import { compareStoryDates, formatStoryDate, parseStoryDate } from '@/timeline/date';
import type { EntryId } from '@/timeline/types';
import type { WorldInfoEntrySnapshot } from '@/st/sillytavern-adapter';
import type {
  AnalysisConfidence,
  AnalysisDraft,
  AnalysisDraftEntry,
  AnalysisDraftGroup,
  AnalysisProgress,
  AnalysisScanMode,
} from '@/ui/pages/analysis';

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
const DATE_CANDIDATE_PATTERN = /(?:^|[^\d])(\d{1,6})(?:年|[-/.])\s*(\d{1,2})(?:月|[-/.])\s*(\d{1,2})(?:日)?(?=$|[^\d])/g;

export interface AnalysisGenerator {
  (prompt: string, signal: AbortSignal): Promise<unknown>;
}

export interface TimelineScanOptions {
  entries: readonly WorldInfoEntrySnapshot[];
  generate?: AnalysisGenerator;
  mode: AnalysisScanMode;
  onProgress?: (progress: AnalysisProgress) => void;
  signal: AbortSignal;
}

export class AnalysisValidationError extends Error {
  readonly rawOutput: string;

  constructor(message: string, rawOutput = '') {
    super(message);
    this.name = 'AnalysisValidationError';
    this.rawOutput = rawOutput;
  }
}

export const TIMELINE_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entryId: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                title: { type: 'string' },
                contentStartDate: { type: ['string', 'null'] },
                boundaryDate: { type: ['string', 'null'] },
                confidence: { anyOf: [{ type: 'number' }, { enum: ['high', 'medium', 'low'] }] },
                warnings: { type: 'array', items: { type: 'string' } },
              },
              required: ['entryId', 'title', 'contentStartDate', 'boundaryDate', 'confidence', 'warnings'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'entries'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
} as const;

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('分析已取消', 'AbortError');
}

interface LocalDateMatch {
  date: string;
}

function extractLocalDates(value: string): LocalDateMatch[] {
  const matches: LocalDateMatch[] = [];
  for (const match of value.matchAll(DATE_CANDIDATE_PATTERN)) {
    const year = match[1];
    const month = match[2];
    const day = match[3];
    const parsed = parseStoryDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!parsed) continue;
    matches.push({ date: formatStoryDate(parsed) });
  }
  return matches;
}

function countDates(value: string): number {
  return extractLocalDates(value).length;
}

export function isQuickScanCandidate(entry: WorldInfoEntrySnapshot): boolean {
  const text = `${entry.comment}\n${entry.content}`;
  if (/<world_timeline\b/i.test(text)) return true;
  const dateCount = countDates(text);
  if (dateCount >= 2) return true;
  return dateCount >= 1 && /(?:时间线|年表|年代记|timeline|chronology|事件)/i.test(text);
}

export function selectScanEntries(
  entries: readonly WorldInfoEntrySnapshot[],
  mode: AnalysisScanMode,
): WorldInfoEntrySnapshot[] {
  return mode === 'deep' ? [...entries] : entries.filter(isQuickScanCandidate);
}

