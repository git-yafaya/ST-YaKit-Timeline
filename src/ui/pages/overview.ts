import type { EntryId } from '@/timeline/types';
import type { HostScopeStatus } from '@/st/sillytavern-adapter';

export type OverviewGroupKind = 'route' | 'character' | 'world';
export type OverviewGroupMode = 'auto' | 'manual';

export interface OverviewActiveEntry {
  entryId: EntryId;
  rangeLabel: string;
  title: string;
}

export interface OverviewGroupSummary {
  activeEntry?: OverviewActiveEntry;
  id: string;
  kind: OverviewGroupKind;
  mode: OverviewGroupMode;
  name: string;
  warning?: string;
}

export interface OverviewSourceState {
  canScan: boolean;
  description: string;
  icon: string;
  title: string;
}

export function getOverviewSourceState(
  status: HostScopeStatus,
  entryCount: number,
  message = '',
): OverviewSourceState {
  if (status === 'ready' && entryCount > 0) {
    return {
      canScan: true,
      icon: '◇',
      title: '当前世界书尚未建立时间线配置',
      description: '开始扫描后，AI 只会生成配置草稿；确认并应用前不会接管世界书。',
    };
  }

  if (status === 'ready') {
    return {
      canScan: false,
      icon: '◇',
      title: '当前世界书没有可扫描条目',
      description: '请先在当前角色绑定的世界书中添加条目。',
    };
  }

  if (status === 'no_character') {
    return {
      canScan: false,
      icon: '●',
      title: '当前未选择角色卡',
      description: '请先打开一个角色聊天，再使用时间线管理。',
    };
  }

  if (status === 'no_worldbook') {
    return {
      canScan: false,
      icon: '◎',
      title: '当前角色卡未绑定世界书',
      description: '请先为角色卡绑定世界书后再使用时间线管理。',
    };
  }

  if (status === 'worldbook_unreadable') {
    return {
      canScan: false,
      icon: '!',
      title: '当前角色绑定的世界书无法读取',
      description: message || '请检查世界书是否存在并仍与当前角色绑定。',
    };
  }

  return {
    canScan: false,
    icon: '!',
    title: '无法读取 SillyTavern 当前状态',
    description: message || '请刷新页面后重试。',
  };
}
