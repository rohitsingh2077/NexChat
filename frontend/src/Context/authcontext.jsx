import { createContext, useContext, useState,useEffect } from "react";

export const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthContextProvider = ({ children }) => {
  const [authUser, setAuthUser] = useState(
    JSON.parse(localStorage.getItem("chatApp")) || null
  );
  useEffect(() => {
    if (authUser) {
      localStorage.setItem("chatApp", JSON.stringify(authUser));
    } else {
      localStorage.removeItem("chatApp");
    }
  }, [authUser]); // this is for updation

  return (
    <AuthContext.Provider value={{ authUser, setAuthUser }}>
      {children}
    </AuthContext.Provider>
  );
};
//global access ke liye bahut mast cheez hai
