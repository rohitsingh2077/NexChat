# Collaborative documents: LWW (Phase 1) -> CRDT (Phase 2a) -> presence (Phase 2b) -> offline resilience (Phase 3a) -> version history (Phase 3b)

Phase: document collaboration backend + frontend (see git log around this file's
introduction for the commit). This document was written for Phase 1 (last-write-wins)
and is kept as-is below because the trade-off reasoning ("why not build OT yourself")
is still the right way to think about the problem - Phase 2a below replaces the
mechanism (CRDT instead of LWW) without changing that reasoning. Phase 2b adds
cursor/selection presence on top of Phase 2a's foundation. Phase 3a (this document's
newest section) makes that same foundation resilient to disconnects - the first of
three planned additions (offline resilience -> version history -> multi-instance
Socket.IO + Redis), numbered 3a/3b/3c since they're independent extensions of Phase
2's architecture rather than sequential replacements the way 1 -> 2a was.

## Problem

Channel members want a shared, editable document per channel - like a lightweight
Google Doc scoped to a channel. Multiple people can open the same document at once
and type into it. The interesting problem isn't the editor UI, it's: **what happens
when two people edit at the same time?**

## Naive approaches, and why "last write wins" is still the right first step

**Real concurrent editing** (two people's edits both surviving, even when they
overlap) needs either:

- **Operational Transformation (OT)** - what Google Docs actually uses. Every edit
  is expressed as an operation (insert/delete at a position); when two operations
  happen concurrently, each is *transformed* against the other so applying both, in
  either order, produces the same result. Correct OT is notoriously hard to
  hand-write - real implementations (Google Wave, Docs) took dedicated teams years
  to harden against edge cases like transforming three or more concurrent ops
  together.
- **CRDTs (Conflict-free Replicated Data Types)** - e.g. Yjs. Each client's edits
  merge automatically with a mathematical convergence guarantee, no central
  transform step needed. This is what most modern collaborative editors (Linear,
  many Notion-likes) use today instead of OT, because a well-tested CRDT library is
  much less likely to have subtle merge bugs than hand-rolled OT.

Both are legitimate, but both are a significant chunk of work and complexity for a
first version. This phase deliberately ships the simplest *correct* thing instead:
**last-write-wins (LWW)**. Whichever `document:edit` event's database write finishes
last becomes the document's state. No merge happens - a concurrent edit from someone
else can overwrite part of what you just typed.

**This is a known, accepted limitation, not an oversight.** Two users editing
different parts of the same document at the same moment will have one edit silently
lost, not merged. See "What's deliberately NOT solved" below.

## Our solution

### 1. Storage: `Document` (`backend/modules/documents/document.model.js`)

