import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/latin-400.css'
import './brand.css'
import './landing.css'
import './projects.css'
import { workspaceRequest as request } from './workspace-api.js'
import { draftKey, decodeWorkspaceDraft } from './workspace-draft.js'
import { configureSignout } from './signout.js'
import { passwordSignInLink, signInDestination } from './sign-in-links.js'
import { projectPath, projectSelection } from './project-links.js'

const $ = id => document.getElementById(id)
const say = message => { $('workspace-status').textContent = message }
const when = time => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(time)
let customer, project, study, thread
let versionCursor, messageCursor
let busy = 0
let parcelDraft
let renameTarget
let renameOpener
let invite = new URLSearchParams(location.hash.slice(1)).get('invite')

function node(tag, text, className) {
  const item = document.createElement(tag)
  item.textContent = text
  if (className) item.className = className
  return item
}
function action(label, onClick) {
  const item = node('button', label)
  item.type = 'button'
  item.addEventListener('click', () => run(onClick))
  return item
}
function link(label, href) {
  const item = node('a', label)
  item.href = href
  return item
}
function selectPath(selection, replace = false) {
  const path = projectPath(selection) + (invite ? location.hash : '')
  if (location.pathname + location.search + location.hash !== path) {
    if (replace) history.replaceState(null, '', path)
    else history.pushState(null, '', path)
  }
  markSelected()
}
function markSelected() {
  const selected = projectSelection(new URLSearchParams(location.search))
  for (const item of document.querySelectorAll('[data-record-key]')) {
    if (selected[item.dataset.recordKey] === item.dataset.recordId) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
}
function recordLink(label, key, id, selection, onClick) {
  const item = link(label, projectPath(selection))
  item.dataset.recordKey = key
  item.dataset.recordId = id
  item.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    run(async () => {
      await onClick()
      selectPath(selection)
    })
  })
  return item
}
function fill(target, entries, render, empty) {
  $(target).replaceChildren(...(entries.length ? entries.map(render) : [node('li', empty, 'empty-record')]))
}
function entry(...children) {
  const item = document.createElement('li')
  item.append(...children)
  return item
}
function heading(panel, title, copy, focus = true) {
  $(panel).hidden = false
  $(title).textContent = copy
  if (focus) $(title).focus()
}
function edit(role) { return role === 'owner' || role === 'editor' }
async function run(fn) {
  if (busy) return
  busy++
  $('main').setAttribute('aria-busy', 'true')
  try {
    await fn()
    say('')
  } catch (error) {
    say(error.message)
  } finally {
    busy--
    $('main').removeAttribute('aria-busy')
  }
}
function submit(form, handler) {
  $(form).addEventListener('submit', event => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    run(async () => {
      await handler(data)
      $(form).reset()
    })
  })
}

async function loadCustomers() {
  const data = await request('customers')
  fill('customers', data.customers, item => entry(
    recordLink(item.name, 'customer', item.id, { customer: item.id }, () => loadCustomer(item.id, true, true)),
    node('small', item.role)), 'Create a customer to organize your projects.')
}

async function loadCustomer(id, focus = true, resetSelection = false) {
  const data = await request('customers/' + id)
  const reopen = customer?.id === id
  customer = data.customer
  if (!reopen || resetSelection) {
    project = null
    for (const part of ['project-panel', 'history-panel', 'thread-panel']) $(part).hidden = true
  }
  $('invite-output').hidden = true
  $('invite-link').value = ''
  heading('customer-panel', 'selected-customer', customer.name, focus)
  $('customer-role').textContent = customer.role
  $('rename-customer').hidden = customer.role !== 'owner'
  $('create-project').hidden = !edit(customer.role)
  $('manage-members').hidden = customer.role !== 'owner'
  fill('projects', data.projects, item => entry(
    recordLink(item.name, 'project', item.id, { customer: id, project: item.id }, () => loadProject(item.id, true, true))),
    'No projects yet.')
  fill('members', data.members, member => entry(node('span', member.email + ' · ' + member.role),
    action('Remove access', async () => {
      if (!window.confirm('Remove access for ' + member.email + '?')) return
      await request('customers/' + id + '/members', { userId: member.user_id })
      await loadCustomer(id, false)
      $('manage-members').querySelector('summary').focus()
    })), 'Only you are a member.')
  fill('invitations', data.invitations, invitation => entry(node('span', invitation.email + ' · ' + invitation.role),
    node('small', 'Expires ' + when(invitation.expires_at)), action('Revoke link', async () => {
      if (!window.confirm('Revoke this invitation?')) return
      await request('customers/' + id + '/revoke-invite', { digest: invitation.digest })
      await loadCustomer(id, false)
      $('manage-members').querySelector('summary').focus()
    })), 'No pending invitations.')
  markSelected()
}

