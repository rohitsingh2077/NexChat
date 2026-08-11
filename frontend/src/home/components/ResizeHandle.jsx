import { useCallback, useEffect, useRef, useState } from "react";

// Drag-to-resize width for a side panel, persisted per panel via
// localStorage so a resize sticks across reloads.
//
// direction: 1 for a left-anchored panel (its resize handle sits on the
// panel's right edge - dragging right grows it), -1 for a right-anchored
// panel (handle on the panel's left edge - dragging left grows it, since
// the panel's right edge is fixed to the window edge).
export const useResizableWidth = ({ storageKey, defaultWidth, min, max, direction = 1 }) => {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored >= min && stored <= max ? stored : defaultWidth;
  });
  const dragState = useRef(null);

  const startDrag = useCallback(
    (e) => {
      dragState.current = { startX: e.clientX, startWidth: width };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const onMove = (e) => {
      if (!dragState.current) return;
      const delta = (e.clientX - dragState.current.startX) * direction;
      setWidth(Math.min(max, Math.max(min, dragState.current.startWidth + delta)));
    };
    const onUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        localStorage.setItem(storageKey, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [direction, max, min, storageKey]);

  return { width, startDrag };
};

export const ResizeHandle = ({ onMouseDown }) => (
  <div
    onMouseDown={onMouseDown}
    className="w-1.5 shrink-0 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors"
  />
);
