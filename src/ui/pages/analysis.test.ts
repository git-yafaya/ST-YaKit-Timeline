import { describe, expect, it } from 'vitest';
import {
  moveAnalysisEntry,
  renameAnalysisGroup,
  reorderAnalysisGroups,
  type AnalysisDraft,
} from '@/ui/pages/analysis';

const draft: AnalysisDraft = {
  candidateCount: 3,
  groups: [
    {
      id: 'group-a',
      name: '主线',
      entries: [
        { entryId: 1, title: '一', sourceComment: '一', confidence: 'high', selected: true },
        { entryId: 2, title: '二', sourceComment: '二', confidence: 'high', selected: true },
      ],
    },
    {
      id: 'group-b',
      name: '支线',
      entries: [{ entryId: 3, title: '三', sourceComment: '三', confidence: 'high', selected: true }],
    },
  ],
};

describe('analysis draft editing', () => {
  it('renames a group and records the manual lock', () => {
    const next = renameAnalysisGroup(draft, 'group-a', '人工主线');
    expect(next.groups[0]).toMatchObject({ name: '人工主线', nameLocked: true });
  });

  it('reorders groups and marks the order as manually locked', () => {
    const next = reorderAnalysisGroups(draft, ['group-b', 'group-a']);
    expect(next.groups.map(group => group.id)).toEqual(['group-b', 'group-a']);
    expect(next.groups.every(group => group.orderLocked)).toBe(true);
  });

  it('moves an entry across groups and preserves a manual group lock', () => {
    const next = moveAnalysisEntry(draft, 'group-a', 'group-b', 2, 3);
    expect(next.groups[0].entries.map(entry => entry.entryId)).toEqual([1]);
    expect(next.groups[1].entries.map(entry => entry.entryId)).toEqual([2, 3]);
    expect(next.groups[1].entries[0]).toMatchObject({ entryId: 2, groupLocked: true, orderLocked: true });
  });
});
