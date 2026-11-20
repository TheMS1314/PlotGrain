window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload()
})

export async function workspaceRequest(path, body, signal) {
  const response = await fetch('/api/' + path, {
    credentials: 'same-origin',
    signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body !== undefined && { method: 'POST', body: JSON.stringify(body) }),
  })
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('Customer workspaces could not be reached. Sign in and try again.')
  }
  if (!response.ok) {
    const error = new Error(result.error || 'The workspace request failed.')
    error.status = response.status
    throw error
  }
  return result
}
