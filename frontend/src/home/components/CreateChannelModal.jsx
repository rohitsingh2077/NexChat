import { useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

const CreateChannelModal = ({ open, onClose, serverId, onCreated }) => {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim() || !serverId) return;
    try {
      setSaving(true);
      const res = await axios.post(`/api/servers/${serverId}/channels`, {
        name: name.trim(),
      });
      if (res.data?.success) {
        toast.success("Channel created");
        onCreated(res.data.channel);
        setName("");
        onClose();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create channel");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="bg-slate-900/90 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm text-white p-6 relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-white/60 hover:text-white text-xl"
          >
            ✕
          </button>
          <h2 className="text-lg font-semibold mb-4">Create text channel</h2>

          <label className="block text-xs text-white/60 mb-1">Channel name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            placeholder="e.g. resources"
          />

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
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default CreateChannelModal;
