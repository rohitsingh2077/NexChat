import React from "react";
import { useAuth } from "../../Context/authcontext";
import { ChatIcon, FriendsIcon, BellIcon, ServerIcon } from "./icons";

const NAV_ITEMS = [
  { key: "friends", label: "Friends", Icon: FriendsIcon },
  { key: "chats", label: "Chats", Icon: ChatIcon },
  { key: "servers", label: "Servers", Icon: ServerIcon },
  { key: "notifications", label: "Notifications", Icon: BellIcon },
];

// Simple list-style nav (icon + label rows, active = soft highlight pill) -
// deliberately not the chunky icon-grid version this replaced.
export const NavRail = ({ activeView, onChangeView, notificationCount = 0, onOpenProfile }) => {
  const { authUser } = useAuth();

  return (
    <div className="h-screen w-56 bg-black/30 border-r border-white/10 flex flex-col py-4 shrink-0">
      <div className="px-3 flex flex-col gap-1">
        {NAV_ITEMS.map(({ key, label, Icon }) => {
          const active = activeView === key;
          return (
            <button
              key={key}
              onClick={() => onChangeView(key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition
                ${active ? "bg-blue-500/15 text-blue-400" : "text-white/70 hover:bg-white/5 hover:text-white"}
              `}
            >
              <Icon size={18} />
              <span className="flex-1 text-left">{label}</span>
              {key === "notifications" && notificationCount > 0 && (
                <span className="bg-red-500 text-white text-[11px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                  {notificationCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      <div className="px-3 pt-3 border-t border-white/10">
        <button
          onClick={onOpenProfile}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition"
        >
          <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold overflow-hidden shrink-0">
            {authUser?.profilePic ? (
              <img src={authUser.profilePic} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              authUser?.fullname?.charAt(0).toUpperCase() || "U"
            )}
          </div>
          <span className="text-sm font-medium text-white/80 truncate">{authUser?.fullname}</span>
        </button>
      </div>
    </div>
  );
};
