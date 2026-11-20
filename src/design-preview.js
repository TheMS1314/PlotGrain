const directions = {
  map: 'Map-first',
  review: 'Review-first',
}

export function activateDesignPreview(defaultDesign = null) {
  const requested = new URLSearchParams(window.location.search).get('layout')
  if (requested === 'standard') return null
  const design = Object.hasOwn(directions, requested) ? requested : defaultDesign
  if (!design) return null
  document.documentElement.dataset.design = design
  return design
}

export function designLink(path, design) {
  if (!design) return path
  const url = new URL(path, window.location.origin)
  url.searchParams.set('layout', design)
  return url.pathname + url.search + url.hash
}

export function setUpWorkspacePreview(design, showDesignReview) {
  if (!design) return () => {}
  const workspace = document.getElementById('study-workspace')
  const inputs = document.getElementById('site-inputs')
  const results = document.getElementById('site-results')
  const map = document.getElementById('site-map')
  const toolbar = document.getElementById('design-toolbar')
  const buttons = toolbar.querySelectorAll('[data-design-panel]')
  document.getElementById('design-direction').textContent = showDesignReview ? directions[design] : 'Site feasibility'
  document.getElementById('design-review-link').hidden = !showDesignReview
  document.getElementById('study-home').href = designLink('/', showDesignReview ? design : null)
  toolbar.hidden = false
  if (design === 'map') workspace.prepend(map)
  else workspace.prepend(results, inputs)

  function selectPanel(name, scroll) {
    document.body.dataset.designPanel = name
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.designPanel === name))
    if (scroll && window.matchMedia('(max-width: 820px)').matches) {
      (name === 'inputs' ? inputs : results).scrollIntoView({ block: 'start' })
    }
  }

  const target = window.location.hash
  selectPanel(['#site-inputs', '#zone-rules'].includes(target) ? 'inputs' : 'results', false)
  if (target === '#zone-rules') document.getElementById('zone-rules').scrollIntoView({ block: 'start' })
  for (const button of buttons) button.addEventListener('click', () => selectPanel(button.dataset.designPanel, true))
  return selectPanel
}
