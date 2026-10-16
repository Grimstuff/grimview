import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Chrome, type MenuItem } from "./components/Chrome";
import { Viewer, type ViewerHandle } from "./components/Viewer";
import { AboutDialog } from "./components/AboutDialog";
import { ContextMenu, type CtxItem } from "./components/ContextMenu";
import { ASPECTS, CropBar, CropOverlay, fitAspect, roundBox, type CropBox } from "./components/CropTool";
import { ResizeDialog } from "./components/ResizeDialog";
import {
  copyImageToClipboard,
  editImage,
  openWithHandlers,
  setAsWallpaper,
  type EditOp,
  type OpenWithHandler,
  fileName,
  formatBytes,
  listFolder,
  loadImage,
  samePath,
  type LoadedImage,
} from "./lib/images";
import { initSystemAccent, initSystemTheme } from "./lib/theme";
import { fitWindowToImage, revealWindow } from "./lib/windowFit";

const CHECKER_KEY = "grimview.checker";
const SIZE_WINDOW_KEY = "grimview.sizeWindowToImage";

/** On/off settings in localStorage (`grimview.*`); both default on. */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Display size after rotation. */
function turnedSize(img: LoadedImage, rotation: number): [number, number] {
  return rotation % 180 !== 0 ? [img.height, img.width] : [img.width, img.height];
}

