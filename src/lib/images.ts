import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface FileInfo {
  size: number;
  mtimeMs: number | null;
}

export interface LoadedImage {
  path: string;
  src: string;
  width: number;
  height: number;
  size: number;
  /** SVG without intrinsic size: width/height are a stand-in. */
  sizeless: boolean;
}

/** Served by the `gv` protocol in lib.rs. `decode` forces the Rust decoder. */
export function imageUrl(path: string, opts: { decode?: boolean; stamp?: number | null } = {}): string {
  const q: string[] = [];
  if (opts.decode) q.push("decode=1");
  if (opts.stamp) q.push(`t=${opts.stamp}`);
  const base = convertFileSrc(path, "gv");
  return q.length ? `${base}?${q.join("&")}` : base;
}

function loadElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      img
        .decode()
        .catch(() => undefined)
        .then(() => resolve(img));
    };
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
}

async function errorText(src: string): Promise<string> {
  try {
    const res = await fetch(src);
    if (!res.ok) return (await res.text()) || `Error ${res.status}`;
  } catch {
    /* fall through */
  }
  return "This image could not be displayed.";
}

/**
 * Load through WebView2 first (fast, keeps animation). If WebView2 cannot decode it
 * (odd BMP, CMYK edge cases), retry through the Rust decoder before giving up.
 */
export async function loadImage(path: string): Promise<LoadedImage> {
  let info: FileInfo;
  try {
    info = await invoke<FileInfo>("get_file_info", { path });
  } catch {
    throw new Error("The file could not be found.");
  }
  const stamp = info.mtimeMs;
  let src = imageUrl(path, { stamp });
  let img: HTMLImageElement;
  try {
    img = await loadElement(src);
  } catch {
    src = imageUrl(path, { stamp, decode: true });
    try {
      img = await loadElement(src);
    } catch {
      throw new Error(await errorText(src));
    }
  }
  const sizeless = !img.naturalWidth || !img.naturalHeight;
  return {
    path,
    src,
    width: sizeless ? 800 : img.naturalWidth,
    height: sizeless ? 600 : img.naturalHeight,
    size: info.size,
    sizeless,
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Siblings in Explorer-like natural order. */
export async function listFolder(path: string): Promise<string[]> {
  try {
    const files = await invoke<string[]>("list_folder_images", { path });
    return files.sort((a, b) => collator.compare(fileName(a), fileName(b)));
  } catch {
    return [path];
  }
}

export function samePath(a: string, b: string): boolean {
  return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** PNG of the image onto the clipboard (needs the CORS header from lib.rs). */
export async function copyImageToClipboard(img: LoadedImage): Promise<void> {
  const el = await loadElement(img.src);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/png"),
  );
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
