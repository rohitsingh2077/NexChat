import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { useAuth } from "../../Context/authcontext";
import { PlusIcon, TrashIcon } from "./icons";
import { DocumentEditor } from "./DocumentEditor";

// List + create/delete for a channel's collaborative documents. Opening one
// swaps this whole panel for DocumentEditor (full-pane, like selecting a
// channel swaps in ChannelMessages) rather than showing both side by side -
// simpler than a split view for a first version.
export const DocumentsPanel = ({ server, channel, role, members }) => {
  const { authUser } = useAuth();
  const currentUserId = authUser?._id || authUser?.id;

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [openDocumentId, setOpenDocumentId] = useState(null);

  const canModerate = role === "owner" || role === "admin";

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`/api/servers/${server._id}/channels/${channel._id}/documents`);
      if (res.data?.success) setDocuments(res.data.documents || []);
    } catch (err) {
      console.error("Failed to fetch documents", err);
    } finally {
      setLoading(false);
    }
  };

  // Reload (and drop back to the list) whenever the selected channel changes.
  useEffect(() => {
    setOpenDocumentId(null);
    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server._id, channel._id]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      setCreating(true);
      const res = await axios.post(`/api/servers/${server._id}/channels/${channel._id}/documents`, {
        title: newTitle.trim(),
      });
      if (res.data?.success) {
        setDocuments((prev) => [res.data.document, ...prev]);
        setNewTitle("");
        setOpenDocumentId(res.data.document._id);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create document");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (documentId) => {
    try {
      await axios.delete(`/api/servers/${server._id}/channels/${channel._id}/documents/${documentId}`);
      setDocuments((prev) => prev.filter((d) => d._id !== documentId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete document");
    }
  };

  const handleRenamed = (updated) => {
    setDocuments((prev) => prev.map((d) => (d._id === updated._id ? { ...d, title: updated.title } : d)));
  };

  if (openDocumentId) {
    return (
      // key forces a fresh DocumentEditor (and a fresh TipTap instance,
      // fresh version/viewer tracking) per document, instead of reusing one
      // instance across different documents - simpler and safer than
      // manually resetting every piece of editor state on documentId change.
      <DocumentEditor
        key={openDocumentId}
        server={server}
        channel={channel}
        documentId={openDocumentId}
        role={role}
        members={members}
        onBack={() => setOpenDocumentId(null)}
        onRenamed={handleRenamed}
        onDeleted={() => {
          setDocuments((prev) => prev.filter((d) => d._id !== openDocumentId));
          setOpenDocumentId(null);
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col text-white min-w-0">
      <div className="px-4 py-3 flex items-center gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          maxLength={150}
          placeholder="New document title..."
          className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 placeholder-white/40"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newTitle.trim()}
          className="bg-blue-500 hover:bg-blue-600 text-white p-2 rounded-lg disabled:opacity-50 shrink-0"
          title="Create document"
        >
          <PlusIcon size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {loading && <p className="text-xs text-white/60 px-2">Loading documents...</p>}
        {!loading && documents.length === 0 && (
          <p className="text-xs text-white/50 px-2 mt-2">
            No documents yet in #{channel.name}. Create one to start collaborating.
          </p>
        )}
        {documents.map((doc) => {
          const creatorId = doc.createdBy?._id || doc.createdBy;
          const canDelete = canModerate || String(creatorId) === String(currentUserId);
          return (
            <div
              key={doc._id}
              onClick={() => setOpenDocumentId(doc._id)}
              className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer"
            >
              <div className="min-w-0">
                <p className="text-sm text-white/90 truncate">{doc.title}</p>
                <p className="text-[11px] text-white/40 truncate">
                  Edited {new Date(doc.updatedAt).toLocaleString()}
                  {doc.lastEditedBy?.fullname ? ` by ${doc.lastEditedBy.fullname}` : ""}
                </p>
              </div>
              {canDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(doc._id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 p-1 rounded shrink-0"
                  title="Delete document"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
