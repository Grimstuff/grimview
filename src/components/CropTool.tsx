import { useRef } from "react";
import type { ImageRect } from "./Viewer";

/** Crop box in image pixels. */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 8;

export const ASPECTS: { label: string; ratio: number | "original" | null }[] = [
  { label: "Free", ratio: null },
  { label: "Original", ratio: "original" },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "16:9", ratio: 16 / 9 },
];

/** Largest box of the given ratio, centered inside the current one. */
export function fitAspect(box: CropBox, ratio: number, imgW: number, imgH: number): CropBox {
  let w = box.w;
  let h = w / ratio;
  if (h > box.h) {
    h = box.h;
    w = h * ratio;
  }
  w = Math.min(w, imgW);
  h = Math.min(h, imgH);
  const x = Math.max(0, Math.min(imgW - w, box.x + (box.w - w) / 2));
  const y = Math.max(0, Math.min(imgH - h, box.y + (box.h - h) / 2));
  return { x, y, w, h };
}

export function roundBox(b: CropBox): CropBox {
  const x = Math.round(b.x);
  const y = Math.round(b.y);
  return { x, y, w: Math.max(1, Math.round(b.x + b.w) - x), h: Math.max(1, Math.round(b.y + b.h) - y) };
}

interface CropOverlayProps {
  rect: ImageRect;
  imgW: number;
  imgH: number;
  box: CropBox;
  ratio: number | null;
  onChange(box: CropBox): void;
}

/** Draggable crop rectangle drawn over the image. */
export function CropOverlay({ rect, imgW, imgH, box, ratio, onChange }: CropOverlayProps) {
  const drag = useRef<{ h: Handle; sx: number; sy: number; start: CropBox } | null>(null);
  const scale = rect.width / imgW;

  const begin = (h: Handle) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { h, sx: e.clientX, sy: e.clientY, start: box };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    const s = d.start;
    if (d.h === "move") {
      onChange({
        ...s,
        x: Math.max(0, Math.min(imgW - s.w, s.x + dx)),
        y: Math.max(0, Math.min(imgH - s.h, s.y + dy)),
      });
      return;
    }
    let left = s.x;
    let top = s.y;
    let right = s.x + s.w;
    let bottom = s.y + s.h;
    if (d.h.includes("w")) left = Math.max(0, Math.min(right - MIN, left + dx));
    if (d.h.includes("e")) right = Math.min(imgW, Math.max(left + MIN, right + dx));
    if (d.h.includes("n")) top = Math.max(0, Math.min(bottom - MIN, top + dy));
    if (d.h.includes("s")) bottom = Math.min(imgH, Math.max(top + MIN, bottom + dy));

    if (ratio) {
      // Width drives, except on the top/bottom edges; anchor the opposite side.
      let w = right - left;
      let h = bottom - top;
      if (d.h === "n" || d.h === "s") w = h * ratio;
      else h = w / ratio;
      const maxW = d.h.includes("w") ? s.x + s.w : imgW - left;
      const maxH = d.h.includes("n") ? s.y + s.h : imgH - top;
      if (w > maxW) (w = maxW), (h = w / ratio);
      if (h > maxH) (h = maxH), (w = h * ratio);
      if (d.h.includes("w")) left = s.x + s.w - w;
      if (d.h.includes("n")) top = s.y + s.h - h;
      if (d.h === "n" || d.h === "s") left = Math.max(0, Math.min(imgW - w, s.x + (s.w - w) / 2));
      if (d.h === "e" || d.h === "w") top = Math.max(0, Math.min(imgH - h, s.y + (s.h - h) / 2));
      right = left + w;
      bottom = top + h;
    }
    onChange({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const end = () => {
    drag.current = null;
  };

  const style = {
    left: rect.left + box.x * scale,
    top: rect.top + box.y * scale,
    width: box.w * scale,
    height: box.h * scale,
  };

  return (
    <div
      className="crop-box"
      style={style}
      onPointerDown={begin("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="crop-grid v1" />
      <span className="crop-grid v2" />
      <span className="crop-grid h1" />
      <span className="crop-grid h2" />
      {HANDLES.map((h) => (
        <span
          key={h}
          className={`crop-handle ${h}`}
          onPointerDown={begin(h)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </div>
  );
}

interface CropBarProps {
  box: CropBox;
  aspect: string;
  busy: boolean;
  onAspect(label: string): void;
  onCancel(): void;
  onSave(asCopy: boolean): void;
}

export function CropBar({ box, aspect, busy, onAspect, onCancel, onSave }: CropBarProps) {
  const r = roundBox(box);
  return (
    <div className="tool-bar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-chips">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`tool-chip${aspect === a.label ? " on" : ""}`}
            onClick={() => onAspect(a.label)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <span className="tool-dims">
        {r.w} × {r.h}
      </span>
      <div className="tool-actions">
        <button type="button" className="tool-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="tool-btn" onClick={() => onSave(true)} disabled={busy}>
          Save copy
        </button>
        <button
          type="button"
          className="tool-btn primary"
          onClick={() => onSave(false)}
          disabled={busy}
          title="Overwrite the file (the original goes to the Recycle Bin)"
        >
          Save
        </button>
      </div>
    </div>
  );
}
