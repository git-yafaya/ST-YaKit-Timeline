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

export const UNGROUPED_GROUP_ID = '__ungrouped__';
export const UNGROUPED_GROUP_NAME = '未分组';

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

export function isWorldbookTimelineConfig(value: unknown): value is WorldbookTimelineConfig {
  return isConfig(value);
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

export async function detectWorldbookConfigStale(
  config: WorldbookTimelineConfig,
  worldbook: WorldbookSnapshot,
): Promise<{ changed: boolean; config: WorldbookTimelineConfig }> {
  if (config.worldbookKey !== worldbook.key) return { changed: false, config };
  const sources = new Map(worldbook.entries.map(entry => [String(entry.id), entry]));
  let changed = false;
  const groups = await Promise.all(config.groups.map(async group => {
    const entries = await Promise.all(group.entries.map(async entry => {
      const source = sources.get(String(entry.entryId));
      const missing = !source;
      const contentChanged = source ? await contentHash(source.content) !== entry.contentHash : false;
      if (!missing && !contentChanged) return cloneEntry(entry);
      const warning = missing
        ? '原世界书条目已不存在，已停止使用该映射。'
        : '世界书正文已修改，时间线旧配置继续保留，建议重新分析。';
      if (entry.stale && entry.warnings.includes(warning)) return cloneEntry(entry);
      changed = true;
      return {
        ...cloneEntry(entry),
        stale: true,
        warnings: [...new Set([...entry.warnings, warning])],
      };
    }));
    return { ...group, entries };
  }));
  return changed
    ? { changed: true, config: { ...config, groups, updatedAt: Date.now() } }
    : { changed: false, config };
}

function cloneEntry(entry: ManagedTimelineEntry): ManagedTimelineEntry {
  return {
    ...entry,
    ...(entry.boundaryDate === undefined ? {} : { boundaryDate: entry.boundaryDate }),
    ...(entry.contentStartDate === undefined ? {} : { contentStartDate: entry.contentStartDate }),
    manualFields: [...entry.manualFields],
    warnings: [...entry.warnings],
  };
}

function normalizeTimelineEntries(entries: readonly ManagedTimelineEntry[]): ManagedTimelineEntry[] {
  let effectiveStart = entries[0]?.contentStartDate ?? entries[0]?.effectiveStartDate ?? '';
  return entries.map((source, index) => {
    const entry = cloneEntry(source);
    const isLast = index === entries.length - 1;
    const effectiveEndDate = isLast
      ? null
      : entry.boundaryDate && parseStoryDate(entry.boundaryDate)
        ? previousDate(entry.boundaryDate)
        : entry.effectiveEndDate;
    const result = {
      ...entry,
      effectiveEndDate,
      effectiveStartDate: effectiveStart || entry.effectiveStartDate,
    };
    if (!isLast && entry.boundaryDate) effectiveStart = entry.boundaryDate;
    return result;
  });
}

function nextConfig(
  config: WorldbookTimelineConfig,
  groups: readonly TimelineGroupConfig[],
): WorldbookTimelineConfig {
  return {
    ...config,
    groups: groups.map(group => ({
      ...group,
      entries: normalizeTimelineEntries(group.entries),
    })),
    updatedAt: Date.now(),
  };
}

function emptyUngroupedGroup(): TimelineGroupConfig {
  return {
    id: UNGROUPED_GROUP_ID,
    name: UNGROUPED_GROUP_NAME,
    nameLocked: true,
    entries: [],
    blocked: true,
    blockReason: '未分组条目不会参与自动时间线切换。',
  };
}

function uniqueGroupId(config: WorldbookTimelineConfig, prefix: string): string {
  const ids = new Set(config.groups.map(group => group.id));
  let index = 1;
  let id = `${prefix}-${Date.now()}`;
  while (ids.has(id)) id = `${prefix}-${Date.now()}-${index++}`;
  return id;
}

function mutateConfig(
  config: WorldbookTimelineConfig,
  mutate: (groups: TimelineGroupConfig[]) => void,
): WorldbookTimelineConfig {
  const groups = config.groups.map(group => ({
    ...group,
    entries: group.entries.map(cloneEntry) as ManagedTimelineEntry[],
  }));
  mutate(groups);
  return nextConfig(config, groups);
}

export function createTimelineGroup(config: WorldbookTimelineConfig, name: string): WorldbookTimelineConfig {
  const trimmed = name.trim();
  if (!trimmed) return config;
  return mutateConfig(config, groups => {
    groups.splice(Math.max(0, groups.length - (groups.some(group => group.id === UNGROUPED_GROUP_ID) ? 1 : 0)), 0, {
      id: uniqueGroupId(config, 'manual-group'),
      name: trimmed,
      nameLocked: true,
      entries: [],
      blocked: false,
    });
  });
}

export function renameTimelineGroup(
  config: WorldbookTimelineConfig,
  groupId: string,
  name: string,
): WorldbookTimelineConfig {
  const trimmed = name.trim();
  if (!trimmed || groupId === UNGROUPED_GROUP_ID) return config;
  return mutateConfig(config, groups => {
    const group = groups.find(item => item.id === groupId);
    if (group) {
      group.name = trimmed;
      group.nameLocked = true;
    }
  });
}

export function reorderTimelineGroups(
  config: WorldbookTimelineConfig,
  orderedGroupIds: readonly string[],
): WorldbookTimelineConfig {
  return mutateConfig(config, groups => {
    const order = new Map(orderedGroupIds.map((id, index) => [id, index]));
    groups.sort((left, right) => {
      if (left.id === UNGROUPED_GROUP_ID) return 1;
      if (right.id === UNGROUPED_GROUP_ID) return -1;
      return (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    });
  });
}

export function reorderTimelineEntries(
  config: WorldbookTimelineConfig,
  groupId: string,
  orderedEntryIds: readonly EntryId[],
): WorldbookTimelineConfig {
  return mutateConfig(config, groups => {
    const group = groups.find(item => item.id === groupId);
    if (!group) return;
    const lookup = new Map(group.entries.map(entry => [String(entry.entryId), entry]));
    const ordered = orderedEntryIds
      .map(entryId => lookup.get(String(entryId)))
      .filter((entry): entry is ManagedTimelineEntry => Boolean(entry));
    for (const entry of group.entries) {
      if (!ordered.includes(entry)) ordered.push(entry);
    }
    group.entries = ordered.map(entry => ({
      ...entry,
      manualFields: [...new Set([...entry.manualFields, 'order'])],
    }));
  });
}

export function moveTimelineEntries(
  config: WorldbookTimelineConfig,
  sourceGroupId: string,
  targetGroupId: string,
  movedEntryIds: readonly EntryId[],
): WorldbookTimelineConfig {
  if (sourceGroupId === targetGroupId || targetGroupId === UNGROUPED_GROUP_ID) return config;
  return mutateConfig(config, groups => {
    const source = groups.find(group => group.id === sourceGroupId);
    const target = groups.find(group => group.id === targetGroupId);
    if (!source || !target) return;
    const moved = new Set(movedEntryIds.map(String));
    const entries = source.entries.filter(entry => moved.has(String(entry.entryId)));
    if (entries.length === 0) return;
    const existing = new Set(target.entries.map(entry => String(entry.entryId)));
    source.entries = source.entries.filter(entry => !moved.has(String(entry.entryId)));
    target.entries = [
      ...target.entries,
      ...entries.filter(entry => !existing.has(String(entry.entryId))).map(entry => ({
        ...entry,
        managed: true,
        manualFields: [...new Set([...entry.manualFields, 'managed', 'group'])],
        warnings: entry.warnings.filter(warning => warning !== '该条目已移至未分组，不会参与自动切换。'),
      })),
    ];
  });
}

export function mergeTimelineGroups(
  config: WorldbookTimelineConfig,
  sourceGroupId: string,
  targetGroupId: string,
): WorldbookTimelineConfig {
  if (sourceGroupId === targetGroupId) return config;
  return mutateConfig(config, groups => {
    const source = groups.find(group => group.id === sourceGroupId);
    const target = groups.find(group => group.id === targetGroupId);
    if (!source || !target || target.id === UNGROUPED_GROUP_ID || source.id === UNGROUPED_GROUP_ID) return;
    const existing = new Set(target.entries.map(entry => String(entry.entryId)));
    target.entries = [
      ...target.entries,
      ...source.entries
        .filter(entry => !existing.has(String(entry.entryId)))
        .map(entry => ({ ...entry, manualFields: [...new Set([...entry.manualFields, 'group'])] })),
    ];
    target.blocked = target.blocked || source.blocked;
    target.blockReason = target.blockReason || source.blockReason;
    groups.splice(groups.indexOf(source), 1);
  });
}

export function splitTimelineGroup(
  config: WorldbookTimelineConfig,
  sourceGroupId: string,
  name: string,
  movedEntryIds: readonly EntryId[],
): WorldbookTimelineConfig {
  const trimmed = name.trim();
  if (!trimmed || sourceGroupId === UNGROUPED_GROUP_ID) return config;
  return mutateConfig(config, groups => {
    const source = groups.find(group => group.id === sourceGroupId);
    if (!source) return;
    const moved = new Set(movedEntryIds.map(String));
    const entries = source.entries.filter(entry => moved.has(String(entry.entryId)));
    if (entries.length === 0 || entries.length === source.entries.length) return;
    source.entries = source.entries.filter(entry => !moved.has(String(entry.entryId)));
    const insertAt = groups.indexOf(source) + 1;
    groups.splice(insertAt, 0, {
      id: uniqueGroupId(config, 'manual-group'),
      name: trimmed,
      nameLocked: true,
      entries: entries.map(entry => ({
        ...entry,
        manualFields: [...new Set([...entry.manualFields, 'group'])],
      })),
      blocked: source.blocked,
      ...(source.blockReason ? { blockReason: source.blockReason } : {}),
    });
  });
}

export function deleteTimelineGroup(
  config: WorldbookTimelineConfig,
  groupId: string,
): WorldbookTimelineConfig {
  if (groupId === UNGROUPED_GROUP_ID) return config;
  return mutateConfig(config, groups => {
    const sourceIndex = groups.findIndex(group => group.id === groupId);
    if (sourceIndex < 0) return;
    const source = groups[sourceIndex];
    let ungrouped = groups.find(group => group.id === UNGROUPED_GROUP_ID);
    if (!ungrouped) {
      ungrouped = emptyUngroupedGroup();
      groups.push(ungrouped);
    }
    const existing = new Set(ungrouped.entries.map(entry => String(entry.entryId)));
    ungrouped.entries = [
      ...ungrouped.entries,
      ...source.entries.filter(entry => !existing.has(String(entry.entryId))).map(entry => ({
      ...entry,
      managed: false,
      manualFields: [...new Set([...entry.manualFields, 'managed'])],
      stale: true,
      warnings: [...new Set([...entry.warnings, '该条目已移至未分组，不会参与自动切换。'])],
      })),
    ];
    groups.splice(sourceIndex, 1);
  });
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ');
}

function matchedOldEntry(
  entry: ManagedTimelineEntry,
  previous: WorldbookTimelineConfig,
  used: Set<string>,
  allowedGroupId?: string,
): { entry: ManagedTimelineEntry; key: string } | null {
  const candidates = previous.groups
    .filter(group => !allowedGroupId || group.id === allowedGroupId)
    .flatMap(group => group.entries
      .filter(item => !item.manualFields.includes('group') || group.id === allowedGroupId)
      .map(item => ({
        groupId: group.id,
        item,
        key: `${group.id}:${String(item.entryId)}`,
      })));
  const exact = candidates.find(candidate => !used.has(candidate.key) && String(candidate.item.entryId) === String(entry.entryId));
  const hashed = candidates.find(candidate => !used.has(candidate.key) && candidate.item.contentHash === entry.contentHash);
  // 名称相同只能作为“疑似继承”提示，不能静默继承旧日期或人工字段。
  const found = exact ?? hashed;
  return found ? { entry: found.item, key: found.key } : null;
}

function mergeEntry(
  incoming: ManagedTimelineEntry,
  previous: ManagedTimelineEntry,
): ManagedTimelineEntry {
  const manual = new Set(previous.manualFields);
  const sourceChanged = previous.contentHash !== incoming.contentHash;
  const warnings = sourceChanged
    ? [...new Set([...previous.warnings, '世界书正文已修改，请确认时间线映射。'])]
    : [...previous.warnings];
  return {
    ...incoming,
    displayTitle: manual.has('displayTitle') || previous.titleLocked ? previous.displayTitle : incoming.displayTitle,
    ...(manual.has('contentStartDate') && previous.contentStartDate
      ? { contentStartDate: previous.contentStartDate }
      : {}),
    ...(manual.has('boundaryDate')
      ? { boundaryDate: previous.boundaryDate }
      : {}),
    managed: manual.has('managed') ? previous.managed : incoming.managed,
    manualFields: [...previous.manualFields],
    stale: previous.stale || sourceChanged,
    titleLocked: previous.titleLocked,
    warnings,
  };
}

/**
 * 将新分析结果与旧正式配置合并。旧配置不会因重新分析而直接消失：
 * 无法重新匹配的旧条目会保留为 stale 且 managed=false，等待人工处理。
 */
export async function mergeWorldbookTimelineConfig(
  previous: WorldbookTimelineConfig,
  draft: AnalysisDraft,
  worldbook: WorldbookSnapshot,
  updatedAt = Date.now(),
): Promise<WorldbookTimelineConfig> {
  const incoming = await buildWorldbookTimelineConfig(draft, worldbook, updatedAt);
  const used = new Set<string>();
  const groups: TimelineGroupConfig[] = [];

  for (const nextGroup of incoming.groups) {
    const oldGroup = previous.groups.find(group => group.id === nextGroup.id)
      ?? previous.groups.find(group => normalizedText(group.name) === normalizedText(nextGroup.name));
    const mergedEntries = nextGroup.entries.map(entry => {
      const match = matchedOldEntry(entry, previous, used, oldGroup?.id);
      if (!match) return entry;
      used.add(match.key);
      return mergeEntry(entry, match.entry);
    });
    const retainedName = oldGroup?.nameLocked ? oldGroup.name : nextGroup.name;
    groups.push({
      ...nextGroup,
      id: oldGroup?.id ?? nextGroup.id,
      name: retainedName,
      nameLocked: oldGroup?.nameLocked ?? nextGroup.nameLocked,
      blocked: oldGroup?.blocked ?? nextGroup.blocked,
      ...(oldGroup?.blockReason ? { blockReason: oldGroup.blockReason } : {}),
      entries: mergedEntries,
    });
  }

  for (const oldGroup of previous.groups) {
    if (oldGroup.id === UNGROUPED_GROUP_ID) continue;
    const staleEntries = oldGroup.entries
      .filter(entry => !used.has(`${oldGroup.id}:${String(entry.entryId)}`))
      .map(entry => ({
        ...cloneEntry(entry),
        managed: false,
        stale: true,
        manualFields: [...new Set([...entry.manualFields, 'managed'])],
        warnings: [...new Set([...entry.warnings, '本次分析未重新识别到该映射，已保留待人工处理。'])],
      }));
    if (staleEntries.length === 0) continue;
    const target = groups.find(group => group.id === oldGroup.id);
    if (target) {
      target.entries = [...target.entries, ...staleEntries];
      target.blocked = true;
      target.blockReason = target.blockReason || oldGroup.blockReason || '旧配置未在本次分析中重新匹配，已停止自动切换。';
    } else {
      groups.push({
        ...oldGroup,
        blocked: true,
        blockReason: oldGroup.blockReason || '旧配置未在本次分析中重新匹配，已停止自动切换。',
        entries: staleEntries,
      });
    }
  }

  const oldUngrouped = previous.groups.find(group => group.id === UNGROUPED_GROUP_ID);
  if (oldUngrouped) {
    const entries = oldUngrouped.entries
      .filter(entry => !used.has(`${oldUngrouped.id}:${String(entry.entryId)}`))
      .map(cloneEntry);
    if (entries.length > 0 || !groups.some(group => group.id === UNGROUPED_GROUP_ID)) {
      groups.push({ ...oldUngrouped, entries });
    }
  }
  return {
    ...previous,
    groups: groups.map(group => ({ ...group, entries: normalizeTimelineEntries(group.entries) })),
    updatedAt,
    worldbookKey: worldbook.key,
    worldbookName: worldbook.name,
  };
}
