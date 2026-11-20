import { decodeWorkspaceDraft } from '../src/workspace-draft.js'

const response = (value, status = 200) => Response.json(value, {
  status,
  headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
})
const failure = (status, error) => response({ error }, status)
export const hostedIdentity = request => {
  const id = request.headers.get('oai-authenticated-user-id')?.trim()
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase()
  return id && email ? { id, email } : null
}
const scopes = {
  customer: ['customers c', 'c.id'],
  project: ['projects p JOIN customers c ON c.id = p.customer_id', 'p.id'],
  study: ['studies s JOIN projects p ON p.id = s.project_id JOIN customers c ON c.id = p.customer_id', 's.id'],
  thread: ['threads t JOIN projects p ON p.id = t.project_id JOIN customers c ON c.id = p.customer_id', 't.id'],
}
const now = () => Date.now()
const id = () => crypto.randomUUID()
const memberRoles = ['editor', 'viewer']
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const text = (value, length) => typeof value === 'string' && value.trim().length > 0 &&
  value.trim().length <= length ? value.trim() : null
const rowCount = result => result.meta.changes
const digest = async secret => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))),
  byte => byte.toString(16).padStart(2, '0')).join('')

function canEdit(role) {
  return role === 'owner' || role === 'editor'
}

async function access(db, type, key, actor) {
  const [join, target] = scopes[type]
  const item = await db.prepare(`SELECT c.id AS customer_id, CASE WHEN c.owner_id = ?1 THEN 'owner' ELSE cm.role END AS role
    FROM ${join} LEFT JOIN customer_members cm ON cm.customer_id = c.id AND cm.user_id = ?1
    WHERE ${target} = ?2 AND (c.owner_id = ?1 OR cm.role IS NOT NULL)`).bind(actor.id, key).first()
  return item
}

async function readBody(request) {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw failure(415, 'Send JSON to this endpoint.')
  const limit = 540 * 1024
  if (Number(request.headers.get('content-length')) > limit) throw failure(413, 'This request is too large.')
  const reader = request.body?.getReader()
  if (!reader) throw failure(400, 'A JSON body is required.')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let value = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        throw failure(413, 'This request is too large.')
      }
      value += decoder.decode(chunk.value, { stream: true })
    }
    const body = JSON.parse(value + decoder.decode())
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch (error) {
    if (error instanceof Response) throw error
    throw failure(400, 'The request body must be a valid JSON object.')
  }
}

async function rows(statement) {
  return (await statement.all()).results
}

const renamedRecords = {
  customers: { scope: 'customer', column: 'name' },
  projects: { scope: 'project', column: 'name' },
  studies: { scope: 'study', column: 'name' },
  threads: { scope: 'thread', column: 'title' },
}

async function renameRecord(db, actor, root, key, body) {
  const specification = renamedRecords[root]
  const scope = await access(db, specification.scope, key, actor)
  if (!scope) return failure(404, 'Record unavailable.')
  const permitted = root === 'customers' ? scope.role === 'owner' : canEdit(scope.role)
  if (!permitted) return failure(403, 'Your role does not allow renaming this record.')
  const name = text(body.name, 100)
  if (!name || /[\u0000-\u001f\u007f]/.test(name) || typeof body.expectedName !== 'string' ||
    body.expectedName.length > 100) return failure(422, 'Enter a name of up to 100 characters on one line.')
  const { column } = specification
  const permission = root === 'customers' ? 'owner_id = ?1 AND id = ?2' : editorScope
  const updated = await db.prepare(`UPDATE ${root} SET ${column} = ?4
    WHERE id = ?3 AND ${column} = ?5 AND ${permission}`)
    .bind(actor.id, scope.customer_id, key, name, body.expectedName).run()
  if (rowCount(updated)) return response({ name })
  const current = await access(db, specification.scope, key, actor)
  if (!current || (root === 'customers' ? current.role !== 'owner' : !canEdit(current.role))) {
    return failure(403, 'Your access to this record changed.')
  }
  const saved = await db.prepare(`SELECT ${column} AS name FROM ${root} WHERE id = ?`).bind(key).first()
  return saved?.name === name ? response({ name })
    : failure(409, 'The name changed while you were editing. Close this dialog and reopen the record to review the latest name.')
}

