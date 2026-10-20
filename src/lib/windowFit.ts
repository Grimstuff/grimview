import { invoke } from "@tauri-apps/api/core";
import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  monitorFromPoint,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";

/** Must match `.chrome` height in app.css. */
export const CHROME_HEIGHT = 36;
/** Logical px; matches minWidth/minHeight in tauri.conf.json. */
const MIN_W = 320;
const MIN_H = 220;

async function targetMonitor(visible: boolean): Promise<Monitor | null> {
  // First show: open on the screen the user is looking at (the cursor), like Explorer does.
  if (!visible) {
    try {
      const c = await cursorPosition();
      const m = await monitorFromPoint(c.x, c.y);
      if (m) return m;
    } catch {
      /* fall through */
    }
  }
  return (await currentMonitor()) ?? (await primaryMonitor());
}

/** Resizes before this time are our own placement, not the user's. */
let placingUntil = 0;
/** The user dragged an edge or snapped the window since the last explicit fit. */
let userSized = false;

/**
 * Watch for the user sizing the window themselves (edge drag, Snap). Maximize,
 * restore and fullscreen are their own states and don't count.
 */
export function initUserSizeTracking(): () => void {
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  void (async () => {
    try {
      const win = getCurrentWindow();
      let lastMax = await win.isMaximized();
      let lastFs = await win.isFullscreen();
      const u = await win.onResized(async () => {
        const max = await win.isMaximized();
        const fs = await win.isFullscreen();
        const stateChange = max !== lastMax || fs !== lastFs;
        lastMax = max;
        lastFs = fs;
        if (stateChange || max || fs || Date.now() < placingUntil) return;
        userSized = true;
      });
      if (cancelled) u();
      else unlisten = u;
    } catch {
      /* browser preview */
    }
  })();
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/**
 * Size the window so the image shows at 100% (one image pixel per screen pixel),
 * shrunk to fit the monitor work area when it is bigger. Hidden windows are centered;
 * a visible one keeps its center and is nudged back inside the work area.
 *
 * A maximized, fullscreen or user-sized window is left alone unless `force`
 * (W / turning "Size window to image" on), which also forgets the user's size.
 */
export async function fitWindowToImage(
  imgW: number,
  imgH: number,
  opts: { force?: boolean } = {},
): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (await win.isFullscreen()) return;
    if (opts.force) userSized = false;
    else if (userSized || (await win.isMaximized())) return;
    if (await win.isMaximized()) {
      placingUntil = Date.now() + 600;
      await win.unmaximize();
    }
    const visible = await win.isVisible();
    const mon = await targetMonitor(visible);
    if (!mon) return;

    const sf = mon.scaleFactor;
    const wa = mon.workArea;
    const chrome = Math.round(CHROME_HEIGHT * sf);
    const scale = Math.min(1, wa.size.width / imgW, (wa.size.height - chrome) / imgH);
    const w = Math.min(wa.size.width, Math.max(Math.round(MIN_W * sf), Math.round(imgW * scale)));
    const h = Math.min(
      wa.size.height,
      Math.max(Math.round(MIN_H * sf), Math.round(imgH * scale) + chrome),
    );

    let cx = wa.position.x + wa.size.width / 2;
    let cy = wa.position.y + wa.size.height / 2;
    if (visible) {
      const [px, py, pw, ph] = await invoke<[number, number, number, number]>("client_rect");
      cx = px + pw / 2;
      cy = py + ph / 2;
    }
    const maxX = wa.position.x + wa.size.width - w;
    const maxY = wa.position.y + wa.size.height - h;
    const x = Math.round(Math.max(wa.position.x, Math.min(maxX, cx - w / 2)));
    const y = Math.round(Math.max(wa.position.y, Math.min(maxY, cy - h / 2)));

    // By the visible area: Tauri's setSize pads for frame borders a frameless window doesn't show.
    placingUntil = Date.now() + 600;
    await invoke("place_window", { x, y, w, h });
    placingUntil = Date.now() + 400;
  } catch (e) {
    console.warn("fitWindowToImage", e);
  }
}

let revealed = false;

/** The window starts hidden (no default-size flash); show it once the first frame is right. */
export async function revealWindow(): Promise<void> {
  if (revealed) return;
  revealed = true;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  try {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  } catch {
    /* browser preview */
  }
}
