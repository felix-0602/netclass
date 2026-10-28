// 用户偏好设置 — localStorage 持久化，跨页面保留

const KEY_ESSAY = 'netclass:essay_enabled';
const KEY_ASK_SUBMIT = 'netclass:ask_before_submit';
const KEY_AUTO_SUBMIT = 'netclass:auto_submit';

function getBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
}

function setBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch { /* quota / sandbox */ }
}

export const userSettings = {
  get essayEnabled(): boolean {
    return getBool(KEY_ESSAY, true);
  },
  set essayEnabled(v: boolean) {
    setBool(KEY_ESSAY, v);
  },

  get askBeforeSubmit(): boolean {
    return getBool(KEY_ASK_SUBMIT, false);
  },
  set askBeforeSubmit(v: boolean) {
    setBool(KEY_ASK_SUBMIT, v);
  },

  get autoSubmit(): boolean {
    return getBool(KEY_AUTO_SUBMIT, true);
  },
  set autoSubmit(v: boolean) {
    setBool(KEY_AUTO_SUBMIT, v);
  },
};