const editorScope = `EXISTS (SELECT 1 FROM customers c LEFT JOIN customer_members cm
  ON cm.customer_id = c.id AND cm.user_id = ?1 WHERE c.id = ?2 AND (c.owner_id = ?1 OR cm.role = 'editor'))`

async function versionReceipt(db, key, actor, requestId, fingerprint) {
  if (!requestId) return null
  const saved = await db.prepare(`SELECT version, request_digest FROM study_versions
    WHERE study_id = ? AND request_actor = ? AND request_key = ?`).bind(key, actor.id, requestId).first()
  if (!saved) return null
  return saved.request_digest === fingerprint ? response({ version: saved.version })
    : failure(409, 'This save request was already used for different edits.')
}

async function saveVersion(db, actor, key, scope, body, restoredFrom = null) {
  if (!canEdit(scope.role)) return failure(403, 'This study is view-only for your account.')
  const label = text(body.label, 100)
  if (!label || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
    return failure(422, 'Enter a version label and use the current study version.')
  }
  const receivedId = body.requestId ?? null
  if (receivedId !== null && (typeof receivedId !== 'string' || !uuid.test(receivedId))) {
    return failure(422, 'This save request identifier is invalid.')
  }
  const requestId = receivedId?.toLowerCase() ?? null
  if (restoredFrom === null && typeof body.snapshot !== 'string') {
    return failure(422, 'Open a valid Plotgrain parcel workspace before saving a version.')
  }
  const fingerprint = requestId ? await digest(JSON.stringify([
    label, body.expectedVersion, restoredFrom, restoredFrom === null ? body.snapshot : null,
  ])) : null
  const replay = await versionReceipt(db, key, actor, requestId, fingerprint)
  if (replay) return replay
  let snapshot = body.snapshot
  if (restoredFrom !== null) {
    const existing = await db.prepare('SELECT snapshot FROM study_versions WHERE study_id = ? AND version = ?').bind(key, restoredFrom).first()
    if (!existing) return failure(404, 'Version unavailable.')
    snapshot = existing.snapshot
  }
  try {
    decodeWorkspaceDraft(snapshot)
  } catch {
    return failure(422, 'Open a valid Plotgrain parcel workspace before saving a version.')
  }
  const result = await db.prepare(`INSERT INTO study_versions
    (study_id, version, label, snapshot, author, created_at, restored_from, request_key, request_actor, request_digest)
    SELECT id, head + 1, ?3, ?4, ?5, ?6, ?7, ?10, CASE WHEN ?10 IS NOT NULL THEN ?1 END, ?11
    FROM studies WHERE id = ?8 AND head = ?9 AND ${editorScope}
      AND NOT EXISTS (SELECT 1 FROM study_versions WHERE study_id = ?8 AND request_actor = ?1 AND request_key = ?10)`)
    .bind(actor.id, scope.customer_id, label, snapshot, actor.email, now(), restoredFrom, key, body.expectedVersion,
      requestId, fingerprint).run()
  if (!rowCount(result)) {
    return await versionReceipt(db, key, actor, requestId, fingerprint)
      ?? failure(409, 'The workspace changed. Reload the latest version before saving.')
  }
  return response({ version: body.expectedVersion + 1 }, 201)
}

