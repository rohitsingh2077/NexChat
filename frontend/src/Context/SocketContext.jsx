import { createContext, useContext, useEffect, useState } from "react";
import io from "socket.io-client";
import { useAuth } from "./authcontext";

const SocketContext = createContext();

export const useSocketContext = () => useContext(SocketContext);

export const SocketContextProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [onlineUser, setOnlineUser] = useState([]);
  const { authUser } = useAuth();
  
  useEffect(() => {
    // if user logs out → close socket
    if (!authUser) {
      if (socket) socket.close();
      setSocket(null);
      return;
    }

    // create new socket connection - identity comes from the jwt cookie
    // (verified server-side), never from a client-supplied userId
    const newSocket = io("http://localhost:3003", {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    
    // Initial snapshot (once, right after connecting) + incremental deltas
    // as other users connect/disconnect - see backend/realtime/handlers/presenceHandler.js
    // for why this replaced resending the whole list on every change.
    newSocket.on("getOnlineUsers", (users) => {
      setOnlineUser(users);
    });
    newSocket.on("user_online", ({ userId }) => {
      setOnlineUser((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    });
    newSocket.on("user_offline", ({ userId }) => {
      setOnlineUser((prev) => prev.filter((id) => id !== userId));
    });

    setSocket(newSocket);

    return () => {
      console.log("Closing socket");
      newSocket.close();
    };

  }, [authUser]);  // <-- ONLY authUser here

  return (
    <SocketContext.Provider value={{ socket, onlineUser }}>
      {children}
    </SocketContext.Provider>
  );
};
