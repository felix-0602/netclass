// 轻量级 JWT HS256 签发/校验
// 为什么不用第三方库：Workers 运行时有原生 crypto.subtle，8 行能搞定

export interface JwtPayload {
  sub: string; // user.id
  plan: 'monthly' | 'lifetime' | 'admin';
  exp: number; // unix seconds
  fp: string; // device fingerprint hash
}

const encoder = new TextEncoder();

function base64urlEncode(bytes: ArrayBuffer | Uint8Array | string): string {
  let data: Uint8Array;
  if (typeof bytes === 'string') data = encoder.encode(bytes);
  else if (bytes instanceof ArrayBuffer) data = new Uint8Array(bytes);
  else data = bytes;
  let binary = '';
  for (let i = 0; i < data.byteLength; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(data));
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64urlEncode(JSON.stringify(header));
  const p = base64urlEncode(JSON.stringify(payload));
  const sig = await hmacSha256(secret, `${h}.${p}`);
  return `${h}.${p}.${base64urlEncode(sig)}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = await hmacSha256(secret, `${h}.${p}`);
  const expectedB64 = base64urlEncode(expected);
  if (expectedB64 !== s) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(p))) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
    return payload;
  } catch {
    return null;
  }
}
