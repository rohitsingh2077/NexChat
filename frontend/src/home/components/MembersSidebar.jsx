import { useState } from "react";
import { toast } from "react-toastify";
import { useProfileModal } from "../../Context/ProfileModalContext";
import { CrownIcon, MoreIcon } from "./icons";
import { ResizeHandle, useResizableWidth } from "./ResizeHandle";

// Only Online/Offline - presence is binary server-side (see
// backend/realtime/handlers/presenceHandler.js). Idle/Do Not Disturb aren't
// real states in this app, so they're not fabricated here.
export const MembersSidebar = ({ members, onlineUserIds, myRole, onKick, onChangeRole, onTransferOwnership }) => {
  const [openMenuId, setOpenMenuId] = useState(null);
  const { openProfile } = useProfileModal();
  const canManageMembers = myRole === "owner" || myRole === "admin";
  // Only the owner can promote/demote - see server.service.js updateMemberRole
  // for why admins can't manage other admins.
  const canChangeRoles = myRole === "owner";
  const { width, startDrag } = useResizableWidth({
    storageKey: "nexchat:membersSidebarWidth",
    defaultWidth: 240,
    min: 180,
    max: 360,
    direction: -1,
  });

  const isOnline = (userId) => onlineUserIds?.includes(userId);

  const online = members.filter((m) => isOnline(m.user._id));
  const offline = members.filter((m) => !isOnline(m.user._id));

  const handleKick = async (member) => {
    setOpenMenuId(null);
    if (!window.confirm(`Remove ${member.user.fullname || member.user.username} from this server?`)) return;
    try {
      await onKick(member.user._id);
      toast.success("Member removed");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to remove member");
    }
  };

  const handleChangeRole = async (member, newRole) => {
    setOpenMenuId(null);
    try {
      await onChangeRole(member.user._id, newRole);
      toast.success(newRole === "admin" ? "Promoted to admin" : "Demoted to member");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to change role");
    }
  };

  const handleTransferOwnership = async (member) => {
    setOpenMenuId(null);
    const name = member.user.fullname || member.user.username;
    if (
      !window.confirm(
        `Make ${name} the owner of this server? You'll be demoted to admin - this can't be undone by yourself.`
      )
    )
      return;
    try {
      await onTransferOwnership(member.user._id);
      toast.success(`${name} is now the owner`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to transfer ownership");
    }
  };

  const renderMember = (m) => {
    const canKickThis = canManageMembers && m.role !== "owner";
    const canPromote = canChangeRoles && m.role === "member";
    const canDemote = canChangeRoles && m.role === "admin";
    // Owner-only, same as promote/demote - see server.service.js
    // transferOwnership for why this isn't opened up to admins.
    const canTransfer = canChangeRoles && m.role !== "owner";
    const hasMenu = canKickThis || canPromote || canDemote || canTransfer;

    return (
      <div
        key={m.user._id}
        className="relative flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 group"
      >
        <button
          onClick={() => openProfile(m.user._id)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center text-black text-sm font-semibold relative overflow-hidden shrink-0">
            {m.user.profilePicture ? (
              <img src={m.user.profilePicture} alt="" className="w-full h-full object-cover" />
            ) : (
              (m.user.fullname || m.user.username || "?").charAt(0).toUpperCase()
            )}
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                isOnline(m.user._id) ? "bg-green-400" : "bg-white/30"
              }`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/90 truncate flex items-center gap-1">
              {m.user.fullname || m.user.username}
              {m.role === "owner" && <span className="text-yellow-400"><CrownIcon /></span>}
              {m.role === "admin" && <span className="text-[9px] text-blue-300 bg-blue-500/15 px-1.5 py-0.5 rounded">ADMIN</span>}
            </p>
            <p className="text-[11px] text-white/40">{isOnline(m.user._id) ? "Online" : "Offline"}</p>
          </div>
        </button>

        {hasMenu && (
          <div className="relative shrink-0">
            <button
              onClick={() => setOpenMenuId(openMenuId === m.user._id ? null : m.user._id)}
              title="Manage member"
              className="text-white/50 hover:text-white p-1 rounded transition"
            >
              <MoreIcon />
            </button>
            {openMenuId === m.user._id && (
              <div className="absolute right-0 top-7 z-10 bg-slate-800 border border-white/10 rounded-lg shadow-xl overflow-hidden w-44">
                {canPromote && (
                  <button
                    onClick={() => handleChangeRole(m, "admin")}
                    className="w-full text-left px-3 py-2 text-sm text-blue-300 hover:bg-white/5"
                  >
                    Make Admin
                  </button>
                )}
                {canDemote && (
                  <button
                    onClick={() => handleChangeRole(m, "member")}
                    className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                  >
                    Remove Admin
                  </button>
                )}
                {canTransfer && (
                  <button
                    onClick={() => handleTransferOwnership(m)}
                    className="w-full text-left px-3 py-2 text-sm text-yellow-300 hover:bg-white/5"
                  >
                    Make Owner
                  </button>
                )}
                {canKickThis && (
                  <button
                    onClick={() => handleKick(m)}
                    className="w-full text-left px-3 py-2 text-sm text-red-300 hover:bg-white/5"
                  >
                    Remove from server
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen flex shrink-0">
      <ResizeHandle onMouseDown={startDrag} />
      <div style={{ width }} className="h-screen bg-black/20 flex flex-col shrink-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10">
        <p className="text-xs font-semibold text-white/50 tracking-wide uppercase">
          Members — {members.length}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {online.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-white/40 px-3 mb-1 uppercase">
              Online — {online.length}
            </p>
            {online.map(renderMember)}
          </div>
        )}
        {offline.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-white/40 px-3 mb-1 uppercase">
              Offline — {offline.length}
            </p>
            {offline.map(renderMember)}
          </div>
        )}
      </div>
      </div>
    </div>
  );
};