One document per row: `channelId`, `title`, `content` (the TipTap/ProseMirror JSON
tree, stored as `Mixed` since it's read/written whole, never queried into),
`version` (bumped via atomic `$inc` on every save), `createdBy`, `lastEditedBy`.
Index: `{ channelId: 1 }` - the one real query is "list documents in this channel".

### 2. Editor: TipTap (ProseMirror-based)

Chosen specifically because its content is a portable JSON tree and it has an
official Collaboration extension that binds to a Yjs CRDT - see "forward
compatibility" below.

### 3. Transport split - REST for metadata, sockets for live content

Same split this app already uses for channel messages:

- REST (`/api/servers/:serverId/channels/:channelId/documents`) - create, list,
  get, rename, delete. Infrequent, not part of the live-typing hot path.
- Socket (`document:join`, `document:leave`, `document:edit`) - the actual live
  editing signal, debounced client-side (~400ms after typing pauses) rather than
  fired per keystroke.

### 4. The concurrency mechanics, precisely

```
document:edit
Client: { documentId, content }          # content = full editor.getJSON() tree
Server: authorize (channel member)
        → Document.findOneAndUpdate({_id: documentId, channelId}, { content, lastEditedBy, $inc: {version: 1} })
        → ack { success, version, updatedAt }
        → broadcast document:updated { documentId, content, version, editedBy } to the room
```

- **No version check gates the write.** It's an unconditional overwrite - the
  server never rejects an edit because "someone else edited first." That's what
  makes this LWW rather than optimistic-concurrency-controlled.
- **`version` is bumped with `$inc`, not a read-then-+1.** MongoDB serializes
  writes to the same document, so even under a genuine race, each concurrent
  `saveEdit` call gets a distinct, correctly-ordered version number - `$inc` is
  race-free without an application-level lock. `version` is *not* a concurrency
  control mechanism (nothing is ever rejected because of it); it exists purely so
  clients can detect "the document changed since I last saw it."
- **The client uses `version` to make the collision visible, not to prevent it.**
  If a `document:updated` broadcast arrives with a higher version than what a
  client last saw *while that client had an unsaved local edit pending*, the
  client shows a toast ("X also edited this document - your changes may have been
  overwritten") instead of silently swallowing the overwrite. See
  `frontend/src/home/components/DocumentEditor.jsx`.

### 5. Reducing collision frequency (without solving the underlying problem)

- **Debouncing** (400ms after the last keystroke) means most short bursts of typing
  from one user become a single save, cutting down how often two people's writes
  actually land close enough in time to race.
- **A "who else is viewing" presence indicator** (`document:join`/`leave`,
  tracked in an in-memory `documentId -> Set<userId>` map, same process-local
  pattern as `userSocketMap` in `realtime/socket.js`) gives users a hint that a
  collision is *possible* before it happens - not a lock, just visibility.

## Forward compatibility with a real CRDT later

TipTap's content model doesn't change whether or not a CRDT sits behind it -
`@tiptap/extension-collaboration` binds a Yjs `Y.Doc` to the exact same editor
component. Migrating to real conflict-free merging later means adding a
`yjsState: Buffer` field and swapping the sync transport (Yjs binary updates
instead of full-content overwrites) - not redesigning this schema or rewriting the
editor UI. This is why Phase 1 didn't need to be built "the hard way" to keep this
option open.

## Failure cases considered

- **Two users edit concurrently** → LWW clobber (see above) - the accepted
  limitation of this phase, surfaced via the "may have been overwritten" toast
  rather than hidden.
- **Client reconnects after a dropped socket** → re-fetches the document over
  REST before rejoining the room, so it can't keep editing indefinitely against
  content that's gone stale.
- **The debounced save's request fails** (network, server error) → the editor's
  local content isn't cleared; the user's text isn't lost from their point of
  view, but it also isn't retried automatically - `saveStatus` shows "Save
  failed".
- **A duplicate/retried `document:edit`** → unlike `send_message`, this has no
  `clientMessageId` idempotency key. Re-applying the same `content` twice is
  naturally idempotent (it overwrites with itself, no duplicate document is
  created), so there's no duplicate-creation risk the way there is for a chat
  message - a deliberate difference from that pattern, not an oversight.
- **Editor closed/channel switched mid-debounce** → the pending edit is flushed
  synchronously on unmount instead of being dropped.

## What's deliberately NOT solved in this phase

- Real concurrent merging (two people's edits both surviving) - needs OT or a
  CRDT, see above.
- Document version history / undo-past-a-save - only the current state is stored.
- Multi-cursor / remote-caret display - needs the same collaboration-provider
  infrastructure a CRDT migration would add anyway.

## Interview questions

**Q: Why not just build OT yourself since "that's what Google Docs does"?**
A: OT is correct only if the transform functions handle every pairwise (and,
for more than two concurrent editors, higher-order) combination of operations
correctly - a small bug shows up as rare, hard-to-reproduce data corruption under
real concurrent load. A CRDT library or an honestly-scoped LWW system both avoid
that risk profile for a project at this stage; hand-rolled OT is the "sounds
simple, is a research problem" trap.

**Q: Is `version` doing anything useful if no write is ever rejected because of
it?**
A: Yes - it separates two different jobs that are easy to conflate: *concurrency
control* (deciding whose write wins) and *change detection* (letting a client know
its view is stale). This phase deliberately only does the second.

**Q: Why is `$inc` safe here without a lock?**
A: MongoDB guarantees writes to a single document are applied atomically and
serially - two concurrent `findOneAndUpdate` calls against the same `_id` don't
interleave at the field level. `$inc` reads-and-increments as one atomic operation
server-side, so there's no read-modify-write race the way there would be if the
client computed `version + 1` itself and sent that number.

**Q: What's the actual difference between "last write wins" here and a real
optimistic-concurrency-controlled system?**
A: Optimistic concurrency control would make the write's filter include the
version the client thinks it's updating (`{_id, version: baseVersion}`) and reject
(409) if it doesn't match anymore, forcing the client to reconcile before retrying.
This phase's `saveEdit` filter is just `{_id, channelId}` - no version check - so
it always succeeds and always overwrites. OCC would prevent the silent-overwrite
failure mode this document describes, at the cost of the client needing real
reconciliation logic (which, without a merge algorithm, just becomes "throw away
one side's edits" - OCC alone doesn't solve merging either, it just changes who
finds out about the conflict and when).

## Phase 2a: replacing LWW with a CRDT (Yjs)

### Problem

Phase 1's accepted limitation - two concurrent edits silently clobber one another -
stops being acceptable once real-time co-editing is the point of the feature, not
an edge case of it.

### Why Yjs over hand-rolled OT or Automerge

Same "OT is a research problem in disguise" reasoning as Phase 1 above, resolved by
picking a mature library instead of avoiding the problem. Yjs specifically (over
Automerge, the other realistic CRDT choice) because TipTap ships an official,
version-matched binding (`@tiptap/extension-collaboration`) - Automerge has no
equivalent first-party TipTap integration, so choosing it would mean building and
maintaining that binding ourselves.

### Architecture: the server never parses document content

The single design decision that kept this phase simple: `yjsState` is treated as an
opaque binary blob everywhere on the backend. `document.service.js` applies updates
to it (`Y.applyUpdate`) and persists it (`Y.encodeStateAsUpdate`) without ever
needing TipTap's ProseMirror schema. All JSON <-> Yjs conversion happens client-side
in `DocumentEditor.jsx`, where the real schema already lives (`editor.schema`). This
was checked against the actual codebase before committing to it: `listDocuments`
already excludes `content` from its query, and `DocumentsPanel.jsx` never previews
it - nothing server-side needed JSON-shaped content in the first place.

### Data flow

```
document:edit
Client: { documentId, update }         # update = Y.encodeStateAsUpdate(ydoc) -
                                        # the CLIENT's entire current Yjs state,
                                        # not a minimal diff (see below)
Server: authorize (channel member)
        → loadYDoc(documentId): hydrate an in-memory canonical Y.Doc from the
          last-persisted yjsState if not already cached
        → Y.applyUpdate(serverYDoc, update)         # CRDT merge, not overwrite
        → Document.findOneAndUpdate({_id, channelId},
            { yjsState: Y.encodeStateAsUpdate(serverYDoc), lastEditedBy, $inc: {version:1} })
        → ack { success, version }
        → broadcast document:updated { documentId, update, editedBy } to the room
          (relays the same raw update - other clients apply it to their own ydoc)
```

**Full-state sends, not minimal diffs.** `DocumentEditor.jsx`'s `saveEdit` sends
`Y.encodeStateAsUpdate(ydoc)` with no base state vector - the client's whole current
state, every debounced save, not just what changed since the last save. This was a
deliberate simplification: a true incremental-diff version needs to track a state
vector across sends, and advancing that vector on a *received* remote update (to
avoid re-sending content that isn't yours) risks suppressing a still-unsent local
edit if done carelessly - a real, subtle bug class. Sending the full state avoids it
entirely, is still a correct, mergeable CRDT delta (not a flat overwrite - see next
paragraph), and costs nothing extra at this document size (`MAX_UPDATE_BYTES` caps
one update at 200KB server-side).

**Why a "full state update" still merges instead of overwriting.** This is the part
that resolves the obvious follow-up question ("if you're sending the whole state
anyway, how is this different from Phase 1's full-content overwrite?"). A Yjs update
- even one encoding the entire document - is a structured, per-operation delta keyed
by each client's own operation clock, not a flattened snapshot of "the final text."
`Y.applyUpdate` merges two clients' full-state updates at the operation level
regardless of which one arrives first or whether one duplicates content the
receiver already has; a JSON overwrite has no such structure to merge against.

### Client-side migration (Phase 1 documents predate `yjsState`)

No server-side migration script. `DocumentEditor.jsx` detects a missing `yjsState`
on load and converts the legacy `content` JSON into a fresh Y.Doc itself, using
`y-prosemirror`'s `prosemirrorJSONToYDoc(editor.schema, content, field)` - this
needs the ProseMirror schema, which only exists client-side, reinforcing why the
migration couldn't live on the backend without adding schema-awareness there too.
The result is merged into the already-bound `ydoc` via `Y.applyUpdate` (not a ydoc
swap - `Collaboration` was already bound to the original instance at editor-creation
time) and flows through as a normal local edit, so the very next debounced save
persists it for everyone. Two viewers opening the same legacy document at once and
both migrating it is safe: both conversions are deterministic from the same source
JSON, and Yjs updates are idempotent, so the second is a no-op merge.

### A naming trap worth knowing about: TipTap v3 renamed things

Two real mismatches were caught by checking installed package source instead of
trusting v2-era memory/docs:
- StarterKit's undo/redo extension is `undoRedo` in v3, not `history` (v2's name).
  Passing `history: false` would have silently done nothing, leaving StarterKit's
  local (non-CRDT-safe) undo active *alongside* Collaboration's own Yjs-backed undo,
  fighting over the same Mod-Z shortcut.
- `y-prosemirror`'s `prosemirrorJSONToYDoc` defaults its Yjs fragment name to
  `'prosemirror'`; `@tiptap/extension-collaboration`'s `field` option defaults to
  `'default'`. Left on defaults, migrated content would bind to a fragment name the
  editor never reads. Fixed with one explicit shared constant (`YJS_FIELD`) both
  call sites pass, instead of relying on two different packages' defaults matching.

### Failure cases

- **Concurrent edits from two users** -> now merge via CRDT instead of one
  clobbering the other. This is the actual improvement over Phase 1.
- **Backend process restarts** -> the in-memory per-document Y.Doc cache is lost,
  not data - the next join/edit rehydrates from the last-persisted `yjsState`.
  Edits made between the last persist and the crash are lost, the same exposure
  Phase 1 had for its unsaved debounce window.
- **A malformed/corrupted update** (buggy or malicious client) -> `Y.applyUpdate` is
  wrapped in try/catch in `document.service.js`; rejected via the ack, never applied
  to the shared doc or relayed to other viewers.
- **Retried/duplicated delivery** (Socket.IO is at-least-once, not exactly-once) ->
  safe by construction: Yjs updates are commutative and idempotent, so applying the
  same update twice, or two updates in different orders on different machines,
  converges to the same final state.
- **Multiple backend instances** (not this project's current scale) -> the
  in-memory Y.Doc cache is process-local, same caveat as `userSocketMap`
  (`realtime/socket.js`). Two instances would only reconcile through whichever
  writes land in MongoDB, not a true cross-instance Yjs merge - would need a shared
  relay (e.g. Redis pub/sub) to fix properly.

## Phase 2b: presence (cursors, selection, activity) via Yjs Awareness

### Problem

Phase 2a fixed *merging*. It didn't give anyone visibility into who else is in the
document right now, where their cursor is, or what they're selecting - the "Google
Docs colored cursors" experience.

### Why this stayed cheap: Yjs ships a purpose-built protocol for exactly this

`y-protocols/awareness`'s `Awareness` class is Yjs's own answer to "share ephemeral,
non-persisted state (cursor, name, color, status) between clients editing the same
document," separate from the CRDT document state itself. TipTap has an official
consumer of it too: `@tiptap/extension-collaboration-caret` (the v3 name - v2 called
it `extension-collaboration-cursor`; confirmed by checking npm's published version
list for both names before installing, not by assuming the v2 name still applied,
after already being caught out once in Phase 2a). It renders remote carets/
selections and - importantly - **publishes this client's own selection into
awareness automatically** via its internal `yCursorPlugin`, which listens for
ProseMirror selection changes and calls `awareness.setLocalStateField('cursor', ...)`
itself. Nothing in `DocumentEditor.jsx` wires up selection tracking by hand.

### Architecture: awareness gets the exact same "opaque relay" treatment as Phase 2a

The backend does not add `yjs` or `y-protocols` as dependencies for this. Awareness
state is never persisted (MongoDB only ever stores `yjsState`, never awareness) and
the server never decodes it - `documentHandler.js`'s `document:awareness` handler is
a pure relay: authorize, then `socket.to(room).emit(...)` the same bytes it
received, exactly like `document:edit`'s update payload in Phase 2a. This keeps the
"server never parses document content" principle intact for presence too.

**The `provider` object is a minimal fake, not a real network provider.**
`CollaborationCaret`'s `provider` option is designed for a real Yjs network provider
(`HocuspocusProvider`, y-websocket's `WebsocketProvider`) - but reading its source
shows it only ever touches `provider.awareness`. Since this app already has a
working Socket.IO transport (used for both `document:edit` and now
`document:awareness`), there's no second real-time transport to actually provide -
`DocumentEditor.jsx` passes `{ awareness }`, a plain object exposing just the one
property the extension actually reads.

### Data flow

```
document:awareness
Client: { documentId, update }   # update = encodeAwarenessUpdate(awareness, changedClients),
                                  # fired whenever this client's local awareness state
                                  # changes (cursor moved, selection changed, went idle)
Server: authorize (channel member) → relay only, no persistence, no ack
        → socket.to(`document:${documentId}`).emit("document:awareness", { documentId, update })
```

**Catch-up for late joiners.** The server never stores awareness state, so there's
nothing for a newly-joined viewer to fetch the way there is for document content
(REST `getDocument`). Instead, every *already-present* client reacts to the existing
`document:viewer_joined` event (Phase 1 plumbing, reused as-is) by re-encoding and
re-emitting its own current awareness state, so the newcomer picks up everyone
already there without the server needing to know anything about awareness content.

**Immediate cleanup on unmount, not a 30-second wait.** `y-protocols/awareness`
expires a client's state automatically if it goes ~30s without an update
(`outdatedTimeout`), which is correct for a hard crash/dropped connection but too
slow for the common case (a clean channel switch or closing the doc). `Awareness`
registers `ydoc.on('destroy', () => this.destroy())` internally, and `destroy()`
calls `setLocalState(null)`, which synchronously fires an `'update'` event with this
client in `removed`. `DocumentEditor.jsx` relies on React's cleanup-runs-in-reverse-
registration-order behavior: the awareness-broadcast-listener effect is registered
*before* the ydoc-destroy effect, so on unmount ydoc.destroy() (and the cascading
awareness.destroy()) fires while the listener is still attached, and that final
"I'm gone" update still gets broadcast before the listener itself is torn down. This
is documented inline in the code specifically because it's an easy thing to break by
reordering effects without knowing why the order matters.

### What "activity feed" means here, honestly

The literal ask ("User X is typing in section Y") would need mapping ProseMirror
positions to human-readable document structure (which heading/paragraph a position
falls under) - not built. What *is* built: `awareness`'s `cursor` field is non-null
exactly when a user has a live selection (set by `yCursorPlugin`, cleared on blur),
so "has a cursor state" is used as a cheap, honest "actively focused here right now"
signal, shown as an "editing" tag next to that user's name in the presence bar -
distinct from `viewers` (has the document open at all, from Phase 1's
`document:join`/`leave`, unchanged in this phase).

### Failure cases

- **A viewer's tab crashes / network drops without a clean disconnect** -> no
  `document:leave` fires, so `viewers` (Phase 1's tracking) would show them as still
  present until the socket's own disconnect handler runs; their awareness state
  independently expires after `outdatedTimeout` (~30s) on every other client, since
  no one is refreshing it on their behalf. Two different mechanisms, two different
  detection windows, by design, not accidentally.
- **Two tabs, same user** -> get different Yjs `clientID`s (Awareness keys state by
  connection, not by user), so they'd show as two separate cursors with a shared
  color (via `colorForUser(userId)`, deterministic per user id) but distinct
  positions - correct, since they really are two independent live selections.
- **Rapid selection changes** (dragging a selection, arrow-key scrolling) aren't
  debounced client-side the way `document:edit` is - `AWARENESS_MAX` in
  `documentHandler.js` is deliberately more generous than `EDIT_MAX` for this reason,
  still bounded as defense-in-depth against a misbehaving client.

### Interview questions

**Q: Why doesn't the backend need `yjs` or `y-protocols` for awareness, when it
needed `yjs` for document content?**
A: It doesn't need either for content parsing purposes - Phase 2a already
established that the server treats `yjsState` as opaque bytes. It needs the `yjs`
*package* on the backend only because `document.service.js` calls `Y.applyUpdate`/
`Y.encodeStateAsUpdate` to merge and persist document content. Awareness is never
merged or persisted server-side at all - pure relay - so there's nothing on the
backend that would ever call into `y-protocols`.

**Q: What's the actual difference between `viewers` and awareness-derived
"editing" status?**
A: `viewers` (Phase 1) answers "has this document open," tracked authoritatively by
the server via `document:join`/`leave` room membership. Awareness's `cursor` field
answers "has a live selection right now," tracked entirely client-side and only
ever relayed, never verified server-side. A user with the document open in a
background tab is a viewer but not "editing."

**Q: Why is `{ awareness }` an acceptable stand-in for `provider` when the option is
clearly designed for a real network provider class?**
A: Because `CollaborationCaret`'s implementation only ever reads `provider.awareness`
- verified by reading its source before relying on this, not assumed. A real
provider class additionally handles the actual network transport, which this app
already has (Socket.IO) and would be redundant to add a second one for.

## Phase 3a: offline resilience (disconnect -> keep editing -> reconnect -> resync)

### Problem

Phase 2a/2b assume a live socket connection. A dropped connection (network blip, wifi
handoff, laptop sleep) previously meant: edits kept working locally (TipTap/Yjs never
needed the network to accept a keystroke), but the debounced save silently failed
after an 8s ack timeout, threw a "Failed to save document" toast that implied a real
rejection rather than a self-healing condition, and - the actual gap - a reconnected
socket never rejoined the document's room, so it would silently stop receiving other
people's edits forever, not just for the outage's duration.

### Why this phase turned out cheap: it was a scoping question, not a new mechanism

The naive mental model (and the one in the original feature request) is a "pending
updates queue" that accumulates local edits while offline and drains them on
reconnect. This app doesn't need one. Phase 2a's `saveEdit` already sends
`Y.encodeStateAsUpdate(ydoc)` - the client's *entire* current state, every debounced
save, not an incremental diff (see Phase 2a section above for why). Any edit made
while offline is already sitting in that state. Reconnecting just needs to **trigger
one more save** - there's no separate buffer to manage, because the ydoc itself
already is the durable local record of everything not yet acknowledged.

### The actual reconnect protocol

```
socket 'disconnect'  -> connectionStatus = "offline" (UI only; editing stays fully
                         local - nothing in TipTap/Yjs requires a live socket)
socket 'connect'      -> resync():
  1. re-emit document:join
       Socket.IO room membership does not survive a disconnect - a reconnected
       socket looks connected again but has silently fallen out of every room
       it was in. Without this, document:updated/document:awareness broadcasts
       for this document would never reach it again.
  2. GET the document's current yjsState, Y.applyUpdate it in (REMOTE_ORIGIN)
       The actual fix for missed updates. See "missed updates" below.
  3. if hasPendingLocalEditRef: saveEditRef.current()
       Delivers anything typed offline - see "no pending-queue" above.
  4. if awareness.getLocalState(): re-broadcast it via document:awareness
       Our own Awareness state didn't change just because the network
       dropped (nothing calls setLocalState on a mere disconnect, only on
       unmount), so its 'update' event won't fire on its own to tell anyone
       we're back.
```

'connect' fires on a client's very first connection too, not just reconnects - this
protocol doesn't need to tell the two apart. Every step here is idempotent
server-side (a duplicate `document:join` is a no-op Set insert; re-pulling and
re-pushing state that hasn't diverged is a no-op CRDT merge), so running the full
sequence on an ordinary first connect is harmless, not just tolerated.

### Missed updates: why a full-state pull is a complete fix, not a partial one

A disconnected client stops receiving `document:updated` broadcasts entirely for the
outage's duration - there's no per-client sequence number or replay log that would
let the server say "here's exactly what you missed." That machinery isn't needed:
every accepted edit, from any client, is durably persisted as the document's
`yjsState` (Phase 2a). So the *current* `yjsState` is always a complete superset of
anything a disconnected client could have missed, no matter how long the outage or
how many other clients edited during it. Pulling it once and merging is sufficient -
"sufficient," not "approximately right," because Yjs update application is
commutative: it doesn't matter whether this client applies the pulled state before
or after replaying its own offline edits, or in what order relative to any other
update it's ever seen. There's no ordering bookkeeping to get right here, which is
also why this doc's IndexedDB load (below) and this REST pull can race each other
freely with no coordination.

### Local persistence: `y-indexeddb`

Beyond a same-tab reconnect, a document should also survive a full page reload while
still offline. `IndexeddbPersistence` (from `y-indexeddb`, Yjs's own official
IndexedDB provider - picked over hand-rolling localStorage snapshotting because
persisting a live, mutating Y.Doc correctly on every update is exactly the kind of
thing worth using a maintained library for, the same reasoning as picking Yjs itself
over hand-rolled OT) is bound to the ydoc alongside the REST-based seed. **Explicitly
out of scope**: opening a document for the very first time while already offline -
nothing in IndexedDB yet, the REST fetch also fails, and the component has nowhere
to load initial content from. Solving that would mean treating IndexedDB as the
primary source of truth with the server as a background sync target instead of the
other way around - a real offline-first redesign, bigger than this phase. What's
built here is resilience *after* a document is already open, matching the original
ask's own diagram (disconnect -> keep editing -> reconnect), not full offline-first.

### Duplicate updates and at-least-once delivery

Nothing new here - restating Phase 2a's guarantee under a new scenario. A reconnect
protocol built on "pull current state, push current state" will sometimes send or
receive an update the other side already has (e.g. the resync's push happens to
race a debounced save that had actually gotten through moments before the
disconnect was detected). This is safe *by construction*: Yjs updates are
commutative and idempotent, so re-applying one that's already been merged is a
no-op, not a correctness risk. This app was never relying on Socket.IO to provide
exactly-once delivery (it doesn't - Socket.IO's own client-side emit buffering could
plausibly redeliver an emit made right as a disconnect occurred, and this design
doesn't need to know or care whether that happens).

### Failure cases

- **Reconnect happens mid-debounce** (user was mid-keystroke when the connection
  dropped) -> no special handling needed - the debounce timer is unaffected by
  socket state, so it either already fired and hit the offline branch in `saveEdit`'s
  catch (silently left pending, no toast), or is still pending and will fire
  normally; either way the resync's own flush step covers it if needed.
- **The document is closed while offline** -> the unmount-flush effect (Phase 1)
  still attempts a save; it fails the same way any offline save does. The edit isn't
  lost (IndexedDB has it), but it won't reach the server until the document is
  opened again on a connected client - not "while this tab is closed," since nothing
  runs in the background.
- **Two tabs of the same user, one offline one online** -> the online tab keeps
  syncing normally; the offline tab's local edits sit in its own IndexedDB store
  (keyed by documentId, not by tab) until it reconnects and pushes them - at which
  point they merge with whatever the online tab already contributed, same as any
  other two-client convergence.

### Interview questions

**Q: Where's the pending-updates queue?**
A: There isn't one, deliberately. `saveEdit` always sends the ydoc's entire current
state rather than an incremental diff (a decision made in Phase 2a for a different
reason - avoiding a subtle state-vector bug), which happens to make a pending-updates
queue unnecessary here too: the ydoc already holds everything not yet acknowledged,
so "flush on reconnect" is just "trigger one more send of the current state."

**Q: How do you know a client won't miss an update permanently if it's offline when
that update happens?**
A: Because the fix isn't "replay what you missed" (which would need the server to
track per-client state), it's "converge to the current truth" - pulling the latest
persisted `yjsState` on reconnect is a complete catch-up regardless of how many
updates were missed or in what order they happened, since Yjs merge is commutative
and the persisted state is always a superset of anything any client could be missing.

**Q: Why is it safe to run the full reconnect sequence (rejoin, pull, push,
re-announce presence) even on a completely ordinary first connection, not just a
real reconnect?**
A: Every step is independently idempotent - rejoining an already-empty room, pulling
state that hasn't changed, pushing state the server already has, and re-announcing
presence that hasn't changed are all no-ops when nothing actually needs doing. That
idempotency is what makes it safe to not bother distinguishing "first connect" from
"reconnect" in the first place.

## Phase 3b: version history (view, compare, restore)

### Problem

Nothing before this phase let anyone see or recover a document's past states -
`Document.yjsState`/`content` only ever hold the current state. The interesting
question isn't "how do you store old states" (a snapshot collection), it's "what
does *restoring* one even mean once the document is a CRDT" - see below.

### The central design question: how does restore interact with a CRDT?

The naive approach - take an old version's Yjs binary state and `Y.applyUpdate` it
onto the current document, the same way `document:updated` broadcasts are applied -
is wrong, and it's wrong for a precise, structural reason, not just "risky." A Yjs
update encodes *operations* tagged with each client's own logical clock. An old
snapshot's operations are, by definition, already known to (and superseded by) the
current document's state for everything that happened after it was captured.
Applying it as an update mostly no-ops with respect to later changes - it does not
delete text that was added after the snapshot, because deletion isn't "absence from
an old update," it's its own explicit operation (a tombstone) that the old snapshot
never contains.

**The fix: restore is not a CRDT operation at all - it's an ordinary edit.**
`VersionHistoryPanel.jsx` decodes the target version to ProseMirror JSON and calls
`editor.commands.setContent(json)` on the *live, currently-bound* editor
(`DocumentEditor.jsx handleRestore`). This dispatches a real ProseMirror transaction,
which `@tiptap/extension-collaboration`'s `ySyncPlugin` observes and translates into
brand-new Yjs operations (delete what's there now, insert the restored content) with
*current* clocks - operations that genuinely supersede everything, the same way any
other edit would. That transaction fires the ydoc `'update'` listener exactly like
typing does (Phase 2a), so restore needs no dedicated socket event, no new
`document.service.js` write path, and no server-side awareness that a "restore"
happened at all - it's indistinguishable, on the wire and in the database, from a
very large ordinary edit. This is why there's no `POST .../restore` endpoint.

### Architecture: server captures, client decodes

Snapshot creation stays server-side and schema-agnostic (same principle as Phase
2a): `document.service.js createVersionSnapshot` reads the same in-memory canonical
`Y.Doc` `applyEdit` uses (`loadYDoc`) and stores `Y.encodeStateAsUpdate(ydoc)` as an
opaque `Buffer` - no ProseMirror schema touches the server. Decoding a version back
to JSON (for viewing, comparing, or restoring) happens entirely client-side in
`VersionHistoryPanel.jsx`, via `y-prosemirror`'s `yDocToProsemirrorJSON` against a
throwaway `Y.Doc` seeded from the stored binary - the same "server never parses
content" split Phase 2a established, just exercised in the opposite direction (here,
decode-to-view rather than encode-from-migration).

### When snapshots are taken

Two triggers, both already covered above at a design level - the mechanics:

- **Auto**: `documentHandler.js`'s existing "last viewer left" hook (previously only
  used to evict the in-memory `Y.Doc` cache) now also calls
  `createAutoVersionSnapshot` first, while that cache still exists. Skipped if
  nothing changed since the last snapshot (`Document.version` compared against the
  most recent version's stored `version`) - otherwise opening and closing a document
  without editing it would spam the history. This is a genuine trade-off, not a free
  win: a single person editing continuously for hours without the room ever emptying
  gets zero auto-snapshots until they finally close it. Manual saves exist
  specifically to cover that case.
- **Manual**: an explicit "Save version" action (`POST .../versions`, optional
  `label`), always creates one regardless of whether anything changed - a deliberate
  checkpoint the user asked for shouldn't be silently skipped the way a redundant
  auto-snapshot is.

### Storage bound

Every version is a **full snapshot**, not a diff from the previous version -
covered in `documentVersion.model.js`'s learning notes: a diff chain would need
every earlier version to remain available to reconstruct a later one, which is
incompatible with pruning any of them. Capped per document, per kind (15 auto / 50
manual - manual capped far looser since it's a deliberate user action, not
something to prune away eagerly), oldest-of-kind deleted after each insert.

### What "compare" means here, honestly

Word-level text diff (`diffWords` from `diff`/jsdiff) between a version's plain text
and the document's current plain text, rendered as added/removed spans. **Not** a
full rich-text visual diff (formatting changes aren't shown, only text content) -
that would need a second live, non-collaborative TipTap instance rendering both
states and diffing across marks/nodes, not just text runs. Restore, the operation
that actually needs full fidelity, works from the real decoded JSON directly and
never goes through this plain-text path at all.

### Failure cases

- **Two auto-snapshot triggers race** (e.g. two viewers' sockets both process
  "last one left" near-simultaneously for the same document, in principle) -> both
  would read the same `Document.version` and could both create a snapshot; harmless
  duplication (identical content stored twice, pruned on the next cycle like
  anything else over the cap), not a correctness bug.
- **A version referenced by an in-progress "compare" or "restore" gets pruned
  mid-session** -> not possible in this design: pruning only removes versions beyond
  the cap for a *given* document, and a version the user has open in the panel is
  already loaded client-side by the time pruning could run again on that document
  (which only happens on the *next* snapshot, not continuously).
- **Restoring an old version while someone else is actively editing** -> not a
  special case at all, which is the point of treating restore as an ordinary edit:
  it merges via the exact same CRDT mechanics as any other concurrent edit (Phase
  2a). The other person doesn't lose their in-flight changes; both sets of
  operations - the restore's deletions/insertions and their concurrent edit -
  coexist in the merged result, for better or worse (a restore happening under
  someone else's cursor can look surprising in the moment, but nothing is silently
  dropped on either side).

### Interview questions

**Q: Why not just `Y.applyUpdate` the old version's state onto the current
document?**
A: Because a Yjs update only carries operations, tagged with logical clocks - it
has no concept of "and delete everything that happened after this." Applying an old
snapshot as an update mostly does nothing to content added later, since that
content isn't referenced by the old update at all. It would not behave like
"reverting" in any way a user would recognize.

**Q: Doesn't expressing restore as `setContent` risk losing the CRDT's merge
properties - i.e., does a restore behave differently from a "normal" edit in a way
that could break something?**
A: No - and that's the actual design win here. `setContent` goes through the same
ProseMirror transaction -> `ySyncPlugin` -> Yjs operation pipeline as typing does.
The resulting Yjs operations are ordinary operations with ordinary clocks; nothing
about them is special-cased as "a restore" anywhere in the system, including the
database. That's precisely why concurrent-edit-during-a-restore (see failure cases)
resolves the same way any other concurrent edit does.

**Q: Why store full snapshots per version instead of diffs, if diffs would use
less storage?**
A: Because pruning becomes unsafe with a diff chain - deleting an old "link" in the
chain would break every later version's ability to reconstruct itself. Full
snapshots make every version independently prunable and independently loadable,
which is what actually gets used here (view/restore always load exactly one
version, never a chain).
