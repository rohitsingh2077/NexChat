const mongoose = require("mongoose");

const serverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    icon: { type: String, default: "" },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // 'open' = joinServer creates membership immediately (existing behavior).
    // 'approval_required' = joinServer creates a ServerJoinRequest instead;
    // an owner/admin must approve it before a ServerMembership exists.
    // See server.service.js joinServer/approveJoinRequest.
    joinPolicy: {
      type: String,
      enum: ["open", "approval_required"],
      default: "open",
    },
    // null = no active invite link (default - must be generated explicitly
    // by an owner/admin). A short random token; possessing it lets a user
    // join (or request to join, if approval_required) without already
    // knowing serverId. Regenerating overwrites this value, immediately
    // invalidating the old link. See server.service.js regenerateInviteCode.
    inviteCode: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Sparse: most servers have no invite code issued (null), and a sparse
// unique index only indexes documents where the field exists/isn't null -
// without sparse, every null-code server would collide on the same unique
// "null" index entry. Serves both the join-by-code lookup (Server.findOne
// ({inviteCode})) and the "codes are unique" guarantee.
serverSchema.index({ inviteCode: 1 }, { unique: true, sparse: true });

const Server = mongoose.model("Server", serverSchema);

module.exports = Server;
