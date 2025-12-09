// login/logout.jsx
import { useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

export const Logout = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const doLogout = async () => {
      try {
        await axios.get("/api/auth/logout", { withCredentials: true });
        localStorage.clear();
        toast.success("Logged out!");
        navigate("/login", { replace: true });
      } catch (err) {
        console.error(err);
        toast.error("Logout failed");
        navigate("/", { replace: true });
      }
    };

    doLogout();
  }, [navigate]);

  return <p className="text-white">Logging out...</p>;
};
