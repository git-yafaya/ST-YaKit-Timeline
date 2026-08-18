import { describe, expect, it } from 'vitest';
import { getOverviewSourceState } from '@/ui/pages/overview';

describe('overview source state', () => {
  it('allows scanning only when the current bound worldbook has entries', () => {
    expect(getOverviewSourceState('ready', 12)).toMatchObject({
      canScan: true,
      title: '当前世界书尚未建立时间线配置',
    });
    expect(getOverviewSourceState('ready', 0)).toMatchObject({
      canScan: false,
      title: '当前世界书没有可扫描条目',
    });
  });

  it('stops scanning when no character or primary worldbook is available', () => {
    expect(getOverviewSourceState('no_character', 0)).toMatchObject({
      canScan: false,
      title: '当前未选择角色卡',
    });
    expect(getOverviewSourceState('no_worldbook', 0)).toMatchObject({
      canScan: false,
      title: '当前角色卡未绑定世界书',
    });
  });

  it('surfaces the adapter message when the bound worldbook is unreadable', () => {
    expect(getOverviewSourceState('worldbook_unreadable', 0, '世界书读取失败')).toEqual({
      canScan: false,
      icon: '!',
      title: '当前角色绑定的世界书无法读取',
      description: '世界书读取失败',
    });
  });

  it('does not expose scanning when SillyTavern context is unavailable', () => {
    expect(getOverviewSourceState('unavailable', 0)).toMatchObject({
      canScan: false,
      title: '无法读取 SillyTavern 当前状态',
    });
  });
});
