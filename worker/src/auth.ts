/**
 * worker/src/auth.ts —— 匿名身份自签 token（HMAC-SHA256）
 * 客户端生成 UID（crypto.randomUUID）持久化在 localStorage；服务端以 UID 签发带过期
 * 时间的签名 token，业务接口一律校验 token（token 即匿名凭据）。
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToB64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return new Uint8Array(sig)
}

export interface AuthPayload {
  uid: string
  exp: number
}

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000

export async function signToken(secret: string, uid: string): Promise<string> {
  const payload = bytesToB64url(encoder.encode(JSON.stringify({ uid, exp: Date.now() + TOKEN_TTL_MS })))
  const sig = await hmacSha256(secret, payload)
  return `${payload}.${bytesToB64url(sig)}`
}

export async function verifyToken(secret: string, token: string | null | undefined): Promise<AuthPayload | null> {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expect = bytesToB64url(await hmacSha256(secret, payload))
  // 常量化比较（避免时序差异）
  if (sig.length !== expect.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const data = JSON.parse(decoder.decode(b64urlToBytes(payload))) as AuthPayload
    if (typeof data.uid !== 'string' || data.uid.length === 0) return null
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null
    return data
  } catch {
    return null
  }
}

/** 从 Authorization: Bearer <token> 取 token */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header || !header.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}
