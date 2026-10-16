import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ZoomPopover } from "./ZoomPopover";

export interface MenuItem {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  run: () => unknown;
}

interface ChromeProps {
  title: string;
  meta: string;
  /** Screen px per image px; null when nothing is shown. */
  zoom: number | null;
  onZoom: (zoom: number) => void;
  fitZoom: number;
  onFit: () => void;
  /** Copies the file name; resolves true when it worked. */
  onTitleClick?: () => Promise<boolean>;
  /** Groups are separated by a divider. */
  menu: MenuItem[][];
}

/** Frameless chrome: ☰ | name · meta (drag region) | zoom | window controls */
export function Chrome({
  title,
  meta,
  zoom,
  fitZoom,
  onZoom,
  onFit,
  onTitleClick,
  menu,
}: ChromeProps) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [maximized, setMaximized] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const win = getCurrentWindow();
        setMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => setMaximized(await win.isMaximized()));
      } catch {
        /* browser preview */
      }
    })();
    return () => unlisten?.();
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || !hamburgerRef.current) return;
    const rect = hamburgerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 2, left: rect.left + 4 });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (dropdownRef.current?.contains(t) || hamburgerRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", () => setMenuOpen(false), { once: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  const winAction = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const win = getCurrentWindow();
      if (action === "minimize") await win.minimize();
      else if (action === "toggleMaximize") await win.toggleMaximize();
      else await win.close();
    } catch (e) {
      console.warn(e);
      if (action === "close") void getCurrentWindow().destroy();
    }
  };

  const dropdown = menuOpen
    ? createPortal(
        <div
          ref={dropdownRef}
          className="menu-dropdown"
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {menu.map((group, gi) => (
            <div key={gi} role="group">
              {gi > 0 ? <div className="menu-sep" /> : null}
              {group.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="menu-option"
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setMenuOpen(false);
                    void Promise.resolve(item.run());
                  }}
                >
                  {item.checked ? `✓ ${item.label}` : item.label}
                  {item.shortcut ? <span className="menu-shortcut">{item.shortcut}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <header className="chrome">
      <button
        ref={hamburgerRef}
        type="button"
        className="chrome-hamburger"
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        title="Menu"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="chrome-hamburger-icon" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </button>

      <div
        className="chrome-drag"
        data-tauri-drag-region
        onDoubleClick={() => void winAction("toggleMaximize")}
      >
        {onTitleClick ? (
          <button
            type="button"
            className="chrome-title chrome-title-btn"
            title="Copy file name"
            onClick={() =>
              void onTitleClick().then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.clearTimeout(copyTimer.current);
                copyTimer.current = window.setTimeout(() => setCopied(false), 1200);
              })
            }
          >
            {title}
          </button>
        ) : (
          <span className="chrome-title">{title}</span>
        )}
        {copied ? <span className="chrome-copied">Copied</span> : null}
        {meta ? <span className="chrome-meta">{meta}</span> : null}
      </div>

      {zoom !== null ? (
        <button
          ref={zoomBtnRef}
          type="button"
          className="chrome-zoom"
          title="Zoom"
          aria-expanded={zoomOpen}
          onClick={() => setZoomOpen((v) => !v)}
        >
          {Math.round(zoom * 100)}%
        </button>
      ) : null}
      <ZoomPopover
        zoom={zoom ?? 1}
        fitZoom={fitZoom}
        anchor={zoomBtnRef.current}
        open={zoomOpen && zoom !== null}
        onClose={() => setZoomOpen(false)}
        onZoom={onZoom}
        onFit={onFit}
      />

      <div className="chrome-controls">
        <button
          type="button"
          className="win-btn"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void winAction("minimize")}
        >
          <svg viewBox="0 0 12 12" aria-hidden>
            <path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="win-btn"
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => void winAction("toggleMaximize")}
        >
          {maximized ? (
            <svg viewBox="0 0 12 12" aria-hidden>
              <path d="M3 4h6v6H3zM4 3h6v1M10 3v6h-1" stroke="currentColor" strokeWidth="1.4" fill="none" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" aria-hidden>
              <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="win-btn win-btn-close"
          title="Close"
          aria-label="Close"
          onClick={() => void winAction("close")}
        >
          <svg viewBox="0 0 12 12" aria-hidden>
            <path
              d="M2.5 2.5l7 7M9.5 2.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {dropdown}
    </header>
  );
}
