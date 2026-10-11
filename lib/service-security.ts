export async function signingKey(secret: string) {
  if (secret.length < 32) throw new Error('保護機能の設定が不足しています。');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
export async function signature(secret: string, content: string) {
  const digest = await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte=>byte.toString(16).padStart(2,'0')).join('');
}