export default function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [folder, setFolder] = useState<string[]>([]);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState({ zoom: 1, fit: true, fitZoom: 1 });
  const [checker, setChecker] = useState(() => readFlag(CHECKER_KEY));
  const [sizeWindow, setSizeWindow] = useState(() => readFlag(SIZE_WINDOW_KEY));
  const sizeWindowRef = useRef(sizeWindow);
  sizeWindowRef.current = sizeWindow;
  const imageRef = useRef(image);
  imageRef.current = image;
  const [fullscreen, setFullscreen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [handlers, setHandlers] = useState<OpenWithHandler[] | null>(null);
  const [tool, setTool] = useState<"crop" | "resize" | null>(null);
  const [cropBox, setCropBox] = useState<CropBox>({ x: 0, y: 0, w: 1, h: 1 });
  const [cropAspect, setCropAspect] = useState("Free");
  const [busy, setBusy] = useState(false);
  const formats = useRef<string[]>([]);
  const viewer = useRef<ViewerHandle>(null);
  const loadSeq = useRef(0);
  const current = useRef<string | null>(null);
  const folderRef = useRef<string[]>([]);
  folderRef.current = folder;

  const flash = useCallback((msg: string, ms = 1400) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), ms);
  }, []);

  const openPath = useCallback(async (path: string, fitWindow: boolean) => {
    const seq = ++loadSeq.current;
    current.current = path;
    setLoading(true);
    void getCurrentWindow()
      .setTitle(`${fileName(path)} - Grimview`)
      .catch(() => undefined);
    try {
      const img = await loadImage(path);
      if (seq !== loadSeq.current) return;
      if (fitWindow) await fitWindowToImage(img.width, img.height);
      setRotation(0);
      setImage(img);
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setImage(null);
      setError({ path, message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (seq === loadSeq.current) setLoading(false);
      void revealWindow();
    }
    if (!folderRef.current.some((p) => samePath(p, path))) {
      const list = await listFolder(path);
      if (seq === loadSeq.current) setFolder(list);
    }
  }, []);

  const index = useMemo(() => {
    const p = image?.path ?? error?.path;
    return p ? folder.findIndex((f) => samePath(f, p)) : -1;
  }, [folder, image, error]);

  const go = useCallback(
    (to: "next" | "prev" | "first" | "last") => {
      const list = folderRef.current;
      if (list.length < 2) return;
      const at = list.findIndex((f) => current.current && samePath(f, current.current));
      const i =
        to === "first"
          ? 0
          : to === "last"
            ? list.length - 1
            : (Math.max(0, at) + (to === "next" ? 1 : -1) + list.length) % list.length;
      void openPath(list[i], sizeWindowRef.current);
    },
    [openPath],
  );

  // Warm the next image (and the Rust decode cache) while this one is on screen.
  useEffect(() => {
    if (!image || folder.length < 2 || index < 0) return;
    const next = folder[(index + 1) % folder.length];
    const t = window.setTimeout(() => void loadImage(next).catch(() => undefined), 150);
    return () => window.clearTimeout(t);
  }, [image, folder, index]);

  const pickFile = useCallback(async () => {
    const at = current.current;
    const picked = await openDialog({
      multiple: false,
      directory: false,
      defaultPath: at ? at.replace(/[\\/][^\\/]*$/, "") : undefined,
      filters: [
        { name: "Images", extensions: formats.current },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (typeof picked === "string") void openPath(picked, !imageRef.current || sizeWindowRef.current);
  }, [openPath]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const next = !(await win.isFullscreen());
      await win.setFullscreen(next);
      setFullscreen(next);
    } catch {
      /* ignore */
    }
  }, []);

  const copyImage = useCallback(async () => {
    if (!image) return;
    try {
      await copyImageToClipboard(image);
      flash("Image copied");
    } catch (e) {
      console.warn(e);
      flash("Could not copy image");
    }
  }, [image, flash]);

  const copyPath = useCallback(async () => {
    const p = current.current;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      flash("Path copied");
    } catch {
      flash("Could not copy path");
    }
  }, [flash]);

  const rotate = useCallback((dir: 1 | -1) => {
    setRotation((r) => {
      const next = (r + dir * 90 + 360) % 360;
      const img = imageRef.current;
      if (img && sizeWindowRef.current) void fitWindowToImage(...turnedSize(img, next));
      return next;
    });
  }, []);

  const toggleSizeWindow = useCallback(() => {
    const on = !sizeWindowRef.current;
    writeFlag(SIZE_WINDOW_KEY, on);
    setSizeWindow(on);
    const img = imageRef.current;
    if (on && img) void fitWindowToImage(...turnedSize(img, rotation));
  }, [rotation]);

  const toggleChecker = useCallback(() => {
    setChecker((v) => {
      writeFlag(CHECKER_KEY, !v);
      return !v;
    });
  }, []);

  const copyName = useCallback(async () => {
    const p = current.current;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(fileName(p));
      flash("Name copied");
    } catch {
      flash("Could not copy name");
    }
  }, [flash]);

  const showInFolder = useCallback(() => {
    if (current.current) void revealItemInDir(current.current).catch(() => undefined);
  }, []);

  const setWallpaper = useCallback(async () => {
    const img = imageRef.current;
    if (!img) return;
    try {
      await setAsWallpaper(img);
      flash("Set as desktop background");
    } catch (e) {
      flash(String(e), 3500);
    }
  }, [flash]);

  /** Save an edit, then show the result (the new copy, or the same file reloaded). */
  const saveEdit = useCallback(
    async (op: EditOp, asCopy: boolean) => {
      const img = imageRef.current;
      if (!img || busy) return;
      setBusy(true);
      try {
        const saved = await editImage(img.path, op, asCopy);
        setTool(null);
        if (asCopy) {
          folderRef.current = [];
          setFolder([]);
        }
        await openPath(saved, sizeWindowRef.current);
        flash(asCopy ? `Saved as ${fileName(saved)}` : "Saved (original is in the Recycle Bin)", 2400);
      } catch (e) {
        flash(String(e), 3500);
      } finally {
        setBusy(false);
      }
    },
    [busy, openPath, flash],
  );

  const startCrop = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    setRotation(0);
    setCropAspect("Free");
    setCropBox({ x: 0, y: 0, w: img.width, h: img.height });
    setTool("crop");
    requestAnimationFrame(() => viewer.current?.fit());
  }, []);

  const pickAspect = useCallback((label: string) => {
    const img = imageRef.current;
    if (!img) return;
    setCropAspect(label);
    const a = ASPECTS.find((x) => x.label === label)?.ratio ?? null;
    const ratio = a === "original" ? img.width / img.height : a;
    if (ratio) setCropBox((b) => fitAspect(b, ratio, img.width, img.height));
  }, []);

  const aspectRatio = ASPECTS.find((x) => x.label === cropAspect)?.ratio ?? null;
  const cropRatio =
    aspectRatio === "original" ? (image ? image.width / image.height : null) : aspectRatio;

  const saveCrop = useCallback(
    (asCopy: boolean) => {
      const r = roundBox(cropBox);
      void saveEdit({ kind: "crop", x: r.x, y: r.y, w: r.w, h: r.h }, asCopy);
    },
    [cropBox, saveEdit],
  );

  const openContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (tool || !current.current) return;
      setCtx({ x: e.clientX, y: e.clientY });
      setHandlers(null);
      void openWithHandlers(current.current).then(setHandlers);
    },
    [tool],
  );

  // No browser context menu anywhere (its "Save as" writes an HTML page); ours replaces it.
  // Same for WebView2's own shortcuts: Ctrl+S/P/F/G/U/R, F3, F5, F7, Ctrl+Shift+I…
  useEffect(() => {
    const block = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    };
    const browserKeys = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (
        (ctrl && ["s", "p", "f", "g", "u", "r", "j", "h", "d", "l", "n", "t"].includes(k)) ||
        (ctrl && e.shiftKey && ["i", "j", "delete", "o"].includes(k)) ||
        ["f3", "f5", "f7", "f12", "browserback", "browserforward"].includes(k)
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", block);
    window.addEventListener("keydown", browserKeys, true);
    return () => {
      document.removeEventListener("contextmenu", block);
      window.removeEventListener("keydown", browserKeys, true);
    };
  }, []);

  // Boot: theme, accent, launch file. The window stays hidden until the first frame is sized.
  useEffect(() => {
    const untheme = initSystemTheme();
    const unaccent = initSystemAccent();
    void (async () => {
      try {
        formats.current = await invoke<string[]>("get_formats");
      } catch {
        /* browser preview */
      }
      let launch: string | null = null;
      try {
        launch = await invoke<string | null>("get_launch_path");
      } catch {
        /* browser preview */
      }
      if (launch) await openPath(launch, true);
      else void revealWindow();
    })();
    return () => {
      untheme();
      unaccent();
    };
  }, [openPath]);

  // Drop a file anywhere.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "drop" && e.payload.paths.length) {
          void openPath(e.payload.paths[0], !current.current || sizeWindowRef.current);
        }
      })
      .then((u) => (unlisten = u))
      .catch(() => undefined);
    return () => unlisten?.();
  }, [openPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (aboutOpen || tool === "resize") return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      const handled = () => e.preventDefault();
      if (tool === "crop") {
        if (k === "Escape") return handled(), setTool(null);
        if (k === "Enter") return handled(), saveCrop(false);
        return;
      }
      if (ctrl && k.toLowerCase() === "o") return handled(), void pickFile();
      if (ctrl && e.shiftKey && k.toLowerCase() === "c") return handled(), void copyPath();
      if (ctrl && k.toLowerCase() === "c") return handled(), void copyImage();
      if (ctrl && k.toLowerCase() === "w") return handled(), void getCurrentWindow().close();
      if (ctrl && (k === "=" || k === "+")) return handled(), viewer.current?.zoomBy(1.25);
      if (ctrl && k === "-") return handled(), viewer.current?.zoomBy(0.8);
      if (ctrl && k === "0") return handled(), viewer.current?.fit();
      if (ctrl) return;
      switch (k) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          return handled(), go("next");
        case "ArrowLeft":
        case "PageUp":
        case "Backspace":
          return handled(), go("prev");
        case "Home":
          return handled(), go("first");
        case "End":
          return handled(), go("last");
        case "+":
        case "=":
          return handled(), viewer.current?.zoomBy(1.25);
        case "-":
        case "_":
          return handled(), viewer.current?.zoomBy(0.8);
        case "0":
          return handled(), viewer.current?.fit();
        case "1":
          return handled(), viewer.current?.actualSize();
        case "r":
          return handled(), rotate(1);
        case "R":
        case "l":
        case "L":
          return handled(), rotate(-1);
        case "w":
        case "W":
          return handled(), toggleSizeWindow();
        case "F11":
        case "f":
        case "F":
          return handled(), void toggleFullscreen();
        case "Enter":
          if (e.altKey) return handled(), void toggleFullscreen();
          return;
        case "Escape":
          handled();
          if (fullscreen) void toggleFullscreen();
          else void getCurrentWindow().close();
          return;
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) (e.preventDefault(), go("prev"));
      if (e.button === 4) (e.preventDefault(), go("next"));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [
    aboutOpen,
    tool,
    saveCrop,
    pickFile,
    copyPath,
    copyImage,
    go,
    rotate,
    toggleSizeWindow,
    toggleFullscreen,
    fullscreen,
  ]);

  const onZoom = useCallback(
    (z: number, fit: boolean, fitZoom: number) => setZoom({ zoom: z, fit, fitZoom }),
    [],
  );

  const hasImage = !!image;
  const menu: MenuItem[][] = [
    [
      { label: "Open…", shortcut: "Ctrl+O", run: pickFile },
      { label: "Fullscreen", shortcut: "F11", run: toggleFullscreen },
    ],
    [
      {
        label: "Size window to image",
        shortcut: "W",
        checked: sizeWindow,
        title: "Resize the window to each image: 100%, or as large as the screen allows",
        run: toggleSizeWindow,
      },
      {
        label: "Transparency grid",
        checked: checker,
        title: "Checkerboard behind transparent pixels",
        run: toggleChecker,
      },
    ],
    [{ label: "About", run: () => setAboutOpen(true) }],
  ];

  const editBlocked = image ? image.editBlocked : "No image";
  const savesOver = "Saves the file (the original goes to the Recycle Bin)";
  const ctxItems: CtxItem[][] = [
    [
      { label: "Copy", shortcut: "Ctrl+C", disabled: !hasImage, run: copyImage },
      { label: "Copy path", shortcut: "Ctrl+Shift+C", run: copyPath },
      { label: "Copy name", run: copyName },
      { label: "Show in folder", run: showInFolder },
    ],
    [
      {
        label: "Edit",
        disabled: !!editBlocked,
        title: editBlocked ?? undefined,
        submenu: [
          [
            { label: "Rotate right", title: savesOver, run: () => saveEdit({ kind: "rotate", turns: 1 }, false) },
            { label: "Rotate left", title: savesOver, run: () => saveEdit({ kind: "rotate", turns: 3 }, false) },
            { label: "Rotate 180°", title: savesOver, run: () => saveEdit({ kind: "rotate", turns: 2 }, false) },
          ],
          [
            { label: "Crop…", run: startCrop },
            { label: "Resize…", run: () => setTool("resize") },
          ],
        ],
      },
      {
        label: "Open with",
        submenu: [
          handlers === null
            ? [{ label: "Looking for apps…", disabled: true }]
            : handlers.length
              ? handlers.map((h) => ({
                  label: h.name,
                  run: () =>
                    invoke("open_with", { path: current.current, id: h.id }).catch((e) =>
                      flash(String(e), 3500),
                    ),
                }))
              : [{ label: "No other apps found", disabled: true }],
          [
            {
              label: "Choose another app…",
              run: () =>
                invoke("open_with_dialog", { path: current.current }).catch((e) =>
                  flash(String(e), 3500),
                ),
            },
          ],
        ],
      },
      { label: "Set as desktop background", disabled: !hasImage, run: setWallpaper },
    ],
  ];

  const shownPath = image?.path ?? error?.path ?? null;
  const meta = [
    image && !image.sizeless ? `${image.width} × ${image.height}` : null,
    image ? formatBytes(image.size) : null,
    folder.length > 1 && index >= 0 ? `${index + 1} / ${folder.length}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div className={`app${fullscreen ? " fullscreen" : ""}`}>
      {fullscreen ? null : (
        <Chrome
          title={shownPath ? fileName(shownPath) : "Grimview"}
          meta={meta}
          zoom={image ? zoom.zoom : null}
          fitZoom={zoom.fitZoom}
          onTitleClick={
            shownPath
              ? () => navigator.clipboard.writeText(fileName(shownPath)).then(() => true, () => false)
              : undefined
          }
          onZoom={(z) => viewer.current?.setZoom(z)}
          onFit={() => viewer.current?.fit()}
          menu={menu}
        />
      )}
      <main className="body" onContextMenu={openContextMenu}>
        {image ? (
          <Viewer
            ref={viewer}
            image={image}
            rotation={rotation}
            checker={checker}
            onZoom={onZoom}
            overlay={
              tool === "crop"
                ? (rect) => (
                    <CropOverlay
                      rect={rect}
                      imgW={image.width}
                      imgH={image.height}
                      box={cropBox}
                      ratio={cropRatio}
                      onChange={setCropBox}
                    />
                  )
                : undefined
            }
          />
        ) : error ? (
          <div className="placeholder">
            <div className="placeholder-title">Can't show {fileName(error.path)}</div>
            <div className="placeholder-text">{error.message}</div>
            <button type="button" className="placeholder-btn" onClick={() => void pickFile()}>
              Open another…
            </button>
          </div>
        ) : loading ? null : (
          <div className="placeholder" data-tauri-drag-region>
            <button type="button" className="placeholder-btn" onClick={() => void pickFile()}>
              Open an image
            </button>
            <div className="placeholder-text">or drop one here · Ctrl+O</div>
          </div>
        )}
        {folder.length > 1 && (image || error) && !tool ? (
          <>
            <button
              type="button"
              className="nav nav-prev"
              aria-label="Previous image"
              title="Previous (←)"
              onClick={() => go("prev")}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              ‹
            </button>
            <button
              type="button"
              className="nav nav-next"
              aria-label="Next image"
              title="Next (→)"
              onClick={() => go("next")}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              ›
            </button>
          </>
        ) : null}
        {loading && image ? <div className="loading-bar" /> : null}
        {tool === "crop" ? (
          <CropBar
            box={cropBox}
            aspect={cropAspect}
            busy={busy}
            onAspect={pickAspect}
            onCancel={() => setTool(null)}
            onSave={saveCrop}
          />
        ) : null}
        {toast ? <div className="toast">{toast}</div> : null}
      </main>
      {ctx ? <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} /> : null}
      {tool === "resize" && image ? (
        <ResizeDialog
          width={image.width}
          height={image.height}
          busy={busy}
          onCancel={() => setTool(null)}
          onSave={(w, h, asCopy) => void saveEdit({ kind: "resize", w, h }, asCopy)}
        />
      ) : null}
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
