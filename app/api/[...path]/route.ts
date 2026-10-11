import { env } from 'cloudflare:workers';
import { validateConfig, validateName, validateResponse, readResponse } from '@/lib/schedule';
import { enforceLimits, writePolicies, RateLimitError } from '@/lib/rate-limit';
import { createBackup, verifyBackup, BackupError, type BackupData } from '@/lib/backup';

export const dynamic = 'force-dynamic';
type Row = { id: string; title: string; description: string; config: string; admin_hash: string; created_at:number };
class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
function response(data: unknown, status = 200, headers: Record<string,string> = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers } });
}
async function hash(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new ApiError('編集・管理URLが無効です。元のURLを確認してください。', 403);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
}
function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== 'string' || value.trim().length > maximum || (required && !value.trim())) throw new ApiError(`入力は${required ? '1〜' : ''}${maximum}文字以内にしてください。`);
  return value.trim();
}
async function readBody(request: Request, maximum = 32768) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0, content = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new ApiError('入力が大きすぎます。',413); }
    content += decoder.decode(value, {stream:true});
  }
  return content + decoder.decode();
}
async function handle(request: Request) {
  try {
    const db = env.DB;
    if (!db) throw new ApiError('保存機能の準備ができていません。管理者にお知らせください。', 503);
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean).slice(1);
    const [resource, eventId, child, answerId] = segments;
    if (resource !== 'events' || segments.length > 4 || (child && !['answers','backup','restore'].includes(child)) || (child && child !== 'answers' && answerId)) throw new ApiError('ページが見つかりません。', 404);
    const method = request.method;
    let body: Record<string, unknown> = {};
    if (method !== 'GET') {
      // Consume the bounded body even for rejected writes, keeping subsequent requests usable.
      const content = await readBody(request,child==='restore' ? 1048576 : 32768);
      if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError('別のサイトからの更新は受け付けられません。', 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('JSON形式で送信してください。', 415);
      const secret = env.SERVICE_SIGNING_KEY;
      if (!secret || secret.length < 32) throw new ApiError('保護機能の準備ができていません。しばらくしてからお試しください。',503);
      await enforceLimits(db,secret,writePolicies(request,(!eventId && method==='POST') || child==='restore',child==='answers' && method==='POST' ? eventId : ''));
      try { body = JSON.parse(content); } catch { throw new ApiError('入力形式を確認してください。'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('入力形式を確認してください。');
    }
    const key = request.headers.get('x-edit-key') ?? '';
    if (!eventId && method === 'POST') {
      const title = text(body.title, 100, true), description = text(body.description ?? '', 1000);
      const config = validateConfig(body.config), adminHash = await hash(key);
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO events (id,title,description,config,admin_hash,created_at) VALUES (?,?,?,?,?,?)').bind(id,title,description,JSON.stringify(config),adminHash,Date.now()).run();
      return response({id}, 201);
    }
    if (!eventId || !/^[a-f0-9-]{36}$/.test(eventId)) throw new ApiError('ページが見つかりません。',404);
    if (child === 'restore' && method === 'POST') {
      const adminHash = await hash(key);
      const backup = await verifyBackup(body,env.SERVICE_SIGNING_KEY!,eventId,adminHash);
      if (await db.prepare('SELECT id FROM events WHERE id=?').bind(eventId).first()) throw new ApiError('このページはまだ存在します。上書き復旧はできません。',409);
      const restored = backup.event;
      const statements = [db.prepare('INSERT INTO events (id,title,description,config,admin_hash,created_at) VALUES (?,?,?,?,?,?)').bind(eventId,restored.title,restored.description,restored.config,adminHash,restored.createdAt),...backup.answers.map(answer=>db.prepare('INSERT INTO answers (id,event_id,name,slots,edit_hash,updated_at) VALUES (?,?,?,?,?,?)').bind(answer.id,eventId,answer.name,answer.slots,answer.editHash,answer.updatedAt))];
      // D1 batch commits all statements together; any conflict rolls back the entire restore.
      await db.batch(statements);
      return response({id:eventId},201);
    }
    const event = await db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<Row>();
    if (!event) throw new ApiError('この調整ページは存在しないか、削除されています。',404);
    const config = validateConfig(JSON.parse(event.config));
    if (child === 'backup' && method === 'GET') {
      if (await hash(key) !== event.admin_hash) throw new ApiError('管理URLが無効です。',403);
      if (!env.SERVICE_SIGNING_KEY) throw new ApiError('バックアップの準備ができていません。',503);
      const snapshot = await db.batch([db.prepare('SELECT * FROM events WHERE id=?').bind(eventId),db.prepare('SELECT id,name,slots,edit_hash,updated_at FROM answers WHERE event_id=? ORDER BY id').bind(eventId)]);
      const latest = snapshot[0].results[0] as Row | undefined;
      if (!latest) throw new ApiError('この調整ページは削除されています。',404);
      const answers = snapshot[1].results as {id:string;name:string;slots:string;edit_hash:string;updated_at:number}[];
      const data: BackupData = {version:1,event:{id:latest.id,title:latest.title,description:latest.description,config:latest.config,adminHash:latest.admin_hash,createdAt:latest.created_at},answers:answers.map(a=>({id:a.id,name:a.name,slots:a.slots,editHash:a.edit_hash,updatedAt:a.updated_at}))};
      return response(await createBackup(data,env.SERVICE_SIGNING_KEY),200,{'Content-Disposition':`attachment; filename="gotsugou-backup-${eventId}.json"`});
    }
    if (!child && method === 'GET') {
      if (url.searchParams.has('manage') && await hash(key) !== event.admin_hash) throw new ApiError('管理URLが無効です。',403);
      const result = await db.prepare('SELECT id,name,slots,updated_at FROM answers WHERE event_id = ? ORDER BY updated_at,id').bind(eventId).all<{id: string; name: string; slots: string; updated_at: number}>();
      return response({id:event.id,title:event.title,description:event.description,config,answers:result.results.map(a => ({id:a.id,name:a.name,...readResponse(a.slots,config),updatedAt:a.updated_at}))});
    }
    if (child === 'answers' && method === 'GET' && answerId) {
      const answer = await db.prepare('SELECT id,name,slots,updated_at FROM answers WHERE id = ? AND event_id = ? AND edit_hash = ?').bind(answerId,eventId,await hash(key)).first<{id:string;name:string;slots:string;updated_at:number}>();
      if (!answer) throw new ApiError('回答の編集URLが無効です。',403);
      return response({id:answer.id,name:answer.name,...readResponse(answer.slots,config),updatedAt:answer.updated_at});
    }
    if (child === 'answers' && ((method === 'POST' && !answerId) || (method === 'PUT' && answerId))) {
      const name = validateName(body.name), slots = JSON.stringify(validateResponse(body, config)), editHash = await hash(key);
      if (JSON.stringify(validateConfig(body.config)) !== event.config) throw new ApiError('時間枠が変更されました。再読み込みして回答してください。',409);
      if (method === 'POST') {
        const previous = await db.prepare('SELECT id FROM answers WHERE event_id = ? AND edit_hash = ?').bind(eventId, editHash).first<{id:string}>();
        if (previous) return response({id:previous.id});
        const id = crypto.randomUUID();
        const result = await db.prepare('INSERT INTO answers (id,event_id,name,slots,edit_hash,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND config = ?) AND (SELECT count(*) FROM answers WHERE event_id = ?) < 100 ON CONFLICT(edit_hash) DO NOTHING').bind(id,eventId,name,slots,editHash,Date.now(),eventId,event.config,eventId).run();
        if (!result.meta.changes) {
          const retry = await db.prepare('SELECT id FROM answers WHERE event_id = ? AND edit_hash = ?').bind(eventId,editHash).first<{id:string}>();
          if (retry) return response({id:retry.id});
          throw new ApiError('回答の上限（100名）または設定変更により保存できません。再読み込みしてください。',409);
        }
        return response({id},201);
      }
      const result = await db.prepare('UPDATE answers SET name=?,slots=?,updated_at=? WHERE id=? AND event_id=? AND edit_hash=?').bind(name,slots,Date.now(),answerId,eventId,editHash).run();
      if (!result.meta.changes) throw new ApiError('回答の編集URLが無効です。',403);
      return response({id:answerId});
    }
    if (await hash(key) !== event.admin_hash) throw new ApiError('管理URLが無効です。',403);
    if (!child && method === 'PATCH') {
      const title = text(body.title,100,true), description = text(body.description ?? '',1000), nextConfig = JSON.stringify(validateConfig(body.config));
      const result = await db.prepare('UPDATE events SET title=?,description=?,config=? WHERE id=? AND (config=? OR NOT EXISTS (SELECT 1 FROM answers WHERE event_id=?))').bind(title,description,nextConfig,eventId,nextConfig,eventId).run();
      if (!result.meta.changes) throw new ApiError('回答開始後は曜日・時間枠を変更できません。新しい調整ページを作成してください。',409);
      return response({ok:true});
    }
    if (method === 'DELETE' && child === 'answers' && answerId) {
      await db.prepare('DELETE FROM answers WHERE id=? AND event_id=?').bind(answerId,eventId).run();
      return response({ok:true});
    }
    if (!child && method === 'DELETE') {
      await db.batch([db.prepare('DELETE FROM answers WHERE event_id=?').bind(eventId),db.prepare('DELETE FROM events WHERE id=?').bind(eventId)]);
      return response({ok:true});
    }
    throw new ApiError('この操作には対応していません。',405);
  } catch (error) {
    if (error instanceof RateLimitError) return response({error:error.message},429,{'Retry-After':String(error.retryAfter)});
    if (error instanceof BackupError) return response({error:error.message},error.status);
    if (error instanceof ApiError) return response({error:error.message},error.status);
    if (error instanceof Error && /入力|ニックネーム|曜日|時刻|時間|1枠|対象|コメント/.test(error.message)) return response({error:error.message},400);
    return response({error:'保存先との通信に失敗しました。入力を残したまま、もう一度お試しください。'},500);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
