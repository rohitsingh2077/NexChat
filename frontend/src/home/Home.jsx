import { Sidebar } from "./components/Sidebar";
import { Messages } from "./components/MessageContainer";
import { useState } from "react";
export const Home = () => {
  const [profileFlag,setprofileFlag] = useState(false);
  
  return (
    <div className="w-screen h-screen flex text-white">
      <Sidebar />
      <Messages />
      
    </div>
  );
};
