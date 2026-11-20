import assert from 'node:assert/strict'
import test from 'node:test'
import { createPasswordAuth, passwordAuthRoute, passwordIdentity } from './password-auth.js'
import { workspaceApi } from './workspaces.js'
import { testDatabase } from './sqlite-test-db.js'

const origin = 'https://plotgrain.test'
const email = 'customer@example.test'
const password = 'Dusty violin - luminous airport'
const newPassword = 'Marble kettle. Silent tropical sunrise'

test('email sign-up, verification, secure sessions, password reset and invalidation', async t => {
  const DB = testDatabase()
  const env = {
    DB, PLOTGRAIN_AUTH_ORIGIN: origin, PLOTGRAIN_AUTH_SECRET: 'unused-randomized-test-secret-74214d028ad388f2c',
    PLOTGRAIN_AUTH_FROM: 'Plotgrain <welcome@example.test>', RESEND_API_KEY: 'test-only',
  }
  const deliveries = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails')
    deliveries.push(JSON.parse(options.body))
    return Response.json({ id: 'test-email' })
  })
  const call = (path, body, headers = {}) => passwordAuthRoute(new Request(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'cf-connecting-ip': '192.0.2.1', origin, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env)
  const post = (path, body, headers) => call('/api/auth/' + path, body, headers)
  const signUp = { name: 'Plotgrain member', email, password, confirmation: password, callbackURL: '/sign-in/?verified=1' }
  assert.equal((await post('sign-up/email', signUp, { origin: 'https://other.test' })).status, 403)
  const mismatch = await post('sign-up/email', { ...signUp, confirmation: 'different' })
  assert.equal(mismatch.status, 400)
  assert.equal((await mismatch.json()).code, 'PASSWORD_MISMATCH')
  const weak = await post('sign-up/email', { ...signUp, password: 'passwordpassword', confirmation: 'passwordpassword' })
  assert.equal(weak.status, 400)
  assert.equal((await weak.json()).code, 'WEAK_PASSWORD')
  assert.equal(deliveries.length, 0)
  const signup = await post('sign-up/email', signUp)
  assert.equal(signup.status, 200, await signup.text())
  assert.equal(signup.headers.get('set-cookie'), null)
  assert.equal(deliveries.length, 1)
  assert.deepEqual(deliveries[0].to, [email])
  const stored = DB.raw.prepare('SELECT password FROM auth_credentials').get().password
  assert.notEqual(stored, password)
  assert.ok(stored.length > password.length)
  assert.equal((await post('sign-in/email', { email, password })).status, 403)

  const verify = await call(deliveries[0].text.match(/https:\/\/[^\s]+/)[0])
  assert.equal(verify.status, 302, await verify.text())
  assert.equal(new URL(verify.headers.get('location'), origin).href, origin + '/sign-in/?verified=1')
  const duplicate = await post('sign-up/email', { ...signUp, email: email.toUpperCase() })
  assert.equal(duplicate.status, 200, await duplicate.text())
  assert.equal(deliveries.length, 1)
  assert.equal(DB.raw.prepare('SELECT count(*) AS count FROM auth_users').get().count, 1)

  const signedIn = await post('sign-in/email', { email, password })
  assert.equal(signedIn.status, 200, await signedIn.text())
  const setCookie = signedIn.headers.get('set-cookie')
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(setCookie.includes(attribute))
  const cookie = setCookie.split(';')[0]
  const request = new Request(origin + '/api/account', { headers: { cookie } })
  const actor = await passwordIdentity(request, createPasswordAuth(env))
  assert.equal(actor?.email, email)
  assert.match(actor.id, /^password:/)
  assert.equal((await (await workspaceApi(request, DB, actor)).json()).provider, 'password')
  assert.equal((await workspaceApi(request, DB)).status, 401)

  assert.equal((await post('request-password-reset', { email, redirectTo: '/sign-in/?mode=reset' })).status, 200)
  assert.equal(deliveries.length, 2)
  const reset = await call(deliveries[1].text.match(/https:\/\/[^\s]+/)[0])
  assert.equal(reset.status, 302, await reset.text())
  const token = new URL(reset.headers.get('location'), origin).searchParams.get('token')
  assert.ok(token)
  const verification = DB.raw.prepare('SELECT identifier FROM auth_verifications').get()
  assert.ok(verification && !verification.identifier.includes(token))
  const invalidReset = await post('reset-password', { token, newPassword })
  assert.equal((await invalidReset.json()).code, 'PASSWORD_MISMATCH')
  assert.equal((await post('reset-password', { token, newPassword: 'passwordpassword', confirmation: 'passwordpassword' })).status, 400)
  assert.equal((await post('reset-password', { token, newPassword, confirmation: newPassword })).status, 200)
  assert.equal((await post('reset-password', { token, newPassword, confirmation: newPassword })).status, 400)
  assert.equal(await passwordIdentity(request, createPasswordAuth(env)), null)
  assert.equal((await post('sign-in/email', { email, password })).status, 401)
  const signedInAgain = await post('sign-in/email', { email, password: newPassword })
  assert.equal(signedInAgain.status, 200)
  const freshCookie = signedInAgain.headers.get('set-cookie').split(';')[0]
  assert.equal((await post('sign-out', {}, { cookie: freshCookie })).status, 200)
  const after = new Request(origin + '/api/account', { headers: { cookie: freshCookie } })
  assert.equal(await passwordIdentity(after, createPasswordAuth(env)), null)
  assert.ok(DB.raw.prepare('SELECT count(*) AS count FROM auth_rate_limits').get().count > 0)
  const wrongPassword = { email, password: 'Wrong passphrase for this test' }
  for (let attempt = 0; attempt < 8; attempt++) {
    assert.equal((await post('sign-in/email', wrongPassword, { 'cf-connecting-ip': '192.0.2.2' })).status, 401)
  }
  assert.equal((await post('sign-in/email', wrongPassword, { 'cf-connecting-ip': '192.0.2.2' })).status, 429)
  const resetRequest = { email: ' unknown@EXAMPLE.test ', redirectTo: '/sign-in/?mode=reset' }
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post('request-password-reset', resetRequest, { 'cf-connecting-ip': '192.0.2.' + (10 + attempt) })).status, 200)
  }
  assert.equal((await post('send-verification-email', { email: 'unknown@example.test' },
    { 'cf-connecting-ip': '192.0.2.20' })).status, 429)
  const limit = DB.raw.prepare('SELECT recipient FROM auth_delivery_limits WHERE attempts = 5').get()
  assert.match(limit.recipient, /^[a-f\d]{64}$/)
  DB.raw.prepare('UPDATE auth_delivery_limits SET hour = 0 WHERE recipient = ?').run(limit.recipient)
  assert.equal((await post('request-password-reset', resetRequest, { 'cf-connecting-ip': '192.0.2.21' })).status, 200)
})

