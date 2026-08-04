const mongoose = require("mongoose");

const serverMembershipSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["owner", "admin", "member"],
      default: "member",
    },
  },
  { timestamps: true } // createdAt doubles as "joinedAt" - no separate field needed
);

// Enforces "can't join the same server twice" at the DB level, and is the
// exact shape of the authorization lookup that runs on every server-scoped
// request: {serverId, userId} -> is this user a member, what's their role.
// See server.middleware.js isServerMember and server.service.js joinServer
// (duplicate-key on this index is caught and treated as "already a member",
// same idempotent-insert pattern as friendRequestModel.js).
serverMembershipSchema.index({ serverId: 1, userId: 1 }, { unique: true });

// Supports "list servers I'm a member of" (server.service.js listMyServers).
// Needed separately because the compound index above can't be reverse-scanned
// by userId alone (userId isn't its prefix field).
serverMembershipSchema.index({ userId: 1 });

const ServerMembership = mongoose.model("ServerMembership", serverMembershipSchema);

module.exports = ServerMembership;

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
The join table between User and Server, carrying the one piece of
per-membership state that matters right now: role. Every server-scoped
authorization check is really "does a ServerMembership doc exist for
{serverId, userId}, and what's its role" - see server.middleware.js.

WHY A SEPARATE COLLECTION INSTEAD OF AN EMBEDDED ARRAY ON Server:
An embedded `members: [{userId, role}]` array on Server would mean loading
and scanning the entire member list to answer "is this one user a member" -
the exact check that runs on nearly every server-scoped request. A separate,
indexed collection turns that into a single indexed lookup instead of an
array scan, the same reasoning that already moved friend requests out of
embedded User arrays into their own collection (see friendRequestModel.js).

WHY THE UNIQUE INDEX DOUBLES AS THE JOIN-IDEMPOTENCY CHECK:
{serverId, userId} unique means a second join attempt fails at the database
level with a duplicate-key error, which server.service.js.joinServer catches
and treats as "already a member" instead of an error - same idempotent-insert
pattern as friendRequestModel.js. This matters under concurrency: two
simultaneous join requests from the same user can't both succeed and create
two membership rows: exactly one insert wins, the other gets the duplicate-key
error and re-reads the winner's row.

INTERVIEW CONCEPTS:
- join/association tables and when they beat embedding
- using a unique index as a concurrency-safe "insert or no-op" primitive
- authorization modeled as a data lookup (row exists + its role field),
  not a separate permissions engine
============================================================
*/
