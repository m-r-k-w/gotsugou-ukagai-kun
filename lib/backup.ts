import { validateConfig, validateName, readResponse } from './schedule.ts';
import { signature, signingKey } from './service-security.ts';

export type BackupData = {
  version:1;
  event:{id:string;title:string;description:string;config:string;adminHash:string;createdAt:number};
  answers:{id:string;name:string;slots:string;editHash:string;updatedAt:number}[];
};
export type BackupFile = {format:'gotsugou-backup';payload:string;signature:string};
export class BackupError extends Error {
  status:number;
  constructor(message = 'バックアップが無効です。元のファイルと管理URLを確認してください。', status = 400) { super(message); this.status=status; }
}
export async function createBackup(data: BackupData, secret: string): Promise<BackupFile> {
  const payload = JSON.stringify(data);
  return {format:'gotsugou-backup',payload,signature:await signature(secret,`backup:${payload}`)};
}
export async function verifyBackup(value: unknown, secret: string, eventId: string, adminHash: string): Promise<BackupData> {
  if (!value || typeof value !== 'object') throw new BackupError();
  const file = value as BackupFile;
  if (file.format !== 'gotsugou-backup' || typeof file.payload !== 'string' || file.payload.length > 1048576 || typeof file.signature !== 'string' || !/^[a-f0-9]{64}$/.test(file.signature)) throw new BackupError();
  const bytes = Uint8Array.from(file.signature.match(/../g)!, byte=>parseInt(byte,16));
  const verified = await crypto.subtle.verify('HMAC', await signingKey(secret), bytes, new TextEncoder().encode(`backup:${file.payload}`));
  if (!verified) throw new BackupError('バックアップの改変・破損を検出しました。元のファイルを選んでください。',403);
  let data: BackupData;
  try { data = JSON.parse(file.payload); } catch { throw new BackupError(); }
  const meeting = data?.event;
  if (data?.version !== 1 || !meeting || meeting.id !== eventId || meeting.adminHash !== adminHash) throw new BackupError('このバックアップと管理URLの組み合わせが一致しません。',403);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!uuid.test(meeting.id) || typeof meeting.title !== 'string' || !meeting.title.trim() || meeting.title.length > 100 || typeof meeting.description !== 'string' || meeting.description.length > 1000 || !Number.isSafeInteger(meeting.createdAt) || meeting.createdAt < 0 || typeof meeting.config !== 'string') throw new BackupError();
  if (!Array.isArray(data.answers) || data.answers.length > 100 || new Set(data.answers.map(a=>a?.id)).size !== data.answers.length || new Set(data.answers.map(a=>a?.editHash)).size !== data.answers.length) throw new BackupError();
  try {
    const config = validateConfig(JSON.parse(meeting.config));
    for (const answer of data.answers) {
      if (!answer || !uuid.test(answer.id) || typeof answer.editHash !== 'string' || !/^[a-f0-9]{64}$/.test(answer.editHash) || !Number.isSafeInteger(answer.updatedAt) || answer.updatedAt < 0 || typeof answer.slots !== 'string') throw new BackupError();
      validateName(answer.name); readResponse(answer.slots,config);
    }
  } catch { throw new BackupError(); }
  return data;
}
