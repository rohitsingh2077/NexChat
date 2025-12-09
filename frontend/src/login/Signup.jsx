import React from "react";
import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useAuth } from "../Context/authcontext";
export const Signup = () => {
  const [input, setUserinput] = useState({});
  const [loading, setloading] = useState(false);
  const navigate = useNavigate();
  const {setAuthUser} = useAuth();
  const handleInput = (e) => {
    const { name, value } = e.target;
    setUserinput((prev) => ({
      ...prev,
      [name]: value,
    }));
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    setloading(true);
    try {
      const res = await axios.post("/api/auth/register", input);
      const data = res.data;
      console.log(data);
      if (data.success === false) {
        toast.error(data.message || "Signup failed");
        return;
      }
      localStorage.setItem("chatApp", JSON.stringify(data));
      toast.success("successfully registered");
      setAuthUser(data);
      navigate("/login");
    } catch (error) {
      console.log("Signup error:", error.response?.data || error);
      toast.error("some error occured");
    }finally{
      setloading(false);
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1f2d3a] relative overflow-hidden">
      {/* Background Cat (same as login for consistency) */}
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

      {/* Signup Card */}
      <div className="bg-white/10 backdrop-blur-xl p-10 rounded-2xl shadow-xl border border-white/20 w-[370px]">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">
          Create Account ✨
        </h2>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Full Name"
            name="fullname"
            className="p-3 rounded-xl bg-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            onChange={handleInput}
          />

          <input
            type="text"
            placeholder="Username"
            name="username"
            className="p-3 rounded-xl bg-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            onChange={handleInput}
          />
          <label className="text-sm text-white/70">Gender</label>
          <select
            name="gender"
            className="
    p-3 
    rounded-xl 
    bg-white/20 
    backdrop-blur-xl 
    text-white 
    border 
    border-white/20
    focus:outline-none 
    focus:ring-2 
    focus:ring-yellow-300 
    appearance-none
  "
            onChange={handleInput}
            defaultValue=""
          >
            <option value="" disabled className="bg-[#1f2d3a] text-white">
              Select gender
            </option>
            <option value="male" className="bg-[#1f2d3a] text-white">
              Male
            </option>
            <option value="female" className="bg-[#1f2d3a] text-white">
              Female
            </option>
          </select>

          <input
            type="email"
            name="email"
            placeholder="Email"
            className="p-3 rounded-xl bg-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            onChange={handleInput}
          />

          <input
            type="password"
            placeholder="Password"
            name="password"
            className="p-3 rounded-xl bg-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            onChange={handleInput}
          />

          <button
            type="submit"
            className="mt-2 bg-yellow-400 hover:bg-yellow-300 text-black font-semibold py-2 rounded-xl transition"
            disabled={loading}
          >
            {loading ? "Creating..." : "Sign Up"}
          </button>
        </form>

        <p className="text-white/60 text-center mt-4 text-sm">
          Already have an account?{" "}
          <span className="text-yellow-300 cursor-pointer"><a href="/login">Login</a></span>
        </p>
      </div>
    </div>
  );
};
