import { compareStoryDates, differenceInStoryDays } from '@/timeline/date';
import { parseWlogTime } from '@/timeline/wlog';
import {
  bindChatTimelineState,
  createChatTimelineState,
  type ChatTimelineState,
} from '@/storage/chat-state';
import type { StoryTime } from '@/timeline/types';

export type ChatStateRestoreSource = 'metadata' | 'last_ai' | 'none';

export interface ChatStateRestoreOptions {
  existing: ChatTimelineState | null;
  groupIds: readonly string[];
  lastAssistantTime: StoryTime | null;
  worldbookKey: string | null;
}

export interface ChatStateRestoreResult {
  shouldPersist: boolean;
  source: ChatStateRestoreSource;
  state: ChatTimelineState;
}

export type StoryTimeApplyResult =
  | {
      kind: 'initial' | 'same_date' | 'forward' | 'unchanged';
      state: ChatTimelineState;
      jumpDays: number;
    }
  | {
      kind: 'pending_rollback';
      state: ChatTimelineState;
      jumpDays: number;
    }
  | {
      kind: 'blocked_by_pending_rollback';
      state: ChatTimelineState;
      jumpDays: 0;
    };

function cloneStoryTime(time: StoryTime): StoryTime {
  return time.hour === undefined || time.minute === undefined
    ? { year: time.year, month: time.month, day: time.day, raw: time.raw }
    : {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      raw: time.raw,
    };
}

function sameStoryTime(left: StoryTime, right: StoryTime): boolean {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute;
}

function stateSnapshot(state: ChatTimelineState): string {
  return JSON.stringify(state);
}

export function parseLastAssistantWlog(messages: readonly unknown[]): StoryTime | null {
  const lastMessage = messages.at(-1);
  if (!lastMessage || typeof lastMessage !== 'object' || Array.isArray(lastMessage)) return null;

  const message = lastMessage as { is_user?: unknown; is_system?: unknown; mes?: unknown };
  if (message.is_user !== false || message.is_system === true || typeof message.mes !== 'string') return null;
  return parseWlogTime(message.mes);
}

export function restoreChatTimelineState(options: ChatStateRestoreOptions): ChatStateRestoreResult {
  const initial = options.existing
    ? options.existing
    : createChatTimelineState(options.worldbookKey, options.groupIds);
  const bound = bindChatTimelineState(initial, options.worldbookKey, options.groupIds);

  if (bound.currentTime) {
    return {
      shouldPersist: options.existing !== null && stateSnapshot(bound) !== stateSnapshot(options.existing),
      source: 'metadata',
      state: bound,
    };
  }

  if (options.lastAssistantTime) {
    return {
      shouldPersist: true,
      source: 'last_ai',
      state: {
        ...bound,
        currentTime: cloneStoryTime(options.lastAssistantTime),
        pendingRollback: undefined,
      },
    };
  }

  return {
    shouldPersist: options.existing !== null && stateSnapshot(bound) !== stateSnapshot(options.existing),
    source: 'none',
    state: bound,
  };
}

export function applyStoryTimeCandidate(
  state: ChatTimelineState,
  nextTime: StoryTime,
): StoryTimeApplyResult {
  if (!state.currentTime) {
    return {
      kind: 'initial',
      state: { ...state, currentTime: cloneStoryTime(nextTime), pendingRollback: undefined },
      jumpDays: 0,
    };
  }

  if (state.pendingRollback) {
    if (sameStoryTime(state.currentTime, nextTime)) {
      return { kind: 'unchanged', state, jumpDays: 0 };
    }
    return { kind: 'blocked_by_pending_rollback', state, jumpDays: 0 };
  }

  const dateOrder = compareStoryDates(nextTime, state.currentTime);
  if (dateOrder < 0) {
    return {
      kind: 'pending_rollback',
      state: {
        ...state,
        pendingRollback: {
          from: cloneStoryTime(state.currentTime),
          to: cloneStoryTime(nextTime),
        },
      },
      jumpDays: differenceInStoryDays(nextTime, state.currentTime),
    };
  }

  const nextState = {
    ...state,
    currentTime: cloneStoryTime(nextTime),
    pendingRollback: undefined,
  };
  if (dateOrder === 0) {
    return {
      kind: sameStoryTime(state.currentTime, nextTime) ? 'unchanged' : 'same_date',
      state: nextState,
      jumpDays: 0,
    };
  }

  return {
    kind: 'forward',
    state: nextState,
    jumpDays: differenceInStoryDays(state.currentTime, nextTime),
  };
}

export function confirmStoryTimeRollback(state: ChatTimelineState): ChatTimelineState {
  if (!state.pendingRollback) return state;
  return {
    ...state,
    currentTime: cloneStoryTime(state.pendingRollback.to),
    pendingRollback: undefined,
  };
}

export function rejectStoryTimeRollback(state: ChatTimelineState): ChatTimelineState {
  if (!state.pendingRollback) return state;
  return { ...state, pendingRollback: undefined };
}
