import { workspaceRequest } from './workspace-api.js'

export function configureSignout(link, provider, status) {
  link.onclick = provider === 'password' ? async event => {
    event.preventDefault()
    try {
      await workspaceRequest('auth/sign-out', {})
      location.replace('/sign-in/')
    } catch {
      status.textContent = 'Sign-out could not complete. Try again.'
    }
  } : null
}
