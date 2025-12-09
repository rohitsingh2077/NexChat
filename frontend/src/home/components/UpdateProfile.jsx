// EditProfileDialog.jsx
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useAuth } from "../../Context/authcontext";
const EditProfileDialog = ({ open, onClose, user, onUpdated }) => {
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [about, setAbout] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [saving, setSaving] = useState(false);
  const { setAuthUser } = useAuth();

  // sync form values when user or open changes
  useEffect(() => {
    if (user && open) {
      setFullName(user.fullname || "");
      setGender(user.gender || "");
      setAbout(user.about || "");
      // NOTE: backend field is `profilePicture` but your UI uses `profilePic` – align it
      setProfilePicture(user.profilePicture || user.profilePic || "");
    }
  }, [user, open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!user?._id) return;
    try {
      setSaving(true);
      const res = await axios.patch(`/api/update/${user._id}`, {
        fullname: fullName,
        gender,
        about,
        profilePicture,
      });
      console.log(res.data);
      if (res.data?.success) {
        // inform parent / context
        //so data is updated...
        const upatedData = res.data.user;
        setAuthUser({
          _id: upatedData._id,
          fullname: upatedData.fullname,
          username: upatedData.username,
          profilePic: upatedData.profilePic,
          email: upatedData.email,
          gender: upatedData.gender,
          about: upatedData.about,
        });
        toast.success("Data Updated");
      }
    } catch (err) {
      console.error("Failed to update user", err);
      // you can show a toast here
      toast.error("some error occured");
    } finally {
      setSaving(false);
    }
  };

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

          <h2 className="text-xl font-semibold mb-6">Edit Profile</h2>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Left: profile photo */}
            <div className="flex flex-col items-center md:items-start gap-3 md:w-1/3">
              <div className="w-24 h-24 rounded-full bg-yellow-400 flex items-center justify-center text-black text-3xl font-bold shadow-lg overflow-hidden">
                {profilePicture ? (
                  <img
                    src={profilePicture}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  fullName?.charAt(0)?.toUpperCase() || "U"
                )}
              </div>
              <input
                type="text"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-xs outline-none focus:border-white/60"
                placeholder="Profile picture URL"
                value={profilePicture}
                onChange={(e) => setProfilePicture(e.target.value)}
              />
              <p className="text-[11px] text-white/50">
              </p>
            </div>

            {/* Right: fields */}
            <div className="flex-1 space-y-4">
              {/* Full name */}
              <div>
                <label className="block text-xs text-white/60 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-white/60"
                  placeholder="Your name"
                />
              </div>

              {/* Username (read-only) */}
              <div>
                <label className="block text-xs text-white/60 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={user?.username || ""}
                  disabled
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/60 cursor-not-allowed"
                />
              </div>

              {/* Gender */}
              <div>
                <label className="block text-xs text-white/60 mb-1">
                  Gender
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-white/60"
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>

              {/* About */}
              <div>
                <label className="block text-xs text-white/60 mb-1">
                  About
                </label>
                <textarea
                  rows={3}
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-white/60 resize-none"
                  placeholder="Say something about yourself..."
                />
              </div>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm bg-white/5 text-white/70 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !fullName.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-green-500 hover:bg-green-600 text-white font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default EditProfileDialog;
