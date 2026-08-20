import { afterEach, describe, expect, it } from 'vitest';
import { TimelineControlLock } from '@/timeline/control-lock';

const locks: TimelineControlLock[] = [];

afterEach(() => {
  for (const lock of locks.splice(0)) lock.close();
});

describe('timeline control lock', () => {
  it('同一世界书只允许一个标签页持有控制权，并支持明确接管', async () => {
    const channel = `timeline-test-${Date.now()}-${Math.random()}`;
    const first = new TimelineControlLock(channel);
    const second = new TimelineControlLock(channel);
    locks.push(first, second);

    await expect(first.acquire('book')).resolves.toBe(true);
    await expect(second.acquire('book')).resolves.toBe(false);
    expect(first.hasControl('book')).toBe(true);

    expect(second.takeover('book')).toBe(true);
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    expect(second.hasControl('book')).toBe(true);
    expect(first.hasControl('book')).toBe(false);
  });
});
