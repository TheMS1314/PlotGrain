const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

export function projectSelection(params) {
  const selected = {}
  for (const key of ['customer', 'project']) {
    const value = params.get(key)
    if (!uuid.test(value ?? '')) return selected
    selected[key] = value
  }
  for (const key of ['study', 'thread']) {
    const value = params.get(key)
    if (uuid.test(value ?? '')) {
      selected[key] = value
      break
    }
  }
  return selected
}

export function projectPath(selection = {}) {
  const params = new URLSearchParams(projectSelection(new URLSearchParams(selection)))
  return '/projects/' + (params.size ? '?' + params : '')
}
