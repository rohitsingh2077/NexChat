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
    
    // online users update
    newSocket.on("getOnlineUsers", (users) => {
      setOnlineUser(users);
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
