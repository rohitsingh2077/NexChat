import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { SearchIcon, PlusIcon } from "./icons";
import { ResizeHandle, useResizableWidth } from "./ResizeHandle";

export const ServerList = ({ servers, selectedServerId, onSelect, onCreateClick, onPreview }) => {
  const [search, setSearch] = useState("");
  const [discoverResults, setDiscoverResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const { width, startDrag } = useResizableWidth({
    storageKey: "nexchat:serverListWidth",
    defaultWidth: 280,
    min: 200,
    max: 420,
    direction: 1,
  });

  const filtered = search.trim()
    ? servers.filter(({ server }) =>
        server.name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : servers;

  // Debounced search across all servers (not just ones you've joined) - see
  // GET /api/servers/discover, which is intentionally not membership-gated.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim()) {
      setDiscoverResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await axios.get("/api/servers/discover", {
          params: { search: search.trim() },
        });
        if (res.data?.success) setDiscoverResults(res.data.results || []);
      } catch (err) {
        console.error("Server discovery failed", err);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Discover results that aren't already in "Your Servers" - avoids showing
  // the same server twice when it happens to match both lists.
  const myServerIds = new Set(servers.map(({ server }) => server._id));
  const otherResults = discoverResults.filter((r) => !myServerIds.has(r.server._id));

  const handleResultClick = (result) => {
    if (result.relationship === "MEMBER") {
      onSelect(result.server._id);
    } else {
      onPreview(result);
    }
  };

  return (
    <div className="h-screen flex shrink-0">
      <div
        style={{ width }}
        className="h-screen bg-white/5 backdrop-blur-xl flex flex-col shrink-0 overflow-hidden"
      >
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white tracking-wide">Your Servers</h2>
        <button
          onClick={onCreateClick}
          title="Create Server"
          className="flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 px-2 py-1 rounded-lg hover:bg-white/5"
        >
          <PlusIcon size={13} />
          Create
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search servers..."
            className="w-full p-2.5 pl-9 rounded-xl bg-white/10 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 border border-white/10 text-sm"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60">
            <SearchIcon size={14} />
          </span>
        </div>
        {searching && <p className="text-xs text-white/50 mt-2">Searching...</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-4">
        <div className="space-y-1">
          {filtered.length === 0 && !search.trim() && (
            <p className="text-sm text-white/40 text-center mt-4 px-3">
              You haven't joined any servers yet.
            </p>
          )}
          {filtered.map(({ server, role }) => {
            const isSelected = server._id === selectedServerId;
            return (
              <button
                key={server._id}
                onClick={() => onSelect(server._id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition
                  hover:bg-white/10
                  ${isSelected ? "bg-blue-500/15 border border-blue-500/30" : ""}
                `}
              >
                <div className="w-10 h-10 rounded-2xl bg-indigo-500 flex items-center justify-center text-white font-semibold overflow-hidden shrink-0">
                  {server.icon ? (
                    <img src={server.icon} alt="" className="w-full h-full object-cover" />
                  ) : (
                    server.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate flex items-center gap-1">
                    {server.name}
                    {role === "owner" && <span className="text-yellow-400 text-xs">👑</span>}
                  </p>
                  <p className="text-xs text-white/50 truncate">
                    {server.description || "No description"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {otherResults.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-white/60 px-3 mb-1">Other servers</p>
            {otherResults.map((result) => (
              <button
                key={result.server._id}
                onClick={() => handleResultClick(result)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition hover:bg-white/10"
              >
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/70 flex items-center justify-center text-white font-semibold overflow-hidden shrink-0">
                  {result.server.icon ? (
                    <img src={result.server.icon} alt="" className="w-full h-full object-cover" />
                  ) : (
                    result.server.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{result.server.name}</p>
                  <p className="text-xs text-white/50 truncate">
                    {result.relationship === "PENDING" ? "Request pending" : `${result.memberCount} members`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
      <ResizeHandle onMouseDown={startDrag} />
    </div>
  );
};
