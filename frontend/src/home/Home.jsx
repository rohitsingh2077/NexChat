import { useEffect, useState } from "react";
import axios from "axios";
import { NavRail } from "./components/NavRail";
import { Sidebar } from "./components/Sidebar";
import { Messages } from "./components/MessageContainer";
import { FriendsList } from "./components/FriendsList";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { ServerView } from "./components/ServerView";
import { ProfileBar } from "./components/ProfieBar";
import EditProfileDialog from "./components/UpdateProfile";
import { UserProfileModal } from "./components/UserProfileModal";
import { useAuth } from "../Context/authcontext";
import { useSocketContext } from "../Context/SocketContext";
import { useChat } from "../Context/SelectedUser";
import { ProfileModalProvider } from "../Context/ProfileModalContext";

export const Home = () => {
  const [activeView, setActiveView] = useState("chats");
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { authUser } = useAuth();
  const { socket } = useSocketContext();
  const { setSelectedUser } = useChat();

  // Opened from the global profile modal's "Message" button - switches to
  // the Chats tab with that user's DM open, same shape FriendsList already
  // builds when starting a chat from the Friends tab.
  const handleMessageFromProfile = (profileUser) => {
    setSelectedUser({
      _id: profileUser._id,
      fullname: profileUser.fullname,
      username: profileUser.username,
      profilePicture: profileUser.profilePicture,
      messagePrivacy: profileUser.messagePrivacy,
    });
    setActiveView("chats");
  };

  // Owned here (not in NotificationsPanel) so NavRail's badge count stays
  // accurate even when the Notifications view isn't the active one.
  const fetchIncomingRequests = async () => {
    try {
      const res = await axios.get("/api/friends/requests/incoming");
      if (res.data && res.data.success) {
        setIncomingRequests(res.data.requests || []);
      }
    } catch (err) {
      console.error("Failed to fetch friend requests", err);
    }
  };

  useEffect(() => {
    fetchIncomingRequests();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchIncomingRequests();
    socket.on("friend:request_received", refresh);
    socket.on("friend:request_cancelled", refresh);
    return () => {
      socket.off("friend:request_received", refresh);
      socket.off("friend:request_cancelled", refresh);
    };
  }, [socket]);

  return (
    <ProfileModalProvider>
    <div className="w-screen h-screen flex text-white">
      <NavRail
        activeView={activeView}
        onChangeView={setActiveView}
        notificationCount={incomingRequests.length}
        onOpenProfile={() => setShowProfile(true)}
      />

      {activeView === "chats" && (
        <>
          <Sidebar />
          <Messages />
        </>
      )}
      {activeView === "servers" && <ServerView />}
      {activeView === "friends" && (
        <FriendsList
          onOpenChat={() => setActiveView("chats")}
          incomingRequests={incomingRequests}
          onIncomingChange={setIncomingRequests}
        />
      )}
      {activeView === "notifications" && (
        <NotificationsPanel
          incomingRequests={incomingRequests}
          onIncomingChange={setIncomingRequests}
        />
      )}

      {showProfile && (
        <ProfileBar
          open={showProfile}
          onClose={() => setShowProfile(false)}
          user={authUser}
          onEditProfile={() => setIsEditDialogOpen(true)}
        />
      )}
      <EditProfileDialog
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        user={authUser}
      />
    </div>
    <UserProfileModal onMessage={handleMessageFromProfile} />
    </ProfileModalProvider>
  );
};
