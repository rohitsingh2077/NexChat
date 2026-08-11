import { useEffect, useLayoutEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useAuth } from "../../Context/authcontext";
import { useSocketContext } from "../../Context/SocketContext";
import { useProfileModal } from "../../Context/ProfileModalContext";
import { HashIcon, UsersIcon, SendIcon, EditIcon, TrashIcon } from "./icons";

const PAGE_SIZE = 30;
const TYPING_EXPIRY_MS = 3000;

// Wraps a socket emit-with-ack in a Promise, with a client-side timeout so a
// dropped connection doesn't leave the UI hanging forever waiting for an ack
// that will never arrive.
const emitAck = (socket, event, payload, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });

export const ChannelMessages = ({ server, channel, role, members, onToggleMembers }) => {
  const { socket } = useSocketContext();
  const { authUser } = useAuth();
  const { openProfile } = useProfileModal();
  const currentUserId = authUser?._id || authUser?.id;

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typingUsers, setTypingUsers] = useState({}); // userId -> true
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");

  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const pendingOlderScrollAdjustRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const typingExpiryTimersRef = useRef({});

  const memberById = (userId) => members.find((m) => String(m.user._id) === String(userId))?.user;
  const canModerate = role === "owner" || role === "admin";

  // Subscribe this socket to the channel's room for the duration this
  // channel is open - see backend/realtime/handlers/channelHandler.js.
  useEffect(() => {
    if (!socket || !channel) return;
    socket.emit("join_channel", { channelId: channel._id });
    return () => socket.emit("leave_channel", { channelId: channel._id });
  }, [socket, channel]);

  // Load the first page whenever the selected channel changes.
  useEffect(() => {
    if (!channel) return;
    setTypingUsers({});
    Object.values(typingExpiryTimersRef.current).forEach(clearTimeout);
    typingExpiryTimersRef.current = {};

    const fetchMessages = async () => {
      try {
        setLoading(true);
        const res = await axios.get(
          `/api/servers/${server._id}/channels/${channel._id}/messages`,
          { params: { limit: PAGE_SIZE } }
        );
        if (res.data?.success) {
          setMessages(res.data.messages || []);
          setHasMore(res.data.hasMore);
          setNextCursor(res.data.nextCursor);
        }
      } catch (err) {
        console.error("Failed to fetch channel messages", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
  }, [server._id, channel]);

  // Realtime: new/edited/deleted messages, and channel-scoped typing.
  useEffect(() => {
    if (!socket || !channel) return;

    const handleNew = ({ message }) => {
      if (message.channelId !== channel._id) return;
      setMessages((prev) => [...prev, message]);
    };
    const handleEdited = ({ message }) => {
      if (message.channelId !== channel._id) return;
      setMessages((prev) => prev.map((m) => (m._id === message._id ? message : m)));
    };
    const handleDeleted = ({ messageId }) => {
      setMessages((prev) => prev.filter((m) => m._id !== messageId));
    };
    const handleTyping = ({ channelId, userId }) => {
      if (channelId !== channel._id || String(userId) === String(currentUserId)) return;
      setTypingUsers((prev) => ({ ...prev, [userId]: true }));
      if (typingExpiryTimersRef.current[userId]) {
        clearTimeout(typingExpiryTimersRef.current[userId]);
      }
      typingExpiryTimersRef.current[userId] = setTimeout(() => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }, TYPING_EXPIRY_MS);
    };

    socket.on("new_message", handleNew);
    socket.on("message_edited", handleEdited);
    socket.on("message_deleted", handleDeleted);
    socket.on("typing", handleTyping);
    return () => {
      socket.off("new_message", handleNew);
      socket.off("message_edited", handleEdited);
      socket.off("message_deleted", handleDeleted);
      socket.off("typing", handleTyping);
    };
  }, [socket, channel, currentUserId]);

  const loadOlderMessages = async () => {
    if (!hasMore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await axios.get(
        `/api/servers/${server._id}/channels/${channel._id}/messages`,
        { params: { cursor: nextCursor, limit: PAGE_SIZE } }
      );
      if (res.data?.success) {
        if (scrollContainerRef.current) {
          pendingOlderScrollAdjustRef.current = scrollContainerRef.current.scrollHeight;
        }
        setMessages((prev) => [...(res.data.messages || []), ...prev]);
        setHasMore(res.data.hasMore);
        setNextCursor(res.data.nextCursor);
      }
    } catch (err) {
      console.error("Failed to load older channel messages", err);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleMessagesScroll = (e) => {
    if (e.target.scrollTop < 80) loadOlderMessages();
  };

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (pendingOlderScrollAdjustRef.current !== null && container) {
      container.scrollTop = container.scrollHeight - pendingOlderScrollAdjustRef.current;
      pendingOlderScrollAdjustRef.current = null;
      return;
    }
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleInput = (e) => {
    setText(e.target.value);
    if (!isTypingRef.current) {
      socket.emit("typing", { channelId: channel._id });
      isTypingRef.current = true;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
    }, 400);
  };

  // Same idempotent-retry shape as DM sendOrRetry: one clientMessageId per
  // logical send attempt, reused on retry. See docs/interview-notes/channel-messaging.md.
  const sendOrRetry = async (content, clientMessageId, isRetry) => {
    setMessages((prev) =>
      isRetry
        ? prev.map((m) =>
            m.clientMessageId === clientMessageId ? { ...m, status: "sending" } : m
          )
        : [
            ...prev,
            { clientMessageId, senderId: currentUserId, content, status: "sending" },
          ]
    );

    try {
      const ack = await emitAck(socket, "send_message", {
        channelId: channel._id,
        content,
        clientMessageId,
      });
      if (!ack.success) throw new Error(ack.error || "Send failed");
      setMessages((prev) =>
        prev.map((m) => (m.clientMessageId === clientMessageId ? ack.message : m))
      );
    } catch (err) {
      toast.error(err.message || "Failed to send message");
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === clientMessageId ? { ...m, status: "failed" } : m
        )
      );
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    const msg = text.trim();
    setText("");
    sendOrRetry(msg, crypto.randomUUID(), false);
  };

  const handleRetry = (m) => sendOrRetry(m.content, m.clientMessageId, true);

  const startEdit = (m) => {
    setEditingId(m._id);
    setEditText(m.content);
  };

  const submitEdit = async (m) => {
    if (!editText.trim()) return;
    try {
      const ack = await emitAck(socket, "edit_message", {
        channelId: channel._id,
        messageId: m._id,
        content: editText.trim(),
      });
      if (!ack.success) throw new Error(ack.error || "Edit failed");
      setMessages((prev) => prev.map((x) => (x._id === m._id ? ack.message : x)));
      setEditingId(null);
    } catch (err) {
      toast.error(err.message || "Failed to edit message");
    }
  };

  const handleDelete = async (m) => {
    try {
      const ack = await emitAck(socket, "delete_message", {
        channelId: channel._id,
        messageId: m._id,
      });
      if (!ack.success) throw new Error(ack.error || "Delete failed");
      setMessages((prev) => prev.filter((x) => x._id !== m._id));
    } catch (err) {
      toast.error(err.message || "Failed to delete message");
    }
  };

  const typingNames = Object.keys(typingUsers)
    .map((id) => memberById(id)?.fullname || memberById(id)?.username)
    .filter(Boolean);

  return (
    <div className="flex-1 h-screen flex flex-col text-white min-w-0">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-slate-900/40">
        <div className="flex items-center gap-2 min-w-0">
          <HashIcon size={18} />
          <span className="font-semibold truncate">{channel.name}</span>
        </div>
        <button
          onClick={onToggleMembers}
          className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/5"
          title="Members"
        >
          <UsersIcon size={18} />
        </button>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {loading && <p className="text-xs text-white/60">Loading messages...</p>}
        {!loading && loadingOlder && (
          <p className="text-xs text-white/40 text-center pb-2">Loading older messages...</p>
        )}
        {!loading && messages.length === 0 && (
          <p className="text-xs text-white/50 mt-4 text-center">
            No messages yet in #{channel.name}. Say hi 👋
          </p>
        )}

        {messages.map((m) => {
          const senderId = m.senderId && typeof m.senderId === "object" ? m.senderId._id : m.senderId;
          const isMine = String(senderId) === String(currentUserId);
          const sender = memberById(senderId);
          const name = isMine ? "You" : sender?.fullname || sender?.username || "Unknown";
          const isFailed = m.status === "failed";
          const isSending = m.status === "sending";
          const canDelete = isMine || canModerate;
          const isEditing = editingId === m._id;

          return (
            <div key={m.clientMessageId || m._id} className="group flex items-start gap-3">
              <button
                onClick={() => openProfile(senderId)}
                className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold shrink-0 overflow-hidden"
              >
                {sender?.profilePicture ? (
                  <img src={sender.profilePicture} alt="" className="w-full h-full object-cover" />
                ) : (
                  name.charAt(0).toUpperCase()
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <button
                    onClick={() => openProfile(senderId)}
                    className="text-sm font-semibold text-white hover:underline"
                  >
                    {name}
                  </button>
                  {m.createdAt && (
                    <span className="text-[10px] text-white/40">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  {m.editedAt && <span className="text-[10px] text-white/30">(edited)</span>}
                </div>

                {isEditing ? (
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitEdit(m);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-400"
                    />
                    <button onClick={() => submitEdit(m)} className="text-xs text-blue-400 hover:text-blue-300">
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-white/50 hover:text-white/80">
                      Cancel
                    </button>
                  </div>
                ) : isFailed ? (
                  <button
                    onClick={() => handleRetry(m)}
                    className="text-sm text-red-300 underline underline-offset-2"
                  >
                    Failed to send · Retry
                  </button>
                ) : (
                  <p className={`text-sm text-white/90 break-words ${isSending ? "opacity-60" : ""}`}>
                    {m.content}
                  </p>
                )}
              </div>

              {!isEditing && !isFailed && !isSending && canDelete && (
                <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 shrink-0">
                  {isMine && (
                    <button
                      onClick={() => startEdit(m)}
                      className="text-white/40 hover:text-white p-1 rounded"
                      title="Edit"
                    >
                      <EditIcon />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(m)}
                    className="text-white/40 hover:text-red-400 p-1 rounded"
                    title="Delete"
                  >
                    <TrashIcon />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {typingNames.length > 0 && (
          <p className="text-xs text-white/40 italic">
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-white/10 bg-slate-900/40 backdrop-blur-lg flex items-center gap-3">
        <input
          type="text"
          placeholder={`Message #${channel.name}`}
          value={text}
          onChange={handleInput}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          className="flex-1 bg-white/10 text-white placeholder-white/50 px-4 py-2 rounded-xl border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={handleSend}
          className="bg-blue-500 text-white p-2.5 rounded-xl hover:bg-blue-600 transition"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
};
