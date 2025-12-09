// ChatContext.jsx
import React, { createContext, useContext, useState } from "react";

const ChatContext = createContext(null);

export const ChatProvider = ({ children }) => {
  const [selectedUser, setSelectedUser] = useState(null);

  // Later you can add more: messages, typing, etc.
  const value = {
    selectedUser,
    setSelectedUser,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
};
