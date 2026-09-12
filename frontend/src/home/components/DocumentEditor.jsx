import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { useSocketContext } from "../../Context/SocketContext";
import { useAuth } from "../../Context/authcontext";
import { emitAck } from "../../utils/emitAck";
import { TrashIcon, HistoryIcon } from "./icons";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { YJS_FIELD, base64ToUint8Array } from "../../utils/yjsCodec";
import "../CssFiles/documentEditor.css";

// Fired debounced, not per keystroke - see
// docs/interview-notes/document-collaboration.md for the Phase 1 writeup
// this interval originated in; still applies unchanged in Phase 2's CRDT
// model (batches rapid typing into one socket emit, same as before).
const EDIT_DEBOUNCE_MS = 400;

// Tags ydoc.applyUpdate calls that came from the network (see the
// document:updated handler below), so the ydoc's own 'update' listener can
// tell a remotely-applied change apart from a locally-typed one without a
// separate boolean flag - Yjs's transaction origin is the purpose-built
// mechanism for exactly this question.
const REMOTE_ORIGIN = "remote";

// A small fixed palette, chosen for reasonable contrast against the app's
// dark UI - not a data-visualization palette, just enough distinct hues that
// two or three simultaneous cursors don't look identical.
const PRESENCE_COLORS = ["#f97316", "#22c55e", "#3b82f6", "#ec4899", "#eab308", "#a855f7", "#14b8a6", "#f43f5e"];

// Deterministic (not random-per-tab) so the same user gets the same cursor
// color across sessions/tabs, instead of a new random color every time
// CollaborationCaret's default color would otherwise pick.
const colorForUser = (userId) => {
  const id = String(userId || "");
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
};

const ToolbarButton = ({ active, onClick, title, children }) => (
  <button
    type="button"
    // Without this, clicking a toolbar button blurs the editor first (losing
    // the text selection a mark like Bold needs to apply to).
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    title={title}
    className={`px-2 py-1 rounded text-xs font-semibold transition ${
      active ? "bg-blue-500 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
    }`}
  >
    {children}
  </button>
);

