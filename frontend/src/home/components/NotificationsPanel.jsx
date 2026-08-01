import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useSocketContext } from "../../Context/SocketContext";

// Incoming requests are owned by Home (shared with NavRail's badge count);
// outgoing requests are fetched locally since nothing else needs that list.
export const NotificationsPanel = ({ incomingRequests, onIncomingChange }) => {
  const [tab, setTab] = useState("incoming");
  const [outgoing, setOutgoing] = useState([]);
  const [pendingId, setPendingId] = useState(null);
  const { socket } = useSocketContext();

  const fetchOutgoing = async () => {
    try {
      const res = await axios.get("/api/friends/requests/outgoing");
      if (res.data && res.data.success) {
        setOutgoing(res.data.requests || []);
      }
    } catch (err) {
      console.error("Failed to fetch outgoing requests", err);
    }
  };

  useEffect(() => {
    fetchOutgoing();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchOutgoing();
    socket.on("friend:request_accepted", refresh);
    socket.on("friend:request_rejected", refresh);
    return () => {
      socket.off("friend:request_accepted", refresh);
      socket.off("friend:request_rejected", refresh);
    };
  }, [socket]);

  const handleAccept = async (requestId) => {
    try {
      setPendingId(requestId);
      await axios.post(`/api/friends/requests/${requestId}/accept`);
      toast.success("Friend request accepted");
      onIncomingChange((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to accept request");
    } finally {
      setPendingId(null);
    }
  };

  const handleReject = async (requestId) => {
    try {
      setPendingId(requestId);
      await axios.post(`/api/friends/requests/${requestId}/reject`);
      onIncomingChange((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reject request");
    } finally {
      setPendingId(null);
    }
  };

  const handleCancel = async (requestId) => {
    try {
      setPendingId(requestId);
      await axios.delete(`/api/friends/requests/${requestId}`);
      setOutgoing((prev) => prev.filter((r) => r.requestId !== requestId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to cancel request");
    } finally {
      setPendingId(null);
    }
  };

  const renderRow = (r, actions) => (
    <div key={r.requestId} className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
      <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center text-black font-semibold shrink-0">
        {r.user?.avatar ? (
          <img
            src={r.user.avatar}
            alt="Profile"
            className="w-full h-full object-cover rounded-full"
          />
        ) : (
          (r.user?.displayName || r.user?.username)?.charAt(0).toUpperCase() || "U"
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{r.user?.displayName || r.user?.username}</p>
        <p className="text-xs text-white/50">@{r.user?.username}</p>
      </div>
      {actions}
    </div>
  );

  return (
    <div className="h-screen flex-1 flex flex-col text-white">
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold">Friend Requests</h2>
      </div>

      <div className="flex px-4 pt-3 gap-2">
        <button
          onClick={() => setTab("incoming")}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${
            tab === "incoming" ? "bg-yellow-400 text-black" : "bg-white/5 text-white/60"
          }`}
        >
          Incoming {incomingRequests.length > 0 && `(${incomingRequests.length})`}
        </button>
        <button
          onClick={() => setTab("outgoing")}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${
            tab === "outgoing" ? "bg-yellow-400 text-black" : "bg-white/5 text-white/60"
          }`}
        >
          Outgoing {outgoing.length > 0 && `(${outgoing.length})`}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mt-3">
        {tab === "incoming" &&
          (incomingRequests.length > 0 ? (
            incomingRequests.map((r) =>
              renderRow(
                r,
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleAccept(r.requestId)}
                    disabled={pendingId === r.requestId}
                    className="text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleReject(r.requestId)}
                    disabled={pendingId === r.requestId}
                    className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              )
            )
          ) : (
            <p className="text-sm text-white/40 text-center mt-8">No incoming requests</p>
          ))}

        {tab === "outgoing" &&
          (outgoing.length > 0 ? (
            outgoing.map((r) =>
              renderRow(
                r,
                <button
                  onClick={() => handleCancel(r.requestId)}
                  disabled={pendingId === r.requestId}
                  className="text-xs bg-white/10 hover:bg-red-500/80 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50 shrink-0"
                >
                  Cancel Request
                </button>
              )
            )
          ) : (
            <p className="text-sm text-white/40 text-center mt-8">No outgoing requests</p>
          ))}
      </div>
    </div>
  );
};
