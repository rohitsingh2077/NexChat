import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Route, Routes } from "react-router-dom";

// external modules
import { Signup } from "./login/Signup.jsx";
import { Login } from "./login/login";
import { Home } from "./home/home.jsx";
import { VerifyUser } from "./utils/VerifyUser.jsx";
import { ChatProvider } from "./Context/SelectedUser.jsx";
import { Logout } from "./login/logout.jsx";
import { SocketContextProvider } from "./Context/SocketContext.jsx";
function App() {
  return (
    <SocketContextProvider>
      <ChatProvider>
      <div className="p2 w-screen h-screen flex items-center justify-center">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/logout" element={<Logout />} />
          <Route element={<VerifyUser />}>
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>

        <ToastContainer position="top-center" autoClose={2000} />
      </div>
    </ChatProvider>
    </SocketContextProvider>
    
  );
}
export default App;
