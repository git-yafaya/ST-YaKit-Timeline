import type { ThemeMode } from '@/ui/pages/settings';

export type ResolvedTheme = Exclude<ThemeMode, 'follow'>;

interface RgbColor {
  blue: number;
  green: number;
  red: number;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function parseRgbChannel(value: string): number | null {
  const normalized = value.trim();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  return clampChannel(normalized.endsWith('%') ? (parsed / 100) * 255 : parsed);
}

export function parseCssColor(value: string): RgbColor | null {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const channels = hex.length === 3
      ? [...hex].map(channel => Number.parseInt(channel + channel, 16))
      : [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
    return { red: channels[0], green: channels[1], blue: channels[2] };
  }

  const rgb = normalized.match(/^rgba?\((.*)\)$/)?.[1];
  if (!rgb) return null;
  const channels = rgb.replace('/', ' ').split(/[\s,]+/).filter(Boolean).slice(0, 3).map(parseRgbChannel);
  if (channels.length !== 3 || channels.some(channel => channel === null)) return null;
  return { red: channels[0]!, green: channels[1]!, blue: channels[2]! };
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function classifyThemeFromColor(value: string): ResolvedTheme | null {
  const color = parseCssColor(value);
  if (!color) return null;
  const luminance = 0.2126 * linearize(color.red) + 0.7152 * linearize(color.green) + 0.0722 * linearize(color.blue);
  return luminance >= 0.45 ? 'light' : 'dark';
}

export function resolveTheme(preference: ThemeMode, hostTheme: ResolvedTheme): ResolvedTheme {
  return preference === 'follow' ? hostTheme : preference;
}

export function detectSillyTavernTheme(
  targetDocument: Document = document,
  targetWindow: Window = window,
): ResolvedTheme {
  const rootStyle = targetWindow.getComputedStyle(targetDocument.documentElement);
  const bodyStyle = targetDocument.body ? targetWindow.getComputedStyle(targetDocument.body) : null;
  const candidates = [
    rootStyle.getPropertyValue('--SmartThemeBlurTintColor'),
    bodyStyle?.backgroundColor ?? '',
    rootStyle.backgroundColor,
  ];

  for (const candidate of candidates) {
    const theme = classifyThemeFromColor(candidate);
    if (theme) return theme;
  }

  return targetWindow.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function watchSillyTavernTheme(
  onChange: (theme: ResolvedTheme) => void,
  targetDocument: Document = document,
  targetWindow: Window = window,
): () => void {
  let queued = false;
  const sync = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      onChange(detectSillyTavernTheme(targetDocument, targetWindow));
    });
  };

  const observer = new MutationObserver(sync);
  observer.observe(targetDocument.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  if (targetDocument.body) {
    observer.observe(targetDocument.body, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  const media = targetWindow.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', sync);
  targetWindow.addEventListener('focus', sync);
  targetDocument.addEventListener('visibilitychange', sync);
  sync();

  return () => {
    observer.disconnect();
    media?.removeEventListener?.('change', sync);
    targetWindow.removeEventListener('focus', sync);
    targetDocument.removeEventListener('visibilitychange', sync);
  };
}
