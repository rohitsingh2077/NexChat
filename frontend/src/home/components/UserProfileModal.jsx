import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useProfileModal } from "../../Context/ProfileModalContext";
import { useSocketContext } from "../../Context/SocketContext";

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

// Global profile view - opened via useProfileModal().openProfile(userId) from
// anywhere in the app (member lists, message sender names, friend rows...).
// Scoped to what's actually real: no fabricated timezone/language/verified
// badge/message-count fields - see docs/interview-notes for the design note
// on this phase if one exists, otherwise: everything shown here is backed by
// GET /api/user/:userId/profile.
export const UserProfileModal = ({ onMessage }) => {
  const { profileUserId, closeProfile, openProfile } = useProfileModal();
  const { onlineUser } = useSocketContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("overview");
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (!profileUserId) return;
    setTab("overview");
    setData(null);
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/user/${profileUserId}/profile`);
        if (res.data?.success) setData(res.data);
      } catch (err) {
        toast.error(err.response?.data?.message || "Failed to load profile");
        closeProfile();
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUserId]);

  if (!profileUserId) return null;

  const isOnline = onlineUser?.includes(profileUserId);

  const handleSendFriendRequest = async () => {
    try {
      setActionBusy(true);
      await axios.post("/api/friends/requests", { receiverId: profileUserId });
      toast.success("Friend request sent");
      setData((prev) => (prev ? { ...prev, friendshipStatus: "REQUEST_SENT" } : prev));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send request");
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveFriend = async () => {
    try {
      setActionBusy(true);
      await axios.delete(`/api/friends/${profileUserId}`);
      toast.success("Friend removed");
      setData((prev) => (prev ? { ...prev, friendshipStatus: "NONE" } : prev));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to remove friend");
    } finally {
      setActionBusy(false);
    }
  };

  const handleMessage = () => {
    if (!data) return;
    onMessage?.(data.profile);
    closeProfile();
  };

  const renderFriendAction = () => {
    if (!data || data.friendshipStatus === "SELF") return null;
    switch (data.friendshipStatus) {
      case "FRIENDS":
        return (
          <button
            onClick={handleRemoveFriend}
            disabled={actionBusy}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-white/10 text-red-300 hover:bg-white/15 disabled:opacity-50"
          >
            Remove Friend
          </button>
        );
      case "REQUEST_SENT":
        return (
          <button
            disabled
            className="px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-white/40 cursor-not-allowed"
          >
            Request Sent
          </button>
        );
      case "REQUEST_RECEIVED":
        return (
          <button
            disabled
            title="Respond from the Notifications tab"
            className="px-4 py-2 rounded-xl text-sm font-medium bg-yellow-500/20 text-yellow-300 cursor-not-allowed"
          >
            Check Notifications
          </button>
        );
      default:
        return (
          <button
            onClick={handleSendFriendRequest}
            disabled={actionBusy}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-500 hover:bg-blue-600 disabled:opacity-50"
          >
            Send Friend Request
          </button>
        );
    }
  };

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "mutualServers", label: `Mutual Servers${data ? ` (${data.mutualServers.length})` : ""}` },
    { key: "mutualFriends", label: `Mutual Friends${data ? ` (${data.mutualFriends.length})` : ""}` },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={closeProfile} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="bg-slate-900/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl text-white relative overflow-hidden max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={closeProfile}
            className="absolute top-3 right-3 text-white/60 hover:text-white text-xl z-10"
          >
            ✕
          </button>

          {loading && <p className="p-8 text-sm text-white/50">Loading profile...</p>}

          {!loading && data && (
            <>
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-yellow-400 flex items-center justify-center text-black text-2xl font-bold overflow-hidden relative shrink-0">
                    {data.profile.profilePicture ? (
                      <img src={data.profile.profilePicture} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (data.profile.fullname || data.profile.username || "?").charAt(0).toUpperCase()
                    )}
                    <span
                      className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-slate-900 ${
                        isOnline ? "bg-green-400" : "bg-white/30"
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold truncate">{data.profile.fullname}</h2>
                    <p className="text-sm text-white/50">@{data.profile.username}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  {renderFriendAction()}
                  {data.friendshipStatus !== "SELF" && (
                    <button
                      onClick={handleMessage}
                      className="px-4 py-2 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15"
                    >
                      Message
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-5 px-6 border-b border-white/10">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`relative pb-2.5 text-sm font-medium ${
                      tab === t.key ? "text-blue-400" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {t.label}
                    {tab === t.key && (
                      <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-400 rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {tab === "overview" && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-white/50 mb-1">About Me</p>
                      <p className="text-sm text-white/90 whitespace-pre-line">
                        {data.profile.about || "No bio added yet."}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-white/50 mb-1">Member Since</p>
                        <p className="text-sm">{formatDate(data.profile.createdAt)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50 mb-1">Status</p>
                        <p className={`text-sm ${isOnline ? "text-green-400" : "text-white/70"}`}>
                          {isOnline ? "Online" : "Offline"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {tab === "mutualServers" &&
                  (data.mutualServers.length === 0 ? (
                    <p className="text-sm text-white/40 text-center mt-6">No mutual servers.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.mutualServers.map((s) => (
                        <div key={s._id} className="flex items-center gap-3 px-2 py-2">
                          <div className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center text-white font-semibold overflow-hidden shrink-0">
                            {s.icon ? (
                              <img src={s.icon} alt="" className="w-full h-full object-cover" />
                            ) : (
                              s.name.charAt(0).toUpperCase()
                            )}
                          </div>
                          <span className="text-sm">{s.name}</span>
                        </div>
                      ))}
                    </div>
                  ))}

                {tab === "mutualFriends" &&
                  (data.mutualFriends.length === 0 ? (
                    <p className="text-sm text-white/40 text-center mt-6">No mutual friends.</p>
                  ) : (
                    <div className="space-y-1">
                      {data.mutualFriends.map((f) => (
                        <button
                          key={f._id}
                          onClick={() => openProfile(f._id)}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 text-left"
                        >
                          <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center text-black text-sm font-semibold overflow-hidden shrink-0">
                            {f.profilePicture ? (
                              <img src={f.profilePicture} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (f.fullname || f.username).charAt(0).toUpperCase()
                            )}
                          </div>
                          <span className="text-sm">{f.fullname || f.username}</span>
                        </button>
                      ))}
                    </div>
                  ))}
              </div>

              <div className="grid grid-cols-2 border-t border-white/10">
                <div className="py-4 text-center border-r border-white/10">
                  <p className="text-lg font-semibold">{data.stats.friendsCount}</p>
                  <p className="text-[11px] text-white/50 uppercase tracking-wide">Friends</p>
                </div>
                <div className="py-4 text-center">
                  <p className="text-lg font-semibold">{data.stats.serversCount}</p>
                  <p className="text-[11px] text-white/50 uppercase tracking-wide">Servers</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
