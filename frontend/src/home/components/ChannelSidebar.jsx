import { useState } from "react";
import { HashIcon, PlusIcon, ChevronDownIcon } from "./icons";
import { ResizeHandle, useResizableWidth } from "./ResizeHandle";

export const ChannelSidebar = ({
  server,
  role,
  channels,
  selectedChannelId,
  onSelectChannel,
  onCreateChannelClick,
  onLeaveServer,
  onOpenJoinRequests,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const canManageChannels = role === "owner" || role === "admin";
  const canReviewRequests =
    canManageChannels && server.joinPolicy === "approval_required";
  const { width, startDrag } = useResizableWidth({
    storageKey: "nexchat:channelSidebarWidth",
    defaultWidth: 240,
    min: 180,
    max: 360,
    direction: 1,
  });

  return (
    <div className="h-screen flex shrink-0">
      <div style={{ width }} className="h-screen bg-black/20 flex flex-col shrink-0 overflow-hidden">
      <div className="relative border-b border-white/10">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/5 transition"
        >
          <span className="text-base font-semibold text-white truncate">{server.name}</span>
          <ChevronDownIcon />
        </button>
        {menuOpen && (
          <div className="absolute top-full left-2 right-2 mt-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-10 overflow-hidden">
            {canReviewRequests && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenJoinRequests();
                }}
                className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5"
              >
                Join Requests
              </button>
            )}
            <button
              onClick={() => {
                setMenuOpen(false);
                onLeaveServer();
              }}
              disabled={role === "owner"}
              title={role === "owner" ? "Transfer ownership before leaving" : ""}
              className="w-full text-left px-3 py-2 text-sm text-red-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Leave Server
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="flex items-center justify-between px-2 mb-1">
          <p className="text-[11px] font-semibold text-white/40 tracking-wide uppercase">
            Text Channels
          </p>
          {canManageChannels && (
            <button
              onClick={onCreateChannelClick}
              title="Create channel"
              className="text-white/50 hover:text-white p-0.5"
            >
              <PlusIcon size={14} />
            </button>
          )}
        </div>

        {channels.map((channel) => {
          const isSelected = channel._id === selectedChannelId;
          return (
            <button
              key={channel._id}
              onClick={() => onSelectChannel(channel._id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition
                ${
                  isSelected
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:bg-white/5 hover:text-white/80"
                }
              `}
            >
              <HashIcon size={16} />
              <span className="truncate">{channel.name}</span>
            </button>
          );
        })}
      </div>
      </div>
      <ResizeHandle onMouseDown={startDrag} />
    </div>
  );
};
