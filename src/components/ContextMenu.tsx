import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface CtxItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  title?: string;
  run?: () => unknown;
  /** Groups separated by a divider. */
  submenu?: CtxItem[][];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: CtxItem[][];
  onClose(): void;
}

const EDGE = 6;

/** Keep a fixed-position box inside the window. */
function useFit(ref: React.RefObject<HTMLDivElement | null>, x: number, y: number, flipFrom?: number) {
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x;
    if (left + width > window.innerWidth - EDGE) {
      left = flipFrom !== undefined ? flipFrom - width : window.innerWidth - EDGE - width;
    }
    const top = Math.min(y, window.innerHeight - EDGE - height);
    setPos({ left: Math.max(EDGE, left), top: Math.max(EDGE, top), ready: true });
  }, [ref, x, y, flipFrom]);
  return pos;
}

function MenuList({
  items,
  x,
  y,
  flipFrom,
  close,
}: {
  items: CtxItem[][];
  x: number;
  y: number;
  flipFrom?: number;
  close(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useFit(ref, x, y, flipFrom);
  const [sub, setSub] = useState<{ key: string; x: number; y: number; flip: number } | null>(null);
  const hoverTimer = useRef(0);

  const openSub = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setSub({ key, x: r.right + 2, y: r.top - 5, flip: r.left - 2 });
  };

  return (
    <div
      ref={ref}
      className="menu-dropdown ctx-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((group, gi) => (
        <div key={gi} role="group">
          {gi > 0 ? <div className="menu-sep" /> : null}
          {group.map((item) => {
            const key = `${gi}:${item.label}`;
            const hasSub = !!item.submenu;
            return (
              <button
                key={key}
                type="button"
                role="menuitem"
                className={`menu-option${sub?.key === key ? " open" : ""}`}
                disabled={item.disabled}
                title={item.title}
                aria-haspopup={hasSub ? "menu" : undefined}
                onMouseEnter={(e) => {
                  window.clearTimeout(hoverTimer.current);
                  const el = e.currentTarget;
                  if (hasSub && !item.disabled) {
                    hoverTimer.current = window.setTimeout(() => openSub(key, el), 120);
                  } else {
                    hoverTimer.current = window.setTimeout(() => setSub(null), 200);
                  }
                }}
                onClick={(e) => {
                  if (hasSub) {
                    openSub(key, e.currentTarget);
                    return;
                  }
                  close();
                  void Promise.resolve(item.run?.());
                }}
              >
                {item.label}
                {hasSub ? (
                  <span className="menu-shortcut menu-chevron">›</span>
                ) : item.shortcut ? (
                  <span className="menu-shortcut">{item.shortcut}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
      {sub
        ? (() => {
            const [gi, label] = [Number(sub.key.split(":")[0]), sub.key.slice(sub.key.indexOf(":") + 1)];
            const parent = items[gi]?.find((i) => i.label === label);
            return parent?.submenu ? (
              <MenuList items={parent.submenu} x={sub.x} y={sub.y} flipFrom={sub.flip} close={close} />
            ) : null;
          })()
        : null}
    </div>
  );
}

/** Right-click menu with one level of submenus, portaled and clamped to the window. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("contextmenu", onDown);
    }, 0);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("contextmenu", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={root}>
      <MenuList items={items} x={x} y={y} close={onClose} />
    </div>,
    document.body,
  );
}
