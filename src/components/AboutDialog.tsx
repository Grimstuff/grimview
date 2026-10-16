import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
/** Grimsoft dog + wizard hat — About branding only (the exe uses the photo icon). */
import grimsoftIcon from "../assets/grimsoft-icon.jpg";

const FALLBACK_VERSION = "0.1";

/** Show 0.1 instead of 0.1.0; keep a real patch if we ship one. */
function displayVersion(v: string): string {
  return v.replace(/\.0$/, "");
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [version, setVersion] = useState(FALLBACK_VERSION);

  useEffect(() => {
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setVersion(displayVersion(await getVersion()));
      } catch {
        /* browser preview */
      }
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="about-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <img className="about-icon" src={grimsoftIcon} alt="Grimsoft" width={72} height={72} draggable={false} />
        <h1 id="about-title" className="about-title">
          Grimview
        </h1>
        <p className="about-version">Version {version}</p>
        <p className="about-blurb">A minimal image viewer.</p>
        <p className="about-meta">Built with Tauri, React, the image crate, jxl-oxide, and Windows Imaging.</p>
        <button ref={closeRef} type="button" className="about-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}
