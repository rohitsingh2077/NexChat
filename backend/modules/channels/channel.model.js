const mongoose = require("mongoose");

const channelSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    // Only 'text' exists today - the enum leaves room for 'voice' later
    // without a schema migration, but voice itself is not built.
    type: { type: String, enum: ["text"], default: "text" },
  },
  { timestamps: true }
);

// Supports the only real read pattern right now: "list channels in a server".
channelSchema.index({ serverId: 1 });

const Channel = mongoose.model("Channel", channelSchema);

module.exports = Channel;
