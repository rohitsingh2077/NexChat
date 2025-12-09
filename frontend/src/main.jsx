import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { BrowserRouter } from "react-router-dom";
import { AuthContextProvider } from "./Context/authcontext.jsx";
import axios from "axios";

// send cookies with all axios requests so backend `isLogin` middleware receives `req.cookies.jwt`
axios.defaults.withCredentials = true;
createRoot(document.getElementById("root")).render(
  <AuthContextProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </AuthContextProvider>
);