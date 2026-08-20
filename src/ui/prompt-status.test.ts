import { describe, expect, it } from 'vitest';
import { getPromptStatus, normalizePromptText } from '@/ui/prompt-status';

describe('prompt status', () => {
  const defaultPrompt = '第一行\n第二行';

  it('marks identical content as default', () => {
    expect(getPromptStatus(defaultPrompt, defaultPrompt)).toEqual({
      isCustomized: false,
      label: '默认',
    });
  });

  it('marks different content as customized', () => {
    expect(getPromptStatus('第一行\n修改后的第二行', defaultPrompt)).toEqual({
      isCustomized: true,
      label: '已修改',
    });
  });

  it('treats empty content as default only when the default is also empty', () => {
    expect(getPromptStatus('', '')).toEqual({ isCustomized: false, label: '默认' });
    expect(getPromptStatus('', defaultPrompt)).toEqual({ isCustomized: true, label: '已修改' });
  });

  it('ignores leading and trailing whitespace', () => {
    expect(getPromptStatus(`  \n${defaultPrompt}\n  `, defaultPrompt)).toMatchObject({
      isCustomized: false,
      label: '默认',
    });
  });

  it('normalizes CRLF and CR line endings to LF', () => {
    expect(normalizePromptText('第一行\r\n第二行\r第三行')).toBe('第一行\n第二行\n第三行');
    expect(getPromptStatus('第一行\r\n第二行', defaultPrompt)).toMatchObject({
      isCustomized: false,
      label: '默认',
    });
  });
});
