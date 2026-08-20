export interface PromptStatus {
  isCustomized: boolean;
  label: '默认' | '已修改';
}

/** 将换行差异归一化，避免平台换行格式影响提示词状态判断。 */
export function normalizePromptText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function getPromptStatus(current: string, defaultValue: string): PromptStatus {
  const isCustomized = normalizePromptText(current) !== normalizePromptText(defaultValue);

  return {
    isCustomized,
    label: isCustomized ? '已修改' : '默认',
  };
}