async function loadProject(id, focus = true, resetSelection = false) {
  const data = await request('projects/' + id)
  if (data.project.customer_id !== customer?.id) throw new Error('Select this project’s customer before opening it.')
  if (project?.id !== id || resetSelection) {
    $('history-panel').hidden = true
    $('thread-panel').hidden = true
  }
  project = data.project
  heading('project-panel', 'selected-project', project.name, focus)
  $('create-study').hidden = !edit(project.role)
  $('create-thread').hidden = !edit(project.role)
  $('rename-project').hidden = !edit(project.role)
  const selection = { customer: customer.id, project: project.id }
  fill('studies', data.studies, item => entry(recordLink(item.name, 'study', item.id,
    { ...selection, study: item.id }, () => openHistory(item)),
    node('small', item.head ? 'Version ' + item.head : 'New study')), 'No saved studies yet.')
  fill('threads', data.threads, item => entry(recordLink(item.title, 'thread', item.id,
    { ...selection, thread: item.id }, () => openThread(item))), 'No discussions yet.')
  markSelected()
  return data
}

function displayVersion(item) {
  const title = node('strong', 'v' + item.version + ' · ' + item.label)
  const details = node('small', when(item.created_at) + ' · ' + item.author +
    (item.restored_from ? ' · Restored v' + item.restored_from : ''))
  const actions = [title, details, link('Open version', '/study/?saved=' + study.id + '&version=' + item.version)]
  if (edit(project.role) && item.version < study.head) {
    let requestId
    actions.push(action('Restore', async () => {
      if (!window.confirm('Restore v' + item.version + ' as a new version?')) return
      requestId ??= crypto.randomUUID()
      let latest
      try {
        latest = await request('studies/' + study.id + '/versions/' + item.version,
          { expectedVersion: study.head, label: 'Restored v' + item.version, requestId }, AbortSignal.timeout(20000))
      } catch (error) {
        if (!error.status || error.status >= 500) throw new Error('The restore could not be confirmed. Choose Restore to retry safely.')
        throw error
      }
      study.head = latest.version
      await loadProject(project.id, false)
      await openHistory(study)
    }))
  }
  return entry(...actions)
}
async function openHistory(item) {
  const [{ study: current }, latest] = await Promise.all([
    request('studies/' + item.id), request('studies/' + item.id + '/versions'),
  ])
  study = current
  $('rename-study').hidden = !edit(current.role)
  versionCursor = latest.next
  fill('versions', latest.versions, displayVersion, 'Open the draft and save a version to start this history.')
  $('older-versions').hidden = !versionCursor
  $('open-study').href = '/study/?saved=' + study.id
  $('thread-panel').hidden = true
  heading('history-panel', 'history-title', study.name + ' history')
}
$('older-versions').addEventListener('click', () => run(async () => {
  const older = await request('studies/' + study.id + '/versions?before=' + versionCursor)
  $('versions').append(...older.versions.map(displayVersion))
  versionCursor = older.next
  $('older-versions').hidden = !versionCursor
}))

function displayMessage(message) {
  return entry(node('small', message.author + ' · ' + when(message.created_at)), node('p', message.body))
}
async function openThread(item, focus = true) {
  const latest = await request('threads/' + item.id + '/messages')
  thread = item
  messageCursor = latest.next
  fill('messages', latest.messages, displayMessage, 'This discussion has no replies yet.')
  $('older-messages').hidden = !messageCursor
  $('post-message').hidden = !edit(project.role)
  $('rename-thread').hidden = !edit(project.role)
  $('history-panel').hidden = true
  heading('thread-panel', 'active-thread', item.title, focus)
}
$('older-messages').addEventListener('click', () => run(async () => {
  const data = await request('threads/' + thread.id + '/messages?before=' + messageCursor)
  $('messages').prepend(...data.messages.map(displayMessage))
  messageCursor = data.next
  $('older-messages').hidden = !messageCursor
}))

submit('create-customer', async body => {
  const item = await request('customers', body)
  await loadCustomers()
  await loadCustomer(item.id)
  selectPath({ customer: item.id })
})
submit('create-project', async body => {
  const item = await request('customers/' + customer.id + '/projects', body)
  await loadCustomer(customer.id, false)
  await loadProject(item.id)
  selectPath({ customer: customer.id, project: item.id })
})
submit('create-study', async body => {
  const item = await request('projects/' + project.id + '/studies', { name: body.name, snapshot: body.local ? parcelDraft : null })
  location.href = '/study/?saved=' + item.id
})
submit('create-thread', async body => {
  const item = await request('projects/' + project.id + '/threads', body)
  await loadProject(project.id, false)
  await openThread({ id: item.id, title: body.name })
  selectPath({ customer: customer.id, project: project.id, thread: item.id })
})
submit('post-message', async body => {
  await request('threads/' + thread.id + '/messages', body)
  await openThread(thread, false)
})
submit('create-invite', async body => {
  const invited = await request('customers/' + customer.id + '/invites', body)
  await loadCustomer(customer.id, false)
  $('invite-link').value = location.origin + '/projects/#invite=' + invited.token
  $('invite-output').hidden = false
  $('invite-link').focus()
})
$('copy-invite').addEventListener('click', async () => {
  $('invite-link').select()
  try { await navigator.clipboard.writeText($('invite-link').value); say('Invitation link copied.') }
  catch { say('Select and copy the invitation link.') }
})
$('accept-invite').addEventListener('click', () => run(async () => {
  const result = await request('invites/accept', { token: invite })
  invite = null
  history.replaceState(null, '', location.pathname + location.search)
  $('accept-invite').hidden = true
  await loadCustomers()
  await loadCustomer(result.customer_id)
  selectPath({ customer: result.customer_id }, true)
}))

