# Message delivery: idempotency, retries, and optimistic UI

Phase: message reliability (see git log around this file's introduction for the commit).

## Problem

`POST /api/message/send/:id` is a plain HTTP request from the frontend. Before this
phase:

- There was no way to tell two send attempts apart. If the client retried a request
  (dropped connection, timeout, user double-tapping send), the server had no way to
  recognize "this is the same message again" versus "this is a new message" — it just
  created a new `Message` document either way.
- The frontend didn't render anything until the server responded, so there was no
  optimistic UI, no "sending..." state, and no way to retry a failed send without
  retyping it.
- `Message` and `Conversation` were written concurrently (`Promise.all`), so a failure
  partway through could leave the conversation's `messages` array pointing at a
  document that never got saved.

## Naive approaches, and why they fail

**"Just don't retry on the client."** Doesn't help — retries aren't only a client
choice. A response can be lost after the server already committed the write (dropped
connection, app backgrounded, proxy timeout). The client can't distinguish "my request
never arrived" from "my request succeeded but the response didn't come back," so it
has to be able to retry safely either way.

**"Dedupe by (senderId, text, conversationId, short time window)."** Breaks
legitimate use: sending the same short message twice on purpose (e.g. "ok" then "ok"
again) would silently collapse into one message. Content isn't a reliable identity for
"this is the same attempt."

**"Debounce the send button on the client."** Only prevents accidental double-clicks —
does nothing for a request that the client legitimately needs to retry after a timeout,
and does nothing at all if two different tabs/devices race.

## Our solution

### 1. `clientMessageId` — an idempotency key generated once per attempt

The frontend generates a UUID (`crypto.randomUUID()`) once, when the user hits send.
That id travels with every retry of that same logical send.

`backend/models/messageModel.js` adds:

```js
clientMessageId: { type: String, required: true }
```

with a **sparse, unique** index. Sparse matters because messages saved before this
field existed have no `clientMessageId` — without `sparse`, a second such document
would collide with the first on the shared `null` value.

### 2. Idempotent controller logic

`backend/controllers/messageController.js`:

```
try save Message
  -> succeeds: this is a new message, isNewMessage = true
  -> fails with Mongo duplicate-key (code 11000):
       re-read the existing Message by clientMessageId
       isNewMessage = false
```

A retry that races a slow-but-successful first attempt gets back the *same* saved
message instead of creating a second one — the client-visible operation is
effectively-once, even though the underlying HTTP request was delivered
at-least-once.

Two more idempotency details:

- **Conversation linking** is checked, not assumed: `chats.messages` is only pushed to
  if the message's `_id` isn't already in it. This covers the narrow case where the
  process crashes between saving the `Message` and linking it into the `Conversation` —
  a retry will find the existing message and link it, rather than leaving it orphaned.
- **The realtime push only fires once.** `io.emit('newMessage', ...)` and the
  `status: 'delivered'` update only happen when `isNewMessage` is true. If they fired
  on every retry, a receiver who was online for the first (successful but
  slow-to-acknowledge) attempt would see the same message pushed into their open chat
  twice.

### 3. Optimistic UI with rollback

`frontend/src/home/components/MessageContainer.jsx`:

- On send, a local bubble is added immediately with `status: 'sending'` and the
  generated `clientMessageId` — no waiting for the server round-trip.
- On success, the bubble is reconciled in place (matched by `clientMessageId`) with the
  server-confirmed message (real `_id`, `createdAt`, `status`).
- On failure, the bubble is **not removed** — it flips to `status: 'failed'` with a
  "Retry" action. Retry calls the same send path with the *same* `clientMessageId`,
  which is exactly what makes retrying safe: the backend will either create the message
  (if the original request never actually arrived) or recognize it as the same attempt
  (if it did).

This is the rollback story required whenever a UI updates optimistically: the
optimistic state must be reconciled or rolled back once the server's real answer is
known, never left showing something the server didn't confirm.

## Data flow

```
User hits Send
  -> client generates clientMessageId (UUID)
  -> optimistic bubble added, status: "sending"
  -> POST /api/message/send/:id { message, clientMessageId }
       -> validate (message non-empty/length, clientMessageId present)
       -> authorize (private-profile friend check)
       -> find-or-create Conversation
       -> save Message (idempotent on clientMessageId)
       -> link into Conversation.messages (idempotent, checked not assumed)
       -> if newly created: emit "newMessage" to receiver's socket, mark delivered
       -> respond 201 (new) or 200 (retry) with the saved message
  -> client reconciles the bubble by clientMessageId
       -> success: replace with server message (real _id, createdAt, status)
       -> failure: mark status "failed", show Retry (reuses same clientMessageId)
```

## Delivery guarantee, precisely

Socket.IO gives no delivery guarantee by itself — an emit can be lost if the socket
drops mid-flight, and NexChat's presence map (`userSocketMap` in
`backend/Socket/socket.js`) is process-local, so there's exactly one shot at delivering
a realtime push per online receiver. What actually makes delivery effectively-once
end-to-end is the combination of:

1. **Durable persistence** — the message is saved to MongoDB *before* anything is
   acknowledged to the client.
2. **A durable read path** — `GET /api/message/:id` reads from that same durable store,
   so a receiver who missed the realtime push still sees the message on next
   fetch/reconnect.
3. **Idempotency on the write side** — `clientMessageId` guarantees retries don't
   duplicate the persisted message.

