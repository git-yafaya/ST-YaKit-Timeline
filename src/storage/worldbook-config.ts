import { compareStoryDates, daysInMonth, formatStoryDate, parseStoryDate } from '@/timeline/date';
import type { EntryId } from '@/timeline/types';
import type { WorldbookSnapshot } from '@/st/sillytavern-adapter';
import type { AnalysisConfidence, AnalysisDraft, AnalysisDraftEntry } from '@/ui/pages/analysis';

const SETTINGS_NAMESPACE = 'st_yafaya_timeline';

export interface ManagedTimelineEntry {
  boundaryDate?: string;
  confidence: number;
  contentHash: string;
  contentStartDate?: string;
  displayTitle: string;
  effectiveEndDate: string | null;
  effectiveStartDate: string;
  entryId: EntryId;
  managed: boolean;
  manualFields: readonly string[];
  originalComment: string;
  stale: boolean;
  titleLocked: boolean;
  warnings: readonly string[];
}

export interface TimelineGroupConfig {
  blockReason?: string;
  blocked: boolean;
  entries: readonly ManagedTimelineEntry[];
  id: string;
  name: string;
  nameLocked: boolean;
}

export interface WorldbookTimelineConfig {
  groups: readonly TimelineGroupConfig[];
  updatedAt: number;
  worldbookKey: string;
  worldbookName: string;
}

interface StorageContext {
  extensionSettings: Record<string, unknown>;
  saveSettingsDebounced: () => void;
}

