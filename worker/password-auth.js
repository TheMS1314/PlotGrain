import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { maximumPasswordLength, minimumPasswordLength, passwordFeedback } from '../src/password-strength.js'

const basePath = '/api/auth'
const postPaths = new Set([
  '/sign-in/email', '/sign-up/email', '/sign-out', '/send-verification-email', '/request-password-reset', '/reset-password',
])
const deliveryPaths = new Set(['/sign-up/email', '/send-verification-email', '/request-password-reset'])
const newPasswordFields = new Map([['/sign-up/email', 'password'], ['/reset-password', 'newPassword']])
const recipientLimit = 5
const credentialsCookie = '__Secure-plotgrain.session_token'
export const expiredPasswordCookie = credentialsCookie + '=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax'
const minutes = value => value * 60
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
})

export function passwordAuthAvailable(env, url) {
  return Boolean(env.DB && env.PLOTGRAIN_AUTH_ORIGIN === url.origin && url.protocol === 'https:' &&
    env.PLOTGRAIN_AUTH_SECRET?.length >= 32)
}

export function authMailAvailable(env) {
  return Boolean(env.RESEND_API_KEY && env.PLOTGRAIN_AUTH_FROM)
}

async function sendEmail(env, { email, url, subject }) {
  try {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.PLOTGRAIN_AUTH_FROM, to: [email], subject,
        text: 'Open this link to continue in Plotgrain:\n\n' + url + '\n\nIf you did not request this, you can ignore this email.',
      }),
    })
    if (result.ok) return
    console.warn('Plotgrain authentication email rejected', result.status)
  } catch (error) {
    console.warn('Plotgrain authentication email transport failed', error?.name)
  }
  throw new Error('Plotgrain authentication email delivery failed.')
}

export function authOptions(env, deliver = sendEmail) {
  const mailEnabled = authMailAvailable(env)
  return {
    appName: 'Plotgrain',
    baseURL: env.PLOTGRAIN_AUTH_ORIGIN,
    basePath,
    secret: env.PLOTGRAIN_AUTH_SECRET,
    database: env.DB,
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: 'plotgrain',
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    user: { modelName: 'auth_users' },
    account: { modelName: 'auth_credentials', accountLinking: { enabled: false } },
    session: { modelName: 'auth_sessions', expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    verification: { modelName: 'auth_verifications', storeIdentifier: 'hashed' },
    rateLimit: {
      enabled: true, storage: 'database', modelName: 'auth_rate_limits', window: minutes(1), max: 30,
      customRules: {
        '/sign-in/email': { window: minutes(1), max: 8 },
        '/sign-up/email': { window: minutes(10), max: 5 },
        '/send-verification-email': { window: minutes(10), max: 3 },
        '/request-password-reset': { window: minutes(10), max: 3 },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: !mailEnabled,
      requireEmailVerification: mailEnabled,
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: minimumPasswordLength,
      maxPasswordLength: maximumPasswordLength,
      resetPasswordTokenExpiresIn: minutes(20),
      ...(mailEnabled && { sendResetPassword: ({ user, url }) => deliver(env, { email: user.email, url, subject: 'Reset your Plotgrain password' }) }),
    },
    emailVerification: {
      sendOnSignUp: mailEnabled,
      autoSignInAfterVerification: false,
      expiresIn: minutes(30),
      ...(mailEnabled && { sendVerificationEmail: ({ user, url }) => deliver(env, { email: user.email, url, subject: 'Verify your Plotgrain email' }) }),
    },
    hooks: {
      before: createAuthMiddleware(async ({ path, body }) => {
        if (newPasswordFields.has(path)) {
          const password = body?.[newPasswordFields.get(path)]
          const feedback = typeof password === 'string' ? passwordFeedback(password, body.email) : ''
          if (feedback) throw new APIError('BAD_REQUEST', { message: feedback, code: 'WEAK_PASSWORD' })
        }
        if (deliveryPaths.has(path) && typeof body?.email === 'string' && body.email.length <= 254 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) && !await reserveDelivery(env, body.email)) {
          throw new APIError('TOO_MANY_REQUESTS', { message: 'Try again later.' })
        }
      }),
    },
    logger: { disabled: true },
  }
}

export function createPasswordAuth(env) {
  return betterAuth(authOptions(env))
}

export function hasPasswordSession(request) {
  return request.headers.get('cookie')?.split(';').some(cookie => cookie.trimStart().startsWith(credentialsCookie + '=')) ?? false
}

export function passwordSessionExpired() {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Set-Cookie': expiredPasswordCookie,
  }
  return Response.json({ error: 'Your session expired. Sign in to continue.' }, { status: 401, headers })
}

