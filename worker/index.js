import { hostedIdentity, workspaceApi } from './workspaces.js'
import { createPasswordAuth, expiredPasswordCookie, hasPasswordSession, passwordAuthAvailable, passwordAuthRoute,
  passwordIdentity, passwordSessionExpired } from './password-auth.js'
import { passwordSignInLink } from '../src/sign-in-links.js'
import assets from '../dist/server/site-assets.js'

const pagePolicy = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'",
  "img-src 'self' data: blob:", "connect-src 'self'", "worker-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'",
].join('; ')
const protectedPages = new Set(['/study/index.html', '/projects/index.html', '/profile/index.html'])

async function pageOrApiAccount(request, env, url, passwordSession) {
  if (!passwordSession) return hostedIdentity(request)
  const auth = passwordAuthAvailable(env, url) ? createPasswordAuth(env) : null
  return passwordIdentity(request, auth)
}

function signInRedirect(key, url, expired) {
  const destination = key.slice(0, -'index.html'.length) + url.search
  const headers = {
    'Location': passwordSignInLink(destination),
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  }
  if (expired) headers['Set-Cookie'] = expiredPasswordCookie
  return new Response(null, { status: 303, headers })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/auth/')) return passwordAuthRoute(request, env)
    if (url.pathname.startsWith('/api/')) {
      try {
        const passwordSession = hasPasswordSession(request)
        const account = await pageOrApiAccount(request, env, url, passwordSession)
        if (passwordSession && !account) return passwordSessionExpired()
        return await workspaceApi(request, env.DB, account)
      } catch {
        return Response.json({ error: 'Account access is temporarily unavailable.' }, {
          status: 503, headers: { 'Cache-Control': 'no-store' },
        })
      }
    }
    if (url.pathname === '/healthz') {
      let storage = false
      try {
        const schema = await env.DB?.prepare(`SELECT count(*) AS available FROM sqlite_master
          WHERE (type = 'table' AND name IN ('customers', 'study_versions', 'thread_messages', 'account_profiles',
            'auth_users', 'auth_credentials', 'auth_sessions', 'auth_verifications', 'auth_rate_limits', 'auth_delivery_limits'))
             OR (type = 'trigger' AND name IN ('expire_other_customer_invites', 'expire_removed_customer_member_invites'))
             OR (type = 'index' AND name = 'study_versions_request')`).first()
        storage = schema?.available === 13
      } catch {
        // The health probe exposes availability only.
      }
      return Response.json({ frontend: true, storage }, { status: storage ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method unavailable.', { status: 405 })
    const route = url.pathname
    if (route === '/account' || route === '/account/') {
      url.pathname = '/profile/'
      return Response.redirect(url, 307)
    }
    const key = route.endsWith('/') ? route + 'index.html' : route
    if (!Object.hasOwn(assets, key)) {
      if (Object.hasOwn(assets, route + '/index.html')) {
        url.pathname += '/'
        return Response.redirect(url, 308)
      }
      return new Response('Page unavailable.', { status: 404 })
    }
    const protectedPage = protectedPages.has(key)
    if (protectedPage) {
      try {
        const passwordSession = hasPasswordSession(request)
        const account = await pageOrApiAccount(request, env, url, passwordSession)
        if (!account) return signInRedirect(key, url, passwordSession)
      } catch {
        return new Response('Workspace access is temporarily unavailable. Try again in a moment.', {
          status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '30' },
        })
      }
    }
    const [type, encoded, tag] = assets[key]
    const headers = {
      'Content-Type': type, ETag: tag,
      'Cache-Control': protectedPage ? 'private, no-store' : key.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    }
    if (key.endsWith('.html')) headers['Content-Security-Policy'] = pagePolicy
    if (!protectedPage && request.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers })
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(encoded), char => char.charCodeAt(0)), { headers })
  },
}
