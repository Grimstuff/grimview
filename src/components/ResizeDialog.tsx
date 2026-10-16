import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ResizeDialogProps {
  width: number;
  height: number;
  busy: boolean;
  onCancel(): void;
  onSave(w: number, h: number, asCopy: boolean): void;
}

const PRESETS = [25, 50, 75];

export function ResizeDialog({ width, height, busy, onCancel, onSave }: ResizeDialogProps) {
  const [w, setW] = useState(String(width));
  const [h, setH] = useState(String(height));
  const [lock, setLock] = useState(true);
  const first = useRef<HTMLInputElement>(null);
  const ratio = width / height;

  useEffect(() => {
    requestAnimationFrame(() => first.current?.select());
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const setWidth = (v: string) => {
    setW(v);
    const n = Number(v);
    if (lock && n > 0) setH(String(Math.max(1, Math.round(n / ratio))));
  };
  const setHeight = (v: string) => {
    setH(v);
    const n = Number(v);
    if (lock && n > 0) setW(String(Math.max(1, Math.round(n * ratio))));
  };

  const nw = Math.round(Number(w));
  const nh = Math.round(Number(h));
  const valid = nw > 0 && nh > 0 && nw <= 65535 && nh <= 65535 && (nw !== width || nh !== height);

  const submit = (asCopy: boolean) => {
    if (valid && !busy) onSave(nw, nh, asCopy);
  };

  return createPortal(
    <div className="about-overlay" role="presentation" onMouseDown={onCancel}>
      <form
        className="about-dialog resize-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resize-title"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <h1 id="resize-title" className="resize-title">
          Resize
        </h1>
        <p className="resize-now">
          Now {width} × {height}
        </p>
        <div className="resize-row">
          <label>
            Width
            <input ref={first} type="number" min={1} value={w} onChange={(e) => setWidth(e.target.value)} />
          </label>
          <span className="resize-x">×</span>
          <label>
            Height
            <input type="number" min={1} value={h} onChange={(e) => setHeight(e.target.value)} />
          </label>
        </div>
        <div className="resize-row resize-opts">
          <label className="resize-lock">
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
            Keep proportions
          </label>
          <div className="tool-chips">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="tool-chip"
                onClick={() => {
                  setW(String(Math.max(1, Math.round((width * p) / 100))));
                  setH(String(Math.max(1, Math.round((height * p) / 100))));
                }}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>
        <div className="resize-actions">
          <button type="button" className="tool-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="tool-btn" onClick={() => submit(true)} disabled={!valid || busy}>
            Save copy
          </button>
          <button
            type="submit"
            className="tool-btn primary"
            disabled={!valid || busy}
            title="Overwrite the file (the original goes to the Recycle Bin)"
          >
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