export async function passwordIdentity(request, auth) {
  if (!auth || !hasPasswordSession(request)) return null
  const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } })
  const user = session?.user
  return user ? { id: 'password:' + user.id, email: user.email, provider: 'password', emailVerified: user.emailVerified === true } : null
}

async function reserveDelivery(env, email) {
  const text = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', text.encode(env.PLOTGRAIN_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, text.encode('plotgrain-auth-delivery:' + email))
  const recipient = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  const hour = Math.floor(Date.now() / 3600000)
  const written = await env.DB.prepare(`INSERT INTO auth_delivery_limits (recipient, hour, attempts)
    VALUES (?1, ?2, 1) ON CONFLICT (recipient) DO UPDATE
    SET hour = excluded.hour, attempts = CASE WHEN hour = excluded.hour THEN attempts + 1 ELSE 1 END
    WHERE hour != excluded.hour OR attempts < ?3`).bind(recipient, hour, recipientLimit).run()
  return written.meta.changes > 0
}

export async function passwordAuthRoute(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.slice(basePath.length)
  const enabled = passwordAuthAvailable(env, url)
  if (path === '/options' && request.method === 'GET') return json({
    emailPassword: enabled, emailVerification: enabled && authMailAvailable(env),
  })
  if (!enabled) return json({ error: 'Email sign-in is unavailable on this site.' }, 503)
  if (!authMailAvailable(env) && ['/send-verification-email', '/request-password-reset', '/reset-password'].includes(path)) {
    return json({ error: 'Email verification and password recovery are currently unavailable.' }, 503)
  }
  const verify = path === '/verify-email' || /^\/reset-password\/[\w-]+$/.test(path)
  if (request.method === 'POST' && postPaths.has(path)) {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'This action must start in Plotgrain.' }, 403)
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Send a JSON request.' }, 415)
    const reader = request.body?.getReader()
    if (!reader) return json({ error: 'Send a JSON request.' }, 400)
    let body = ''
    let bytes = 0
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 4096) {
        await reader.cancel()
        return json({ error: 'This request is too large.' }, 413)
      }
      body += decoder.decode(value, { stream: true })
    }
    let payload
    try { payload = JSON.parse(body + decoder.decode()) } catch {
      return json({ error: 'Send a valid JSON request.' }, 400)
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'Send a JSON object.' }, 400)
    if (typeof payload.email === 'string') payload.email = payload.email.trim().toLowerCase()
    const passwordField = newPasswordFields.get(path)
    if (passwordField) {
      if (typeof payload[passwordField] !== 'string' || payload.confirmation !== payload[passwordField]) {
        return json({ code: 'PASSWORD_MISMATCH', error: 'Passwords must match.' }, 400)
      }
      delete payload.confirmation
    }
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    request = new Request(request.url, { method: 'POST', headers, body: JSON.stringify(payload) })
  } else if (request.method !== 'GET' || !verify) {
    return json({ error: 'Endpoint unavailable.' }, 404)
  }
  try {
    const response = await createPasswordAuth(env).handler(request)
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    headers.set('Referrer-Policy', 'no-referrer')
    return new Response(response.body, { status: response.status, headers })
  } catch (error) {
    console.error('Plotgrain password auth request failed', error?.name)
    return json({ error: 'Sign-in could not complete. Try again.' }, 503)
  }
}
