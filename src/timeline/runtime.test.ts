import { describe, expect, it } from 'vitest';
import {
  applyStoryTimeCandidate,
  confirmStoryTimeRollback,
  parseLastAssistantWlog,
  rejectStoryTimeRollback,
  restoreChatTimelineState,
} from '@/timeline/runtime';
import { createChatTimelineState, type ChatTimelineState } from '@/storage/chat-state';
import type { StoryTime } from '@/timeline/types';

const time = (year: number, month: number, day: number, hour = 12, minute = 0): StoryTime => ({
  year,
  month,
  day,
  hour,
  minute,
  raw: `${year}年${month}月${day}日/${hour}:${minute}`,
});

const emptyState = (currentTime?: StoryTime): ChatTimelineState => ({
  ...(currentTime ? { currentTime } : {}),
  groups: {},
  logs: [],
  worldbookKey: 'book',
});

describe('chat timeline runtime', () => {
  it('只从最后一条 AI 消息恢复，不回溯更早消息', () => {
    expect(parseLastAssistantWlog([
      { is_user: false, is_system: false, mes: '<wlog time="424年5月14日">旧</wlog>' },
      { is_user: true, is_system: false, mes: '用户消息' },
    ])).toBeNull();
    expect(parseLastAssistantWlog([
      { is_user: false, is_system: false, mes: '<wlog time="424年5月14日">旧</wlog>' },
      { is_user: false, is_system: false, mes: '<wlog time="424年5月15日">新</wlog>' },
    ])).toMatchObject({ year: 424, month: 5, day: 15 });
  });

  it('metadata 有效时间优先于末条正文，未初始化时才恢复正文', () => {
    const metadata = restoreChatTimelineState({
      existing: emptyState(time(424, 5, 14)),
      groupIds: ['main'],
      lastAssistantTime: time(424, 5, 20),
      worldbookKey: 'book',
    });
    expect(metadata.source).toBe('metadata');
    expect(metadata.state.currentTime).toMatchObject({ day: 14 });
    expect(metadata.state.groups.main.mode).toBe('auto');

    const recovered = restoreChatTimelineState({
      existing: emptyState(),
      groupIds: ['main'],
      lastAssistantTime: time(424, 5, 20),
      worldbookKey: 'book',
    });
    expect(recovered.source).toBe('last_ai');
    expect(recovered.state.currentTime).toMatchObject({ day: 20 });
    expect(recovered.shouldPersist).toBe(true);
  });

  it('首次时间和同日时间只更新聊天状态', () => {
    const initial = applyStoryTimeCandidate(emptyState(), time(424, 5, 14, 17, 15));
    expect(initial.kind).toBe('initial');
    expect(initial.state.currentTime).toMatchObject({ hour: 17, minute: 15 });

    const sameDate = applyStoryTimeCandidate(initial.state, time(424, 5, 14, 21, 40));
    expect(sameDate.kind).toBe('same_date');
    expect(sameDate.jumpDays).toBe(0);
    expect(sameDate.state.currentTime).toMatchObject({ hour: 21, minute: 40 });
  });

  it('时间倒退进入待确认状态，确认或拒绝都不会猜测', () => {
    const current = emptyState(time(424, 5, 14));
    const pending = applyStoryTimeCandidate(current, time(424, 5, 12));
    expect(pending.kind).toBe('pending_rollback');
    expect(pending.state.currentTime).toMatchObject({ day: 14 });
    expect(pending.state.pendingRollback).toMatchObject({ from: { day: 14 }, to: { day: 12 } });

    const rejected = rejectStoryTimeRollback(pending.state);
    expect(rejected.currentTime).toMatchObject({ day: 14 });
    expect(rejected.pendingRollback).toBeUndefined();

    const confirmed = confirmStoryTimeRollback(pending.state);
    expect(confirmed.currentTime).toMatchObject({ day: 12 });
    expect(confirmed.pendingRollback).toBeUndefined();
  });

  it('待确认倒退期间阻止新的日期覆盖', () => {
    const pending = applyStoryTimeCandidate(emptyState(time(424, 5, 14)), time(424, 5, 12));
    const blocked = applyStoryTimeCandidate(pending.state, time(424, 5, 20));
    expect(blocked.kind).toBe('blocked_by_pending_rollback');
    expect(blocked.state.currentTime).toMatchObject({ day: 14 });
  });
});
