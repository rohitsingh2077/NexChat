import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useSocketContext } from "../../Context/SocketContext";
import { ServerList } from "./ServerList";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChannelMessages } from "./ChannelMessages";
import { MembersSidebar } from "./MembersSidebar";
import { ServerPreviewPanel } from "./ServerPreviewPanel";
import CreateServerModal from "./CreateServerModal";
import CreateChannelModal from "./CreateChannelModal";
import JoinRequestsModal from "./JoinRequestsModal";
import InviteModal from "./InviteModal";

export const ServerView = () => {
  const { socket, onlineUser } = useSocketContext();
  const [servers, setServers] = useState([]); // [{server, role}]
  const [selectedServerId, setSelectedServerId] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [members, setMembers] = useState([]);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showJoinRequests, setShowJoinRequests] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  // A server found via search that the user isn't a member of yet - shown
  // via ServerPreviewPanel instead of the normal channel view.
  const [previewResult, setPreviewResult] = useState(null);
  const [joiningPreview, setJoiningPreview] = useState(false);

  const fetchServers = async () => {
    try {
      const res = await axios.get("/api/servers");
      if (res.data?.success) {
        setServers(res.data.servers || []);
        if (!selectedServerId && res.data.servers?.length > 0) {
          setSelectedServerId(res.data.servers[0].server._id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch servers", err);
    }
  };

  useEffect(() => {
    fetchServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe/unsubscribe this socket to the selected server's room whenever
  // selection changes - see backend/realtime/handlers/serverRoomHandler.js.
  useEffect(() => {
    if (!socket || !selectedServerId) return;
    socket.emit("join_server", { serverId: selectedServerId });
    return () => socket.emit("leave_server", { serverId: selectedServerId });
  }, [socket, selectedServerId]);

  useEffect(() => {
    if (!selectedServerId) {
      setChannels([]);
      setMembers([]);
      setSelectedChannelId(null);
      return;
    }

    const fetchChannelsAndMembers = async () => {
      try {
        const [channelsRes, membersRes] = await Promise.all([
          axios.get(`/api/servers/${selectedServerId}/channels`),
          axios.get(`/api/servers/${selectedServerId}/members`),
        ]);
        if (channelsRes.data?.success) {
          const fetchedChannels = channelsRes.data.channels || [];
          setChannels(fetchedChannels);
          setSelectedChannelId((prev) =>
            fetchedChannels.some((c) => c._id === prev) ? prev : fetchedChannels[0]?._id || null
          );
        }
        if (membersRes.data?.success) setMembers(membersRes.data.members || []);
      } catch (err) {
        console.error("Failed to fetch server details", err);
      }
    };
    fetchChannelsAndMembers();
  }, [selectedServerId]);

  const selectedEntry = servers.find((s) => s.server._id === selectedServerId);
  const selectedServer = selectedEntry?.server;
  const myRole = selectedEntry?.role;
  const selectedChannel = channels.find((c) => c._id === selectedChannelId);

  const handleSelectServer = (serverId) => {
    setPreviewResult(null);
    setSelectedServerId(serverId);
  };

  const handlePreview = (result) => {
    setSelectedServerId(null);
    setPreviewResult(result);
  };

  const handleServerCreated = (entry, defaultChannel) => {
    setServers((prev) => [...prev, entry]);
    setPreviewResult(null);
    setSelectedServerId(entry.server._id);
    setChannels([defaultChannel]);
    setSelectedChannelId(defaultChannel._id);
  };

  const handleChannelCreated = (channel) => {
    setChannels((prev) => [...prev, channel]);
    setSelectedChannelId(channel._id);
  };

  const handleLeaveServer = async () => {
    if (!selectedServerId) return;
    try {
      await axios.delete(`/api/servers/${selectedServerId}/leave`);
      toast.success("Left server");
      setServers((prev) => prev.filter((s) => s.server._id !== selectedServerId));
      setSelectedServerId(null);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to leave server");
    }
  };

  const handleKickMember = async (targetUserId) => {
    await axios.delete(`/api/servers/${selectedServerId}/members/${targetUserId}`);
    setMembers((prev) => prev.filter((m) => m.user._id !== targetUserId));
  };

  const handleChangeMemberRole = async (targetUserId, newRole) => {
    await axios.patch(`/api/servers/${selectedServerId}/members/${targetUserId}/role`, {
      role: newRole,
    });
    setMembers((prev) =>
      prev.map((m) => (m.user._id === targetUserId ? { ...m, role: newRole } : m))
    );
  };

  // After a transfer, the caller (previously "owner") is now "admin" and the
  // target is "owner" - refetch both the server list (role badges) and
  // members (role labels) instead of hand-rolling the two-sided role swap
  // in local state, since it's easy to get one side wrong.
  const handleTransferOwnership = async (newOwnerUserId) => {
    await axios.post(`/api/servers/${selectedServerId}/transfer-ownership`, { newOwnerUserId });
    await Promise.all([
      fetchServers(),
      axios.get(`/api/servers/${selectedServerId}/members`).then((res) => {
        if (res.data?.success) setMembers(res.data.members || []);
      }),
    ]);
  };

  const handleInviteCodeChange = (inviteCode) => {
    setServers((prev) =>
      prev.map((entry) =>
        entry.server._id === selectedServerId
          ? { ...entry, server: { ...entry.server, inviteCode } }
          : entry
      )
    );
  };

  const handleJoinedByCode = async (serverId) => {
    await fetchServers();
    setPreviewResult(null);
    setSelectedServerId(serverId);
  };

  const handleJoinPreview = async () => {
    if (!previewResult) return;
    try {
      setJoiningPreview(true);
      const res = await axios.post(`/api/servers/${previewResult.server._id}/join`);
      if (!res.data?.success) return;
      if (res.data.outcome === "pending") {
        toast.success("Join request sent");
        setPreviewResult((prev) => (prev ? { ...prev, relationship: "PENDING" } : prev));
        return;
      }
      // "joined" or "already_member" both mean the server is open to us now.
      toast.success("Joined server");
      await fetchServers();
      setPreviewResult(null);
      setSelectedServerId(previewResult.server._id);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to join server");
    } finally {
      setJoiningPreview(false);
    }
  };

  const handleOpenFromPreview = () => {
    setSelectedServerId(previewResult.server._id);
    setPreviewResult(null);
  };

  return (
    <>
      <ServerList
        servers={servers}
        selectedServerId={selectedServerId}
        onSelect={handleSelectServer}
        onCreateClick={() => setShowCreateServer(true)}
        onPreview={handlePreview}
        onJoinedByCode={handleJoinedByCode}
      />

      {previewResult ? (
        <ServerPreviewPanel
          result={previewResult}
          onJoin={handleJoinPreview}
          onOpenServer={handleOpenFromPreview}
          joining={joiningPreview}
        />
      ) : selectedServer ? (
        <>
          <ChannelSidebar
            server={selectedServer}
            role={myRole}
            channels={channels}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
            onCreateChannelClick={() => setShowCreateChannel(true)}
            onLeaveServer={handleLeaveServer}
            onOpenJoinRequests={() => setShowJoinRequests(true)}
            onOpenInvite={() => setShowInvite(true)}
          />

          {selectedChannel ? (
            <>
              <ChannelMessages
                server={selectedServer}
                channel={selectedChannel}
                role={myRole}
                members={members}
                onToggleMembers={() => setShowMembers((v) => !v)}
              />
              {showMembers && (
                <MembersSidebar
                  members={members}
                  onlineUserIds={onlineUser}
                  myRole={myRole}
                  onKick={handleKickMember}
                  onChangeRole={handleChangeMemberRole}
                  onTransferOwnership={handleTransferOwnership}
                />
              )}
            </>
          ) : (
            <div className="flex-1 h-screen flex items-center justify-center text-white/50 text-sm">
              {channels.length === 0
                ? "No channels yet - create one to get started."
                : "Select a channel."}
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 h-screen flex items-center justify-center text-white/50 text-sm">
          {servers.length === 0
            ? "You haven't joined any servers yet - create one to get started."
            : "Select a server."}
        </div>
      )}

      <CreateServerModal
        open={showCreateServer}
        onClose={() => setShowCreateServer(false)}
        onCreated={handleServerCreated}
      />
      <CreateChannelModal
        open={showCreateChannel}
        onClose={() => setShowCreateChannel(false)}
        serverId={selectedServerId}
        onCreated={handleChannelCreated}
      />
      <JoinRequestsModal
        open={showJoinRequests}
        onClose={() => setShowJoinRequests(false)}
        serverId={selectedServerId}
        channels={channels}
      />
      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        serverId={selectedServerId}
        inviteCode={selectedServer?.inviteCode}
        onInviteCodeChange={handleInviteCodeChange}
      />
    </>
  );
};
