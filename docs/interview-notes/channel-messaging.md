# Channel messaging & the realtime layer split

Phase: channel messaging + realtime layer (see git log around this file's introduction).

## Problem

Servers/channels (previous phase) had membership and roles but no way to actually
talk in a channel. Unlike DMs - exactly two participants, one designated receiver -
a channel message needs to reach an arbitrary number of members, and the realtime
layer (`backend/Socket/socket.js`, a single ~115-line file) needed room-based
broadcast, per-channel typing, and a lot more surface area than it had.

## Design decisions, and why

### Channel messages are socket-first, DMs are REST-first

DM sending is `POST /api/message/send/:id` specifically because HTTP retries are
easy to reason about and idempotency via `clientMessageId` maps cleanly onto "did my
POST succeed" (see `docs/interview-notes/message-delivery.md`). Channel messages use
a socket event with an ack (`send_message`) instead, for a concrete reason: a channel
message needs to reach every member of the room in realtime *anyway*, so the
send-then-broadcast happens on the same connection instead of round-tripping through
REST and then separately pushing to N other sockets.

**This does not mean giving up the reliability guarantee.** `ChannelMessage` reuses
the *exact same* `clientMessageId` idempotency pattern as the DM `Message` model - a
dropped ack or a client that reconnects mid-send retries with the same id, and the
unique index on `clientMessageId` makes a duplicate-key error look identical to "this
attempt already succeeded," exactly like the DM path. The only thing that changed is
the transport (socket ack vs HTTP response); the reliability mechanism didn't.

### Separate model from DM `Message`, not a generalized one

Considered unifying into one `Message` model with an optional `channelId`. Rejected:
DM `status` (`sent`/`delivered`/`seen`) and `recieverId` are inherently
per-single-recipient concepts. A channel message doesn't have one receiver, it has N
members, each of whom would need their own delivery/read state - forcing that into
the DM model would mean either an array of per-member states (a different data shape
entirely) or leaving `status`/`recieverId` meaningless for channel messages sharing
the same schema. Two purpose-built models, sharing only the *pattern* (idempotency
key, cursor pagination by `_id`), is simpler than one model straddling two different
delivery semantics.

### `join_channel`/`leave_channel` are room subscriptions, not authorization state

Actually being allowed to access a channel is still `ServerMembership` (a durable,
REST-managed relationship from the previous phase). `join_channel` just subscribes
*this socket connection* to `channel:{id}` so the server has somewhere to broadcast
to - re-authorized against `ServerMembership` fresh, every time, never inferred from
"the client says it already joined." Mutations (`send_message`/`edit_message`/
`delete_message`) re-check membership independently too, rather than trusting that
the sender's socket happens to be in the room - room membership is a broadcast
convenience, not a security boundary.

### `typing` is one self-expiring event for channels, no `stopTyping`

DM typing is explicit start/stop between exactly two people - cheap to track. A
channel can have many people typing at once; tracking explicit stop state per user
per channel is real bookkeeping for little benefit. Instead, the receiving client
clears each user's typing indicator after ~3 seconds without another `typing` event -
the same simplification Slack and similar tools make. DM's `typing`/`stopTyping` pair
is untouched.

### Presence: snapshot once, delta after

Before this phase, every connect/disconnect broadcast the *entire* online-user list
to *every* connected client (`io.emit("getOnlineUsers", allUserIds)`) - O(n) payload
to n clients on every single join/leave, O(n²) total data as the user count grows.
Now: a newly-connected socket gets one `getOnlineUsers` snapshot (to itself only);
everyone else gets a one-line `user_online`/`user_offline` delta. This is a real
behavior change to an existing contract, so `frontend/src/Context/SocketContext.jsx`
was updated in the same phase (never leave a contract change half-applied - see the
"do not break existing API contracts" rule).

### The realtime/ split

`backend/Socket/socket.js` is now `backend/realtime/socket.js` (connection setup,
auth middleware, presence map) plus `backend/realtime/handlers/*.js` (one file per
concern: presence, DM typing, DM read receipts, server-room subscriptions, channel
messaging). This was deferred from the servers/channels phase specifically until
there was a concrete reason - channel messaging needed enough new event handlers that
the single-file version would have become unreadable. Same exports
(`{io, app, server, getRecieverSocket}`), so the only change for existing consumers
(`index.js`, `messageController.js`, `friendController.js`) was the import path.

## Event contract

See the servers/channels planning discussion (or `backend/realtime/handlers/*.js`,
each event is documented at its handler) for the full per-event contract:
`join_server`, `leave_server`, `join_channel`, `leave_channel`, `send_message`,
`edit_message`, `delete_message`, `typing` (channel-scoped), `user_online`,
`user_offline`.

## Failure cases

| Scenario | Behavior |
|---|---|
| `send_message` ack is dropped after the server already saved the message | Retry with the same `clientMessageId` hits the duplicate-key path, returns the same message, `isNewMessage: false` - no duplicate, no missed broadcast re-fire (broadcast only happens when `isNewMessage` is true) |
| A member is removed from the server after joining a channel's socket room but before their next `send_message` | Rejected - authorization is re-checked against `ServerMembership` on every mutation, not inferred from room membership |
| Non-sender tries to edit someone else's message | `findOneAndUpdate` with `senderId` in the filter returns null (atomically - no separate find-then-check race), surfaced as `MESSAGE_NOT_FOUND_OR_NOT_YOURS` |
| Owner/admin deletes another member's message (moderation) | Allowed - `deleteMessage` checks `isOwnMessage OR role in [owner, admin]` |
| Two `send_message` calls with different `clientMessageId`s but identical content, sent by mistake | Two messages are created - `clientMessageId` dedups retries of *one* attempt, not duplicate user intent (same accepted scope-limit as the DM idempotency design) |

## What we deliberately did not do

- **No message reactions, threads, or pinning.** Out of scope for this phase.
- **No soft-delete/tombstone for `delete_message`.** A hard delete plus a
  `message_deleted` broadcast is enough for connected clients to remove it from view;
  a client fetching history afterward simply doesn't see it. An audit trail for
  moderation actions would be a deliberate future addition, not an oversight.
- **No rate limiting on `send_message`/`typing`.** Flagged, not solved - this app has
  no rate limiting anywhere yet (see the servers/channels phase discussion); adding it
  is a separate, cross-cutting phase, not something to bolt onto one event handler.
- **`document_update`/`cursor_move` are not implemented.** Reserved for the future
  collaborative doc editor - deliberately deferred (would need a CRDT library
  decision, e.g. Yjs, which is its own dependency discussion).

## Common interview questions

**Q: Why is DM messaging REST but channel messaging is socket-based, in the same
app?** They're solving different delivery problems. A DM has exactly one designated
receiver, so REST-plus-a-single-targeted-emit is the natural fit. A channel message
needs to reach an unbounded number of members in realtime regardless of how it was
sent, so doing the send and the broadcast on the same socket connection avoids a
REST-then-fan-out-over-sockets round trip for no benefit.

**Q: How do you keep a socket-based write idempotent when there's no HTTP status
code to hang retries off of?** The reliability mechanism (a client-generated
`clientMessageId`, enforced unique at the database level) doesn't care what the
transport is. An ack callback plays the same role an HTTP response does - the client
retries the same logical attempt with the same id either way.

**Q: Why re-check server membership on every `send_message` instead of trusting that
the socket already joined the channel's room?** Room membership is set once, at
`join_channel` time, and never automatically revoked if the underlying
`ServerMembership` changes later (e.g. a kick). Treating "is in the room" as
authorization would mean a removed member could keep sending messages until they
happen to disconnect. Re-checking the source of truth on every mutation closes that
gap at the cost of one more indexed query per send.
