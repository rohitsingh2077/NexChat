// Shown in place of the channel view when the user has picked a server they
// aren't a member of yet from search/discover - a lightweight "about this
// server" screen with a join/request action, not the full channel UI.
export const ServerPreviewPanel = ({ result, onJoin, onOpenServer, joining }) => {
  const { server, memberCount, relationship } = result;
  const requiresApproval = server.joinPolicy === "approval_required";

  return (
    <div className="flex-1 h-screen flex flex-col items-center justify-center text-white gap-3 px-8">
      <div className="w-20 h-20 rounded-3xl bg-indigo-500 flex items-center justify-center text-3xl font-bold overflow-hidden">
        {server.icon ? (
          <img src={server.icon} alt="" className="w-full h-full object-cover" />
        ) : (
          server.name.charAt(0).toUpperCase()
        )}
      </div>
      <h2 className="text-2xl font-semibold text-center">{server.name}</h2>
      <p className="text-white/60 max-w-md text-center text-sm">
        {server.description || "No description provided."}
      </p>
      <p className="text-xs text-white/40">
        {memberCount} member{memberCount === 1 ? "" : "s"} ·{" "}
        {requiresApproval ? "Approval required to join" : "Anyone can join"}
      </p>

      {relationship === "MEMBER" && (
        <button
          onClick={onOpenServer}
          className="mt-2 px-6 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 font-medium transition"
        >
          Open Server
        </button>
      )}
      {relationship === "PENDING" && (
        <button
          disabled
          className="mt-2 px-6 py-2.5 rounded-xl bg-white/10 text-white/50 font-medium cursor-not-allowed"
        >
          Request Pending
        </button>
      )}
      {relationship === "NONE" && (
        <button
          onClick={onJoin}
          disabled={joining}
          className="mt-2 px-6 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 font-medium transition disabled:opacity-50"
        >
          {joining ? "..." : requiresApproval ? "Request to Join" : "Join Server"}
        </button>
      )}
    </div>
  );
};
