import { createContext, useContext, useState } from "react";

// Lets any component, anywhere in the tree, open the global user-profile
// modal by userId - avoids prop-drilling an "openProfile" callback through
// every panel (MembersSidebar, ChannelMessages, FriendsList, ...) that might
// want to trigger it. Same pattern as SelectedUser.jsx's ChatContext.
const ProfileModalContext = createContext(null);

export const ProfileModalProvider = ({ children }) => {
  const [profileUserId, setProfileUserId] = useState(null);

  const value = {
    profileUserId,
    openProfile: (userId) => setProfileUserId(userId),
    closeProfile: () => setProfileUserId(null),
  };

  return (
    <ProfileModalContext.Provider value={value}>{children}</ProfileModalContext.Provider>
  );
};

export const useProfileModal = () => {
  const ctx = useContext(ProfileModalContext);
  if (!ctx) throw new Error("useProfileModal must be used inside ProfileModalProvider");
  return ctx;
};
