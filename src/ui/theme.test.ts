import { describe, expect, it } from 'vitest';
import { resolveTheme } from '@/ui/theme';

describe('theme helpers', () => {
  it('passes follow, light, and dark through as the data-theme value', () => {
    expect(resolveTheme('follow')).toBe('follow');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});
