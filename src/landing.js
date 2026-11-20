import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import './brand.css'
import './landing.css'
import './landing-design.css'
import { demoViews } from './demo-views.js'
import { activateDesignPreview, designLink } from './design-preview.js'

const designPreview = activateDesignPreview()
const buttons = [...document.querySelectorAll('[data-demo]')]
const get = id => document.getElementById(id)
const visual = get('demo-visual')
if (designPreview) {
  get('review-navigation').hidden = false
  for (const link of document.querySelectorAll('a[href^="/study/"]')) link.setAttribute('href', designLink(link.getAttribute('href'), designPreview))
  const [title, emphasis] = designPreview === 'map' ? ['Read the site', 'before you design.'] : ['Bring two options', 'to the table.']
  const secondLine = document.createElement('em')
  secondLine.textContent = emphasis
  get('hero-title').replaceChildren(title + ' ', secondLine)
}
let previewChanged = false
let reveal
const viewFields = [
  ['demo-name', 'name'], ['demo-description', 'description'],
  ['demo-primary-label', 'primaryLabel'], ['demo-primary', 'primary'],
  ['demo-secondary-label', 'secondaryLabel'], ['demo-secondary', 'secondary'],
]

visual.addEventListener('load', () => {
  if (!previewChanged || !visual.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  reveal?.cancel()
  reveal = visual.animate([{ opacity: .8 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
})

for (const button of buttons) {
  button.addEventListener('click', () => {
    const key = button.dataset.demo
    const view = demoViews[key]
    if (!view || button.getAttribute('aria-pressed') === 'true') return
    for (const item of buttons) item.setAttribute('aria-pressed', String(item === button))
    previewChanged = true
    visual.src = `/media/preview-${key}.webp`
    visual.alt = view.imageAlt
    for (const [id, field] of viewFields) get(id).textContent = view[field]
    get('demo-open').href = designLink(`/study/?view=${key}`, designPreview)
  })
}
