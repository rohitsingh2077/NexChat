import { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

// Owner/admin only - see server.controller.js getServer, which redacts
// inviteCode from the payload for plain members, and the route-level
// requireRole(["owner","admin"]) guard on generate/revoke.
const InviteModal = ({ open, onClose, serverId, inviteCode, onInviteCodeChange }) => {
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleGenerate = async () => {
    try {
      setBusy(true);
      const res = await axios.post(`/api/servers/${serverId}/invite-code`);
      if (res.data?.success) onInviteCodeChange(res.data.inviteCode);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to generate invite link");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm("Revoke this invite link? Anyone with the old link will no longer be able to join.")) return;
    try {
      setBusy(true);
      await axios.delete(`/api/servers/${serverId}/invite-code`);
      onInviteCodeChange(null);
      toast.success("Invite link revoked");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to revoke invite link");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy - copy it manually");
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="bg-slate-900/90 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md text-white p-6 relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={onClose} className="absolute top-3 right-3 text-white/60 hover:text-white text-xl">
            ✕
          </button>
          <h2 className="text-lg font-semibold mb-1">Invite people</h2>
          <p className="text-xs text-white/50 mb-4">
            Share this code - anyone who enters it under &quot;Join with a code&quot; can
            join{" "}
            {/* joinPolicy still applies to invite-code joins - approval_required
                servers create a pending request, same as joining by id. */}
            (or request to join, if this server requires approval).
          </p>

          {inviteCode ? (
            <div className="flex items-center gap-2 mb-4">
              <input
                readOnly
                value={inviteCode}
                onClick={(e) => e.target.select()}
                className="flex-1 p-2.5 rounded-xl bg-white/10 text-white text-sm font-mono tracking-wide border border-white/10 truncate"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-sm font-medium shrink-0"
              >
                Copy
              </button>
            </div>
          ) : (
            <p className="text-sm text-white/40 mb-4">No active invite code.</p>
          )}

          <div className="flex justify-end gap-2">
            {inviteCode && (
              <button
                onClick={handleRevoke}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-red-300 hover:bg-white/10 disabled:opacity-50"
              >
                Revoke
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs bg-blue-500 hover:bg-blue-600 font-medium disabled:opacity-50"
            >
              {inviteCode ? "Generate new code" : "Generate code"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default InviteModal;
