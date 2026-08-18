import { describe, expect, it } from 'vitest';
import { parseStoryTimeValue, parseWlogTime } from '@/timeline/wlog';

describe('parseWlogTime', () => {
  it('解析标准 wlog 故事时间', () => {
    const result = parseWlogTime('<wlog time="🕒时间:424年5月14日/17:15">正文</wlog>');
    expect(result).toEqual({
      year: 424,
      month: 5,
      day: 14,
      hour: 17,
      minute: 15,
      raw: '🕒时间:424年5月14日/17:15',
    });
  });

  it('从后向前选择最后一个合法 wlog', () => {
    const message = [
      '<wlog time="419年11月10日/08:30">第一段</wlog>',
      '<wlog time="420年3月17日/12:05">第二段</wlog>',
    ].join('\n');
    expect(parseWlogTime(message)).toMatchObject({ year: 420, month: 3, day: 17, hour: 12, minute: 5 });
  });

  it('最后一个完整标签时间非法时回退到前一个合法标签', () => {
    const message = [
      '<wlog time="419年11月10日/08:30">第一段</wlog>',
      '<wlog time="420年2月30日/12:05">第二段</wlog>',
    ].join('\n');
    expect(parseWlogTime(message)).toMatchObject({ year: 419, month: 11, day: 10 });
  });

  it('忽略生成中断留下的不完整末尾标签', () => {
    const message = [
      '<wlog time="419年11月10日/08:30">完整</wlog>',
      '<wlog time="420年3月17日/12:05">生成中断',
    ].join('\n');
    expect(parseWlogTime(message)).toMatchObject({ year: 419, month: 11, day: 10 });
  });

  it('没有完整合法标签时返回 null', () => {
    expect(parseWlogTime('普通正文')).toBeNull();
    expect(parseWlogTime('<wlog>缺少时间</wlog>')).toBeNull();
    expect(parseWlogTime('<wlog time="424年5月14日/25:00">非法时间</wlog>')).toBeNull();
  });
});

describe('parseStoryTimeValue', () => {
  it('允许没有时分的合法年月日', () => {
    expect(parseStoryTimeValue('424年5月14日')).toEqual({
      year: 424,
      month: 5,
      day: 14,
      raw: '424年5月14日',
    });
  });

  it('接受中文冒号、斜杠和空白', () => {
    expect(parseStoryTimeValue(' 🕒 时间：424年 5月 14日 ／ 7：05 ')).toMatchObject({
      year: 424,
      month: 5,
      day: 14,
      hour: 7,
      minute: 5,
    });
  });
});
