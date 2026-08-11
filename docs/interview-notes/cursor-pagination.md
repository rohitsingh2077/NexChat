# Cursor pagination for message history

Phase: message reliability, part 2 (follows [message-delivery.md](./message-delivery.md)).

## Problem

`GET /api/message/:id` fetched an entire conversation's history in one response:

```js
const chats = await Conversation.findOne({ participants: { $all: [senderId, recieverId] } })
  .populate("messages");
return res.json({ success: true, messages: chats.messages });
```

`Conversation.messages` is an array of every message ever exchanged in that
conversation. `populate` resolves every single one of those references into a full
`Message` document, every time the chat is opened — regardless of whether the
conversation has 10 messages or 100,000. That's an unbounded query and an unbounded
response payload, growing forever with no ceiling.

## Naive approaches, and why they fail

**"Just add `.limit(50)` to the populate."** `populate()` doesn't limit *which* array
elements get resolved — the array itself already holds every message id, so limiting
the populate would either still fetch the whole array of ids (cheap) but arbitrarily
truncate which ones get hydrated (no control over *which* 50, and no way to ask for the
next 50).

**"Offset pagination: `?page=2&pageSize=30`, skip 30."** Works at small scale but has a
real correctness bug for a live chat: if a new message arrives between page 1 and page
2 being fetched, every subsequent "offset" shifts by one, and the client either sees a
duplicate or skips a message. Offset pagination also gets slower as the offset grows,
since the database still has to walk past all the skipped documents.

**"Timestamp cursor (`createdAt`)."** Closer, but timestamps aren't guaranteed unique —
two messages saved in the same millisecond (realistic under any concurrent load) create
a tie. Depending on how ties land relative to the page boundary, a query for "older than
this timestamp" can skip or double-return a tied message.

## Our solution

Cursor pagination keyed on `_id`, not `createdAt` or an offset.

### Why `_id` as the cursor

A MongoDB `ObjectId` is unique per document and, for documents inserted by this app (no
bulk imports, no manual `_id` overrides), monotonically increasing in insertion order.
That gives an unambiguous, race-free definition of "everything older than this point":
`_id < cursor`. No ties are possible (ids are unique by construction), and no
"shifting offset" problem exists (the cursor is anchored to a specific document, not a
position that moves as new rows are inserted).

### Query

`backend/controllers/messageController.js`:

```js
const query = { conversationId: chats._id };
if (cursor) query._id = { $lt: cursor };

const page = await Message.find(query)
  .sort({ _id: -1 })
  .limit(pageSize + 1);       // +1 to detect hasMore without a count query

const hasMore = page.length > pageSize;
const trimmed = hasMore ? page.slice(0, pageSize) : page;
const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

res.json({ success: true, messages: trimmed.reverse(), hasMore, nextCursor });
```

Fetching `pageSize + 1` and checking whether the extra one came back is a cheap way to
know if there's a next page, without running a separate `countDocuments` query.

### Index

`backend/models/messageModel.js`:

```js
messageSchema.index({ conversationId: 1, _id: 1 });
```

- **Query it serves**: `Message.find({ conversationId, _id: { $lt: cursor } }).sort({ _id: -1 }).limit(n)`.
- **Why this field order**: `conversationId` is an equality filter (ESR rule — Equality
  fields first), `_id` handles both the range condition (`$lt`) and the required sort
  in the same index scan, so MongoDB never needs a separate in-memory sort step.
- **Storage/write cost**: one extra B-tree entry per message insert. Negligible at this
  project's write volume — the standard, expected cost of a targeted index.

### API contract

`GET /api/message/:id?cursor=<ObjectId>&limit=<1-100, default 30>`

Response: `{ success, messages: [...oldest→newest for this page...], hasMore, nextCursor }`.
No `cursor` = most recent page. `nextCursor` is `null` once there's nothing older left.

### Frontend: scroll-preserving "load more"

`frontend/src/home/components/MessageContainer.jsx` loads only the first page on open.
Scrolling near the top of the message list (while `hasMore` is true) triggers a fetch
of the next page with `cursor=nextCursor`, which gets *prepended* to the in-memory
list.

Prepending content above the current viewport would normally yank the scroll position
down to show the new content at the top (the browser keeps `scrollTop` fixed, and new
content pushes everything else down past where the user was looking). To avoid that:

