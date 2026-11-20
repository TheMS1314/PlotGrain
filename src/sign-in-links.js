import { projectSelection } from './project-links.js'

const origin = 'https://plotgrain.invalid'
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const invite = /^#invite=[\da-f]{64}$/

export function signInDestination(path, fragment = '') {
  if (typeof path !== 'string' || !path.startsWith('/')) return '/profile/'
  let url
  try { url = new URL(path, origin) } catch { return '/profile/' }
  if (url.origin !== origin) return '/profile/'
  const safe = new URL('/profile/', origin)
  if (url.pathname === '/study/') {
    safe.pathname = '/study/'
    const saved = url.searchParams.get('saved')
    const version = url.searchParams.get('version')
    if (uuid.test(saved ?? '')) {
      safe.searchParams.set('saved', saved)
      if (version && /^[1-9]\d*$/.test(version) && Number.isSafeInteger(Number(version))) {
        safe.searchParams.set('version', version)
      }
    }
    const layout = url.searchParams.get('layout')
    if (['map', 'review', 'standard'].includes(layout)) safe.searchParams.set('layout', layout)
    const view = url.searchParams.get('view')
    if (['envelope', 'garden', 'compact', 'compare'].includes(view)) safe.searchParams.set('view', view)
    if (!safe.searchParams.has('saved') && url.searchParams.get('example') === 'narrow') safe.searchParams.set('example', 'narrow')
    if ((fragment || url.hash) === '#zone-rules') safe.hash = '#zone-rules'
  }
  if (url.pathname === '/projects/') {
    safe.pathname = '/projects/'
    for (const [key, value] of Object.entries(projectSelection(url.searchParams))) safe.searchParams.set(key, value)
    const hash = fragment || url.hash
    if (invite.test(hash)) safe.hash = hash
  }
  return safe.pathname + safe.search + safe.hash
}

export function passwordSignInLink(destination, fields = {}, includeInvitation = true) {
  const url = new URL(signInDestination(destination), origin)
  const params = new URLSearchParams(fields)
  if (url.pathname !== '/profile/') params.set('return', url.pathname + url.search)
  const query = params.toString()
  return '/sign-in/' + (query ? '?' + query : '') + (includeInvitation ? url.hash : '')
}
