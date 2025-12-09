import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useChat } from "../../Context/SelectedUser";
import { useAuth } from "../../Context/authcontext";
import { ProfileBar } from "./ProfieBar";
import { useSocketContext } from "../../Context/SocketContext";
import EditProfileDialog from "./UpdateProfile";

export const Sidebar = () => {
  const [chatters, setChatters] = useState([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const { selectedUser, setSelectedUser } = useChat();
  const debounceRef = useRef(null);
  const { authUser } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const { onlineUser } = useSocketContext();
  const [newMessage, setnewMessageUsers] = useState("");
  const [isProfileBarOpen, setIsProfileBarOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  useEffect(() => {
    // fetch users you've chatted with
    const fetchChatters = async () => {
      try {
        const res = await axios.get("/api/user/currentChatters");
        if (res.data && res.data.success) {
          setChatters(res.data.chatters || []);
        } else {
          console.log(`chatters nhi mil paye bhai`);
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
    console.log(`selected user is : `, user);
  };

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

  const renderUserRow = (user, hint = null) => {
    const isOnline = onlineUser?.includes(user._id);
    return (
      <button
        key={user._id || user.id}
        onClick={() => handleSelect(user)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-white/10 transition"
      >
        <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold relative">
          {user?.profilePicture ? (
            <img
              src={user.profilePicture}
              alt="Profile"
              className="w-full h-full object-cover rounded-full"
            />
          ) : (
            user?.fullname?.charAt(0).toUpperCase() || "U"
          )}

          {isOnline && (
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 border-2 border-slate-900 rounded-full shadow-md"></span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center">
            <p className="text-sm font-medium text-white truncate">
              {user.fullname || user.username}
            </p>
            {hint && (
              <span className="text-[10px] text-white/50 whitespace-nowrap ml-2">
                {hint}
              </span>
            )}
          </div>
          <div className="inline-flex items-center rounded-full bg-green-600/90 text-white text-xs font-medium px-2.5 py-0.5 shadow">
            +1
          </div>

          {user.lastMessage && (
            <p className="text-xs text-white/60 truncate">{user.lastMessage}</p>
          )}
        </div>
      </button>
    );
    //selected user ki chats dikhani padengi in the right hand side
  };
  return (
    <>
    <div className="h-screen w-[320px] bg-white/5 border-r border-white/10 backdrop-blur-xl flex flex-col">
      <div className="px-4 py-4 border-b border-white/10">
        <button onClick={() => setShowProfile(true)}>
          <p className="text-left text-xl font-bold bg-gradient-to-r from-yellow-300 to-orange-400 bg-clip-text text-transparent tracking-wide">
            {authUser.fullname}
          </p>
        </button>

        <h2 className="text-lg font-semibold text-white tracking-wide">
          Chats
        </h2>
      </div>
      {showProfile && (
        <ProfileBar
          open={showProfile}
          onClose={() => setShowProfile(false)}
          user={authUser}
          onEditProfile={() => setIsEditDialogOpen(true)}
        />
      )}

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
            {results.map((u) => renderUserRow(u))}
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
    <EditProfileDialog
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        user={authUser}
      />
    </>
  );
};

/*Next thing to create -> app should 
1.show how many messages pending to see
2.typing functionality
3.enhance the overall profile of the user including provinding setting for them
*/
