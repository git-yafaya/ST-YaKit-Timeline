import type { ThemeMode } from '@/ui/pages/settings';

/** 主题偏好直接作为插件外层 data-theme，让 follow 由 SillyTavern 的 Token 决定。 */
export function resolveTheme(preference: ThemeMode): ThemeMode {
  return preference;
}
