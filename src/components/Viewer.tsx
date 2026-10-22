import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { LoadedImage } from "../lib/images";

export interface ViewerHandle {
  zoomBy(factor: number): void;
  setZoom(zoom: number): void;
  fit(): void;
  actualSize(): void;
  toggleFit(): void;
}

interface ViewerProps {
  image: LoadedImage;
  rotation: number;
  checker: boolean;
  /** fitZoom: the zoom that fits the window right now (≤ 1). */
  onZoom(zoom: number, fit: boolean, fitZoom: number): void;
  /** Drawn over the image (crop tool); gets the unrotated image's box in stage CSS px. */
  overlay?: (rect: ImageRect) => React.ReactNode;
  /** Double-click on the image (App: fullscreen). */
  onDoubleClick?: () => void;
  /** Drag on the picture: start a file drag out of the window. */
  onDragOut?: () => void;
}

export interface ImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** zoom is screen pixels per image pixel (1 = 100%, independent of Windows scaling). */
interface View {
  zoom: number;
  x: number;
  y: number;
  fit: boolean;
}

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 64;
const DRAG_THRESHOLD = 4;

export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(
  { image, rotation, checker, onZoom, overlay, onDoubleClick: onDouble, onDragOut },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0, fit: true });
  const viewRef = useRef(view);
  viewRef.current = view;

  const turned = rotation % 180 !== 0;
  const imgW = turned ? image.height : image.width;
  const imgH = turned ? image.width : image.height;

  const stageSize = () => {
    const el = stageRef.current;
    return { w: el?.clientWidth ?? 1, h: el?.clientHeight ?? 1 };
  };

  const fitZoom = useCallback(() => {
    const { w, h } = stageSize();
    const dpr = window.devicePixelRatio || 1;
    return Math.min(1, (w * dpr) / imgW, (h * dpr) / imgH);
  }, [imgW, imgH]);

  /** Keep the image from being dragged off screen; center any axis that fits. */
  const clamp = useCallback(
    (v: View): View => {
      const { w, h } = stageSize();
      const dpr = window.devicePixelRatio || 1;
      const dispW = (imgW * v.zoom) / dpr;
      const dispH = (imgH * v.zoom) / dpr;
      const mx = Math.max(0, (dispW - w) / 2);
      const my = Math.max(0, (dispH - h) / 2);
      return { ...v, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
    },
    [imgW, imgH],
  );

  const commit = useCallback(
    (v: View) => {
      const next = clamp(v);
      viewRef.current = next;
      setView(next);
    },
    [clamp],
  );

  /** Zoom keeping the image point under (cx, cy) — stage-relative CSS px — still. */
  const zoomAt = useCallback(
    (target: number, cx?: number, cy?: number) => {
      const v = viewRef.current;
      const { w, h } = stageSize();
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target));
      const px = (cx ?? w / 2) - w / 2;
      const py = (cy ?? h / 2) - h / 2;
      const k = z / v.zoom;
      commit({ zoom: z, x: px - (px - v.x) * k, y: py - (py - v.y) * k, fit: false });
    },
    [commit],
  );

  const toFit = useCallback(() => commit({ zoom: fitZoom(), x: 0, y: 0, fit: true }), [commit, fitZoom]);

  // New image or rotation: back to fit.
  useLayoutEffect(() => {
    toFit();
  }, [image.src, rotation, toFit]);

  // Window resize: fit keeps fitting, a manual zoom just re-clamps.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const v = viewRef.current;
      if (v.fit) commit({ zoom: fitZoom(), x: 0, y: 0, fit: true });
      else commit(v);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [commit, fitZoom]);

  useEffect(() => {
    onZoom(view.zoom, view.fit, fitZoom());
  }, [view, onZoom, fitZoom]);

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (f) => zoomAt(viewRef.current.zoom * f),
      setZoom: (z) => zoomAt(z),
      fit: toFit,
      actualSize: () => zoomAt(1),
      toggleFit: () => {
        const v = viewRef.current;
        if (v.fit && fitZoom() < 1) zoomAt(1);
        else toFit();
      },
    }),
    [zoomAt, toFit, fitZoom],
  );

  // Wheel zooms around the cursor. Passing through 100% snaps to it once.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      let z = v.zoom * Math.pow(1.0015, -delta);
      if ((v.zoom < 1 && z > 1) || (v.zoom > 1 && z < 1)) z = 1;
      const r = el.getBoundingClientRect();
      zoomAt(z, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Drag pans when the image is bigger than the window; otherwise (or with Ctrl) dragging
  // the picture drags the file out. Only the title bar moves the window.
  const drag = useRef<{
    sx: number;
    sy: number;
    vx: number;
    vy: number;
    moved: boolean;
    onImage: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);

  const pannable = () => {
    const v = viewRef.current;
    const { w, h } = stageSize();
    const dpr = window.devicePixelRatio || 1;
    return (imgW * v.zoom) / dpr > w + 0.5 || (imgH * v.zoom) / dpr > h + 0.5;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || overlay) return;
    const v = viewRef.current;
    const r = stageRef.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const halfW = (imgW * v.zoom) / dpr / 2;
    const halfH = (imgH * v.zoom) / dpr / 2;
    const px = e.clientX - r.left - r.width / 2 - v.x;
    const py = e.clientY - r.top - r.height / 2 - v.y;
    const onImage = Math.abs(px) <= halfW && Math.abs(py) <= halfH;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, onImage };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!(e.buttons & 1)) {
      drag.current = null;
      setPanning(false);
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      if (e.ctrlKey || !pannable()) {
        const onImage = d.onImage;
        drag.current = null;
        if (onImage) onDragOut?.();
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setPanning(true);
    }
    commit({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
  };

  const onPointerUp = () => {
    drag.current = null;
    setPanning(false);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (onDouble) return onDouble();
    const v = viewRef.current;
    if (v.fit && fitZoom() < 1) {
      const r = stageRef.current!.getBoundingClientRect();
      zoomAt(1, e.clientX - r.left, e.clientY - r.top);
    } else {
      toFit();
    }
  };

  const dpr = window.devicePixelRatio || 1;
  // CSS size of the unrotated element; rotation is applied by transform.
  const cssW = (image.width * view.zoom) / dpr;
  const cssH = (image.height * view.zoom) / dpr;

  return (
    <div
      ref={stageRef}
      className={`stage${panning ? " panning" : ""}${pannable() ? " pannable" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={overlay ? undefined : onDoubleClick}
    >
      <img
        key={image.src}
        className={`stage-img${checker ? " checker" : ""}${view.zoom >= 2 ? " pixelated" : ""}`}
        src={image.src}
        crossOrigin="anonymous"
        alt=""
        draggable={false}
        style={{
          width: cssW,
          height: cssH,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${rotation}deg)`,
        }}
      />
      {overlay
        ? overlay({
            left: stageSize().w / 2 + view.x - cssW / 2,
            top: stageSize().h / 2 + view.y - cssH / 2,
            width: cssW,
            height: cssH,
          })
        : null}
    </div>
  );
});
