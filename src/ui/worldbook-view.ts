import type { WorldbookSnapshot } from '@/st/sillytavern-adapter';
import type { ChatGroupState } from '@/storage/chat-state';
import type { ManagedTimelineEntry, WorldbookTimelineConfig } from '@/storage/worldbook-config';
import type { OverviewGroupSummary } from '@/ui/pages/overview';
import type { TimelineGroupDetail } from '@/ui/pages/timeline';

function rangeLabel(entry: ManagedTimelineEntry): string {
  return `${entry.effectiveStartDate} ～ ${entry.effectiveEndDate ?? '∞'}`;
}

function entryWarning(entry: ManagedTimelineEntry, sourceExists: boolean): string | undefined {
  if (!sourceExists) return '原世界书条目已不存在，已停止使用该映射。';
  if (entry.stale) return '世界书正文已修改，当前配置可能已过期。';
  return entry.warnings[0];
}

export function buildOverviewGroupSummaries(
  config: WorldbookTimelineConfig | null,
  worldbook: WorldbookSnapshot | null,
  groupStates: Readonly<Record<string, ChatGroupState>> = {},
): OverviewGroupSummary[] {
  if (!config || !worldbook || config.worldbookKey !== worldbook.key) return [];
  const sources = new Map(worldbook.entries.map(entry => [String(entry.id), entry]));
  return config.groups.map(group => {
    const enabledEntries = group.entries.filter(entry => sources.get(String(entry.entryId))?.enabled);
    const warningEntry = group.entries.find(entry => !sources.has(String(entry.entryId)) || entry.stale || entry.warnings.length > 0);
    const warning = group.blockReason || (warningEntry ? entryWarning(warningEntry, Boolean(sources.get(String(warningEntry.entryId)))) : undefined);
    const active = enabledEntries.length === 1 ? enabledEntries[0] : undefined;
    return {
      id: group.id,
      kind: 'route',
      mode: groupStates[group.id]?.mode ?? 'auto',
      name: group.name,
      warning,
      activeEntry: active ? {
        entryId: active.entryId,
        rangeLabel: rangeLabel(active),
        title: active.displayTitle,
      } : undefined,
    };
  });
}

export function buildTimelineGroupDetails(
  config: WorldbookTimelineConfig | null,
  worldbook: WorldbookSnapshot | null,
  groupStates: Readonly<Record<string, ChatGroupState>> = {},
): TimelineGroupDetail[] {
  if (!config || !worldbook || config.worldbookKey !== worldbook.key) return [];
  const sources = new Map(worldbook.entries.map(entry => [String(entry.id), entry]));
  return config.groups.map(group => {
    const entries = group.entries.map(entry => {
      const source = sources.get(String(entry.entryId));
      const warning = group.blockReason || entryWarning(entry, Boolean(source));
      return {
        contentPreview: source?.content ?? '',
        enabled: source?.enabled ?? false,
        entryId: entry.entryId,
        originalComment: source?.comment || entry.originalComment,
        rangeLabel: rangeLabel(entry),
        state: warning ? 'warning' as const : source?.enabled ? 'active' as const : 'inactive' as const,
        title: entry.displayTitle,
        warning,
      };
    });
    const activeEntries = entries.filter(entry => entry.enabled && entry.state !== 'warning');
    return {
      id: group.id,
      name: group.name,
      mode: groupStates[group.id]?.mode ?? 'auto',
      activeEntryTitle: activeEntries.length === 1 ? activeEntries[0].title : undefined,
      entries,
    };
  });
}
