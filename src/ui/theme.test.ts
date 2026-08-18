import { describe, expect, it } from 'vitest';
import { classifyThemeFromColor, parseCssColor, resolveTheme } from '@/ui/theme';

describe('theme helpers', () => {
  it('parses SillyTavern rgba and hex theme colors', () => {
    expect(parseCssColor('rgba(15, 23, 42, 0.82)')).toEqual({ red: 15, green: 23, blue: 42 });
    expect(parseCssColor('#f8fafc')).toEqual({ red: 248, green: 250, blue: 252 });
    expect(parseCssColor('#fff')).toEqual({ red: 255, green: 255, blue: 255 });
  });

  it('classifies host backgrounds by luminance', () => {
    expect(classifyThemeFromColor('rgb(15 23 42)')).toBe('dark');
    expect(classifyThemeFromColor('rgb(248, 250, 252)')).toBe('light');
    expect(classifyThemeFromColor('transparent')).toBeNull();
  });

  it('maps follow to the host theme and preserves manual choices', () => {
    expect(resolveTheme('follow', 'dark')).toBe('dark');
    expect(resolveTheme('follow', 'light')).toBe('light');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });
});
