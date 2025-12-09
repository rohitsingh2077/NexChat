import React from "react";

export const ProfileBar = ({ open, onClose, user, onEditProfile }) => {
  return (
    <>
      {/* Overlay (click anywhere to close) */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 z-40 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      ></div>

      {/* Right Sliding Panel */}
      <div
        className={`
          fixed top-0 right--100 h-full w-[320px] 
          bg-slate-900/80 backdrop-blur-xl border-l border-white/10 
          shadow-xl z-50 
          border-r-8
          transform transition-transform duration-300 
          ${open ? "translate-x-0" : "translate-x-full"}
        `}
      >
        {/* Close Button */}
        <div className="flex justify-end p-4">
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white text-xl"
          >
            ✕
          </button>
        </div>

        {/* Profile Details */}
        <div className="flex flex-col items-center px-6 py-4 text-white">
          {/* Profile Picture */}
          <div className="w-24 h-24 rounded-full bg-yellow-400 flex items-center justify-center text-black text-4xl font-bold shadow-lg overflow-hidden">
            {user?.profilePic ? (
              <img
                src={user.profilePic}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              user?.fullname?.charAt(0).toUpperCase() || "U"
            )}
          </div>
          {/* Full Name */}
          <h2 className="text-2xl font-bold mt-4 drop-shadow-[0_0_4px_rgba(255,255,255,0.5)]">
            {user?.fullname || "Unknown User"}
          </h2>
          {/* Username */}
          <p className="text-white/60 text-sm">
            @{user?.username || "username"}
          </p>
          <div className="mt-2">
            <button
              onClick={() => onEditProfile?.()}
              className="
      group relative w-full
      text-white/80 text-sm font-medium
      py-2 rounded-xl
      bg-white/5 border border-white/10
      hover:bg-white/10 hover:border-white/20
      transition-all duration-300 ease-out
      overflow-hidden
      flex items-center justify-center gap-2
      px-3
    "
            >
              {/* Glow Animation */}
              <span
                className="
      absolute inset-0 bg-gradient-to-r from-yellow-300/0 via-yellow-300/10 to-yellow-300/0
      opacity-0 group-hover:opacity-100
      blur-xl transition-all duration-500
    "
              />
              <span className="group-hover:text-white transition-colors duration-300">
                Edit Profile
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="w-full h-px bg-white/10 my-5"></div>
          {/* Information List */}
          <div className="w-full space-y-4 text-white/80">
            <div>
              <p className="text-xs text-white/50">Gender</p>
              <p className="font-semibold">{user?.gender || "Not specified"}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">About</p>
              <p className="font-semibold">{user?.about || "Not specified"}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Email</p>
              <p className="font-semibold break-all">{user?.email || "N/A"}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Phone</p>
              <p className="font-semibold">{user?.phone || "Not provided"}</p>
            </div>
            <button className="test-xs text-white/50">
              <a href="/logout">Logout</a>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
