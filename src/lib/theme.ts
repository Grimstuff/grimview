import { invoke } from "@tauri-apps/api/core";

/** Follow Windows light/dark. No theme picker, same as Grimpad. */
export function initSystemTheme(): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
  };
  apply();
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}

interface AccentColors {
  background: string;
  foreground: string;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function darkenHex(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const f = 1 - amount;
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * f)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(0, 120, 212, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function applyAccent({ background: bg, foreground: fg }: AccentColors) {
  const root = document.documentElement;
  root.style.setProperty("--gp-accent", bg);
  root.style.setProperty("--gp-accent-hover", darkenHex(bg, 0.12));
  root.style.setProperty("--gp-accent-fg", fg);
  root.style.setProperty("--gp-focus-ring", hexToRgba(bg, 0.45));
  root.style.setProperty("--gp-accent-soft", hexToRgba(bg, 0.16));
  root.style.setProperty("--gp-accent-soft-strong", hexToRgba(bg, 0.28));
}

/** Windows accent from the registry; refreshed on focus in case Colors changed. */
export function initSystemAccent(): () => void {
  let cancelled = false;
  const refresh = async () => {
    try {
      const colors = await invoke<AccentColors>("get_system_accent");
      if (!cancelled) applyAccent(colors);
    } catch {
      /* browser preview */
    }
  };
  void refresh();
  window.addEventListener("focus", refresh);
  return () => {
    cancelled = true;
    window.removeEventListener("focus", refresh);
  };
}
