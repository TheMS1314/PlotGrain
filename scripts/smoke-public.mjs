import assert from 'node:assert/strict'

const input = process.argv[2]
if (!input) throw new Error('Usage: node scripts/smoke-public.mjs https://your-plotgrain-host')
const site = new URL(input)
assert.equal(site.protocol, 'https:', 'Use an HTTPS Plotgrain origin.')
assert.equal(site.href, site.origin + '/', 'Pass the site origin without credentials, a path, or a query.')

function get(path) {
  return fetch(new URL(path, site), {
    redirect: 'manual', signal: AbortSignal.timeout(15000),
  })
}

const homepage = await get('/')
assert.equal(homepage.status, 200, 'The public homepage must open while signed out.')
assert.match(homepage.headers.get('content-security-policy') ?? '', /script-src 'self'/)
assert.match(await homepage.text(), /id="preview"/, 'The public homepage must include the example.')

const signIn = await get('/sign-in/')
assert.equal(signIn.status, 200, 'The sign-in page must be public.')
assert.match(await signIn.text(), /Continue with ChatGPT/)

const paths = [
  ['/study/', '/study/'],
  ['/study/index.html?view=garden', '/study/?view=garden'],
  ['/projects/', '/projects/'],
  ['/profile/', '/profile/'],
]
for (const [path, destination] of paths) {
  const response = await get(path)
  assert.equal(response.status, 303, path + ' must redirect guests to sign-in.')
  const location = new URL(response.headers.get('location'), site)
  assert.equal(location.origin, site.origin)
  assert.equal(location.pathname, '/sign-in/')
  assert.equal(location.searchParams.get('return') ?? '/profile/', destination)
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.equal(await response.text(), '')
}

for (const path of ['/api/account', '/api/customers']) {
  const response = await get(path)
  assert.equal(response.status, 401, path + ' must reject anonymous requests.')
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.deepEqual(Object.keys(await response.json()), ['error'])
}

const health = await get('/healthz')
assert.equal(health.status, 200, 'The production database must be healthy.')
assert.deepEqual(await health.json(), { frontend: true, storage: true })

const options = await get('/api/auth/options')
assert.equal(options.status, 200)
const { emailPassword } = await options.json()
assert.equal(typeof emailPassword, 'boolean')
if (process.argv.includes('--expect-password-signup')) {
  assert.equal(emailPassword, true, 'Email and password signup is required for this release.')
}

const hosted = await get('/signin-with-chatgpt?return_to=%2Fstudy%2F')
assert.equal(hosted.status, 302, 'The hosted sign-in route must redirect to the identity provider.')
assert.equal(new URL(hosted.headers.get('location')).origin, 'https://auth.openai.com')

console.log('Public homepage, protected workspace routes and APIs, hosted sign-in, and database health passed.')
console.log('Email and password signup is ' + (emailPassword ? 'enabled.' : 'disabled.'))