async function customerRoute(db, actor, method, key, action, child, body) {
  if (!key && method === 'GET') return response({ customers: await rows(db.prepare(`SELECT c.id, c.name,
    CASE WHEN c.owner_id = ?1 THEN 'owner' ELSE cm.role END AS role FROM customers c LEFT JOIN customer_members cm
    ON cm.customer_id = c.id AND cm.user_id = ?1 WHERE c.owner_id = ?1 OR cm.role IS NOT NULL ORDER BY c.name, c.id`).bind(actor.id)) })
  if (!key && method === 'POST') {
    const name = text(body.name, 100)
    if (!name) return failure(422, 'Enter a customer name of up to 100 characters.')
    const key = id()
    await db.prepare('INSERT INTO customers (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').bind(key, actor.id, name, now()).run()
    return response({ id: key, name, role: 'owner' }, 201)
  }
  const scope = await access(db, 'customer', key, actor)
  if (!scope) return failure(404, 'Customer unavailable.')
  if (!action && method === 'GET') {
    const customer = await db.prepare('SELECT id, name FROM customers WHERE id = ?').bind(key).first()
    const projects = await rows(db.prepare('SELECT id, name, created_at FROM projects WHERE customer_id = ? ORDER BY created_at DESC, id').bind(key))
    const members = scope.role === 'owner'
      ? await rows(db.prepare('SELECT user_id, email, role FROM customer_members WHERE customer_id = ? ORDER BY email').bind(key)) : []
    const invitations = scope.role === 'owner' ? await rows(db.prepare(`SELECT digest, email, role, expires_at
      FROM customer_invites WHERE customer_id = ? AND expires_at > ? AND accepted_by IS NULL ORDER BY expires_at DESC`).bind(key, now())) : []
    return response({ customer: { ...customer, role: scope.role }, projects, members, invitations })
  }
  if (action === 'projects' && method === 'POST' && !child) {
    if (!canEdit(scope.role)) return failure(403, 'Projects are view-only for your account.')
    const name = text(body.name, 100)
    if (!name) return failure(422, 'Enter a project name of up to 100 characters.')
    const project = id()
    const saved = await db.prepare(`INSERT INTO projects (id, customer_id, name, created_at)
      SELECT ?3, ?2, ?4, ?5 WHERE ${editorScope}`).bind(actor.id, key, project, name, now()).run()
    return rowCount(saved) ? response({ id: project, name }, 201) : failure(403, 'Project access changed.')
  }
  if (action === 'invites' && method === 'POST' && !child) {
    if (scope.role !== 'owner') return failure(403, 'Only the customer owner can invite members.')
    const email = text(body.email, 254)?.toLowerCase()
    if (!email || !validEmail.test(email) || !memberRoles.includes(body.role)) return failure(422, 'Enter an email and select a member role.')
    if (email === actor.email) return failure(422, 'You already own this customer workspace.')
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
    const issued = now()
    const expires = issued + 7 * 86400000
    const created = await db.prepare(`INSERT INTO customer_invites (digest, customer_id, email, role, expires_at)
      SELECT ?1, ?2, ?3, ?4, ?5
      WHERE NOT EXISTS (
        SELECT 1 FROM customer_members WHERE customer_id = ?2 AND email = ?3
      ) AND NOT EXISTS (
        SELECT 1 FROM customer_invites WHERE customer_id = ?2 AND email = ?3
          AND accepted_by IS NULL AND expires_at > ?6
      )`).bind(await digest(token), key, email, body.role, expires, issued).run()
    return rowCount(created) ? response({ token, expires }, 201)
      : failure(409, 'This email already has access or a pending invitation. Review the member list.')
  }
  if (action === 'members' && method === 'POST' && !child) {
    if (scope.role !== 'owner') return failure(403, 'Only the customer owner can manage membership.')
    const user = text(body.userId, 256)
    if (!user) return failure(422, 'Select a current member.')
    await db.prepare('DELETE FROM customer_members WHERE customer_id = ? AND user_id = ?').bind(key, user).run()
    return response({ removed: true })
  }
  if (action === 'revoke-invite' && method === 'POST' && !child) {
    if (scope.role !== 'owner') return failure(403, 'Only the customer owner can revoke invitations.')
    if (typeof body.digest !== 'string' || !/^[\da-f]{64}$/.test(body.digest)) return failure(422, 'Select a valid invitation.')
    const removed = await db.prepare('DELETE FROM customer_invites WHERE customer_id = ? AND digest = ? AND accepted_by IS NULL')
      .bind(key, body.digest).run()
    return rowCount(removed) ? response({ revoked: true }) : failure(409, 'The invitation changed. Check the member list.')
  }
  return failure(404, 'Endpoint unavailable.')
}

async function acceptInvitation(db, actor, body) {
  if (actor.provider === 'password' && actor.emailVerified !== true) {
    return failure(403, 'Verify your email before accepting a customer invitation.')
  }
  if (typeof body.token !== 'string' || !/^[\da-f]{64}$/.test(body.token)) return failure(422, 'This invitation link is invalid.')
  const hash = await digest(body.token)
  const time = now()
  // A migration-owned trigger adds the member in the same transaction as the claim.
  const claim = await db.prepare(`UPDATE customer_invites SET accepted_by = ? WHERE digest = ? AND email = ?
    AND expires_at > ? AND accepted_by IS NULL`).bind(actor.id, hash, actor.email, time).run()
  if (!rowCount(claim)) return failure(404, 'Invitation unavailable for this account. Ask the owner for a new link.')
  const resolved = await db.prepare('SELECT customer_id FROM customer_invites WHERE digest = ?').bind(hash).first()
  return response(resolved)
}

