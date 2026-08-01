import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useChat } from "../../Context/SelectedUser";
import { useSocketContext } from "../../Context/SocketContext";
import { ChatIcon, FriendsIcon, MoreIcon, SearchIcon } from "./icons";

// Dedicated "Friends" view - GET /api/friends is the source of truth here,
// separate from the "recent chatters" list in Sidebar (chatters = people
// you've messaged; friends = people who accepted a friend request).
// incomingRequests/onIncomingChange are lifted from Home so the "Requests"
// tab here and the NavRail badge/NotificationsPanel all share one fetch.
export const FriendsList = ({ onOpenChat, incomingRequests, onIncomingChange }) => {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [pendingId, setPendingId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const { setSelectedUser } = useChat();
  const { onlineUser, socket } = useSocketContext();

  const fetchFriends = async () => {
    try {
      const res = await axios.get("/api/friends");
      if (res.data && res.data.success) {
        setFriends(res.data.friends || []);
      }
    } catch (err) {
      console.error("Failed to fetch friends", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFriends();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchFriends();
    socket.on("friend:request_accepted", refresh);
    socket.on("friend:removed", refresh);
    return () => {
      socket.off("friend:request_accepted", refresh);
      socket.off("friend:removed", refresh);
    };
  }, [socket]);

  const handleMessage = (friend) => {
    setSelectedUser({
      _id: friend._id,
      fullname: friend.displayName,
      username: friend.username,
      profilePicture: friend.avatar,
      // Confirmed friends by definition of being in this list - the message
      // privacy gate in MessageContainer never blocks on FRIENDS.
      friendshipStatus: "FRIENDS",
    });
    onOpenChat?.();
  };

  const handleRemove = async (friendId) => {
    try {
      setPendingId(friendId);
      setOpenMenuId(null);
      await axios.delete(`/api/friends/${friendId}`);
      toast.success("Friend removed");
      setFriends((prev) => prev.filter((f) => f._id !== friendId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to remove friend");
    } finally {
      setPendingId(null);
    }
  };

  const handleAcceptRequest = async (requestId) => {
    try {
      setPendingId(requestId);
      await axios.post(`/api/friends/requests/${requestId}/accept`);
      toast.success("Friend request accepted");
      onIncomingChange((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to accept request");
    } finally {
      setPendingId(null);
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      setPendingId(requestId);
      await axios.post(`/api/friends/requests/${requestId}/reject`);
      onIncomingChange((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reject request");
    } finally {
      setPendingId(null);
    }
  };

  const filteredFriends = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return friends;
    return friends.filter((f) =>
      (f.displayName || f.username || "").toLowerCase().includes(term)
    );
  }, [friends, search]);

  const onlineFriends = filteredFriends.filter((f) => onlineUser?.includes(f._id));
  const offlineFriends = filteredFriends.filter((f) => !onlineUser?.includes(f._id));

  const renderFriendRow = (friend) => {
    const isOnline = onlineUser?.includes(friend._id);
    const name = friend.displayName || friend.username;
    return (
      <div
        key={friend._id}
        className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/5 rounded-lg group"
      >
        <div className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold shrink-0 overflow-hidden">
          {friend.avatar ? (
            <img src={friend.avatar} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            name?.charAt(0).toUpperCase() || "U"
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{name}</p>
          <p className={`text-xs flex items-center gap-1.5 ${isOnline ? "text-green-400" : "text-white/40"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-400" : "bg-white/30"}`} />
            {isOnline ? "Online" : "Offline"}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition shrink-0">
          <button
            onClick={() => handleMessage(friend)}
            title="Message"
            className="p-2 rounded-lg hover:bg-white/10 text-white/70"
          >
            <ChatIcon size={16} />
          </button>
          <div className="relative">
            <button
              onClick={() => setOpenMenuId((id) => (id === friend._id ? null : friend._id))}
              title="More"
              className="p-2 rounded-lg hover:bg-white/10 text-white/70"
            >
              <MoreIcon size={16} />
            </button>
            {openMenuId === friend._id && (
              <div className="absolute right-0 top-9 bg-slate-800 border border-white/10 rounded-lg shadow-lg py-1 w-40 z-10">
                <button
                  onClick={() => handleRemove(friend._id)}
                  disabled={pendingId === friend._id}
                  className="w-full text-left px-3 py-2 text-xs text-red-300 hover:bg-white/5 disabled:opacity-50"
                >
                  Remove Friend
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const tabs = [
    { key: "all", label: "All Friends", count: friends.length },
    { key: "online", label: "Online", count: onlineFriends.length },
    { key: "requests", label: "Requests", count: incomingRequests.length },
  ];

  return (
    <div
      className="h-screen flex-1 flex flex-col text-white"
      onClick={() => openMenuId && setOpenMenuId(null)}
    >
      <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
        <FriendsIcon size={20} />
        <h2 className="text-lg font-semibold">Friends</h2>
      </div>

      <div className="px-5 pt-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
            <SearchIcon size={15} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search friends..."
            className="w-full py-2 pl-9 pr-3 rounded-lg bg-white/5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-blue-400 border border-white/10"
          />
        </div>
      </div>

      <div className="flex items-center gap-5 px-5 mt-4 border-b border-white/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative pb-2.5 text-sm font-medium flex items-center gap-1.5 ${
              tab === t.key ? "text-blue-400" : "text-white/50 hover:text-white/80"
            }`}
          >
            {t.label}
            <span
              className={`text-[11px] font-semibold rounded-full px-1.5 py-0.5 ${
                tab === t.key ? "bg-blue-500/20 text-blue-300" : "bg-white/10 text-white/60"
              }`}
            >
              {t.count}
            </span>
            {tab === t.key && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading && <p className="text-sm text-white/50 px-5 py-3">Loading...</p>}

        {!loading && tab !== "requests" && filteredFriends.length === 0 && (
          <p className="text-sm text-white/40 text-center mt-8">
            {friends.length === 0
              ? "No friends yet - search for people in Chats to add some."
              : "No friends match your search."}
          </p>
        )}

        {!loading && tab === "all" && (
          <>
            {onlineFriends.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide px-5 py-1.5">
                  Online — {onlineFriends.length}
                </p>
                {onlineFriends.map(renderFriendRow)}
              </div>
            )}
            {offlineFriends.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide px-5 py-1.5">
                  Offline — {offlineFriends.length}
                </p>
                {offlineFriends.map(renderFriendRow)}
              </div>
            )}
          </>
        )}

        {!loading && tab === "online" && onlineFriends.map(renderFriendRow)}

        {tab === "requests" &&
          (incomingRequests.length > 0 ? (
            incomingRequests.map((r) => (
              <div key={r.requestId} className="flex items-center gap-3 px-5 py-2.5">
                <div className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold shrink-0 overflow-hidden">
                  {r.user?.avatar ? (
                    <img src={r.user.avatar} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    (r.user?.displayName || r.user?.username)?.charAt(0).toUpperCase() || "U"
                  )}
                </div>
                <p className="flex-1 min-w-0 text-sm font-medium text-white truncate">
                  {r.user?.displayName || r.user?.username}
                </p>
                <button
                  onClick={() => handleAcceptRequest(r.requestId)}
                  disabled={pendingId === r.requestId}
                  className="text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleRejectRequest(r.requestId)}
                  disabled={pendingId === r.requestId}
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-white/40 text-center mt-8">No pending requests</p>
          ))}
      </div>
    </div>
  );
};
