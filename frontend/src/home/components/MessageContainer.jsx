import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useChat } from "../../Context/SelectedUser";
import { useAuth } from "../../Context/authcontext";
import { useSocketContext } from "../../Context/SocketContext";
import TypingIndicator from "./TypingIndicator";
import FriendProfileDialog from "./friendProfile";

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
  const [showFriendProfile, setShowFriendProfile] = useState(false);

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
    };
    // Directly use the callback passed as prop: newMessage
    socket.on("newMessage", handler);

    return () => {
      socket.off("newMessage", handler);
    };
  }, [socket]);

  // determine current user id once (prefer auth context, fallback to chatApp or explicit userId)
  const parsedChatApp = (() => {
    try {
      return JSON.parse(localStorage.getItem("chatApp")) || null;
    } catch (e) {
      return null;
    }
  })();

  const currentUserId =
    (authUser && (authUser._id || authUser.id)) ||
    (parsedChatApp &&
      (parsedChatApp._id || parsedChatApp.user?._id || parsedChatApp.userId)) ||
    localStorage.getItem("userId") ||
    null;
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

  //handling the send functionality api
  const handleSend = async () => {
    if (!text.trim() || !selectedUser || isBlocked) return;

    const msg = text.trim();
    setText(""); // clear textbox immediately

    try {
      const res = await axios.post(`/api/message/send/${selectedUser._id}`, {
        message: msg,
      });

      // Backend returns message object EXACTLY as shown
      const savedMessage = res.data;
      // Add the new message to the chat UI
      setMessages((prev) => [...prev, savedMessage.message]);
    } catch (err) {
      console.error("Error sending message:", err);
      toast.error(err.response?.data?.message || "Failed to send message");
      // optional: restore text on error
      setText(msg);
    }
  };
  // fetching all the messages
  useEffect(() => {
    if (!selectedUser) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/message/${selectedUser._id}`);
        console.log(res.data.messages);
        if (res.data && res.data.success) {
          setMessages(res.data.messages || []);
        }
      } catch (err) {
        console.error("Failed to fetch messages", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [selectedUser]);
  //scrolling useEffect
  useEffect(() => {
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
          onClick={() => setShowFriendProfile(true)}
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
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading && (
            <p className="text-xs text-white/60">Loading messages...</p>
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

            return (
              <div
                key={m._id}
                className={`w-fit max-w-[80%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                  isMine
                    ? "ml-auto bg-green-500 text-white rounded-br-none"
                    : "mr-auto bg-blue-500 text-white rounded-bl-none"
                }`}
              >
                <p>{m.message}</p>
                {m.createdAt && (
                  <p className="mt-1 text-[10px] opacity-70 text-right">
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
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
      <FriendProfileDialog
        open={showFriendProfile}
        onClose={() => setShowFriendProfile(false)}
        user={selectedUser}
        me = {authUser}
      />
    </>
  );
};
