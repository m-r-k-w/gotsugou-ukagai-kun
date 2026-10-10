export const DAYS = ['月', '火', '水', '木', '金', '土', '日', '祝'];
export const NOTICE = 'このページは、ミーティングの都合確認・調整のためだけに使います。ニックネームで回答し、本名・連絡先などの個人情報は入力しないでください。';
export type Schedule = { days: number[]; start: number; end: number; extraStart: number; extraEnd: number; step: number };
export type Answer = { id: string; name: string; slots: string[]; updatedAt: number };
export type Meeting = { id: string; title: string; description: string; config: Schedule; answers: Answer[] };
export const DEFAULT_CONFIG: Schedule = { days: [0,1,2,3,4], start: 1080, end: 1320, extraStart: 480, extraEnd: 1320, step: 30 };
export function time(minute: number) { return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`; }
export function range(config: Schedule, day: number) { return day < 5 ? [config.start, config.end] : [config.extraStart, config.extraEnd]; }
export function slotKey(day: number, minute: number) { return `${day}:${minute}`; }
export function allSlots(config: Schedule) {
  return config.days.flatMap(day => {
    const [start, end] = range(config, day);
    return Array.from({length: (end - start) / config.step}, (_, i) => slotKey(day, start + i * config.step));
  });
}
export function slotLabel(key: string, step: number) {
  const [day, minute] = key.split(':').map(Number);
  return `${DAYS[day]}${day === 7 ? '日' : '曜'} ${time(minute)}〜${time(minute + step)}`;
}
export function validateConfig(value: unknown): Schedule {
  if (!value || typeof value !== 'object') throw new Error('曜日・時間の設定を確認してください。');
  const v = value as Schedule;
  if (!Array.isArray(v.days) || !v.days.length || v.days.length > 8 || new Set(v.days).size !== v.days.length || v.days.some(d => !Number.isInteger(d) || d < 0 || d > 7)) throw new Error('対象曜日を1つ以上選んでください。');
  if (![30, 60].includes(v.step)) throw new Error('1枠は30分または60分にしてください。');
  for (const [start, end] of [[v.start, v.end], [v.extraStart, v.extraEnd]]) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end || start % 30 || end % 30 || (end - start) % v.step) throw new Error('開始・終了時刻と1枠の長さを確認してください。');
  }
  return { days: [...v.days].sort((a,b) => a-b), start: v.start, end: v.end, extraStart: v.extraStart, extraEnd: v.extraEnd, step: v.step };
}
export function validateName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('ニックネームを1〜40文字で入力してください。');
  return value.trim();
}
export function validateSlots(value: unknown, config: Schedule): string[] {
  const allowed = new Set(allSlots(config));
  if (!Array.isArray(value) || value.length > allowed.size || value.some(v => typeof v !== 'string' || !allowed.has(v)) || new Set(value).size !== value.length) throw new Error('選択した時間帯が無効です。ページを再読み込みしてください。');
  return [...value].sort();
}
export function rankSlots(meeting: Meeting) {
  const counts = new Map(allSlots(meeting.config).map(key => [key, 0]));
  for (const answer of meeting.answers) for (const key of new Set(answer.slots)) if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
  const sorted = [...counts].map(([key, count]) => ({key, count})).sort((a,b) => b.count - a.count || Number(a.key.split(':')[0]) - Number(b.key.split(':')[0]) || Number(a.key.split(':')[1]) - Number(b.key.split(':')[1]));
  let rank = 0, previous = -1;
  return sorted.map((slot, i) => { if (slot.count !== previous) rank = i + 1; previous = slot.count; return {...slot, rank}; });
}
export function randomKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}
// Sample intermediate pointer positions so fast strokes do not skip cells.
export function strokePoints(from: {x: number; y: number}, to: {x: number; y: number}) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x-from.x, to.y-from.y) / 6));
  return Array.from({length: steps}, (_, i) => ({x: from.x+(to.x-from.x)*(i+1)/steps, y: from.y+(to.y-from.y)*(i+1)/steps}));
}