const renameDialog = $('rename-dialog')
for (const [button, root, selected, title] of [
  ['rename-customer', 'customers', () => customer, 'Rename customer'],
  ['rename-project', 'projects', () => project, 'Rename project'],
  ['rename-study', 'studies', () => study, 'Rename study'],
  ['rename-thread', 'threads', () => thread, 'Rename discussion'],
]) {
  $(button).addEventListener('click', () => {
    const record = selected()
    renameTarget = { root, id: record.id, expectedName: record.name ?? record.title }
    renameOpener = $(button)
    $('rename-title').textContent = title
    $('record-name').value = renameTarget.expectedName
    $('rename-status').textContent = ''
    renameDialog.showModal()
    $('record-name').focus()
    $('record-name').select()
  })
}
$('cancel-rename').addEventListener('click', () => renameDialog.close())
renameDialog.addEventListener('close', () => renameOpener?.focus())
renameDialog.addEventListener('cancel', event => {
  if ($('confirm-rename').disabled) event.preventDefault()
})
$('rename-form').addEventListener('submit', async event => {
  event.preventDefault()
  if ($('confirm-rename').disabled || busy) return
  $('confirm-rename').disabled = true
  $('cancel-rename').disabled = true
  $('record-name').readOnly = true
  $('rename-status').textContent = 'Saving…'
  const target = renameTarget
  try {
    await request(target.root + '/' + target.id + '/rename', {
      name: $('record-name').value, expectedName: target.expectedName,
    }, AbortSignal.timeout(20000))
    renameDialog.close()
    await run(async () => {
      const activeProject = project?.id
      const activeStudy = !$('history-panel').hidden ? study : null
      const activeThread = !$('thread-panel').hidden ? thread : null
      await loadCustomers()
      await loadCustomer(customer.id, false)
      if (activeProject) {
        const records = await loadProject(activeProject, false)
        if (activeStudy) await openHistory(activeStudy)
        if (activeThread) {
          const item = records.threads.find(item => item.id === activeThread.id)
          if (item) await openThread(item, false)
        }
      }
    })
  } catch (error) {
    $('rename-status').textContent = error.message || 'The name could not be saved. Try again.'
  } finally {
    $('confirm-rename').disabled = false
    $('cancel-rename').disabled = false
    $('record-name').readOnly = false
  }
})

async function boot() {
  try {
    const account = await request('account')
    $('account').textContent = 'Signed in as ' + (account.displayName ? account.displayName + ' · ' : '') + account.email
    $('sign-out').hidden = false
    configureSignout($('sign-out'), account.provider, $('workspace-status'))
    $('accept-invite').hidden = !invite
    try {
      const raw = sessionStorage.getItem(draftKey)
      decodeWorkspaceDraft(raw)
      parcelDraft = raw
    } catch { /* A portable or new study can still be opened. */ }
    $('use-local').disabled = !parcelDraft
    if (parcelDraft) $('use-local').checked = true
    await loadCustomers()
    $('project-layout').hidden = false
    markSelected()
    say(invite ? 'Accept this invitation to open the customer workspace.' : '')
    const selected = projectSelection(new URLSearchParams(location.search))
    if (selected.customer) await loadCustomer(selected.customer)
    if (selected.project) {
      const data = await loadProject(selected.project)
      if (selected.study) {
        const item = data.studies.find(item => item.id === selected.study)
        if (!item) throw new Error('This study is unavailable in the selected project.')
        await openHistory(item)
      }
      if (selected.thread) {
        const item = data.threads.find(item => item.id === selected.thread)
        if (!item) throw new Error('This discussion is unavailable in the selected project.')
        await openThread(item)
      }
    }
  } catch (error) {
    say(error.message)
    if (error.status === 401) {
      const destination = signInDestination(location.pathname + location.search, location.hash)
      $('sign-in').href = '/signin-with-chatgpt?return_to=' + encodeURIComponent(destination)
      $('sign-in').hidden = false
      $('sign-in-options').href = passwordSignInLink(destination)
      $('sign-in-options').hidden = false
    }
  }
}
window.addEventListener('popstate', () => location.reload())
boot()
