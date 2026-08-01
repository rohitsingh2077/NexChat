const mongoose = require("mongoose");

const friendRequestSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Order-independent pair key (min/max of sender+receiver) - carries no
    // business meaning on its own, it exists only so the unique index below
    // can enforce "one relationship per pair" regardless of who asked whom.
    userLow: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    userHigh: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // A document's existence *is* the relationship. PENDING = an open ask;
    // ACCEPTED = friends. There is no REJECTED - rejecting/cancelling deletes
    // the document instead (see LEARNING NOTES).
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

// Enforces "at most one relationship between any two users" as a database
// invariant - not just an application-level check. See LEARNING NOTES.
friendRequestSchema.index({ userLow: 1, userHigh: 1 }, { unique: true });

// Serves "incoming requests" (receiver=me, status=PENDING) and half of the
// friend-list $or query (receiver=me, status=ACCEPTED).
friendRequestSchema.index({ receiver: 1, status: 1 });

// Serves "outgoing requests" (sender=me, status=PENDING) and the other half
// of the friend-list $or query (sender=me, status=ACCEPTED).
friendRequestSchema.index({ sender: 1, status: 1 });

const FriendRequest = mongoose.model("FriendRequest", friendRequestSchema);

module.exports = FriendRequest;

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
Represents the entire lifecycle of a relationship between two users - a
pending ask, or an accepted friendship. One collection, one document per
pair, instead of a separate FriendRequest model plus embedded arrays on
User (friends/friendRequests/sentRequests, which this model replaces).

WHY ONE COLLECTION INSTEAD OF FriendRequest + User.friends[]:
A document existing with status ACCEPTED *is* the friendship - there's no
second place "are they friends" could be asked, and no separate write to
two User documents. That matters because "accept" then becomes a single
atomic update instead of a multi-document transaction:

  FriendRequest.findOneAndUpdate(
    { _id: requestId, receiver: myUserId, status: 'PENDING' },
    { status: 'ACCEPTED' }
  )

The query filter carries BOTH the authorization check (receiver must be
me) and the state precondition (must still be pending) - Mongo either
finds-and-updates exactly one document atomically, or finds nothing.
There's no window where a second request can act on a half-updated
state, and no need for a multi-document transaction (which would only
work if MongoDB is deployed as a replica set).

RACE CONDITION THIS PREVENTS:
Two users, A and B, send friend requests to each other at nearly the same
moment. The naive approach - "check if a request already exists, then
insert" - has a gap: both reads can happen before either write lands,
so both requests "see" no conflict and both insert. That's an
application-level check, and concurrent requests can both pass it.

SOLUTION:
sender/receiver carry business meaning (who asked, who must respond) and
are used for authorization. userLow/userHigh carry NO meaning - they're
just min(sender,receiver)/max(sender,receiver), computed the same way
regardless of direction, and exist purely so the unique index on
{userLow, userHigh} can reject a second document for the same pair
outright. MongoDB enforces that uniqueness atomically at the storage
layer: of two concurrent inserts for the same pair, exactly one succeeds
and the other fails with a duplicate-key error (code 11000) - there is no
timing window where both can win, because the database itself is the
thing enforcing the invariant, not application code reading state first.

When the loser of that race receives the duplicate-key error, it re-reads
the winning document: if the winner is the *other* direction (they asked
me first), the loser's request is turned into an accept instead of an
error - so A<->B racing to friend each other resolves into exactly one
ACCEPTED document, never two friendships and never two pending rows.

WHY REJECTED ISN'T A PERSISTED STATUS:
Keeping a REJECTED row around would permanently block ever asking that
person again, because the unique index would still consider the pair
"occupied" - re-enabling a future request would need extra logic to
revive/overwrite the old row. Deleting on reject/cancel keeps the
invariant simple: a document = an active relationship (pending or
friends), nothing else. This trades away a rejection audit trail for
that simplicity - reconsider if a history requirement shows up later.

FAILURE CASES:
- Duplicate request from the same sender -> unique index conflict ->
  re-read shows same sender -> REQUEST_ALREADY_EXISTS.
- Request to someone already a friend -> unique index conflict -> re-read
  shows status ACCEPTED -> ALREADY_FRIENDS.
- Accept/reject/cancel on a request that's already been resolved by a
  concurrent call -> the atomic findOneAndUpdate/findOneAndDelete matches
  nothing -> treated as not-found/already-resolved, never double-applied.

INTERVIEW CONCEPTS:
- application-level validation vs. database-enforced invariants
- unique compound indexes as a concurrency-control mechanism
- modeling state via document existence instead of an enum field
- avoiding multi-document transactions by choosing a schema that doesn't
  need them
============================================================
*/
