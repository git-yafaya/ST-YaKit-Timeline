import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_CHAT_METADATA_KEY } from '@/branding';
import {
  CHAT_TIMELINE_METADATA_KEY,
  appendChatRuntimeLog,
  createChatTimelineState,
  isChatTimelineState,
  loadChatTimelineState,
  saveChatTimelineState,
} from '@/storage/chat-state';
import type { ChatTimelineState } from '@/storage/chat-state';

function installContext(chatMetadata: Record<string, unknown>, updateChatMetadata = (values: Record<string, unknown>) => {
  Object.assign(chatMetadata, values);
}, saveMetadataDebounced = vi.fn()): void {
  Object.defineProperty(globalThis, 'SillyTavern', {
    configurable: true,
    value: {
      getContext: () => ({ chatMetadata, updateChatMetadata, saveMetadataDebounced }),
    },
    writable: true,
  });
}

afterEach(() => {
  globalThis.SillyTavern = undefined;
});

const validState = (): ChatTimelineState => ({
  currentTime: { year: 424, month: 5, day: 14, raw: '424年5月14日' },
  groups: {
    main: { manualEnabledEntryIds: [1], mode: 'auto' },
  },
  logs: [],
  worldbookKey: 'book',
});

describe('chat timeline storage', () => {
  it('严格读取合法状态并拒绝损坏状态', () => {
    const metadata = { [CHAT_TIMELINE_METADATA_KEY]: validState() };
    installContext(metadata);
    expect(loadChatTimelineState()).toEqual(validState());

    metadata[CHAT_TIMELINE_METADATA_KEY] = {
      ...validState(),
      currentTime: { year: 424, month: 2, day: 30, raw: 'invalid' },
    };
    expect(loadChatTimelineState()).toBeNull();
  });

  it('只更新插件命名空间并通过宿主元数据保存接口持久化', () => {
    const metadata: Record<string, unknown> = { unrelated: 'keep' };
    const saveMetadataDebounced = vi.fn();
    installContext(metadata, undefined, saveMetadataDebounced);

    expect(saveChatTimelineState(validState())).toBe(true);
    expect(metadata.unrelated).toBe('keep');
    expect(metadata[CHAT_TIMELINE_METADATA_KEY]).toEqual(validState());
    expect(saveMetadataDebounced).toHaveBeenCalledOnce();
  });

  it('兼容读取旧聊天键，并在保存时迁移到新键', () => {
    const metadata: Record<string, unknown> = { [LEGACY_CHAT_METADATA_KEY]: validState() };
    installContext(metadata, undefined, vi.fn());

    expect(loadChatTimelineState()).toEqual(validState());
    expect(saveChatTimelineState(validState())).toBe(true);
    expect(metadata[CHAT_TIMELINE_METADATA_KEY]).toEqual(validState());
    expect(metadata[LEGACY_CHAT_METADATA_KEY]).toBeUndefined();
  });

  it('运行日志最多保留最近 100 条', () => {
    let state = createChatTimelineState('book');
    for (let index = 0; index < 101; index += 1) {
      state = appendChatRuntimeLog(state, {
        category: 'timeline',
        description: `log-${index}`,
        id: String(index),
        level: 'info',
        occurredAt: '2026-08-20T00:00:00.000Z',
        title: '测试',
      });
    }
    expect(state.logs).toHaveLength(100);
    expect(state.logs[0].id).toBe('1');
    expect(isChatTimelineState(state)).toBe(true);
  });
});
