import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Log scale, 100% in the middle: 1/32× (3%) … 32× (3200%). */
const SPAN = Math.log(32);
/** Slider positions within this of the middle land on exactly 100%. */
const SNAP = 0.04;

const toPos = (zoom: number) => Math.max(-1, Math.min(1, Math.log(zoom) / SPAN));
const toZoom = (pos: number) => (Math.abs(pos) < SNAP ? 1 : Math.exp(pos * SPAN));

interface ZoomPopoverProps {
  zoom: number;
  anchor: HTMLElement | null;
  open: boolean;
  onClose(): void;
  onZoom(zoom: number): void;
  onFit(): void;
}

export function ZoomPopover({ zoom, anchor, open, onClose, onZoom, onFit }: ZoomPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos({ top: r.bottom + 2, right: Math.max(8, window.innerWidth - r.right) });
    requestAnimationFrame(() => sliderRef.current?.focus());
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      // Arrows belong to the slider while it is open, not to prev/next.
      if (e.key.startsWith("Arrow")) e.stopPropagation();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;

  return createPortal(
    <div ref={ref} className="zoom-pop" style={{ top: pos.top, right: pos.right }}>
      <div className="zoom-pop-track">
        <span className="zoom-pop-tick" aria-hidden />
        <input
          ref={sliderRef}
          type="range"
          className="zoom-pop-slider"
          min={-1}
          max={1}
          step={0.002}
          value={toPos(zoom)}
          aria-label="Zoom"
          title="Middle is actual size (100%)"
          onChange={(e) => onZoom(toZoom(Number(e.currentTarget.value)))}
          onDoubleClick={() => onZoom(1)}
        />
      </div>
      <span className="zoom-pop-value">{Math.round(zoom * 100)}%</span>
      <button type="button" className="zoom-pop-fit" onClick={onFit} title="Fit to window (0)">
        Fit
      </button>
    </div>,
    document.body,
  );
}
