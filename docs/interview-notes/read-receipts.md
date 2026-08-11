# Read receipts: the "seen" status

Phase: read receipts (see git log around this file's introduction for the commit).

## Problem

`Message.status` already distinguished `sent` (persisted) from `delivered` (the
receiver's socket actually got the realtime push) - see `docs/interview-notes/message-delivery.md`.
Neither of those tells the sender whether the receiver actually *looked at* the
message. That's a separate, later event: the receiver opening the conversation.

## Naive approaches, and why they fail

**"Mark seen as soon as the message is delivered."** Delivered only means the
receiver's socket was online and got the push - it says nothing about whether
they have that conversation open, or are looking at their phone at all. Collapsing
delivered and seen into the same event misrepresents what actually happened.

**"Client sets `status: 'seen'` directly via a REST call."** Never trust the
client to declare state about someone else's message as authoritative (rule 12
in this repo's engineering rules). The receiver's identity for this operation
must come from their authenticated socket, not a value they send.

**"Track exact per-message read state client-side only."** Doesn't survive a
reconnect or a second device - the sender needs a receipt that persists
server-side, not a client-only visual state that resets on refresh.

## Our solution

### 1. `status` enum gains a third value

`backend/models/messageModel.js`: `enum: ['sent', 'delivered', 'seen']`. No
migration needed - existing documents keep whatever status they already have;
Mongoose only enforces the enum on write.

### 2. `messageService.markConversationSeen(viewerId, peerId)`

`backend/services/messageService.js`. Given the *viewer's* id (always the
authenticated socket's userId, never client input) and the peer they're
viewing, it bulk-updates every message in that conversation that the peer sent
to the viewer and that isn't already `seen`:

```js
Message.updateMany(
  { conversationId, senderId: peerId, recieverId: viewerId, status: { $ne: "seen" } },
  { $set: { status: "seen" } }
)
```

One call marks every currently-unseen message in the conversation as seen at
once - no per-message loop, and rerunning it with nothing new to mark is a
no-op (`modifiedCount === 0`), which doubles as an idempotency check.

### 3. Socket event contract

```
message:seen
Client -> Server: { peerId }
  viewerId is taken from socket.userId (verified jwt), never the payload
Server: validate peerId is an ObjectId
        -> markConversationSeen(viewerId, peerId)
        -> if anything changed, emit to peerId's socket (if online):
Server -> peer's socket: { by: viewerId }
No ack. No broadcast at all if nothing changed (nothing new to report).
```

### 4. When the client emits it

`frontend/src/home/components/MessageContainer.jsx` emits `message:seen` in
two places:
- right after the initial page of messages loads for a newly opened
  conversation (opening the chat implies viewing everything on that first page)
- inside the `newMessage` handler, when the incoming message's sender is the
  peer currently open (a live message arriving while the chat is already open
  is, in this app's simplified model, immediately "seen")

This is a deliberate simplification: it does not track actual browser
tab-focus/visibility. A message is treated as seen because the matching
conversation is open in the UI, not because the user is provably looking at
the screen at that instant - the same simplification most chat apps make.

### 5. Rendering

The existing tick pattern (`✓` sent, `✓✓` delivered) gets a third state: `✓✓`
in a distinct color (blue, `text-sky-300`) for seen - no new iconography, just
the WhatsApp-style convention this UI was already implying.

## Data flow

```
Viewer opens conversation with peer
  -> GET /api/message/:peerId (existing REST fetch, unchanged)
  -> client emits socket "message:seen" { peerId }
       -> server: viewerId = socket.userId (never trusted from payload)
       -> messageService.markConversationSeen(viewerId, peerId)
            -> Message.updateMany(unseen messages from peer to viewer -> seen)
       -> if anything changed: emit "message:seen" { by: viewerId } to peer's socket
  -> peer's client (if peer has that same conversation open):
       flips their own sent/delivered bubbles to seen in local state
```

## Delivery guarantee, precisely

Same shape as the delivered-status guarantee already documented for message
delivery: the socket emit is a latency optimization, not the source of truth.
If the peer is offline when the receipt happens, they simply see the correct
`seen` status next time they fetch that conversation (`GET /api/message/:id`
already returns each message's persisted `status`) - nothing is lost, it's
just not pushed in realtime.

## Failure cases

| Scenario | Behavior |
|---|---|
| Peer (original sender) is offline when viewer marks seen | DB write still happens; `notify`/emit is skipped (no socket to push to); peer sees correct status on next fetch |
| No conversation exists yet between the two users | `markConversationSeen` returns `{updated: 0}` immediately; no Message query, no broadcast |
| Viewer emits `message:seen` twice in a row with nothing new | Second call matches zero documents; no broadcast sent (avoids spamming the peer with redundant receipts) |
| Malformed/missing `peerId` in the socket payload | Rejected by `mongoose.isValidObjectId` before any query runs; handler returns silently, no crash |
| Two `message:seen` emits race (page-load emit and live-message emit firing close together) | Both `updateMany` calls are independently safe; whichever runs second finds nothing left to update |

## What we deliberately did not do

- **No `seenAt` timestamp.** Only a boolean-ish state via the `status` enum,
  matching the existing sent/delivered pattern. A "seen at 10:32 PM" tooltip
  is a UI polish addition on top of this, not part of the core mechanism.
- **No group-chat "seen by N people" list.** This app is DMs only; the whole
  design (one `peerId`, one broadcast target) assumes exactly two participants.
- **No tab-focus/visibility tracking.** Seen is inferred from "conversation is
  open," not "user is actively looking at the screen" - see the simplification
  note above.
- **Not wired to `Conversation.unreadCount`.** That field already exists on
  the `Conversation` model but isn't populated or read anywhere in the
  codebase - pre-existing, unrelated to this phase, left untouched.

## Scaling limitations

Same as message delivery: `userSocketMap` in `backend/Socket/socket.js` is
process-local, so the realtime receipt push only works within a single backend
instance. If the app is ever scaled horizontally, presence and this push both
need a shared store (e.g. Redis) - independent of everything in this phase.

## Common interview questions

**Q: Why is marking a conversation "seen" a bulk update instead of updating
one message at a time?** The client only knows "I opened this conversation,"
not which specific message ids just became visible from the server's point of
view. A single `updateMany` filtered on "not yet seen" both answers that and
gives you idempotency for free - rerunning it when nothing's new just matches
zero documents.

**Q: Why derive the viewer's identity from the socket instead of the
payload?** Never trust the client to assert whose read receipt this is -
if a client could pass an arbitrary `viewerId`, anyone could forge a receipt
claiming someone else read their messages. The verified JWT at socket
handshake time is the only trustworthy source of "who is this."

**Q: What happens if the peer is offline when the viewer reads the message?**
Nothing is lost - the DB write is unconditional and happens either way. The
socket emit is purely a low-latency notification for the case where the peer
happens to be online; the peer's next fetch of that conversation returns the
correct persisted status regardless.
