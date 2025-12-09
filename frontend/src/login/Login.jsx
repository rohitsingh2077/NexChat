import axios from "axios";
import React, { useState } from "react";
import { toast } from "react-toastify";
//also import useNavigate to navigate to the home page
import { useNavigate } from "react-router-dom";
import { useAuth } from "../Context/authcontext";

export const Login = () => {
  const [userInput, setuserInput] = useState({
    username: "",
    password: "",
  });
  const {setAuthUser} = useAuth();
  const navigate = useNavigate();
  const [loading, setloading] = useState(false);

  const handleinput = (e) => {
    const { name, value } = e.target;
    setuserInput((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); //stops form reload
    setloading(true);

    try {
      const res = await axios.post("/api/auth/login", userInput);
      const data = res.data;
      if (data.success === false) {
        toast.error(data.message || "Login failed");
        return; // stop here
      }
      toast.success(data.message || "Login successful");
      localStorage.setItem("chatApp", JSON.stringify(data));
      setAuthUser(data);
      navigate("/");
    } catch (error) {
      console.log("Login error:", error.response?.data || error);
      toast.error("some error occured");
    } finally {
      setloading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1f2d3a] relative overflow-hidden">
      {/* Background Cat */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex items-center gap-4">
        <div className="w-6 h-6 rounded-full bg-black"></div>
        <div className="w-28 h-28 bg-black rounded-t-full relative">
          <div className="absolute w-4 h-4 bg-black rounded-full -top-1 -left-3 rotate-45"></div>
          <div className="absolute w-4 h-4 bg-black rounded-full -top-1 -right-3 rotate-45"></div>

          {/* Cat Eyes */}
          <div className="absolute inset-x-0 top-8 flex justify-center gap-6">
            <div className="w-4 h-4 rounded-full border-2 border-yellow-300"></div>
            <div className="w-4 h-4 rounded-full border-2 border-yellow-300"></div>
          </div>
        </div>
        <div className="w-6 h-6 rounded-full bg-black"></div>
      </div>

      {/* Login Card */}
      <div className="bg-white/10 backdrop-blur-xl p-10 rounded-2xl shadow-xl border border-white/20 w-[350px]">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">
          Welcome Back 👋
        </h2>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <input
            type="text"
            onChange={handleinput}
            placeholder="Username"
            name="username"
            value={userInput.username}
            className="p-3 rounded-xl bg-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            required
          />

          <input
            type="password"
            name="password"
            onChange={handleinput}
            value={userInput.password}
            placeholder="Password"
            className="p-3 rounded-xl bg-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            required
          />

          <button
            type="submit"
            className="mt-2 bg-yellow-400 hover:bg-yellow-300 text-black font-semibold py-2 rounded-xl transition"
            disabled={loading}
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>

        <p className="text-white/60 text-center mt-4 text-sm">
          Don't have an account?{" "}
          <span className="text-yellow-300 cursor-pointer">
            <a href="/signup">Sign up</a>
          </span>
        </p>
      </div>
    </div>
  );
};
