import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Log scale, 100% in the middle: 1/32× (3%) … 32× (3200%). */
const SPAN = Math.log(32);
/** Slider positions this close to a notch land on it. */
const SNAP = 0.05;
/** Half the range thumb's width, so notches line up with the thumb's center. */
const THUMB_HALF = 8;

const toPos = (zoom: number) => Math.max(-1, Math.min(1, Math.log(zoom) / SPAN));
const notchLeft = (pos: number) =>
  `calc(${THUMB_HALF}px + (100% - ${THUMB_HALF * 2}px) * ${(pos + 1) / 2})`;

interface ZoomPopoverProps {
  zoom: number;
  /** Zoom that fits the window; gets its own snap notch. */
  fitZoom: number;
  anchor: HTMLElement | null;
  open: boolean;
  onClose(): void;
  onZoom(zoom: number): void;
  onFit(): void;
}

export function ZoomPopover({ zoom, fitZoom, anchor, open, onClose, onZoom, onFit }: ZoomPopoverProps) {
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

  const fitPos = toPos(fitZoom);
  const showFit = Math.abs(fitPos) > 0.01;

  const onSlide = (p: number) => {
    if (Math.abs(p) < SNAP) onZoom(1);
    else if (showFit && Math.abs(p - fitPos) < SNAP) onFit();
    else onZoom(Math.exp(p * SPAN));
  };

  return createPortal(
    <div ref={ref} className="zoom-pop" style={{ top: pos.top, right: pos.right }}>
      <div className="zoom-pop-track">
        <span className="zoom-pop-tick" style={{ left: notchLeft(0) }} title="100%" aria-hidden />
        {showFit ? (
          <span className="zoom-pop-tick fit" style={{ left: notchLeft(fitPos) }} aria-hidden />
        ) : null}
        <input
          ref={sliderRef}
          type="range"
          className="zoom-pop-slider"
          min={-1}
          max={1}
          step={0.002}
          value={toPos(zoom)}
          aria-label="Zoom"
          title="Snaps to 100% (middle) and to fit the window"
          onChange={(e) => onSlide(Number(e.currentTarget.value))}
          onDoubleClick={() => onZoom(1)}
        />
      </div>
      <span className="zoom-pop-value">{Math.round(zoom * 100)}%</span>
    </div>,
    document.body,
  );
}
