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

    // create new socket connection
    const newSocket = io("http://localhost:3000", {
      auth: { userId: authUser._id },
      query: { userId: authUser._id },
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
