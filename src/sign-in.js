import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/latin-400.css'
import './brand.css'
import './landing.css'
import './projects.css'
import './sign-in.css'
import { passwordSignInLink, signInDestination } from './sign-in-links.js'

const $ = id => document.getElementById(id)
const email = $('auth-email')
const password = $('auth-password')
const confirmation = $('confirm-password')
const form = $('auth-form')
const submit = $('auth-submit')
const status = $('auth-status')
const toggles = [...document.querySelectorAll('.password-toggle')]
const params = new URLSearchParams(location.search)
const flows = Object.freeze({
  signin: { title: 'Sign in', intro: 'Open your Plotgrain workspace.', submit: 'Sign in' },
  signup: { title: 'Create an account', intro: 'Save studies and return to your work from any device.', submit: 'Create account' },
  forgot: { title: 'Reset your password', intro: 'Enter the email address you use for Plotgrain.', submit: 'Send reset link' },
  reset: { title: 'Choose a new password', intro: 'After you save it, sign in again on your devices.', submit: 'Save new password' },
  verify: { title: 'Verify your email', intro: 'Request a fresh link to verify your email address.', submit: 'Send verification link' },
})
const requested = params.get('mode')
const mode = Object.hasOwn(flows, requested) ? requested : 'signin'
const flow = flows[mode]
const returnPath = params.get('return') ?? (params.get('next') === 'projects' ? '/projects/' : '/profile/')
const destination = signInDestination(returnPath, location.hash)
const openingWorkspace = destination.startsWith('/study/') || destination.startsWith('/projects/')
const hasInvitation = destination.includes('#invite=')
const verifyCallback = passwordSignInLink(destination, { verified: '1' }, false)
$('continue-chatgpt').href = '/signin-with-chatgpt?return_to=' + encodeURIComponent(destination)
const token = mode === 'reset' ? params.get('token') : null
if (params.has('token')) history.replaceState(null, '', passwordSignInLink(destination, { mode: 'reset' }))
const hasPassword = ['signin', 'signup', 'reset'].includes(mode)
const newPassword = ['signup', 'reset'].includes(mode)
let feedback
let emailVerification = true

document.title = flow.title + ' — Plotgrain'
$('auth-title').textContent = flow.title
$('auth-intro').textContent = mode === 'signin' && openingWorkspace
  ? 'Sign in to open your workspace. You’ll return to the page you selected.'
  : flow.intro
submit.textContent = flow.submit
email.required = mode !== 'reset'
email.disabled = !email.required
$('email-field').hidden = !email.required
$('password-field').hidden = !hasPassword
password.disabled = !hasPassword
password.required = hasPassword
password.autocomplete = newPassword ? 'new-password' : 'current-password'
confirmation.disabled = !newPassword
confirmation.required = newPassword
$('confirm-field').hidden = !newPassword
$('password-strength').hidden = !newPassword
$('forgot-password').hidden = mode !== 'signin'
if (newPassword) $('password-strength').textContent = 'Use at least 15 characters.'
if (mode !== 'signin') {
  $('auth-alternate').textContent = 'Back to sign in'
}
for (const [id, target] of [['auth-alternate', mode === 'signin' ? 'signup' : 'signin'],
  ['forgot-password', 'forgot'], ['resend-verification', 'verify']]) {
  $(id).href = passwordSignInLink(destination, target === 'signin' ? {} : { mode: target })
}

function setPasswordVisible(toggle, visible) {
  const input = $(toggle.getAttribute('aria-controls'))
  const name = input === confirmation ? 'password confirmation' : 'password'
  input.type = visible ? 'text' : 'password'
  toggle.dataset.visible = String(visible)
  toggle.setAttribute('aria-label', (visible ? 'Hide ' : 'Show ') + name)
}
for (const toggle of toggles) {
  toggle.addEventListener('click', () => {
    setPasswordVisible(toggle, toggle.dataset.visible !== 'true')
  })
}

function strength() {
  if (!feedback) return
  const issues = feedback(password.value, email.value)
  const indicator = $('password-strength')
  const message = issues || 'Strong password'
  if (indicator.textContent !== message) indicator.textContent = message
  indicator.dataset.strong = String(!issues)
}

function passwordsMatch() {
  const mismatch = confirmation.value && confirmation.value !== password.value
  const message = mismatch ? 'Passwords must match.' : ''
  confirmation.setCustomValidity(message)
  if (mismatch) confirmation.setAttribute('aria-invalid', 'true')
  else confirmation.removeAttribute('aria-invalid')
  const error = $('password-match')
  if (error.textContent !== message) error.textContent = message
  error.hidden = !mismatch
  return !mismatch
}

if (newPassword) {
  password.addEventListener('input', strength)
  email.addEventListener('change', strength)
  for (const input of [password, confirmation]) input.addEventListener('input', passwordsMatch)
}