// One channel document, opened full-pane. Owns: loading the document over
// REST, joining its realtime room, merging remote edits into the shared
// Yjs doc, and debounced-saving local edits back out.
//
// CONCURRENCY MODEL (CRDT via Yjs, Phase 2a - see
// docs/interview-notes/document-collaboration.md for the Phase 1 writeup
// this replaces): edits now genuinely merge instead of one clobbering
// another. TipTap's Collaboration extension binds the editor directly to a
// Y.Doc; local keystrokes mutate that Y.Doc, which emits binary updates we
// relay through the existing document:edit/document:updated socket events
// instead of a second real-time transport. Every viewer's Y.Doc converges to
// the same content regardless of the order updates arrive in or whether one
// is delivered twice (Socket.IO is at-least-once, not exactly-once) - that's
// the CRDT convergence guarantee, not an assumption.
export const DocumentEditor = ({ server, channel, documentId, role, members, onBack, onRenamed, onDeleted }) => {
  const { socket } = useSocketContext();
  const { authUser } = useAuth();
  const currentUserId = authUser?._id || authUser?.id;

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved"); // 'saved' | 'saving' | 'error'
  const [viewers, setViewers] = useState([]); // userIds currently in this document's room
  const [connectionStatus, setConnectionStatus] = useState("online"); // 'online' | 'offline'
  const [showHistory, setShowHistory] = useState(false);

  // One Y.Doc per mounted editor instance. DocumentsPanel already remounts
  // DocumentEditor fresh per documentId (key={openDocumentId}), so a plain
  // lazily-created ref - not something keyed by documentId internally - is
  // enough; useMemo (not useState) because this is a mutable object we hand
  // to TipTap, not a value React should treat as replaceable render state.
  const ydoc = useMemo(() => new Y.Doc(), []);

  // Cursor position, text selection, and presence color/name - Yjs's
  // Awareness protocol (Phase 2b), bound to the same ydoc. Deliberately
  // never persisted (see document.model.js LEARNING NOTES and
  // documentHandler.js document:awareness) - it's ephemeral by design, so
  // there's nothing to load from REST the way there is for document
  // content. Awareness registers `ydoc.on('destroy', () => this.destroy())`
  // internally, so it's automatically cleaned up whenever the ydoc-destroy
  // effect below runs - no separate awareness.destroy() call needed.
  const awareness = useMemo(() => new Awareness(ydoc), [ydoc]);

  // Phase 1 offline resilience: persists every ydoc update to the browser's
  // IndexedDB, keyed per-document, and loads whatever was previously stored
  // back into the ydoc as soon as this runs. This is what makes local edits
  // survive more than "the tab stayed open through a brief network blip" -
  // they survive a full reload while still offline. Order relative to the
  // REST-based yjsState seed effect below doesn't matter: both are just
  // Y.applyUpdate calls against the same ydoc, and Yjs merges are
  // commutative - whichever finishes loading first, the final state is the
  // same. Deliberately NOT solved by this: opening a document for the
  // *first* time while offline (nothing in IndexedDB yet, REST fetch also
  // fails) - that's full offline-first architecture, a bigger redesign than
  // this phase's scope of "stay resilient through a disconnect after the
  // document is already open."
  const idbPersistence = useMemo(() => new IndexeddbPersistence(`nexchat-document-${documentId}`, ydoc), [documentId, ydoc]);
  useEffect(() => () => idbPersistence.destroy(), [idbPersistence]);

  // Refs, not state, for values read inside socket callbacks / the ydoc
  // 'update' handler - those close over the render they were created in
  // (TipTap only builds the editor once), so anything they need to read
  // "live" has to be a ref rather than a state variable.
  const versionRef = useRef(0);
  const hasPendingLocalEditRef = useRef(false);
  const debounceRef = useRef(null);
  const saveEditRef = useRef(() => {});

  // Who currently has a live cursor/selection in this document, keyed by
  // Yjs clientID - not the same as `viewers` (who has the document *open*,
  // tracked via document:join/leave). A viewer might have the doc open in a
  // background tab with no selection; this is the stricter "actively
  // focused here" signal, e.g. for an "X is editing" indicator.
  const [awarenessStates, setAwarenessStates] = useState(new Map());

  const canModerate = role === "owner" || role === "admin";
  const creatorId = doc?.createdBy?._id || doc?.createdBy;
  const canDelete = canModerate || String(creatorId) === String(currentUserId);

  const memberById = (userId) => members?.find((m) => String(m.user._id) === String(userId))?.user;

  // The actual persist call, fired from the debounce timer (and once more,
  // synchronously, on unmount - see the flush effect below). Sends the
  // Y.Doc's *entire current state* (Y.encodeStateAsUpdate with no base state
  // vector), not a minimal incremental diff since the last save - simpler
  // and just as correct under CRDT merge (an update encoding the whole
  // state is still a structured, mergeable delta, not a flat overwrite), at
  // the cost of resending the full document each save instead of only what
  // changed. Fine at this document size (MAX_UPDATE_BYTES caps it at 200KB
  // server-side); a true incremental-diff version would need to track a
  // state vector per successful send, which is easy to get subtly wrong
  // (e.g. advancing it on a received remote update would suppress a
  // still-unsent local edit) - not worth that risk for this project's scale.
  // This never "fails" due to someone else editing first - only real errors
  // (network, auth, validation) reach the catch.
  const saveEdit = useCallback(async () => {
    if (!socket) return;
    try {
      const update = Y.encodeStateAsUpdate(ydoc);
      const ack = await emitAck(socket, "document:edit", { documentId, update });
      if (!ack.success) throw new Error(ack.error || "Save failed");
      versionRef.current = ack.version;
      hasPendingLocalEditRef.current = false;
      setSaveStatus("saved");
    } catch (err) {
      if (!socket.connected) {
        // Offline, not a real failure - leave saveStatus as "saving" (still
        // genuinely pending, not lost - the ydoc holds it, and IndexedDB
        // persists it) and skip the toast. hasPendingLocalEditRef stays
        // true, so the reconnect handler below flushes this automatically
        // once back online; connectionStatus already tells the user why
        // nothing's saving right now, so a second "failed" toast on top of
        // that would just be noise for a condition they can't act on.
        return;
      }
      setSaveStatus("error");
      toast.error(err.message || "Failed to save document");
    }
  }, [socket, documentId, ydoc]);

  // Keeps saveEditRef pointed at the latest saveEdit (latest socket/documentId)
  // on every render, so the ydoc 'update' listener below - registered once -
  // never calls a stale, closed-over version.
  useEffect(() => {
    saveEditRef.current = saveEdit;
  });

  // Drives the debounced save from the Y.Doc itself rather than TipTap's
  // onUpdate - the ydoc's 'update' event fires for both local edits and
  // remote updates we apply (see handleUpdated below), and its `origin`
  // argument is exactly how we tell them apart: REMOTE_ORIGIN marks updates
  // we applied from the network, so this only schedules a save for changes
  // that actually originated in this tab.
  useEffect(() => {
    const handleYdocUpdate = (_update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      hasPendingLocalEditRef.current = true;
      setSaveStatus("saving");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => saveEditRef.current(), EDIT_DEBOUNCE_MS);
    };
    ydoc.on("update", handleYdocUpdate);
    return () => ydoc.off("update", handleYdocUpdate);
  }, [ydoc]);

  // Relays this client's own awareness changes (cursor moved, selection
  // changed, joined/left) to the room - CollaborationCaret's yCursorPlugin
  // (wired up below) is what actually calls awareness.setLocalStateField on
  // selection changes; this effect just publishes whatever it sets. Mirrors
  // the ydoc 'update' listener above: origin lets us skip re-broadcasting
  // awareness changes that came from applying someone else's update.
  //
  // ORDERING NOTE: this effect must be registered before the ydoc-destroy
  // effect right below it. React runs cleanup functions in reverse
  // registration order, so on unmount ydoc.destroy() (which synchronously
  // triggers awareness.destroy() -> setLocalState(null), see the ydoc
  // effect's comment) fires *before* this effect's own cleanup detaches the
  // listener - meaning the final "I'm gone" awareness update still reaches
  // this handler and gets broadcast, instead of silently being missed.
  // Other viewers' cursors for this user then disappear immediately on
  // unmount rather than waiting for Awareness's own ~30s outdatedTimeout.
  useEffect(() => {
    if (!socket) return;
    const handleAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      const changedClients = added.concat(updated, removed);
      if (changedClients.length === 0) return;
      const update = encodeAwarenessUpdate(awareness, changedClients);
      socket.emit("document:awareness", { documentId, update });
    };
    awareness.on("update", handleAwarenessUpdate);
    return () => awareness.off("update", handleAwarenessUpdate);
  }, [socket, awareness, documentId]);

  // Mirrors the ydoc 'update' listener above, but for rendering: keeps
  // React state in sync with awareness so the presence UI (viewer list
  // "editing" status) re-renders on change, since mutating the Awareness
  // instance's internal Map in place wouldn't otherwise trigger a re-render.
  useEffect(() => {
    const handleAwarenessChange = () => setAwarenessStates(new Map(awareness.getStates()));
    handleAwarenessChange(); // seed with whatever state already exists (usually just this client)
    awareness.on("change", handleAwarenessChange);
    return () => awareness.off("change", handleAwarenessChange);
  }, [awareness]);

  // ydoc.destroy() releases Yjs's internal structures when this editor
  // unmounts (channel switch, navigating back to the list) - Yjs docs
  // recommend this explicitly rather than relying on GC alone. This also
  // cascades into awareness.destroy() - see the awareness useMemo comment
  // above and the ORDERING NOTE on the effect just above this one.
  useEffect(() => () => ydoc.destroy(), [ydoc]);

  const editor = useEditor({
    extensions: [
      // `undoRedo` (not `history` - TipTap v3 renamed StarterKit's
      // undo/redo extension to UndoRedo) must be disabled here: Collaboration
      // unconditionally wires up its own Yjs-backed Mod-Z/Mod-Y undo via
      // yUndoPlugin (Y.UndoManager scoped to this client's own edits, so
      // undoing never reverts someone else's typing - unlike StarterKit's
      // plain undo, which isn't collaboration-safe). Leaving both enabled
      // doesn't just duplicate undo, it makes them fight over the same
      // shortcut - TipTap warns about this combination at runtime. Disabling
      // StarterKit's copy keeps Collaboration's; undo/redo still works.
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: YJS_FIELD }),
      // Renders remote cursors/selections and publishes this client's own
      // (via its yCursorPlugin, which listens for ProseMirror selection
      // changes and calls awareness.setLocalStateField('cursor', ...)
      // itself - not something this component wires up by hand). The
      // `provider` option normally expects a real network provider
      // (HocuspocusProvider, y-websocket's WebsocketProvider); this
      // extension only ever touches `provider.awareness`, so a plain
      // `{ awareness }` object is a legitimate, minimal provider here -
      // there's no second real-time transport to actually provide, we're
      // relaying awareness through the same Socket.IO connection as
      // everything else (see the awareness effects above).
      CollaborationCaret.configure({
        provider: { awareness },
        user: { id: currentUserId, name: authUser?.fullname || authUser?.username || "Someone", color: colorForUser(currentUserId) },
      }),
    ],
  });

  // Load the document over REST - the source of truth for "what does this
  // document contain right now", independent of whether a live broadcast is
  // ever missed (e.g. this client reconnecting after a drop).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios
      .get(`/api/servers/${server._id}/channels/${channel._id}/documents/${documentId}`)
      .then((res) => {
        if (cancelled || !res.data?.success) return;
        setDoc(res.data.document);
        setTitle(res.data.document.title);
        versionRef.current = res.data.document.version;
      })
      .catch((err) => {
        console.error("Failed to fetch document", err);
        toast.error("Failed to load document");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [server._id, channel._id, documentId]);

  // Seed the shared Y.Doc once the document has loaded (or reloaded) -
  // either from its persisted yjsState, or by migrating a Phase 1 legacy
  // document that predates the CRDT switch (see document.model.js LEARNING
  // NOTES, "Phase 1 -> Phase 2 migration"). Applying via Y.applyUpdate
  // (rather than replacing `ydoc` outright) matters because Collaboration
  // was already bound to this exact ydoc instance when the editor was
  // created above.
  useEffect(() => {
    if (!editor || !doc) return;
    if (doc.yjsState) {
      // Already-persisted state - tag REMOTE_ORIGIN so the ydoc 'update'
      // listener doesn't schedule a pointless save of data that just came
      // from the server back to itself.
      Y.applyUpdate(ydoc, base64ToUint8Array(doc.yjsState), REMOTE_ORIGIN);
    } else {
      // No REMOTE_ORIGIN tag here - this content has never been persisted
      // as Yjs state before, so it should flow through as a normal local
      // change and get picked up by the ydoc 'update' listener, which
      // schedules the debounced save that actually persists it. Safe even
      // if two viewers both open and migrate the same legacy document at
      // once: both conversions are deterministic from the same source JSON,
      // and Yjs updates are idempotent, so the second save is a no-op
      // merge, not a conflicting write.
      const migrated = prosemirrorJSONToYDoc(editor.schema, doc.content, YJS_FIELD);
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(migrated));
      migrated.destroy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc?._id]);

  // Join the document's realtime room for as long as this editor is open -
  // see backend/realtime/handlers/documentHandler.js document:join.
  useEffect(() => {
    if (!socket || !documentId) return;
    let active = true;
    socket.emit("document:join", { documentId }, (ack) => {
      if (active && ack?.success) setViewers(ack.viewers || []);
    });
    return () => {
      active = false;
      socket.emit("document:leave", { documentId });
    };
  }, [socket, documentId]);

  // Phase 1 offline resilience: the join effect above only runs once per
  // mount, but Socket.IO room membership does NOT survive a disconnect - a
  // reconnected socket looks connected again but has silently fallen out of
  // every room it was in, so document:updated/document:awareness broadcasts
  // for this document would stop reaching it forever without this. 'connect'
  // fires on the client's *first* connection too, not just reconnects; that
  // case is harmless here (document:join is idempotent server-side, and
  // re-pulling/re-pushing state neither loses nor duplicates anything) so
  // there's no need to specifically distinguish "first connect" from
  // "reconnect."
  useEffect(() => {
    if (!socket) return;
    setConnectionStatus(socket.connected ? "online" : "offline");

    const resync = async () => {
      setConnectionStatus("online");
      socket.emit("document:join", { documentId }, (ack) => {
        if (ack?.success) setViewers(ack.viewers || []);
      });

      // The "missed updates" fix. Not because anything tracks a per-client
      // sequence number - nothing does - but because every edit, from any
      // client, is durably persisted, so the latest yjsState is always a
      // complete superset of anything this client could have missed while
      // disconnected. Merging it in is safe regardless of arrival order,
      // Yjs update application is commutative - so there's no "did I get
      // everything, in the right order" bookkeeping to get right here.
      try {
        const res = await axios.get(`/api/servers/${server._id}/channels/${channel._id}/documents/${documentId}`);
        if (res.data?.success && res.data.document.yjsState) {
          Y.applyUpdate(ydoc, base64ToUint8Array(res.data.document.yjsState), REMOTE_ORIGIN);
        }
      } catch (err) {
        console.error("Failed to resync document after reconnect", err);
      }

      // Delivers anything typed while offline. There's no separate "pending
      // edits queue" to drain: saveEdit always sends the ydoc's entire
      // current state (see its own comment above), and any offline edits
      // are already sitting in that state - now merged with whatever was
      // just pulled from the server above, since Yjs merges are commutative
      // regardless of order.
      if (hasPendingLocalEditRef.current) saveEditRef.current();

      // Re-announce presence. Our local Awareness state didn't itself
      // change just because the network dropped - nothing calls
      // setLocalState during a mere disconnect, only on unmount (see the
      // awareness effect above) - so its own 'update' event won't fire the
      // way it would for a real edit. Other clients need this explicit
      // nudge to know we're back and see our cursor reappear.
      const localState = awareness.getLocalState();
      if (localState) {
        socket.emit("document:awareness", { documentId, update: encodeAwarenessUpdate(awareness, [awareness.clientID]) });
      }
    };
    const handleDisconnect = () => setConnectionStatus("offline");

    socket.on("connect", resync);
    socket.on("disconnect", handleDisconnect);
    return () => {
      socket.off("connect", resync);
      socket.off("disconnect", handleDisconnect);
    };
  }, [socket, documentId, server._id, channel._id, ydoc, awareness]);

  useEffect(() => {
    if (!socket || !editor) return;

    // Unlike Phase 1, there's no "your unsaved changes may have been
    // overwritten" warning here anymore - that was Phase 1's honest
    // disclosure of the LWW clobber risk, and it's no longer true: Yjs
    // merges this update into the local Y.Doc rather than replacing
    // anything, so a pending local edit survives regardless of what order
    // updates arrive in. `editedBy` is intentionally unused for now.
    const handleUpdated = ({ documentId: incomingId, update, version }) => {
      if (incomingId !== documentId) return;
      versionRef.current = version;
      Y.applyUpdate(ydoc, new Uint8Array(update), REMOTE_ORIGIN);
    };
    // Someone else's cursor/selection/presence moved - merge it into our
    // local Awareness (REMOTE_ORIGIN so the broadcast effect above doesn't
    // echo it straight back out).
    const handleAwareness = ({ documentId: incomingId, update }) => {
      if (incomingId !== documentId) return;
      applyAwarenessUpdate(awareness, new Uint8Array(update), REMOTE_ORIGIN);
    };
    const handleViewerJoined = ({ userId }) => {
      setViewers((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
      // The server never stores awareness state (it's ephemeral by design -
      // see documentHandler.js document:awareness), so a newly-joined
      // viewer has no way to learn this client's current cursor/selection
      // except by us re-announcing it now. Skipped if we don't have a
      // cursor state yet (e.g. this client hasn't focused the editor).
      const localState = awareness.getLocalState();
      if (localState) socket.emit("document:awareness", { documentId, update: encodeAwarenessUpdate(awareness, [awareness.clientID]) });
    };
    const handleViewerLeft = ({ userId }) => {
      setViewers((prev) => prev.filter((id) => id !== userId));
    };

    socket.on("document:updated", handleUpdated);
    socket.on("document:awareness", handleAwareness);
    socket.on("document:viewer_joined", handleViewerJoined);
    socket.on("document:viewer_left", handleViewerLeft);
    return () => {
      socket.off("document:updated", handleUpdated);
      socket.off("document:awareness", handleAwareness);
      socket.off("document:viewer_joined", handleViewerJoined);
      socket.off("document:viewer_left", handleViewerLeft);
    };
  }, [socket, editor, documentId, ydoc, awareness]);

  // Flush a pending debounced edit synchronously on unmount (navigating back
  // to the list, switching channels, etc.) - otherwise the last ~400ms of
  // typing before leaving would never be sent.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (hasPendingLocalEditRef.current) saveEditRef.current();
    };
  }, []);

  const handleTitleBlur = async () => {
    if (!doc || !title.trim() || title.trim() === doc.title) {
      setTitle(doc?.title || "");
      return;
    }
    try {
      setSavingTitle(true);
      const res = await axios.patch(
        `/api/servers/${server._id}/channels/${channel._id}/documents/${documentId}`,
        { title: title.trim() }
      );
      if (res.data?.success) {
        setDoc(res.data.document);
        onRenamed?.(res.data.document);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to rename document");
      setTitle(doc.title);
    } finally {
      setSavingTitle(false);
    }
  };

  const handleDelete = async () => {
    try {
      await axios.delete(`/api/servers/${server._id}/channels/${channel._id}/documents/${documentId}`);
      onDeleted?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete document");
    }
  };

  // Restoring a past version is deliberately just an ordinary edit, not a
  // special CRDT operation - see docs/interview-notes/document-collaboration.md
  // "Phase 3b" for why replaying an old version's binary Yjs state directly
  // would NOT correctly undo later changes (its operations are already
  // superseded by the current document's clocks, so applying it as an
  // update is mostly a no-op). setContent dispatches a real ProseMirror
  // transaction, which Collaboration's ySyncPlugin observes and translates
  // into brand-new Yjs operations against the *current* shared doc - those
  // genuinely supersede whatever's there now. That in turn fires the ydoc
  // 'update' listener above exactly like typing would, so this needs no
  // separate save path - just an immediate flush instead of waiting out the
  // usual debounce, since a restore is a deliberate, one-shot action.
  const handleRestore = (restoredJSON) => {
    if (!editor) return;
    editor.commands.setContent(restoredJSON);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    saveEditRef.current();
    setShowHistory(false);
  };

  // Awareness's `cursor` field is set by CollaborationCaret's yCursorPlugin
  // whenever a user has a live selection in the editor, and cleared (null)
  // on blur - so "has a cursor state" is a reasonable proxy for "actively
  // focused here right now", not just "has the document open" (that's
  // `viewers`, tracked separately via document:join/leave). This is the
  // lightweight version of an activity indicator: real per-section labels
  // ("editing paragraph 3") would need mapping ProseMirror positions to
  // document structure, deliberately not built in this phase.
  const editingUserIds = new Set(
    [...awarenessStates.values()].filter((state) => state?.cursor && state?.user?.id).map((state) => String(state.user.id))
  );

  const presenceViewers = viewers
    .filter((id) => String(id) !== String(currentUserId))
    .map((id) => ({
      id,
      name: memberById(id)?.fullname || memberById(id)?.username,
      color: colorForUser(id),
      editing: editingUserIds.has(String(id)),
    }))
    .filter((v) => v.name);

  if (loading || !doc || !editor) {
    return (
      <div className="h-full flex items-center justify-center text-white/50 text-sm">
        Loading document...
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col text-white min-w-0">
      <div className="px-4 py-2 border-b border-white/10 bg-slate-900/40 flex items-center gap-3">
        <button onClick={onBack} className="text-white/60 hover:text-white text-sm shrink-0">
          ← Docs
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
          disabled={savingTitle}
          maxLength={150}
          className="flex-1 bg-transparent text-sm font-semibold outline-none focus:bg-white/10 rounded px-2 py-1 min-w-0"
        />
        <span className={`text-[11px] shrink-0 ${connectionStatus === "offline" ? "text-amber-400" : "text-white/40"}`}>
          {connectionStatus === "offline"
            ? "Offline - changes saved locally"
            : saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "error"
                ? "Save failed"
                : "Saved"}
        </span>
        <button
          onClick={() => setShowHistory(true)}
          className="text-white/40 hover:text-white p-1 rounded shrink-0"
          title="Version history"
        >
          <HistoryIcon />
        </button>
        {canDelete && (
          <button
            onClick={handleDelete}
            className="text-white/40 hover:text-red-400 p-1 rounded shrink-0"
            title="Delete document"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {presenceViewers.length > 0 && (
        <div className="px-4 py-1.5 flex items-center gap-3 flex-wrap border-b border-white/5">
          {presenceViewers.map((v) => (
            <span key={v.id} className="flex items-center gap-1.5 text-[11px] text-white/60">
              {/* Same color this user's cursor/selection renders in (see
                  colorForUser + CollaborationCaret.configure above) - the
                  presence dot and the caret in the document are meant to
                  visually correspond. */}
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
              {v.name}
              {v.editing && <span className="text-white/30">editing</span>}
            </span>
          ))}
        </div>
      )}

      <div className="px-2 py-1 border-b border-white/10 flex items-center gap-1 flex-wrap">
        <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          B
        </ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          I
        </ToolbarButton>
        <ToolbarButton title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          S
        </ToolbarButton>
        <span className="w-px h-4 bg-white/10 mx-1" />
        <ToolbarButton
          title="Heading"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          title="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </ToolbarButton>
        <ToolbarButton
          title="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </ToolbarButton>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 doc-editor-content">
        <EditorContent editor={editor} />
      </div>

      {showHistory && (
        <VersionHistoryPanel
          server={server}
          channel={channel}
          documentId={documentId}
          currentText={editor.getText()}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
};
