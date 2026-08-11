import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

// Owner/admin review pending join requests for an approval_required server.
// Approve optionally restricts the new member to a subset of channels (see
// serverMembership.model.js allowedChannelIds) - leaving all boxes
// unchecked approves with unrestricted access, the common case.
const JoinRequestsModal = ({ open, onClose, serverId, channels }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState({}); // requestId -> Set(channelId)
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!open || !serverId) return;
    const fetchRequests = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/servers/${serverId}/join-requests`);
        if (res.data?.success) setRequests(res.data.requests || []);
      } catch {
        toast.error("Failed to load join requests");
      } finally {
        setLoading(false);
      }
    };
    fetchRequests();
  }, [open, serverId]);

  if (!open) return null;

  const toggleChannel = (requestId, channelId) => {
    setSelectedChannels((prev) => {
      const current = new Set(prev[requestId] || []);
      if (current.has(channelId)) current.delete(channelId);
      else current.add(channelId);
      return { ...prev, [requestId]: current };
    });
  };

  const handleApprove = async (requestId) => {
    try {
      setBusyId(requestId);
      const allowedChannelIds = Array.from(selectedChannels[requestId] || []);
      await axios.post(`/api/servers/${serverId}/join-requests/${requestId}/approve`, {
        allowedChannelIds,
      });
      toast.success("Request approved");
      setRequests((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to approve");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (requestId) => {
    try {
      setBusyId(requestId);
      await axios.post(`/api/servers/${serverId}/join-requests/${requestId}/reject`);
      toast.success("Request rejected");
      setRequests((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reject");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="bg-slate-900/90 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg text-white p-6 relative max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={onClose} className="absolute top-3 right-3 text-white/60 hover:text-white text-xl">
            ✕
          </button>
          <h2 className="text-lg font-semibold mb-1">Join requests</h2>
          <p className="text-xs text-white/50 mb-4">
            Approving without selecting any channel gives unrestricted access.
          </p>

          {loading && <p className="text-sm text-white/50">Loading...</p>}
          {!loading && requests.length === 0 && (
            <p className="text-sm text-white/40">No pending requests.</p>
          )}

          <div className="space-y-4">
            {requests.map((r) => (
              <div key={r.requestId} className="border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold overflow-hidden shrink-0">
                    {r.user.profilePicture ? (
                      <img src={r.user.profilePicture} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (r.user.fullname || r.user.username || "?").charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{r.user.fullname || r.user.username}</p>
                    <p className="text-[11px] text-white/40">@{r.user.username}</p>
                  </div>
                </div>

                <p className="text-[11px] text-white/50 mb-1.5">
                  Restrict to channels (optional):
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {channels.map((c) => {
                    const checked = selectedChannels[r.requestId]?.has(c._id);
                    return (
                      <button
                        key={c._id}
                        onClick={() => toggleChannel(r.requestId, c._id)}
                        className={`text-xs px-2 py-1 rounded-lg border transition ${
                          checked
                            ? "bg-blue-500/20 border-blue-400 text-blue-300"
                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                        }`}
                      >
                        #{c.name}
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleReject(r.requestId)}
                    disabled={busyId === r.requestId}
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-red-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(r.requestId)}
                    disabled={busyId === r.requestId}
                    className="px-3 py-1.5 rounded-lg text-xs bg-blue-500 hover:bg-blue-600 font-medium disabled:opacity-50"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default JoinRequestsModal;
