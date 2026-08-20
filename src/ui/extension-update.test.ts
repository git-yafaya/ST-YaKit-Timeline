import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkExtensionUpdate, updateExtension } from '@/ui/extension-update';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extension update service', () => {
  it('checks the installed extension version through SillyTavern', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      currentBranchName: 'master',
      currentCommitHash: 'local-hash',
      isUpToDate: false,
      remoteUrl: 'https://example.test/YaKit-Timeline.git',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkExtensionUpdate()).resolves.toEqual({
      extensionName: 'ST-YaKit-Timeline',
      isUpToDate: false,
      remoteUrl: 'https://example.test/YaKit-Timeline.git',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/version', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ extensionName: 'ST-YaKit-Timeline', global: false }),
    }));
  });

  it('tries the technical extension name when the installed directory name differs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ isUpToDate: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkExtensionUpdate()).resolves.toMatchObject({
      extensionName: 'YaKit-Timeline',
      isUpToDate: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('updates only after the caller requests it and returns the host commit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      isUpToDate: false,
      shortCommitHash: 'abc1234',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateExtension('ST-YaKit-Timeline')).resolves.toEqual({
      isUpToDate: false,
      shortCommitHash: 'abc1234',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/extensions/update', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ extensionName: 'ST-YaKit-Timeline', global: false }),
    }));
  });
});