1. Before the state update, capture `scrollContainerRef.current.scrollHeight`.
2. After React re-renders with the older messages prepended, set
   `scrollTop = newScrollHeight - oldScrollHeight` — exactly the height of what was
   just inserted above — in a `useLayoutEffect` (runs before the browser paints, so
   there's no visible jump-then-correct flicker).
3. The same effect's default behavior (auto-scroll to bottom) is skipped for this case
   via a ref flag, so it only fires for genuinely new messages (sent or received), not
   for a history load.

## Data flow

```
Open conversation
  -> GET /api/message/:id?limit=30 (no cursor)
  -> returns newest 30 messages, oldest -> newest, hasMore, nextCursor
  -> rendered, scrolled to bottom

User scrolls near the top, hasMore is true
  -> capture current scrollHeight
  -> GET /api/message/:id?cursor=<nextCursor>&limit=30
  -> returns the next-older 30, oldest -> newest, new hasMore/nextCursor
  -> prepended to the message list
  -> scrollTop adjusted so the viewport doesn't visibly move
```

## Failure cases

| Scenario | Behavior |
|---|---|
| Invalid `cursor` (not a valid ObjectId) | 400 from `validateGetMessages`, request rejected before hitting the controller |
| `limit` out of range or non-integer | 400 from the same validator (bounded to 1-100) |
| No conversation exists yet | `{ messages: [], hasMore: false, nextCursor: null }` — same shape as a normal empty page, no special-casing needed client-side |
| A new message arrives (via socket) while the user is scrolled up loading older history | Unaffected — the new message is appended via the separate `newMessage` socket handler, which doesn't touch `nextCursor`/`hasMore`; forward (live) and backward (history) message flow are cleanly decoupled by cursor direction |
| User scrolls up rapidly, firing the scroll handler many times before a page resolves | `loadingOlder` guards `loadOlderMessages` from starting a second fetch while one is in flight |

## What we deliberately did not do

- **No offset/page-number pagination.** Rejected above for the shifting-window bug
  under concurrent inserts.
- **No `createdAt` cursor.** Rejected above for tie-breaking correctness.
- **No separate `countDocuments` for total message count / total pages.** Nothing in
  the UI needs a total count, and it would be an extra full collection scan (or an
  extra index) purely to display a number nobody asked for.
- **Didn't change what `Conversation.messages` is used for on the write side.**
  `sendMessage` still pushes into that array (see message-delivery.md) — this phase
  only changed how *reads* are served, from array-populate to a direct indexed query,
  because the array approach has no way to bound how much gets hydrated per request.

## Scaling limitations

- Deep pagination (scrolling back through tens of thousands of messages) still works
  correctly with this approach — unlike offset pagination, cursor-based paging doesn't
  degrade as you go further back, because each query is still just an indexed
  equality+range lookup, not "skip N rows".
- This paginates one conversation's history. It does not paginate the conversation
  *list* itself (Sidebar/FriendsList) — that's a different, currently-unbounded query
  outside this phase's scope if it ever needs the same treatment.

## Common interview questions

**Q: Why cursor pagination instead of offset (`?page=2`)?**
Offset pagination re-counts from the start of the result set every time, so it gets
slower the deeper you paginate, and it's unstable under concurrent writes — inserting a
new row shifts every offset after it, causing skipped or duplicated rows across page
boundaries. A cursor anchors to a specific document instead of a position, so it's
immune to both problems.

**Q: Why `_id` instead of `createdAt` as the cursor?**
Timestamps aren't guaranteed unique — two documents can share a millisecond, and ties
can be skipped or double-counted at a page boundary depending on how they land relative
to the cursor. `ObjectId` is unique per document and, for this app's insert pattern,
increases monotonically with insertion order, so `_id < cursor` is an unambiguous,
tie-free definition of "strictly older than this page."

**Q: How do you know if there's a next page without a separate count query?**
Fetch one extra document beyond the page size. If it comes back, there's more; drop it
from the response and use the last *included* document's id as the next cursor.

**Q: What index does this need, and why that field order?**
A compound index on `{ conversationId: 1, _id: 1 }`. Equality fields (`conversationId`)
go first per the ESR (Equality, Sort, Range) guideline; `_id` here serves double duty as
both the sort key and the range filter, so MongoDB can satisfy the whole query — filter,
range, and sort — from a single index scan with no extra in-memory sort.