interface StorageApi {
  getContext: () => StorageContext;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getContext(): StorageContext | null {
  try {
    return (globalThis as unknown as { SillyTavern?: StorageApi }).SillyTavern?.getContext() ?? null;
  } catch {
    return null;
  }
}

function previousDate(value: string): string {
  const date = parseStoryDate(value);
  if (!date) throw new Error(`无效切换边界：${value}`);
  if (date.day > 1) return formatStoryDate({ ...date, day: date.day - 1 });
  if (date.month > 1) {
    const month = date.month - 1;
    return formatStoryDate({ year: date.year, month, day: daysInMonth(date.year, month) });
  }
  if (date.year <= 1) throw new Error('切换边界不能早于最小支持日期');
  return formatStoryDate({ year: date.year - 1, month: 12, day: 31 });
}

function confidenceNumber(confidence: AnalysisConfidence): number {
  if (confidence === 'high') return 0.9;
  if (confidence === 'medium') return 0.6;
  return 0.3;
}

async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function selectedGroups(draft: AnalysisDraft): Array<{
  entries: AnalysisDraftEntry[];
  id: string;
  name: string;
}> {
  return draft.groups.flatMap(group => {
    const entries = group.entries.filter(entry => entry.selected);
    return entries.length > 0 ? [{ id: group.id, name: group.name.trim(), entries: [...entries] }] : [];
  });
}

export function getDraftApplicationIssue(
  draft: AnalysisDraft | null,
  worldbook: WorldbookSnapshot | null,
): string | null {
  if (!draft) return '尚未生成分析草稿。';
  if (!worldbook) return '当前角色绑定的世界书不可读取。';
  const groups = selectedGroups(draft);
  if (groups.length === 0) return '草稿中没有选中的受管条目。';

  const sourceIds = new Set(worldbook.entries.map(entry => String(entry.id)));
  const usedIds = new Set<string>();
  const groupIds = new Set<string>();
  const groupNames = new Set<string>();
  for (const group of groups) {
    if (!group.id.trim()) return '时间线组 ID 不能为空。';
    if (groupIds.has(group.id)) return `时间线组 ID 重复：${group.id}`;
    groupIds.add(group.id);
    if (!group.name) return '时间线组名称不能为空。';
    if (groupNames.has(group.name)) return `时间线组名称重复：${group.name}`;
    groupNames.add(group.name);

    for (let index = 0; index < group.entries.length; index += 1) {
      const entry = group.entries[index];
      const id = String(entry.entryId);
      if (!sourceIds.has(id)) return `条目 ${id} 已不在当前世界书中。`;
      if (usedIds.has(id)) return `条目 ${id} 被多个时间线组重复纳管。`;
      usedIds.add(id);
      if (!entry.title.trim()) return `条目 ${id} 的展示标题不能为空。`;
      if (entry.confidence === 'medium') return `条目 ${id} 仍处于待确认状态。`;
      if (entry.confidence === 'low' && !entry.manuallyLocked) return `低置信度条目 ${id} 尚未人工确认。`;
      if ((entry.warnings?.length ?? 0) > 0) return `条目 ${id} 仍有未处理警告。`;
      if (!entry.contentStartDate || !parseStoryDate(entry.contentStartDate)) {
        return `条目 ${id} 缺少合法的内容开始日期。`;
      }
      if (entry.boundaryDate && !parseStoryDate(entry.boundaryDate)) {
        return `条目 ${id} 的切换边界不是合法日期。`;
      }
      if (index < group.entries.length - 1 && (!entry.boundaryDate || !parseStoryDate(entry.boundaryDate))) {
        return `条目 ${id} 缺少通往下一条目的切换边界。`;
      }
    }

    let effectiveStart = group.entries[0].contentStartDate!;
    for (let index = 0; index < group.entries.length; index += 1) {
      const entry = group.entries[index];
      const start = parseStoryDate(effectiveStart)!;
      if (index < group.entries.length - 1) {
        const boundary = parseStoryDate(entry.boundaryDate!)!;
        if (compareStoryDates(boundary, start) <= 0) return `条目 ${String(entry.entryId)} 的切换边界没有晚于生效起点。`;
        effectiveStart = entry.boundaryDate!;
      }
    }
  }
  return null;
}

export async function buildWorldbookTimelineConfig(
  draft: AnalysisDraft,
  worldbook: WorldbookSnapshot,
  updatedAt = Date.now(),
): Promise<WorldbookTimelineConfig> {
  const issue = getDraftApplicationIssue(draft, worldbook);
  if (issue) throw new Error(issue);
  const sourceEntries = new Map(worldbook.entries.map(entry => [String(entry.id), entry]));
  const groups: TimelineGroupConfig[] = [];

  for (const group of selectedGroups(draft)) {
    let effectiveStart = group.entries[0].contentStartDate!;
    const entries: ManagedTimelineEntry[] = [];
    for (let index = 0; index < group.entries.length; index += 1) {
      const draftEntry = group.entries[index];
      const source = sourceEntries.get(String(draftEntry.entryId))!;
      const isLast = index === group.entries.length - 1;
      const manualFields = draftEntry.manuallyLocked
        ? ['displayTitle', 'contentStartDate', 'boundaryDate', 'managed']
        : [];
      entries.push({
        boundaryDate: draftEntry.boundaryDate,
        confidence: confidenceNumber(draftEntry.confidence),
        contentHash: await contentHash(source.content),
        contentStartDate: draftEntry.contentStartDate,
        displayTitle: draftEntry.title.trim(),
        effectiveEndDate: isLast ? null : previousDate(draftEntry.boundaryDate!),
        effectiveStartDate: effectiveStart,
        entryId: source.id,
        managed: true,
        manualFields,
        originalComment: source.comment,
        stale: false,
        titleLocked: Boolean(draftEntry.manuallyLocked),
        warnings: [],
      });
      if (!isLast) effectiveStart = draftEntry.boundaryDate!;
    }
    groups.push({
      id: group.id,
      name: group.name,
      nameLocked: group.id.startsWith('manual-group-'),
      entries,
      blocked: false,
    });
  }

  return {
    worldbookKey: worldbook.key,
    worldbookName: worldbook.name,
    groups,
    updatedAt,
  };
}

function isEntry(value: unknown): value is ManagedTimelineEntry {
  const entry = recordValue(value);
  return Boolean(
    entry &&
    (typeof entry.entryId === 'string' || typeof entry.entryId === 'number') &&
    typeof entry.originalComment === 'string' &&
    typeof entry.contentHash === 'string' &&
    typeof entry.displayTitle === 'string' &&
    typeof entry.effectiveStartDate === 'string' &&
    (entry.effectiveEndDate === null || typeof entry.effectiveEndDate === 'string') &&
    typeof entry.confidence === 'number' &&
    typeof entry.managed === 'boolean' &&
    Array.isArray(entry.manualFields) &&
    typeof entry.stale === 'boolean' &&
    typeof entry.titleLocked === 'boolean' &&
    Array.isArray(entry.warnings)
  );
}

function isGroup(value: unknown): value is TimelineGroupConfig {
  const group = recordValue(value);
  return Boolean(
    group &&
    typeof group.id === 'string' &&
    typeof group.name === 'string' &&
    typeof group.nameLocked === 'boolean' &&
    typeof group.blocked === 'boolean' &&
    Array.isArray(group.entries) &&
    group.entries.every(isEntry)
  );
}

function isConfig(value: unknown): value is WorldbookTimelineConfig {
  const config = recordValue(value);
  return Boolean(
    config &&
    typeof config.worldbookKey === 'string' &&
    typeof config.worldbookName === 'string' &&
    typeof config.updatedAt === 'number' &&
    Array.isArray(config.groups) &&
    config.groups.every(isGroup)
  );
}

export function loadWorldbookTimelineConfig(worldbookKey: string): WorldbookTimelineConfig | null {
  const context = getContext();
  const namespace = recordValue(context?.extensionSettings[SETTINGS_NAMESPACE]);
  const worldbooks = recordValue(namespace?.worldbooks);
  const config = worldbooks?.[worldbookKey];
  return isConfig(config) && config.worldbookKey === worldbookKey ? config : null;
}

export function saveWorldbookTimelineConfig(config: WorldbookTimelineConfig): boolean {
  const context = getContext();
  if (!context) return false;
  const previousNamespace = context.extensionSettings[SETTINGS_NAMESPACE];
  try {
    const namespace = recordValue(previousNamespace) ?? {};
    const worldbooks = recordValue(namespace.worldbooks) ?? {};
    context.extensionSettings[SETTINGS_NAMESPACE] = {
      ...namespace,
      worldbooks: { ...worldbooks, [config.worldbookKey]: config },
    };
    context.saveSettingsDebounced();
    return true;
  } catch {
    if (previousNamespace === undefined) delete context.extensionSettings[SETTINGS_NAMESPACE];
    else context.extensionSettings[SETTINGS_NAMESPACE] = previousNamespace;
    return false;
  }
}
