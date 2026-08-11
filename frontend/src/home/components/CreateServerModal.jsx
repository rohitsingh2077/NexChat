import { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

const CreateServerModal = ({ open, onClose, onCreated }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [joinPolicy, setJoinPolicy] = useState("open");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post("/api/servers", {
        name: name.trim(),
        description: description.trim(),
        joinPolicy,
      });
      if (res.data?.success) {
        toast.success("Server created");
        onCreated({ server: res.data.server, role: "owner" }, res.data.defaultChannel);
        setName("");
        setDescription("");
        setJoinPolicy("open");
        onClose();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create server");
    } finally {
      setSaving(false);
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
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-white/60 hover:text-white text-xl"
          >
            ✕
          </button>
          <h2 className="text-xl font-semibold mb-1">Create a server</h2>
          <p className="text-xs text-white/50 mb-6">
            You'll be the owner, and a #general channel is created automatically.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-white/60 mb-1">Server name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                placeholder="e.g. IIT BHU Coding Club"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Description (optional)</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none"
                placeholder="What's this server about?"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Who can join</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setJoinPolicy("open")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm border transition ${
                    joinPolicy === "open"
                      ? "bg-blue-500/20 border-blue-400 text-blue-300"
                      : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                  }`}
                >
                  Anyone can join
                </button>
                <button
                  type="button"
                  onClick={() => setJoinPolicy("approval_required")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm border transition ${
                    joinPolicy === "approval_required"
                      ? "bg-blue-500/20 border-blue-400 text-blue-300"
                      : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                  }`}
                >
                  Approval required
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm bg-white/5 text-white/70 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !name.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-blue-500 hover:bg-blue-600 text-white font-medium disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Server"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default CreateServerModal;
