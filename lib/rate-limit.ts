import { signature } from './service-security.ts';

export class RateLimitError extends Error {
  retryAfter:number;
  constructor(retryAfter: number) { super(`操作が続いているため、約${Math.ceil(retryAfter/60)}分後にもう一度お試しください。入力内容はそのまま残っています。`); this.retryAfter=retryAfter; }
}
export type RatePolicy = {scope:string;subject:string;limit:number;seconds:number};
export function writePolicies(request: Request, creating: boolean, eventId = ''): RatePolicy[] {
  // Cloudflare supplies this header at its edge. Never trust client-selected keys or X-Forwarded-For.
  const address = request.headers.get('cf-connecting-ip') || 'unavailable';
  const policies: RatePolicy[] = [{scope:'writes',subject:address,limit:120,seconds:600}];
  if (creating) policies.push({scope:'create',subject:address,limit:10,seconds:3600});
  if (eventId) policies.push({scope:'answers',subject:eventId,limit:60,seconds:60});
  if (creating) policies.push({scope:'create-global',subject:'all',limit:200,seconds:86400});
  return policies;
}
export async function enforceLimits(db: D1Database, secret: string, policies: RatePolicy[], now = Date.now()) {
  // Indexed, bounded lifetime: only operational counters are cleaned up, never meeting data.
  await db.prepare('DELETE FROM request_limits WHERE expires_at <= ?').bind(now).run();
  for (const policy of policies) {
    const period = policy.seconds*1000, window = Math.floor(now/period);
    const expires = (window+1)*period;
    const id = await signature(secret, `${policy.scope}:${policy.subject}:${window}`);
    const result = await db.prepare('INSERT INTO request_limits (id,hits,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET hits=hits+1 WHERE hits < ? RETURNING hits').bind(id,expires,policy.limit).first<{hits:number}>();
    if (!result) throw new RateLimitError(Math.max(1,Math.ceil((expires-now)/1000)));
  }
}
