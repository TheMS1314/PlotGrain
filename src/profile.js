import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/latin-400.css'
import './brand.css'
import './landing.css'
import './projects.css'
import { workspaceRequest as request } from './workspace-api.js'
import { configureSignout } from './signout.js'

const $ = id => document.getElementById(id)
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const name = $('display-name')
const save = $('save-profile')

function recentStudy(study) {
  const row = document.createElement('li')
  const link = document.createElement('a')
  link.className = 'text-action'
  link.href = '/study/?saved=' + encodeURIComponent(study.id)
  link.textContent = study.name
  const context = document.createElement('small')
  context.textContent = [study.customer, study.project, 'v' + study.version + ' ' + study.label].join(' · ')
  const date = document.createElement('time')
  date.dateTime = new Date(study.savedAt).toISOString()
  date.textContent = dateFormat.format(study.savedAt)
  row.append(link, context, date)
  return row
}

function locked(message, needsSignIn) {
  $('verified-email').textContent = ''
  name.value = ''
  $('recent-studies').replaceChildren()
  $('account-content').hidden = true
  $('sign-out').hidden = true
  $('sign-in').hidden = !needsSignIn
  $('sign-in-options').hidden = !needsSignIn
  $('retry-account').hidden = needsSignIn
  $('account-status').textContent = message
}

async function load() {
  $('retry-account').hidden = true
  $('account-status').textContent = 'Loading your profile…'
  try {
    const account = await request('account?recent=1')
    $('verified-email').textContent = account.email
    $('email-label').textContent = account.provider === 'password'
      ? account.emailVerified ? 'Verified email address' : 'Email address · unverified'
      : 'ChatGPT account email'
    name.value = account.displayName
    const entries = account.recentStudies.map(recentStudy)
    if (entries.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'empty-record'
      empty.textContent = 'Saved study versions will appear here.'
      entries.push(empty)
    }
    $('recent-studies').replaceChildren(...entries)
    $('account-content').hidden = false
    $('sign-out').hidden = false
    configureSignout($('sign-out'), account.provider, $('account-status'))
    $('account-status').textContent = ''
  } catch (error) {
    locked(error.message, error.status === 401)
  }
}

$('retry-account').addEventListener('click', load)
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (save.disabled) return
  save.disabled = true
  name.readOnly = true
  $('profile-status').textContent = 'Saving…'
  try {
    const account = await request('account', { displayName: name.value })
    name.value = account.displayName
    $('profile-status').textContent = 'Profile saved.'
  } catch (error) {
    $('profile-status').textContent = error.message
    if (error.status === 401) locked(error.message, true)
  } finally {
    name.readOnly = false
    save.disabled = false
  }
})

load()