test('password auth requires complete configuration', async () => {
  const env = { DB: testDatabase() }
  const options = await passwordAuthRoute(new Request(origin + '/api/auth/options'), env)
  assert.deepEqual(await options.json(), { emailPassword: false, emailVerification: false })
  assert.equal((await passwordAuthRoute(new Request(origin + '/api/auth/sign-in/email', { method: 'POST' }), env)).status, 503)
})

test('an unverified password account can own work but cannot claim an invited email', async () => {
  const DB = testDatabase()
  const env = { DB, PLOTGRAIN_AUTH_ORIGIN: origin, PLOTGRAIN_AUTH_SECRET: 'independent-test-secret-35d790fe616ec543' }
  const signup = await passwordAuthRoute(new Request(origin + '/api/auth/sign-up/email', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.81' },
    body: JSON.stringify({ email, name: 'Independent member', password, confirmation: password }),
  }), env)
  assert.equal(signup.status, 200, await signup.clone().text())
  const cookie = signup.headers.get('set-cookie').split(';')[0]
  const request = new Request(origin + '/api/account', { headers: { cookie } })
  const actor = await passwordIdentity(request, createPasswordAuth(env))
  assert.equal(actor.emailVerified, false)
  const profile = await workspaceApi(request, DB, actor)
  assert.equal(profile.status, 200)
  const invite = await workspaceApi(new Request(origin + '/api/invites/accept', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'a'.repeat(64) }),
  }), DB, actor)
  assert.equal(invite.status, 403)
  const duplicate = await passwordAuthRoute(new Request(origin + '/api/auth/sign-up/email', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.82' },
    body: JSON.stringify({ email, name: 'Duplicate', password, confirmation: password }),
  }), env)
  assert.notEqual(duplicate.status, 200)
  assert.equal(DB.raw.prepare('SELECT count(*) AS count FROM auth_users').get().count, 1)
})