The realtime emit is a latency optimization on top of a durable, idempotent write —
not the source of truth.

**Terminology, precisely:** the HTTP request from client to server is *at-least-once*
(it may be retried). The resulting write to MongoDB is *effectively-once* (idempotent
via `clientMessageId`, so retries collapse onto the same document). The Socket.IO push
from server to receiver is *at-most-once* per attempt (fire-and-forget, no ack, no
retry) — the durable read path is what covers the gap if that one shot misses.

## Failure cases

| Scenario | Behavior |
|---|---|
| Response lost after server saved the message | Client retries with same `clientMessageId` → server returns the existing message (200), no duplicate created |
| Crash between saving `Message` and linking to `Conversation` | A later retry (or the user manually resending, unlikely but possible) links the existing message instead of leaving it orphaned indefinitely. A crash with **no** retry ever following leaves it saved-but-unlinked — accepted, not fixed with a transaction (see below) |
| Receiver offline when message is sent | `status` stays `"sent"`; receiver sees it via `GET /api/message/:id` on next open; no push was ever attempted |
| Receiver online, push succeeds | `status` flips to `"delivered"`; receiver's client appends it directly via the `newMessage` socket event |
| Client's POST truly never reaches the server | No message exists server-side; client shows `"failed"` with Retry; retry is a genuine first attempt (no duplicate-key error) |
| Two devices of the same user retry independently with different `clientMessageId`s for what the user considers "the same" send | Two messages are created — this is out of scope; `clientMessageId` dedups retries of *one* client's *one* attempt, not cross-device intent |

## What we deliberately did not do

- **No Mongo multi-document transaction** across the `Message` save and the
  `Conversation` update. Transactions require a replica set and add real operational
  complexity for a single-instance MERN project at this scale. The idempotent
  find-or-link check gets most of the benefit (a retry heals the link) without it — the
  only unhealed case is a crash with zero subsequent retries, which is an acceptable
  gap for now.
- **No read receipts.** `status` only distinguishes `sent` vs `delivered` (realtime
  push succeeded or not) — there's no "seen" state tied to the receiver actually
  opening the conversation. That's a separate future phase.
- **No socket-emitted send path.** Sending is still plain REST; only the server→receiver
  push uses Socket.IO. Converting the send itself into a socket event with an ack
  contract is a bigger change to the realtime layer and was kept out of this phase's
  scope on purpose (one system at a time).

## Alternatives considered

- **Outbox pattern / background reconciliation job** that periodically scans for
  `Message` documents not referenced by any `Conversation.messages` and links them.
  More robust against the crash-with-no-retry gap above, but it's a new background
  worker for a gap that's narrow and low-probability — not justified yet at this
  project's scale.
- **Client-side dedup only** (skip re-adding a bubble if the same text was just sent).
  Rejected: doesn't fix the actual server-side duplication risk, and the "same text
  twice" heuristic has real false positives.

## Scaling limitations

- The idempotency check is a single `findOne` by an indexed field — cheap and doesn't
  change under load.
- The `alreadyLinked` check does `chats.messages.some(...)`, an O(n) scan of the
  conversation's message-id array on every send. Fine at this project's scale (a DM
  conversation's array isn't going to reach a size where this matters); would need
  rethinking (e.g. checking via a query instead of loading the whole array) if
  conversations ever grew to tens of thousands of messages.
- `userSocketMap` (in `backend/Socket/socket.js`) is still process-local — this phase
  doesn't change that. If the backend is ever scaled to multiple instances, "receiver
  online" and the realtime push both need a shared store (e.g. Redis), independent of
  everything in this document.

## Common interview questions

**Q: How do you make an HTTP write idempotent when the client might retry it?**
Generate an id client-side that identifies the *attempt*, not the content. Enforce
uniqueness on that id at the database level (a unique index), and on a
duplicate-key error, treat it as "already done" and return the existing result instead
of erroring or creating a duplicate.

**Q: Why not just rely on Socket.IO for delivery?**
Socket.IO has no built-in delivery guarantee — it's fire-and-forget over a connection
that can drop at any time. Durable persistence plus a read path the client can fall
back to is what actually guarantees the message isn't lost; the socket push is purely a
latency optimization for the online case.

**Q: What's the difference between at-least-once, at-most-once, and effectively-once
here?** The client's HTTP request is at-least-once (may be retried). The realtime
socket push is at-most-once (one attempt, no retry, no ack). The net effect on the
database — thanks to the idempotency key — is effectively-once: the user's action
results in exactly one message existing, regardless of how many times the underlying
request was actually sent.

**Q: Why is optimistic UI rollback needed here, and what does "rollback" mean when you
can't literally undo a message that was never sent?** Rollback doesn't mean deleting
the bubble — it means not leaving the UI showing a confirmed state that the server
never confirmed. Here that's flipping the bubble to a visibly `"failed"` state with a
retry action, rather than silently leaving it looking identical to a successfully sent
message.

**Q: Why didn't you use a database transaction for the Message-save +
Conversation-link?** Transactions require a replica set, add latency and operational
complexity, and the failure window they'd close (crash between two specific writes) is
narrow and already mostly closed by making the link idempotent and retry-healed. For a
single-instance project at this scale, that trade-off wasn't worth it — call it out
explicitly rather than silently accepting a correctness gap without naming it.
