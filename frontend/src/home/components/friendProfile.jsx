// friendprofile.jsx
// Dialogue box for friend profile (view only)

import React from "react";

const FriendProfileDialog = ({ open, onClose, user, me }) => {
  if (!open || !user) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Centered dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="bg-slate-900/90 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl 
                     text-white p-6 md:p-8 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-white/60 hover:text-white text-xl"
          >
            ✕
          </button>

          <h2 className="text-xl font-semibold mb-6">Profile</h2>
          <p className="text-white/60 text-sm mb-5 m-auto">
            Hey {me?.fullname}👋
          </p>
          <div className="flex flex-col md:flex-row gap-6">
            {/* Left: profile photo */}
            <div className="flex flex-col items-center md:items-start gap-3 md:w-1/3">
              <div className="w-24 h-24 rounded-full bg-yellow-400 flex items-center justify-center text-black text-3xl font-bold shadow-lg overflow-hidden">
                {user.profilePicture ? (
                  <img
                    src={user.profilePicture}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  user.fullname?.charAt(0)?.toUpperCase() || "U"
                )}
              </div>

              <p className="text-sm font-semibold mt-2 text-center md:text-left">
                {user.fullname || "Unknown User"}
              </p>
              <p className="text-xs text-white/60">
                @{user.username || "username"}
              </p>
            </div>

            {/* Right: fields (read-only) */}
            <div className="flex-1 space-y-4">
              {/* Full name */}
              <div>
                <p className="text-xs text-white/60 mb-1">Full Name</p>
                <p className="text-sm font-medium">
                  {user.fullname || "Not provided"}
                </p>
              </div>

              {/* Username */}
              <div>
                <p className="text-xs text-white/60 mb-1">Username</p>
                <p className="text-sm font-mono text-white/80">
                  @{user.username || "username"}
                </p>
              </div>

              {/* Gender */}
              <div>
                <p className="text-xs text-white/60 mb-1">Gender</p>
                <p className="text-sm font-medium">
                  {user.gender || "Not specified"}
                </p>
              </div>

              {/* About */}
              <div>
                <p className="text-xs text-white/60 mb-1">About</p>
                <p className="text-sm text-white/80 whitespace-pre-line">
                  {user.about || "No bio added yet."}
                </p>
              </div>

              {/* Email (optional) */}
              {user.email && (
                <div>
                  <p className="text-xs text-white/60 mb-1">Email</p>
                  <p className="text-sm text-white/80 break-all">
                    {user.email}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm bg-white/5 text-white/70 hover:bg-white/10 transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default FriendProfileDialog;