async function projectRoute(db, actor, method, key, action, body) {
  const scope = await access(db, 'project', key, actor)
  if (!scope) return failure(404, 'Project unavailable.')
  if (!action && method === 'GET') {
    const project = await db.prepare('SELECT id, name, customer_id FROM projects WHERE id = ?').bind(key).first()
    const studies = await rows(db.prepare('SELECT id, name, head FROM studies WHERE project_id = ? ORDER BY created_at DESC, id').bind(key))
    const threads = await rows(db.prepare('SELECT id, title, created_at FROM threads WHERE project_id = ? ORDER BY created_at DESC, id').bind(key))
    return response({ project: { ...project, role: scope.role }, studies, threads })
  }
  if (method !== 'POST' || !['studies', 'threads'].includes(action)) return failure(404, 'Endpoint unavailable.')
  if (!canEdit(scope.role)) return failure(403, 'This project is view-only for your account.')
  const name = text(body.name, 100)
  if (!name) return failure(422, 'Enter a name of up to 100 characters.')
  const keyNew = id()
  const column = action === 'threads' ? 'title' : 'name'
  const create = db.prepare(`INSERT INTO ${action} (id, project_id, ${column}, created_at)
    SELECT ?3, ?4, ?5, ?6 WHERE ${editorScope}`).bind(actor.id, scope.customer_id, keyNew, key, name, now())
  let saved
  if (action === 'studies' && body.snapshot != null) {
    try { decodeWorkspaceDraft(body.snapshot) } catch { return failure(422, 'The tab workspace could not be imported.') }
    const [created] = await db.batch([create, db.prepare(`INSERT INTO study_versions
      (study_id, version, label, snapshot, author, created_at)
      SELECT id, 1, 'Imported tab workspace', ?, ?, ? FROM studies WHERE id = ?`)
      .bind(body.snapshot, actor.email, now(), keyNew)])
    saved = created
  } else saved = await create.run()
  return rowCount(saved) ? response({ id: keyNew }, 201) : failure(403, 'Project access changed.')
}

async function studyRoute(db, actor, method, key, action, version, body, url) {
  const scope = await access(db, 'study', key, actor)
  if (!scope) return failure(404, 'Study unavailable.')
  if (!action && method === 'GET') {
    const study = await db.prepare(`SELECT s.id, s.name, s.project_id, s.head, p.customer_id FROM studies s
      JOIN projects p ON p.id = s.project_id WHERE s.id = ?`).bind(key).first()
    const snapshot = study.head ? await db.prepare('SELECT snapshot FROM study_versions WHERE study_id = ? AND version = ?').bind(key, study.head).first() : null
    return response({ study: { ...study, role: scope.role }, snapshot: snapshot?.snapshot ?? null })
  }
  if (action !== 'versions') return failure(404, 'Endpoint unavailable.')
  if (!version && method === 'GET') {
    const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER)
    if (!Number.isSafeInteger(before) || before < 1) return failure(422, 'This history cursor is invalid.')
    const found = await rows(db.prepare(`SELECT version, label, author, created_at, restored_from FROM study_versions
      WHERE study_id = ? AND version < ? ORDER BY version DESC LIMIT 31`).bind(key, before))
    return response({ versions: found.slice(0, 30), next: found.length > 30 ? found[29].version : null })
  }
  if (!version && method === 'POST') return saveVersion(db, actor, key, scope, body)
  const selected = Number(version)
  if (!Number.isSafeInteger(selected) || selected < 1) return failure(404, 'Version unavailable.')
  if (method === 'POST') return saveVersion(db, actor, key, scope, body, selected)
  if (method === 'GET') {
    const item = await db.prepare('SELECT snapshot, label FROM study_versions WHERE study_id = ? AND version = ?').bind(key, selected).first()
    return item ? response(item) : failure(404, 'Version unavailable.')
  }
  return failure(404, 'Endpoint unavailable.')
}

