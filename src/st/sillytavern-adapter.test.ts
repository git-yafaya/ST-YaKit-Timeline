import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseWorldInfoEntries,
  readCurrentHostScope,
  readLastAssistantMessageText,
  watchCurrentHostRuntime,
  watchCurrentHostScope,
} from '@/st/sillytavern-adapter';

function installContext(context: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'SillyTavern', {
    configurable: true,
    value: { getContext: () => context },
    writable: true,
  });
}

function character(world?: string) {
  return {
    name: '测试角色',
    avatar: 'test.png',
    data: { extensions: { world } },
  };
}

afterEach(() => {
  globalThis.SillyTavern = undefined;
});

describe('read-only SillyTavern adapter', () => {
  it('parses native disable flags without exposing mutable source records', () => {
    const source = {
      entries: {
        7: { uid: 7, comment: '阶段一', content: '正文一', disable: false },
        9: { uid: 'custom-id', comment: '阶段二', content: '正文二', disable: true },
      },
    };

    expect(parseWorldInfoEntries(source)).toEqual([
      { id: 7, comment: '阶段一', content: '正文一', enabled: true },
      { id: 'custom-id', comment: '阶段二', content: '正文二', enabled: false },
    ]);
  });

  it('returns unavailable when the SillyTavern context cannot be read', async () => {
    await expect(readCurrentHostScope()).resolves.toMatchObject({
      status: 'unavailable',
      character: null,
      worldbook: null,
    });
  });

  it('stops safely when no current character is selected', async () => {
    installContext({ characterId: undefined, characters: [], chatId: 'chat-a' });

    await expect(readCurrentHostScope()).resolves.toMatchObject({
      status: 'no_character',
      chatId: 'chat-a',
      worldbook: null,
    });
  });

  it('does not guess a worldbook when the current character has no primary binding', async () => {
    const loadWorldInfo = vi.fn();
    installContext({
      characterId: 0,
      characters: [character()],
      chatId: 'chat-a',
      loadWorldInfo,
      selectedWorldInfo: ['unrelated-global-book'],
    });

    await expect(readCurrentHostScope()).resolves.toMatchObject({
      status: 'no_worldbook',
      character: { name: '测试角色' },
      worldbook: null,
    });
    expect(loadWorldInfo).not.toHaveBeenCalled();
  });

  it('loads only the exact primary worldbook bound to the current character', async () => {
    const loadWorldInfo = vi.fn().mockResolvedValue({
      entries: {
        3: { uid: 3, comment: '第一幕', content: '内容', disable: false },
      },
    });
    installContext({
      characterId: 0,
      characters: [character('角色主世界书')],
      chatId: 'chat-a',
      loadWorldInfo,
      getWorldInfoNames: () => ['全局世界书', '角色主世界书'],
    });

    await expect(readCurrentHostScope()).resolves.toEqual({
      status: 'ready',
      message: '',
      chatId: 'chat-a',
      character: { id: 'test.png', name: '测试角色', avatar: 'test.png' },
      worldbook: {
        key: '角色主世界书',
        name: '角色主世界书',
        entries: [{ id: 3, comment: '第一幕', content: '内容', enabled: true }],
      },
    });
    expect(loadWorldInfo).toHaveBeenCalledOnce();
    expect(loadWorldInfo).toHaveBeenCalledWith('角色主世界书');
  });

  it('reports an unreadable bound worldbook without falling back to another book', async () => {
    const loadWorldInfo = vi.fn().mockResolvedValue(null);
    installContext({
      characterId: 0,
      characters: [character('已丢失世界书')],
      loadWorldInfo,
    });

    await expect(readCurrentHostScope()).resolves.toMatchObject({
      status: 'worldbook_unreadable',
      character: { name: '测试角色' },
      worldbook: null,
    });
    expect(loadWorldInfo).toHaveBeenCalledWith('已丢失世界书');
  });

  it('subscribes to scope-changing host events and removes the same listeners', () => {
    const on = vi.fn();
    const removeListener = vi.fn();
    installContext({
      eventSource: { on, removeListener },
      eventTypes: {
        APP_READY: 'ready',
        CHAT_CHANGED: 'chat',
        CHARACTER_EDITED: 'character',
        WORLDINFO_UPDATED: 'worldbook',
      },
    });
    const listener = vi.fn();

    const stop = watchCurrentHostScope(listener);
    expect(on.mock.calls.map(call => call[0])).toEqual(['ready', 'chat', 'character', 'worldbook']);

    stop();
    expect(removeListener.mock.calls.map(call => call[0])).toEqual(['ready', 'chat', 'character', 'worldbook']);
  });

  it('只读取当前聊天最后一条 AI 消息', () => {
    installContext({
      chat: [
        { is_user: false, is_system: false, mes: '旧 AI 消息' },
        { is_user: true, is_system: false, mes: '用户消息' },
      ],
    });
    expect(readLastAssistantMessageText()).toBeNull();

    installContext({
      chat: [
        { is_user: false, is_system: false, mes: '旧 AI 消息' },
        { is_user: false, is_system: false, mes: '最新 AI 消息' },
      ],
    });
    expect(readLastAssistantMessageText()).toBe('最新 AI 消息');
  });

  it('监听完成的 AI 消息事件并移除同一监听器', () => {
    const on = vi.fn();
    const removeListener = vi.fn();
    installContext({
      eventSource: { on, removeListener },
      eventTypes: { MESSAGE_RECEIVED: 'message_received' },
    });
    const listener = vi.fn();

    const stop = watchCurrentHostRuntime(listener);
    expect(on).toHaveBeenCalledWith('message_received', expect.any(Function));
    const registered = on.mock.calls[0][1] as () => void;
    registered();
    expect(listener).toHaveBeenCalledOnce();

    stop();
    expect(removeListener).toHaveBeenCalledWith('message_received', registered);
  });
});
