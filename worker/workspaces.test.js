import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { workspaceApi } from './workspaces.js'
import { testDatabase } from './sqlite-test-db.js'
import { encodeWorkspaceDraft } from '../src/workspace-draft.js'

const origin = 'https://plotgrain.test'
const parcel = { points: [[100, 13], [100.01, 13], [100.01, 13.01]], name: 'A plot', role: 'parcel', use: 'residential' }
const snapshot = encodeWorkspaceDraft([parcel], parcel, { view: 'envelope', slice: 9 })
const users = { a: 'a@example.test', b: 'b@example.test', c: 'c@example.test' }

function client(db, user) {
  return async (path, content, headers = {}) => {
    const method = content === undefined ? 'GET' : 'POST'
    const request = new Request(origin + '/api/' + path, {
      method,
      headers: {
        ...(user && { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': users[user] }),
        ...(content !== undefined && { Origin: origin, 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(content !== undefined && { body: JSON.stringify(content) }),
    })
    const response = await workspaceApi(request, db)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    return { status: response.status, json: await response.json() }
  }
}

async function createProject(member) {
  const customer = await member('customers', { name: 'Customer Alpha' })
  assert.equal(customer.status, 201)
  const project = await member('customers/' + customer.json.id + '/projects', { name: 'Bang Son' })
  assert.equal(project.status, 201)
  return { customer: customer.json.id, project: project.json.id }
}

test('signed-out callers and cross-origin writes cannot use customer storage', async () => {
  const db = testDatabase()
  assert.equal((await client(db)('customers')).status, 401)
  assert.equal((await client(db)('customers', { name: 'Try' })).status, 401)
  const a = client(db, 'a')
  assert.equal((await a('customers', { name: 'Try' }, { Origin: 'https://other.test' })).status, 403)
  assert.deepEqual((await a('customers')).json.customers, [])
})

test('profiles persist by verified account ID and require a same-origin authenticated write', async () => {
  const db = testDatabase()
  const a = client(db, 'a'), b = client(db, 'b')
  assert.equal((await client(db)('account?recent=1')).status, 401)
  assert.equal((await client(db)('account', { displayName: 'Anonymous' })).status, 401)
  assert.equal((await a('account', { displayName: 'A' }, { Origin: 'https://other.test' })).status, 403)
  for (const displayName of ['', '    ', 'a'.repeat(81), 'First\nSecond', 42]) {
    assert.equal((await a('account', { displayName })).status, 422)
  }
  const profile = await a('account', { userId: 'b', email: users.b, displayName: '  มีร์ Patel  ' })
  assert.deepEqual(profile, { status: 200, json: { email: users.a, displayName: 'มีร์ Patel' } })
  assert.deepEqual((await client(db, 'a')('account', undefined, {
    'oai-authenticated-user-email': 'new@example.test',
  })).json, { email: 'new@example.test', displayName: 'มีร์ Patel' })
  assert.deepEqual((await b('account?recent=1')).json, { email: users.b, displayName: '', recentStudies: [] })
  assert.equal((await a('account', { displayName: 'Updated' })).status, 200)
  assert.equal((await b('account', { displayName: 'Updated' })).status, 200)
  assert.equal(db.raw.prepare('SELECT count(*) AS count FROM account_profiles').get().count, 2)
  assert.deepEqual((await a('account')).json, { email: users.a, displayName: 'Updated' })
})

test('recent study versions honor invitations and access revocation', async () => {
  const db = testDatabase()
  const a = client(db, 'a'), b = client(db, 'b')
  const { customer, project } = await createProject(a)
  const study = (await a('projects/' + project + '/studies', { name: 'Envelope', snapshot })).json.id
  await a('projects/' + project + '/studies', { name: 'Unsaved study' })
  await a('studies/' + study + '/versions', { snapshot, label: 'Client review', expectedVersion: 1 })
  const own = (await a('account?recent=1')).json.recentStudies
  assert.equal(own.length, 1)
  assert.deepEqual(own.map(({ id, customer, project, version, label }) => ({ id, customer, project, version, label })),
    [{ id: study, customer: 'Customer Alpha', project: 'Bang Son', version: 2, label: 'Client review' }])
  assert.deepEqual((await b('account?recent=1')).json.recentStudies, [])
  const invite = await a('customers/' + customer + '/invites', { email: users.b, role: 'viewer' })
  assert.equal((await b('invites/accept', { token: invite.json.token })).status, 200)
  assert.deepEqual((await b('account?recent=1')).json.recentStudies, own)
  assert.equal((await a('customers/' + customer + '/members', { userId: 'b' })).status, 200)
  assert.deepEqual((await b('account?recent=1')).json.recentStudies, [])
})

test('projects, threads, exports and study versions stay within their customer', async () => {
  const db = testDatabase()
  const a = client(db, 'a'), b = client(db, 'b')
  const { customer, project } = await createProject(a)
  const study = (await a('projects/' + project + '/studies', { name: 'Envelope', snapshot })).json.id
  const thread = (await a('projects/' + project + '/threads', { name: 'Road evidence' })).json.id
  assert.equal((await a('threads/' + thread + '/messages', { message: 'Survey uploaded.' })).status, 201)
  await createProject(b)
  const visible = (await b('customers')).json.customers
  assert.equal(visible.length, 1)
  assert.notEqual(visible[0].id, customer)
  for (const path of [
    'customers/' + customer, 'projects/' + project, 'studies/' + study,
    'studies/' + study + '/versions', 'studies/' + study + '/versions/1', 'threads/' + thread + '/messages',
  ]) assert.equal((await b(path)).status, 404, path)
  assert.equal((await b('projects/' + project + '/studies', { name: 'Cross-customer'})).status, 404)
  assert.equal((await b('studies/' + study + '/versions', { snapshot, label: 'Cross-customer', expectedVersion: 1 })).status, 404)
  assert.equal((await a('studies/' + study)).json.snapshot, snapshot)
  assert.equal((await a('threads/' + thread + '/messages')).json.messages[0].body, 'Survey uploaded.')
})

test('one-use email-bound invitations grant the selected role and removal revokes it', async () => {
  const db = testDatabase()
  const a = client(db, 'a'), b = client(db, 'b'), c = client(db, 'c')
  const { customer, project } = await createProject(a)
  const invite = await a('customers/' + customer + '/invites', { email: users.b, role: 'viewer' })
  assert.equal(invite.status, 201)
  const { token } = invite.json
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.notEqual(db.raw.prepare('SELECT digest FROM customer_invites').get().digest, token)
  assert.equal((await c('invites/accept', { token })).status, 404)
  assert.equal((await b('invites/accept', { token })).status, 200)
  assert.equal((await b('projects/' + project)).json.project.role, 'viewer')
  assert.equal((await b('projects/' + project + '/threads', { name: 'Read only' })).status, 403)
  assert.equal((await b('customers/' + customer + '/invites', { email: users.c, role: 'editor' })).status, 403)
  assert.equal((await a('customers/' + customer + '/members', { userId: 'b' })).status, 200)
  assert.equal((await b('projects/' + project)).status, 404)
  assert.equal((await b('invites/accept', { token })).status, 404)
  assert.equal((await b('projects/' + project)).status, 404)
  const editor = await a('customers/' + customer + '/invites', { email: users.c, role: 'editor' })
  assert.equal((await c('invites/accept', { token: editor.json.token })).status, 200)
  assert.equal((await c('projects/' + project + '/threads', { name: 'Editor contribution' })).status, 201)
  const expired = await a('customers/' + customer + '/invites', { email: users.b, role: 'editor' })
  db.raw.prepare('UPDATE customer_invites SET expires_at = 0 WHERE accepted_by IS NULL').run()
  assert.equal((await b('invites/accept', { token: expired.json.token })).status, 404)
  const revoked = await a('customers/' + customer + '/invites', { email: users.b, role: 'editor' })
  const pending = (await a('customers/' + customer)).json.invitations
  assert.equal(pending.length, 1)
  assert.equal((await a('customers/' + customer + '/revoke-invite', { digest: pending[0].digest })).status, 200)
  assert.equal((await b('invites/accept', { token: revoked.json.token })).status, 404)
})

test('version writes reject stale submissions and restoring creates a separate revision', async () => {
  const db = testDatabase()
  const a = client(db, 'a')
  const { project } = await createProject(a)
  assert.equal((await a('projects/' + project + '/studies', { name: 'Invalid', snapshot: '{}' })).status, 422)
  assert.deepEqual((await a('projects/' + project)).json.studies, [])
  const study = (await a('projects/' + project + '/studies', { name: 'Project study' })).json.id
  const path = 'studies/' + study + '/versions'
  const first = await a(path, { expectedVersion: 0, label: 'Initial', snapshot })
  assert.equal(first.status, 201)
  assert.equal((await a(path, { expectedVersion: 0, label: 'Stale edit', snapshot })).status, 409)
  const updated = JSON.stringify({ ...JSON.parse(snapshot), view: '1' })
  assert.equal((await a(path, { expectedVersion: 1, label: 'Revised', snapshot: updated })).status, 201)
  const restored = await a(path + '/1', { expectedVersion: 2, label: 'Restored from first study' })
  assert.equal(restored.json.version, 3)
  assert.equal((await a('studies/' + study)).json.snapshot, snapshot)
  const versions = (await a(path)).json.versions
  assert.deepEqual(versions.map(item => [item.version, item.restored_from]), [[3, 1], [2, null], [1, null]])
})

test('save receipts deduplicate concurrent writes and reject reuse for different edits', async () => {
  const db = testDatabase()
  const a = client(db, 'a'), b = client(db, 'b')
  const { customer, project } = await createProject(a)
  const study = (await a('projects/' + project + '/studies', { name: 'Receipts' })).json.id
  const path = 'studies/' + study + '/versions'
  const original = { expectedVersion: 0, label: 'First version', snapshot, requestId: crypto.randomUUID() }
  const concurrent = await Promise.all([a(path, original), a(path, original)])
  assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 201])
  assert.ok(concurrent.every(item => item.json.version === 1))
  assert.deepEqual((await a(path, { ...original, requestId: original.requestId.toUpperCase() })).json, { version: 1 })
  assert.equal((await a(path, { ...original, label: 'Different edits' })).status, 409)
  assert.equal((await a(path, { ...original, requestId: 'invalid' })).status, 422)
  assert.equal((await b(path, original)).status, 404)

  const invite = await a('customers/' + customer + '/invites', { email: users.b, role: 'editor' })
  await b('invites/accept', { token: invite.json.token })
  assert.equal((await b(path, original)).status, 409)
  const next = { ...original, expectedVersion: 1, requestId: crypto.randomUUID() }
  assert.equal((await b(path, next)).status, 201)
  assert.deepEqual((await a(path, original)).json, { version: 1 })
  const restore = { expectedVersion: 2, label: 'Restored', requestId: crypto.randomUUID() }
  assert.equal((await a(path + '/1', restore)).status, 201)
  assert.deepEqual((await a(path + '/1', restore)).json, { version: 3 })
  assert.equal((await a(path + '/2', restore)).status, 409)
  assert.deepEqual((await a(path)).json.versions.map(row => row.version), [3, 2, 1])
})

test('invites deduplicate by customer and email and stale links cannot restore removed access', async () => {
  const db = testDatabase()
  const a = client(db, 'a'), b = client(db, 'b')
  const { customer, project } = await createProject(a)
  const path = 'customers/' + customer + '/invites'
  const issued = await Promise.all([
    a(path, { email: users.b, role: 'viewer' }),
    a(path, { email: users.b.toUpperCase(), role: 'editor' }),
  ])
  assert.deepEqual(issued.map(invite => invite.status).sort(), [201, 409])
  const live = issued.find(invite => invite.status === 201)
  const legacyInvite = token => db.raw.prepare(`INSERT INTO customer_invites
    (digest, customer_id, email, role, expires_at) VALUES (?, ?, ?, 'editor', ?)`)
    .run(createHash('sha256').update(token).digest('hex'), customer, users.b, live.json.expires)
  const beforeAcceptance = '1'.repeat(64)
  legacyInvite(beforeAcceptance)
  assert.equal((await b('invites/accept', { token: live.json.token })).status, 200)
  assert.equal((await b('invites/accept', { token: beforeAcceptance })).status, 404)
  assert.equal((await a(path, { email: users.b, role: 'editor' })).status, 409)
  const second = await createProject(a)
  assert.equal((await a('customers/' + second.customer + '/invites', { email: users.b, role: 'viewer' })).status, 201)
  const beforeRemoval = '2'.repeat(64)
  legacyInvite(beforeRemoval)
  assert.equal((await a('customers/' + customer + '/members', { userId: 'b' })).status, 200)
  assert.equal((await b('invites/accept', { token: beforeRemoval })).status, 404)
  assert.equal((await b('projects/' + project)).status, 404)
  assert.equal((await a(path, { email: users.b, role: 'viewer' })).status, 201)
})

test('renaming checks permissions, detects concurrent edits and preserves version history', async () => {
  const db = testDatabase()
  const owner = client(db, 'a'), editor = client(db, 'b'), outsider = client(db, 'c')
  const { customer, project } = await createProject(owner)
  const study = (await owner('projects/' + project + '/studies', { name: 'Study', snapshot })).json.id
  const thread = (await owner('projects/' + project + '/threads', { name: 'Discussion' })).json.id
  const invite = await owner('customers/' + customer + '/invites', { email: users.b, role: 'editor' })
  await editor('invites/accept', { token: invite.json.token })
  assert.equal((await editor('customers/' + customer + '/rename', { name: 'Changed', expectedName: 'Customer Alpha' })).status, 403)
  for (const [root, key, previous] of [
    ['customers', customer, 'Customer Alpha'], ['projects', project, 'Bang Son'],
    ['studies', study, 'Study'], ['threads', thread, 'Discussion'],
  ]) {
    const path = root + '/' + key + '/rename'
    const renamed = { name: previous + ' revised', expectedName: previous }
    assert.equal((await outsider(path, renamed)).status, 404)
    assert.equal((await owner(path, { ...renamed, name: 'Line\nbreak' })).status, 422)
    assert.equal((await owner(path, { ...renamed, name: ' ' })).status, 422)
    assert.equal((await owner(path, renamed)).status, 200)
    assert.equal((await owner(path, renamed)).status, 200)
    assert.equal((await owner(path, { ...renamed, name: 'Overwrite' })).status, 409)
  }
  assert.equal((await editor('studies/' + study + '/rename', { name: 'Editor revision', expectedName: 'Study revised' })).status, 200)
  assert.equal((await owner('studies/' + study)).json.study.name, 'Editor revision')
  assert.equal((await owner('studies/' + study)).json.snapshot, snapshot)
  assert.equal((await owner('studies/' + study + '/versions')).json.versions.length, 1)
  db.raw.prepare("UPDATE customer_members SET role = 'viewer' WHERE user_id = 'b'").run()
  assert.equal((await editor('studies/' + study + '/rename', { name: 'Viewer edits', expectedName: 'Editor revision' })).status, 403)
})
