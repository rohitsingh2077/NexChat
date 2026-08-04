const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recieverId: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  // Client-generated id (crypto.randomUUID()) identifying one logical send
  // attempt. A retry of the same attempt collides into the existing
  // document via the unique index below instead of creating a duplicate
  // message - see messageController.sendMessage and LEARNING NOTES.
  clientMessageId: {
    type: String,
    required: true,
  },
  // 'sent' = persisted; 'delivered' = the receiver's socket actually
  // received the realtime push; 'seen' = the receiver has had the
  // conversation open while this message was present (read receipt, set via
  // messageService.markConversationSeen). Not a delivery guarantee on its
  // own - see LEARNING NOTES.
  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent',
  },
}, { timestamps: true });

// sparse: messages inserted before this field existed have no
// clientMessageId - without sparse, a second such document would collide
// with the first on the shared `null` value and fail to save.
messageSchema.index({ clientMessageId: 1 }, { unique: true, sparse: true });

// Serves cursor-paginated history: Message.find({conversationId, _id:{$lt:cursor}})
// .sort({_id:-1}).limit(n) - conversationId narrows to one conversation,
// _id (already sorted, already unique) satisfies both the range condition
// and the sort with no extra in-memory sort step. See messageController.js
// getMessage and LEARNING NOTES for why _id is used as the cursor instead
// of createdAt.
messageSchema.index({ conversationId: 1, _id: 1 });

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
clientMessageId turns "send a message" into an idempotent operation, so a
network retry or a double-submit from the client can never create two
messages for the same logical send attempt. status tracks whether the
realtime push to the receiver actually happened.

WHY THIS EXISTS:
The frontend calls POST /api/message/send/:id over plain HTTP. If the
response is lost after the server already saved the message (dropped
connection, timeout, app resumed from background), the client has no way
to know whether the send succeeded - the only safe options are "assume it
failed and let the user resend" or "somehow recognize a resend as the same
attempt". Without an idempotency key, resending creates a second, distinct
message: same text, two documents, because Mongo has no way to know it's
the same logical send.

SOLUTION:
The client generates a UUID once per send attempt (crypto.randomUUID()) and
reuses that same id if it retries. The unique index on clientMessageId
means a retry's insert fails with a duplicate-key error (code 11000)
instead of creating a second document - the controller catches that error
and re-reads the original message instead of erroring out, so the caller
gets back the same result whether their request landed once or the retry
raced a slow-but-successful first attempt.

WHY NOT DEDUPE BY (senderId, message, conversationId, time window) INSTEAD:
Two legitimate messages can have identical text in a short window (e.g.
sending "ok" twice on purpose) - content-based dedup would silently drop a
real second message. An explicit id generated once per user action has no
such ambiguity: same id = same attempt, different id = different attempt,
regardless of content.

FAILURE CASES:
- Client sends, response is lost, client retries with the same
  clientMessageId -> second attempt hits the duplicate-key error, the
  controller returns the already-saved message with 200 instead of 201.
  Effectively-once from the caller's point of view, even though the
  request itself was delivered at-least-once.
- Process crashes between saving the Message and linking it into the
  Conversation's messages array -> the retry finds the existing message via
  clientMessageId and links it into the conversation if not already linked,
  so the message doesn't stay permanently orphaned. This is not a full
  transaction (the two writes are still separate operations) - a crash in
  exactly that narrow window before any retry occurs would leave a message
  saved but unlinked until one occurs. Accepted for now rather than adding
  Mongo multi-document transactions for a single-instance MERN project at
  this scale.
- Realtime push (Socket.IO emit) only fires on the attempt that actually
  created the message, never on a retry that found an existing document -
  otherwise the receiver could see the same message pushed to their open
  chat twice.

DELIVERY GUARANTEE, PRECISELY:
Socket.IO gives no delivery guarantee on its own - a message can be lost if
the receiver's socket drops mid-emit. What actually makes this
"effectively-once" for the user is the combination of: (1) durable
persistence in MongoDB before any acknowledgment, (2) the receiver's
message list also being fetched via GET /api/message/:id from that durable
store, and (3) the clientMessageId idempotency guarding against duplicates
from retries. The realtime emit is a latency optimization, not the source
of truth.

INTERVIEW CONCEPTS:
- idempotency keys for retry-safe writes
- unique index as a database-enforced dedup mechanism, not app-level checks
- at-least-once request delivery vs. effectively-once application behavior
- why persistence (not the socket push) is the actual delivery guarantee

CURSOR PAGINATION - WHY _id INSTEAD OF createdAt:
getMessage paginates history by _id, not createdAt. A timestamp cursor
("give me messages before this createdAt") breaks when two messages share
a millisecond: sort order among ties isn't guaranteed to match query order,
so a page boundary can either skip a tied message or return it twice.
ObjectId doesn't have this problem - each one is unique and, since this
app always inserts new messages with a freshly generated id, monotonically
increasing in insertion order. That makes "less than this _id" an
unambiguous, race-free definition of "older than this page", and it's the
same field the {conversationId, _id} index above is built on, so the query
and the sort both use it for free.
============================================================
*/