async function threadRoute(db, actor, method, key, action, body, url) {
  const scope = await access(db, 'thread', key, actor)
  if (!scope) return failure(404, 'Thread unavailable.')
  if (action !== 'messages') return failure(404, 'Endpoint unavailable.')
  if (method === 'GET') {
    const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER)
    if (!Number.isSafeInteger(before) || before < 1) return failure(422, 'This message cursor is invalid.')
    const found = await rows(db.prepare(`SELECT id, body, author, created_at FROM thread_messages
      WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT 41`).bind(key, before))
    return response({ messages: found.slice(0, 40).reverse(), next: found.length > 40 ? found[39].id : null })
  }
  if (method === 'POST') {
    if (!canEdit(scope.role)) return failure(403, 'This discussion is view-only for your account.')
    const message = text(body.message, 4000)
    if (!message) return failure(422, 'Enter a message of up to 4,000 characters.')
    const saved = await db.prepare(`INSERT INTO thread_messages (thread_id, body, author, created_at)
      SELECT ?3, ?4, ?5, ?6 WHERE ${editorScope}`).bind(actor.id, scope.customer_id, key, message, actor.email, now()).run()
    return rowCount(saved) ? response({ posted: true }, 201) : failure(403, 'Thread access changed.')
  }
  return failure(404, 'Endpoint unavailable.')
}

async function accountRoute(db, actor, method, body, includeRecent) {
  if (method === 'POST') {
    const displayName = text(body.displayName, 80)
    if (!displayName || /[\u0000-\u001f\u007f]/.test(displayName)) {
      return failure(422, 'Enter a display name of up to 80 characters on one line.')
    }
    await db.prepare(`INSERT INTO account_profiles (user_id, display_name, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
      .bind(actor.id, displayName, now()).run()
    return response({ email: actor.email, displayName })
  }
  const profile = await db.prepare('SELECT display_name FROM account_profiles WHERE user_id = ?').bind(actor.id).first()
  const account = { email: actor.email, displayName: profile?.display_name ?? '',
    ...(actor.provider && { provider: actor.provider, emailVerified: actor.emailVerified === true }) }
  if (!includeRecent) return response(account)

  const recentStudies = await rows(db.prepare(`WITH permitted_customers AS (
      SELECT id FROM customers WHERE owner_id = ?1
      UNION SELECT customer_id FROM customer_members WHERE user_id = ?1
    )
    SELECT s.id, s.name, p.name AS project, c.name AS customer, v.version, v.label, v.created_at AS savedAt
    FROM permitted_customers allowed
    JOIN customers c ON c.id = allowed.id
    JOIN projects p ON p.customer_id = c.id
    JOIN studies s ON s.project_id = p.id
    JOIN study_versions v ON v.study_id = s.id AND v.version = s.head
    ORDER BY v.created_at DESC, s.id LIMIT 6`).bind(actor.id))
  return response({ ...account, recentStudies })
}

export async function workspaceApi(request, db, actor = hostedIdentity(request)) {
  const url = new URL(request.url)
  if (!actor) return failure(401, 'Sign in to continue.')
  if (!db) return failure(503, 'Customer storage is unavailable.')
  const [root, key, action, child, extra] = url.pathname.slice(5).split('/')
  if (!['GET', 'POST'].includes(request.method)) return failure(405, 'This operation is unavailable.')
  if (extra || (key && !uuid.test(key) && !(root === 'invites' && key === 'accept'))) return failure(404, 'Endpoint unavailable.')
  const method = request.method
  try {
    if (method === 'POST' && request.headers.get('origin') !== url.origin) return failure(403, 'This action must start in Plotgrain.')
    const body = method === 'POST' ? await readBody(request) : null
    if (Object.hasOwn(renamedRecords, root) && key && action === 'rename' && !child && method === 'POST') {
      return await renameRecord(db, actor, root, key, body)
    }
    if (url.pathname === '/api/account') return await accountRoute(db, actor, method, body, url.searchParams.get('recent') === '1')
    if (root === 'customers') return await customerRoute(db, actor, method, key, action, child, body)
    if (root === 'projects' && key && !child) return await projectRoute(db, actor, method, key, action, body)
    if (root === 'studies' && key) return await studyRoute(db, actor, method, key, action, child, body, url)
    if (root === 'threads' && key && !child) return await threadRoute(db, actor, method, key, action, body, url)
    if (root === 'invites' && key === 'accept' && !action && method === 'POST') return await acceptInvitation(db, actor, body)
    return failure(404, 'Endpoint unavailable.')
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Plotgrain workspace request failed', error?.name)
    return failure(503, 'Customer storage could not complete this request. Try again.')
  }
}
