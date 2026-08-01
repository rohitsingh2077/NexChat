import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useChat } from "../../Context/SelectedUser";
import { useSocketContext } from "../../Context/SocketContext";

export const Sidebar = () => {
  const [chatters, setChatters] = useState([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const { selectedUser, setSelectedUser } = useChat();
  const debounceRef = useRef(null);
  const { onlineUser } = useSocketContext();
  const [pendingActionId, setPendingActionId] = useState(null);

  useEffect(() => {
    // fetch users you've chatted with
    const fetchChatters = async () => {
      try {
        const res = await axios.get("/api/user/currentChatters");
        if (res.data && res.data.success) {
          setChatters(res.data.chatters || []);
        }
      } catch (err) {
        console.error("Failed to fetch chatters", err);
      }
    };
    fetchChatters();
  }, []);

  useEffect(() => {
    // debounce search requests
    /*Prevents hitting API on every keystroke (reduces spam calls).*/
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search || search.trim().length === 0) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(
          `/api/user/search?search=${encodeURIComponent(search)}`
        );
        if (res.data && res.data.success) {
          setResults(res.data.users || []);
        }
      } catch (err) {
        console.error("Search failed", err);
        setResults([]);
      }
      setLoading(false);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const handleSelect = (user) => {
    setSelectedUser(user);
  };

  const handleAddFriend = async (userId) => {
    try {
      setPendingActionId(userId);
      await axios.post("/api/friends/requests", { receiverId: userId });
      toast.success("Friend request sent");
      setResults((prev) =>
        prev.map((u) => (u._id === userId ? { ...u, friendshipStatus: "REQUEST_SENT" } : u))
      );
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send request");
    } finally {
      setPendingActionId(null);
    }
  };

  const handleRemoveFriend = async (userId) => {
    try {
      setPendingActionId(userId);
      await axios.delete(`/api/friends/${userId}`);
      toast.success("Friend removed");
      setResults((prev) =>
        prev.map((u) => (u._id === userId ? { ...u, friendshipStatus: "NONE" } : u))
      );
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to remove friend");
    } finally {
      setPendingActionId(null);
    }
  };

  // Chatters (existing conversations) come back as full User docs
  // (fullname/profilePicture); search results come back as the shaped
  // public-only object (displayName/avatar). Normalize both here.
  const renderUserRow = (user, showFriendAction = false) => {
    const name = user.fullname || user.displayName || user.username;
    const avatar = user.profilePicture || user.avatar;
    const isOnline = onlineUser?.includes(user._id);
    const isSelected = selectedUser?._id === user._id;

    return (
      <div key={user._id || user.id} className="flex items-center gap-2 px-1">
        <button
          onClick={() => handleSelect(user)}
          className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition
            hover:bg-white/10
            ${isSelected ? "bg-green-500/10 border border-green-500/20 backdrop-blur-sm" : ""}
          `}
        >
          <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold relative">
            {avatar ? (
              <img
                src={avatar}
                alt="Profile"
                className="w-full h-full object-cover rounded-full"
              />
            ) : (
              name?.charAt(0).toUpperCase() || "U"
            )}

            {isOnline && (
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 border-2 border-slate-900 rounded-full shadow-md"></span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{name}</p>
          </div>
        </button>

        {showFriendAction && renderFriendAction(user)}
      </div>
    );
  };

  const renderFriendAction = (user) => {
    const busy = pendingActionId === user._id;
    switch (user.friendshipStatus) {
      case "FRIENDS":
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveFriend(user._id);
            }}
            disabled={busy}
            className="text-[10px] text-red-300 hover:text-red-200 px-2 py-1 rounded-lg bg-white/5 disabled:opacity-50 whitespace-nowrap"
          >
            Remove Friend
          </button>
        );
      case "REQUEST_SENT":
        return (
          <button
            disabled
            className="text-[10px] text-white/40 px-2 py-1 rounded-lg bg-white/5 cursor-not-allowed whitespace-nowrap"
          >
            Request Sent
          </button>
        );
      case "REQUEST_RECEIVED":
        return (
          <span className="text-[10px] text-yellow-300 px-2 whitespace-nowrap">
            Check requests
          </span>
        );
      default:
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleAddFriend(user._id);
            }}
            disabled={busy}
            className="text-[10px] text-black bg-yellow-400 hover:bg-yellow-300 px-2 py-1 rounded-lg font-semibold disabled:opacity-50 whitespace-nowrap"
          >
            Add Friend
          </button>
        );
    }
  };

  return (
    <div className="h-screen w-[320px] bg-white/5 border-r border-white/10 backdrop-blur-xl flex flex-col">
      <div className="px-4 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white tracking-wide">
          Chats
        </h2>
      </div>

      <div className="px-4 py-3">
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search users..."
            className="w-full p-2.5 pl-9 rounded-xl bg-white/10 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-yellow-300 border border-white/10"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/60 text-sm">
            🔍
          </span>
        </div>

        {loading && <p className="text-xs text-white/50 mt-2">Searching...</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {/* Show search results when there is a query */}
        {search && results.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-white/60 px-3 mb-2">Search results</p>
            {results.map((u) => renderUserRow(u, true))}
          </div>
        )}

        {/* Show chatters loaded from backend */}
        <div>
          <p className="text-xs text-white/60 px-3 mb-2">Recent chats</p>
          {chatters.length > 0 ? (
            chatters.map((u) => renderUserRow(u))
          ) : (
            <p className="text-sm text-white/40 text-center mt-4">
              You haven't chatted with anyone yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
