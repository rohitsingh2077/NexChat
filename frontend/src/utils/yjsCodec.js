// Shared between DocumentEditor.jsx (live editing) and VersionHistoryPanel.jsx
// (decoding past snapshots) - pulled out to its own module rather than
// exported from DocumentEditor.jsx so both stay plain constants/functions,
// not something a component file's Fast Refresh boundary has an opinion
// about (react-refresh/only-export-components).

// The Yjs XML fragment name both @tiptap/extension-collaboration's `field`
// option and y-prosemirror's `xmlFragmentName` param need to agree on - an
// explicit shared constant rather than relying on each library's own
// default staying in sync with the other's (they don't: one defaults to
// 'default', the other to 'prosemirror').
export const YJS_FIELD = "default";

// document.controller.js base64-encodes yjsState for clean JSON transport
// (a raw Buffer would otherwise serialize as an awkward {type,data} shape) -
// this is the inverse, back into the Uint8Array Y.applyUpdate expects.
export const base64ToUint8Array = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