async function post(endpoint, body) {
  const response = await fetch('/api/auth/' + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (response.ok) return
  const result = await response.json().catch(() => ({}))
  if (response.status === 429) throw new Error('Too many attempts. Please wait and try again.')
  if (result.code === 'EMAIL_NOT_VERIFIED') {
    $('resend-verification').hidden = false
    throw new Error('Check your email for the verification link first.')
  }
  if (mode === 'signin' && response.status < 500) throw new Error('The email or password is incorrect.')
  if (mode === 'signup' && ['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'].includes(result.code)) {
    throw new Error('An account already exists for this email. Sign in with your password.')
  }
  if (mode === 'reset' && result.code === 'INVALID_TOKEN') throw new Error('This link has expired or was used. Request a new reset link.')
  const validationMessage = result.code === 'WEAK_PASSWORD' ? result.message
    : result.code === 'PASSWORD_MISMATCH' ? 'Passwords must match.' : ''
  throw new Error(validationMessage || 'This request could not be completed. Please try again.')
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  if (submit.disabled) return
  if (newPassword && !passwordsMatch()) {
    confirmation.reportValidity()
    return
  }
  if (newPassword && feedback?.(password.value, email.value)) {
    strength()
    password.focus()
    return
  }
  submit.disabled = true
  status.textContent = ''
  try {
    const address = email.value.trim().toLowerCase()
    if (mode === 'signin') {
      await post('sign-in/email', { email: address, password: password.value })
      location.assign(destination)
      return
    }
    if (mode === 'signup') {
      await post('sign-up/email', { email: address, password: password.value, confirmation: confirmation.value,
        name: 'Plotgrain member', callbackURL: verifyCallback })
      if (!emailVerification) {
        location.assign(destination)
        return
      }
      status.textContent = 'If this address can be registered, you’ll receive a verification email. Already registered? Sign in or reset your password.'
      if (hasInvitation) status.textContent += ' After verifying, reopen your original invitation link.'
      $('resend-verification').hidden = false
    }
    if (mode === 'forgot') {
      await post('request-password-reset', { email: address, redirectTo: passwordSignInLink(destination, { mode: 'reset' }, false) })
      status.textContent = 'If an account exists for this address, you’ll receive a reset link.'
    }
    if (mode === 'verify') {
      await post('send-verification-email', { email: address, callbackURL: verifyCallback })
      status.textContent = 'If the address needs verification, you’ll receive a new link.'
    }
    if (mode === 'reset') {
      await post('reset-password', { token, newPassword: password.value, confirmation: confirmation.value })
      location.replace(passwordSignInLink(destination, { reset: '1' }))
      return
    }
    password.value = ''
    confirmation.value = ''
    for (const toggle of toggles) setPasswordVisible(toggle, false)
    if (newPassword) {
      passwordsMatch()
      strength()
    }
  } catch (error) {
    status.textContent = error.message || 'Try again in a moment.'
  } finally {
    submit.disabled = false
  }
})

async function load() {
  try {
    const response = await fetch('/api/auth/options')
    if (!response.ok) throw new Error()
    const options = await response.json()
    emailVerification = options.emailVerification !== false
    if (!options.emailPassword) {
      status.textContent = 'Email sign-in is being set up. You can continue with ChatGPT.'
      $('continue-chatgpt').classList.replace('secondary-button', 'primary-button')
      return
    }
    $('auth-links').hidden = false
    $('forgot-password').hidden = mode !== 'signin' || !emailVerification
    if (!emailVerification && ['forgot', 'reset', 'verify'].includes(mode)) {
      status.textContent = 'Email verification and password recovery are currently unavailable.'
      return
    }
    if (mode === 'reset' && (!token || !/^[\w-]+$/.test(token))) {
      status.textContent = 'This reset link is unavailable. Request a new link.'
      $('auth-alternate').href = passwordSignInLink(destination, { mode: 'forgot' })
      $('auth-alternate').textContent = 'Request a new reset link'
      return
    }
    form.hidden = false
    if (mode === 'signup' && !emailVerification) {
      $('auth-intro').textContent = 'Create your account to save studies. Email verification and password recovery are currently unavailable.'
    }
    $('auth-divider').hidden = false
    status.textContent = params.has('error') ? 'This link is unavailable or has expired.'
      : params.has('verified') ? 'Email verified. You can sign in now.'
      : params.has('reset') ? 'Password updated. Sign in with your new password.' : ''
    if (newPassword) {
      const { passwordFeedback } = await import('./password-strength.js')
      feedback = passwordFeedback
      strength()
    }
  } catch {
    if (form.hidden) status.textContent = 'Sign-in options could not load. Refresh to try again.'
    else if (newPassword) $('password-strength').textContent = 'Password strength is checked when you submit.'
  }
}

load()
