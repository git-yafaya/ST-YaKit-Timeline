export type ControlStatus = 'available' | 'other' | 'owner' | 'unsupported';

type ControlMessage =
  | { at: number; key: string; ownerId: string; type: 'claim' | 'heartbeat' | 'release' | 'takeover' }
  | { at: number; key: string; ownerId: string; type: 'busy' };

interface ObservedOwner {
  lastSeen: number;
  ownerId: string;
}

const OWNER_TTL_MS = 6_000;
const HEARTBEAT_MS = 2_000;
const CLAIM_WINDOW_MS = 80;

function makeOwnerId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Some embedded webviews expose crypto but not randomUUID.
  }
  return `timeline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isControlMessage(value: unknown): value is ControlMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Partial<ControlMessage>;
  return (
    typeof message.type === 'string' &&
    ['claim', 'heartbeat', 'release', 'takeover', 'busy'].includes(message.type) &&
    typeof message.key === 'string' &&
    typeof message.ownerId === 'string' &&
    typeof message.at === 'number'
  );
}

/**
 * 通过 BroadcastChannel 协调同一世界书的写控制权。
 * 不使用 localStorage 或聊天元数据，控制权只存在于当前标签页与广播心跳中。
 */
export class TimelineControlLock {
  readonly ownerId: string;
  private readonly channel: BroadcastChannel | null;
  private readonly observed = new Map<string, ObservedOwner>();
  private readonly listeners = new Set<(key: string, status: ControlStatus) => void>();
  private readonly claimingKeys = new Set<string>();
  private currentKey = '';
  private heartbeatTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  private closed = false;

  constructor(channelName = 'st-yafaya-timeline-control') {
    this.ownerId = makeOwnerId();
    this.channel = typeof globalThis.BroadcastChannel === 'function'
      ? new globalThis.BroadcastChannel(channelName)
      : null;
    if (this.channel) this.channel.addEventListener('message', this.onMessage);
  }

  onChange(listener: (key: string, status: ControlStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(key: string): ControlStatus {
    if (!this.channel) return this.currentKey === key ? 'owner' : 'unsupported';
    if (this.currentKey === key) return 'owner';
    const owner = this.activeOwner(key);
    return owner ? 'other' : 'available';
  }

  hasControl(key: string): boolean {
    return Boolean(key) && this.currentKey === key;
  }

  async acquire(key: string): Promise<boolean> {
    if (this.closed || !key) return false;
    if (this.currentKey === key) return true;
    this.release();

    if (!this.channel) {
      this.currentKey = key;
      this.notify(key);
      return true;
    }
    if (this.activeOwner(key)) {
      this.notify(key);
      return false;
    }

    this.claimingKeys.add(key);
    this.post({ type: 'claim', key, ownerId: this.ownerId, at: Date.now() });
    await new Promise<void>(resolve => globalThis.setTimeout(resolve, CLAIM_WINDOW_MS));
    this.claimingKeys.delete(key);
    if (this.closed || this.activeOwner(key)) {
      this.notify(key);
      return false;
    }
    this.currentKey = key;
    this.startHeartbeat();
    this.post({ type: 'heartbeat', key, ownerId: this.ownerId, at: Date.now() });
    this.notify(key);
    return true;
  }

  takeover(key: string): boolean {
    if (this.closed || !key) return false;
    this.release();
    this.currentKey = key;
    this.observed.delete(key);
    this.startHeartbeat();
    this.post({ type: 'takeover', key, ownerId: this.ownerId, at: Date.now() });
    this.notify(key);
    return true;
  }

  release(): void {
    if (!this.currentKey) return;
    const key = this.currentKey;
    this.post({ type: 'release', key, ownerId: this.ownerId, at: Date.now() });
    this.currentKey = '';
    this.stopHeartbeat();
    this.notify(key);
  }

  close(): void {
    if (this.closed) return;
    this.release();
    this.closed = true;
    this.channel?.removeEventListener('message', this.onMessage);
    this.channel?.close();
    this.listeners.clear();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (!isControlMessage(event.data)) return;
    const message = event.data;
    if (message.ownerId === this.ownerId) return;
    if (message.type === 'release') {
      const owner = this.observed.get(message.key);
      if (owner?.ownerId === message.ownerId) this.observed.delete(message.key);
      this.notify(message.key);
      return;
    }

    if (message.type === 'takeover') {
      this.observed.set(message.key, { ownerId: message.ownerId, lastSeen: message.at });
      if (this.currentKey === message.key) {
        this.currentKey = '';
        this.stopHeartbeat();
      }
      this.notify(message.key);
      return;
    }

    if (message.type === 'claim' && this.currentKey === message.key) {
      this.observed.set(message.key, { ownerId: message.ownerId, lastSeen: message.at });
      this.post({ type: 'busy', key: message.key, ownerId: this.ownerId, at: Date.now() });
    } else if (message.type === 'claim' && this.claimingKeys.has(message.key)) {
      // 同时发起 claim 时用稳定 ownerId 决胜，避免两边都放弃或都认为自己获胜。
      if (message.ownerId < this.ownerId) {
        this.observed.set(message.key, { ownerId: message.ownerId, lastSeen: message.at });
      } else {
        this.post({ type: 'busy', key: message.key, ownerId: this.ownerId, at: Date.now() });
      }
    } else {
      this.observed.set(message.key, { ownerId: message.ownerId, lastSeen: message.at });
    }
    this.notify(message.key);
  };

  private activeOwner(key: string): ObservedOwner | null {
    const owner = this.observed.get(key);
    if (!owner || Date.now() - owner.lastSeen > OWNER_TTL_MS) {
      if (owner) this.observed.delete(key);
      return null;
    }
    return owner;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = globalThis.setInterval(() => {
      if (!this.currentKey) return;
      this.post({ type: 'heartbeat', key: this.currentKey, ownerId: this.ownerId, at: Date.now() });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return;
    globalThis.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private post(message: ControlMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed BroadcastChannel must never break the timeline UI.
    }
  }

  private notify(key: string): void {
    const status = this.status(key);
    for (const listener of this.listeners) listener(key, status);
  }
}

export function worldbookControlChannelName(worldbookKey: string): string {
  return `st-yafaya-timeline-control:${worldbookKey}`;
}