function buildQuickScanDraft(
  candidates: readonly WorldInfoEntrySnapshot[],
  signal: AbortSignal,
): AnalysisDraft {
  const entries = candidates.map((source, sourceIndex) => {
    abortIfNeeded(signal);
    const text = `${source.comment}\n${source.content}`;
    const dates = extractLocalDates(text);
    const sourceComment = source.comment.trim() || `条目 ${source.id}`;
    const warnings = ['快速扫描仅识别候选，不进行 AI 分组或边界推断。'];
    if (dates.length === 0) {
      warnings.push('未提取到完整日期，请人工补充内容开始日期。');
    } else if (dates.length > 1) {
      warnings.push(`检测到 ${dates.length} 个日期，起点暂取首次出现日期，请人工确认。`);
    }

    return {
      entry: {
        boundaryDate: undefined,
        confidence: 'low' as const,
        contentStartDate: dates[0]?.date,
        entryId: source.id,
        selected: false,
        sourceContent: source.content,
        sourceComment,
        title: sourceComment,
        warnings,
      },
      firstDate: dates[0]?.date,
      sourceIndex,
    };
  });

  entries.sort((left, right) => {
    if (left.firstDate !== right.firstDate) {
      if (!left.firstDate) return 1;
      if (!right.firstDate) return -1;
      const leftDate = parseStoryDate(left.firstDate);
      const rightDate = parseStoryDate(right.firstDate);
      if (leftDate && rightDate) return compareStoryDates(leftDate, rightDate);
      return left.firstDate.localeCompare(right.firstDate);
    }
    return left.sourceIndex - right.sourceIndex;
  });

  return {
    candidateCount: candidates.length,
    groups: candidates.length > 0
      ? [{ id: 'local-quick-candidates', name: '本地候选', entries: entries.map(item => item.entry) }]
      : [],
    scanMode: 'quick',
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空字符串`);
  return value.trim();
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !parseStoryDate(value.trim())) throw new Error(`${field} 不是合法日期`);
  return value.trim();
}

function confidenceValue(value: unknown): AnalysisConfidence {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('confidence 必须是 0～1 或 high / medium / low');
  }
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function warningValues(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('warnings 必须是字符串数组');
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function extractJson(value: unknown): { parsed: unknown; raw: string } {
  if (typeof value !== 'string') return { parsed: value, raw: JSON.stringify(value) };
  const raw = value.trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return { parsed: JSON.parse(unfenced), raw };
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return { parsed: JSON.parse(unfenced.slice(start, end + 1)), raw };
      } catch {
        // 统一在下方报告非法 JSON。
      }
    }
  }
  throw new AnalysisValidationError('AI 返回的内容不是合法 JSON', raw);
}

export function validateAnalysisDraft(
  value: unknown,
  sourceEntries: readonly WorldInfoEntrySnapshot[],
): AnalysisDraft {
  const { parsed, raw } = extractJson(value);
  const root = recordValue(parsed);
  if (!root || !Array.isArray(root.groups)) throw new AnalysisValidationError('AI 结果缺少 groups 数组', raw);

  const sourceIds = new Map(sourceEntries.map(entry => [String(entry.id), entry.id]));
  const usedIds = new Set<string>();

  try {
    const groups: AnalysisDraftGroup[] = root.groups.map((groupValue, groupIndex) => {
      const group = recordValue(groupValue);
      if (!group || !Array.isArray(group.entries)) throw new Error(`groups[${groupIndex}] 结构无效`);
      const name = textValue(group.name, `groups[${groupIndex}].name`);
      const entries: AnalysisDraftEntry[] = group.entries.map((entryValue, entryIndex) => {
        const entry = recordValue(entryValue);
        if (!entry) throw new Error(`groups[${groupIndex}].entries[${entryIndex}] 结构无效`);
        if (typeof entry.entryId !== 'string' && typeof entry.entryId !== 'number') {
          throw new Error(`groups[${groupIndex}].entries[${entryIndex}].entryId 无效`);
        }
        const canonicalId = String(entry.entryId);
        const sourceId = sourceIds.get(canonicalId);
        if (sourceId === undefined) throw new Error(`AI 引用了不存在的条目 ID：${canonicalId}`);
        if (usedIds.has(canonicalId)) throw new Error(`AI 重复引用条目 ID：${canonicalId}`);
        usedIds.add(canonicalId);

        const confidence = confidenceValue(entry.confidence);
        const source = sourceEntries.find(item => String(item.id) === canonicalId);
        return {
          boundaryDate: optionalDate(entry.boundaryDate, `条目 ${canonicalId} boundaryDate`),
          confidence,
          contentStartDate: optionalDate(entry.contentStartDate, `条目 ${canonicalId} contentStartDate`),
          entryId: sourceId as EntryId,
          selected: confidence !== 'low',
          sourceContent: source?.content ?? '',
          sourceComment: source?.comment || `条目 ${canonicalId}`,
          title: textValue(entry.title, `条目 ${canonicalId} title`),
          warnings: warningValues(entry.warnings),
        };
      });
      return { id: `ai-group-${groupIndex + 1}`, name, entries };
    });

    return { candidateCount: sourceEntries.length, groups };
  } catch (error) {
    throw new AnalysisValidationError(error instanceof Error ? error.message : 'AI 结果结构无效', raw);
  }
}

function serializeEntries(entries: readonly WorldInfoEntrySnapshot[]): string {
  return JSON.stringify(entries.map(entry => ({
    entryId: entry.id,
    comment: entry.comment,
    content: entry.content,
  })));
}

function basePrompt(entries: readonly WorldInfoEntrySnapshot[]): string {
  return [
    '分析以下 SillyTavern 世界书条目，识别时间线条目并分组、排序。',
    '只输出符合约定的 JSON，不要输出 Markdown 或解释。不得杜撰 entryId，不得修改原文。',
    '日期统一为 YYYY-MM-DD；不确定的日期填 null，并在 warnings 中说明。',
    'confidence 使用 0 到 1 的数字。低置信度内容仍可返回，但必须准确标低。',
    'JSON 结构：{"groups":[{"name":"组名","entries":[{"entryId":1,"title":"标题","contentStartDate":"424-05-14","boundaryDate":null,"confidence":0.9,"warnings":[]}]}]}',
    `输入条目：${serializeEntries(entries)}`,
  ].join('\n\n');
}

function summaryPrompt(drafts: readonly AnalysisDraft[], entries: readonly WorldInfoEntrySnapshot[]): string {
  const compact = drafts.flatMap(draft => draft.groups.flatMap(group => group.entries.map(entry => ({
    group: group.name,
    entryId: entry.entryId,
    title: entry.title,
    contentStartDate: entry.contentStartDate ?? null,
    boundaryDate: entry.boundaryDate ?? null,
    confidence: entry.confidence,
    warnings: entry.warnings ?? [],
  }))));
  return [
    '将以下分批分析结果汇总成统一时间线分组并排序。只输出 JSON，不要解释。',
    '不得新增或遗漏候选中的 entryId；可重新命名或合并分组，但不得修改已识别字段的事实含义。',
    '输出结构必须与输入批次相同。',
    `允许的 entryId：${JSON.stringify(entries.map(entry => entry.id))}`,
    `分批结果：${JSON.stringify(compact)}`,
  ].join('\n\n');
}

async function generateValidated(
  prompt: string,
  entries: readonly WorldInfoEntrySnapshot[],
  generate: AnalysisGenerator,
  signal: AbortSignal,
): Promise<AnalysisDraft> {
  let repairNote = '';
  let lastError: AnalysisValidationError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    abortIfNeeded(signal);
    const output = await generate(`${prompt}${repairNote}`, signal);
    abortIfNeeded(signal);
    try {
      return validateAnalysisDraft(output, entries);
    } catch (error) {
      lastError = error instanceof AnalysisValidationError
        ? error
        : new AnalysisValidationError('AI 结果结构无效');
      repairNote = `\n\n上一次输出校验失败：${lastError.message}。请修复并重新输出完整 JSON。`;
    }
  }
  throw new AnalysisValidationError(
    `AI 分析结果连续 ${MAX_ATTEMPTS} 次无法通过结构校验：${lastError?.message ?? '未知错误'}`,
    lastError?.rawOutput,
  );
}

export async function runTimelineScan(options: TimelineScanOptions): Promise<AnalysisDraft> {
  const { entries, generate, mode, onProgress, signal } = options;
  abortIfNeeded(signal);
  onProgress?.({ stage: 'filtering', percent: 5, label: `正在筛选候选条目 0 / ${entries.length}` });
  const candidates = selectScanEntries(entries, mode);
  abortIfNeeded(signal);
  onProgress?.({
    stage: 'filtering',
    percent: 15,
    label: `候选筛选完成 ${candidates.length} / ${entries.length}`,
  });

  if (mode === 'quick') {
    onProgress?.({ stage: 'local', percent: 65, label: '正在整理本地候选结果' });
    const draft = buildQuickScanDraft(candidates, signal);
    onProgress?.({ stage: 'validation', percent: 100, label: '本地候选结果已生成' });
    return draft;
  }

  if (candidates.length === 0) {
    onProgress?.({ stage: 'validation', percent: 100, label: '没有可分析的条目' });
    return { candidateCount: 0, groups: [], scanMode: mode };
  }
  if (!generate) throw new Error('深度扫描需要可用的 AI 生成器。');

  const batches: WorldInfoEntrySnapshot[][] = [];
  for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
    batches.push(candidates.slice(index, index + BATCH_SIZE));
  }

  const partialDrafts: AnalysisDraft[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    abortIfNeeded(signal);
    onProgress?.({
      stage: 'batches',
      percent: 15 + Math.round(((index + 1) / batches.length) * (batches.length === 1 ? 65 : 50)),
      label: `AI 分析第 ${index + 1} / ${batches.length} 批`,
    });
    partialDrafts.push(await generateValidated(basePrompt(batches[index]), batches[index], generate, signal));
  }

  let draft: AnalysisDraft;
  if (partialDrafts.length === 1) {
    draft = partialDrafts[0];
  } else {
    onProgress?.({ stage: 'summary', percent: 78, label: '正在汇总分组结果' });
    draft = await generateValidated(summaryPrompt(partialDrafts, candidates), candidates, generate, signal);
  }

  onProgress?.({ stage: 'validation', percent: 94, label: '正在校验 JSON 与条目 ID' });
  abortIfNeeded(signal);
  const result = { ...draft, candidateCount: candidates.length, scanMode: mode };
  onProgress?.({ stage: 'validation', percent: 100, label: '分析草稿已生成' });
  return result;
}
