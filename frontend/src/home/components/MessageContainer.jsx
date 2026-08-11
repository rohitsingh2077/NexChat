import { useEffect, useLayoutEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useChat } from "../../Context/SelectedUser";
import { useAuth } from "../../Context/authcontext";
import { useSocketContext } from "../../Context/SocketContext";
import { useProfileModal } from "../../Context/ProfileModalContext";
import TypingIndicator from "./TypingIndicator";

const PAGE_SIZE = 30;

export const Messages = () => {
  const { selectedUser } = useChat();
  const { socket } = useSocketContext();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const bottomRef = useRef(null);
  const { authUser } = useAuth();
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef(null); //to save in re renders
  const isTypingRef = useRef(false);
  const { openProfile } = useProfileModal();

  // Cursor pagination for message history - see docs/interview-notes for
  // the full design. hasMore/nextCursor come from the last page fetched;
  // scrollContainerRef + pendingOlderScrollAdjustRef exist purely to keep
  // the viewport visually still when older messages are prepended above
  // what's currently on screen.
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollContainerRef = useRef(null);
  const pendingOlderScrollAdjustRef = useRef(null);

  //listening for the incoming typing socket
  useEffect(() => {
    if (!socket) return;

    const handleTyping = (fromUserId) => {
      // only show typing if it's the person whose chat is open
      if (fromUserId === selectedUser._id) {
        setIsTyping(true);
      }
    };
    const handleStopTyping = (fromUserId) => {
      if (fromUserId === selectedUser._id) {
        setIsTyping(false);
      }
    };
    socket.on("typing", handleTyping);
    socket.on("stopTyping", handleStopTyping);
    return () => {
      socket.off("typing");
      socket.off("stopTyping");
    };
  }, [socket, selectedUser]);

  // listen for incoming messages once
  useEffect(() => {
    if (!socket) {
      console.log("no socket so returning");
      return;
    }
    const handler = (newMessage) => {
      setMessages((prev) => [...prev, newMessage]);
      // I'm receiving this in realtime while that sender's chat is open, so
      // I'm viewing it immediately - tell the server so the sender gets a
      // seen receipt (see backend/Socket/socket.js message:seen contract).
      if (selectedUser && String(newMessage.senderId) === String(selectedUser._id)) {
        socket.emit("message:seen", { peerId: selectedUser._id });
      }
    };
    // Directly use the callback passed as prop: newMessage
    socket.on("newMessage", handler);

    return () => {
      socket.off("newMessage", handler);
    };
  }, [socket, selectedUser]);

  // determine current user id once (prefer auth context, fallback to chatApp or explicit userId)
  const parsedChatApp = (() => {
    try {
      return JSON.parse(localStorage.getItem("chatApp")) || null;
    } catch {
      return null;
    }
  })();

  const currentUserId =
    (authUser && (authUser._id || authUser.id)) ||
    (parsedChatApp &&
      (parsedChatApp._id || parsedChatApp.user?._id || parsedChatApp.userId)) ||
    localStorage.getItem("userId") ||
    null;

  // Someone I've sent messages to just viewed our conversation - flip my
  // sent/delivered bubbles to "seen". Only applies to the peer currently
  // open, since that's the only conversation rendered in `messages`.
  useEffect(() => {
    if (!socket) return;
    const handleSeen = ({ by }) => {
      if (!selectedUser || String(by) !== String(selectedUser._id)) return;
      setMessages((prev) =>
        prev.map((m) => {
          const senderId = m.senderId && typeof m.senderId === "object" ? m.senderId._id : m.senderId;
          const isMine = String(senderId) === String(currentUserId);
          const isPending = m.status === "failed" || m.status === "sending";
          return isMine && !isPending ? { ...m, status: "seen" } : m;
        })
      );
    };
    socket.on("message:seen", handleSeen);
    return () => socket.off("message:seen", handleSeen);
  }, [socket, selectedUser, currentUserId]);

  //handling the input of the message box
  const handleInput = (e) => {
    setText(e.target.value);

    if (!isTypingRef.current) {
      // tell backend who should receive the typing event
      socket.emit("typing", { to: selectedUser._id });
      isTypingRef.current = true;
    }

    // Clear old timeout if it exists
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stopTyping", { to: selectedUser._id });
      isTypingRef.current = false;
    }, 400);
  };
  // Backend is the real enforcement point (never trust this alone) - this is
  // just a proactive UI guard so the input doesn't invite a send that will
  // just get rejected as NOT_FRIENDS_CANNOT_MESSAGE.
  const isBlocked =
    selectedUser?.messagePrivacy === "private" && selectedUser?.friendshipStatus !== "FRIENDS";

  // Sends (or resends) one logical message identified by clientMessageId.
  // Reusing the same id on retry is what makes a resend safe - the backend
  // recognizes it as the same attempt instead of creating a duplicate
  // message (see messageModel.js LEARNING NOTES).
  const sendOrRetry = async (msg, clientMessageId, isRetry) => {
    setMessages((prev) =>
      isRetry
        ? prev.map((m) =>
            m.clientMessageId === clientMessageId ? { ...m, status: "sending" } : m
          )
        : [
            ...prev,
            {
              clientMessageId,
              senderId: currentUserId,
              message: msg,
              status: "sending",
            },
          ]
    );

    try {
      const res = await axios.post(`/api/message/send/${selectedUser._id}`, {
        message: msg,
        clientMessageId,
      });
      const savedMessage = res.data.message;
      // Reconcile the optimistic bubble with the server-confirmed message
      // (real _id, createdAt, status) by matching on clientMessageId.
      setMessages((prev) =>
        prev.map((m) => (m.clientMessageId === clientMessageId ? savedMessage : m))
      );
    } catch (err) {
      console.error("Error sending message:", err);
      toast.error(err.response?.data?.message || "Failed to send message");
      // Roll back to a failed state rather than removing the bubble, so the
      // user can retry without retyping - retry reuses the same
      // clientMessageId above.
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === clientMessageId ? { ...m, status: "failed" } : m
        )
      );
    }
  };

  const handleSend = () => {
    if (!text.trim() || !selectedUser || isBlocked) return;

    const msg = text.trim();
    setText(""); // clear textbox immediately
    sendOrRetry(msg, crypto.randomUUID(), false);
  };

  const handleRetry = (m) => sendOrRetry(m.message, m.clientMessageId, true);
  // fetching the most recent page of messages
  useEffect(() => {
    if (!selectedUser) {
      setMessages([]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    const fetchMessages = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/message/${selectedUser._id}`, {
          params: { limit: PAGE_SIZE },
        });
        if (res.data && res.data.success) {
          setMessages(res.data.messages || []);
          setHasMore(res.data.hasMore);
          setNextCursor(res.data.nextCursor);
          // Opening this conversation means I've now viewed whatever's on
          // this first page - tell the server so senders get seen receipts.
          if (socket && (res.data.messages || []).length > 0) {
            socket.emit("message:seen", { peerId: selectedUser._id });
          }
        }
      } catch (err) {
        console.error("Failed to fetch messages", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [selectedUser, socket]);

  // Fetches the next-older page and prepends it. Captures the scroll
  // container's current scrollHeight before the DOM updates, so the
  // layout effect below can restore the same visual position afterward
  // instead of the viewport jumping to show the newly inserted content.
  const loadOlderMessages = async () => {
    if (!selectedUser || !hasMore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await axios.get(`/api/message/${selectedUser._id}`, {
        params: { cursor: nextCursor, limit: PAGE_SIZE },
      });
      if (res.data && res.data.success) {
        if (scrollContainerRef.current) {
          pendingOlderScrollAdjustRef.current = scrollContainerRef.current.scrollHeight;
        }
        setMessages((prev) => [...(res.data.messages || []), ...prev]);
        setHasMore(res.data.hasMore);
        setNextCursor(res.data.nextCursor);
      }
    } catch (err) {
      console.error("Failed to load older messages", err);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleMessagesScroll = (e) => {
    if (e.target.scrollTop < 80) {
      loadOlderMessages();
    }
  };

  //scrolling effect - either restores position after prepending older
  //messages, or scrolls to the bottom for a new/sent message (the default).
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (pendingOlderScrollAdjustRef.current !== null && container) {
      container.scrollTop = container.scrollHeight - pendingOlderScrollAdjustRef.current;
      pendingOlderScrollAdjustRef.current = null;
      return;
    }
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);
  // agar koi bhi selected user naa ho to
  if (!selectedUser) {
    return (
      <div className="flex-1 h-screen flex items-center justify-center text-white/60">
        Select a user from the left to start chatting.
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 h-screen flex flex-col text-white">
        {/* Header */}
        <button
          onClick={() => openProfile(selectedUser._id)}
        >
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3 bg-slate-900/40">
            <div className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold">
              {(selectedUser.fullname || selectedUser.username || "?")
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {selectedUser.fullname || selectedUser.username}
              </p>
              {isTyping && (
                // <p className="text-xs text-green-400 animate-pulse">typing...</p>
                <div className="typing-wrapper">
                  <TypingIndicator />
                </div>
              )}
              <p className="text-[11px] text-white/60">Direct messages</p>
            </div>
          </div>
        </button>

        {/* Messages list */}
        <div
          ref={scrollContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        >
          {loading && (
            <p className="text-xs text-white/60">Loading messages...</p>
          )}

          {!loading && loadingOlder && (
            <p className="text-xs text-white/40 text-center pb-2">
              Loading older messages...
            </p>
          )}

          {!loading && messages.length === 0 && (
            <p className="text-xs text-white/50 mt-4 text-center">
              No messages yet. Say hi 👋
            </p>
          )}

          {messages.map((m) => {
            // -----------------------------
            // Determine if message is mine by comparing normalized senderId to `currentUserId`
            // `currentUserId` is computed from AuthContext or localStorage fallback
            // -----------------------------
            const senderId =
              m.senderId && typeof m.senderId === "object"
                ? m.senderId._id || m.senderId.id || ""
                : m.senderId;
            const isMine = String(senderId) === String(currentUserId);
            const isFailed = m.status === "failed";
            const isSending = m.status === "sending";

            return (
              <div
                key={m.clientMessageId || m._id}
                className={`w-fit max-w-[80%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                  isMine
                    ? isFailed
                      ? "ml-auto bg-red-500/70 text-white rounded-br-none"
                      : "ml-auto bg-green-500 text-white rounded-br-none"
                    : "mr-auto bg-blue-500 text-white rounded-bl-none"
                } ${isSending ? "opacity-60" : ""}`}
              >
                <p>{m.message}</p>
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
                  {isFailed ? (
                    <button
                      onClick={() => handleRetry(m)}
                      className="underline underline-offset-2"
                    >
                      Failed to send · Retry
                    </button>
                  ) : isSending ? (
                    <span>Sending...</span>
                  ) : (
                    <>
                      {m.createdAt && (
                        <span>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      {isMine && (
                        <span className={m.status === "seen" ? "text-red-500" : ""}>
                          {m.status === "delivered" || m.status === "seen" ? "✓✓" : "✓"}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {/* {isTyping && (
          
        )} */}
          <div ref={bottomRef} />
        </div>
        {/* Bottom input bar */}
        {isBlocked ? (
          <div className="px-4 py-4 border-t border-white/10 bg-slate-900/40 text-center text-sm text-white/50">
            {selectedUser.fullname || selectedUser.displayName || selectedUser.username} only accepts
            messages from friends.{" "}
            {selectedUser.friendshipStatus === "REQUEST_SENT"
              ? "Friend request pending."
              : "Send a friend request from Chats to start chatting."}
          </div>
        ) : (
          <div className="px-4 py-3 border-t border-white/10 bg-slate-900/40 backdrop-blur-lg flex items-center gap-3">
            <input
              type="text"
              placeholder="Enter your message..."
              value={text}
              onChange={handleInput}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="
        flex-1
        bg-white/10
        text-white
        placeholder-white/50
        px-4 py-2
        rounded-xl
        border border-white/10
        focus:outline-none
        focus:ring-2 focus:ring-yellow-300
      "
            />

            <button
              onClick={handleSend}
              className="
        bg-yellow-400
        text-black
        px-4 py-2
        rounded-xl
        font-semibold
        hover:bg-yellow-300
        transition
      "
            >
              Send
            </button>
          </div>
        )}
      </div>
    </>
  );
};
