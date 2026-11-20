import { assemblyChecklist, defaultReviews, summarizeAssemblySelections } from './assembly.js'

export function createAssemblyPanel(document, { area, onSelection, onOpenParcel }) {
  const get = id => document.getElementById(id)
  const metrics = ['area', 'shared', 'floor', 'footprint']
  const reviews = defaultReviews()
  const status = get('assembly-status')
  const rows = get('assembly-parcels')
  const issues = get('assembly-issues')
  const reviewControls = []

  function option(text, value) {
    const item = document.createElement('option')
    item.value = value
    item.textContent = text
    return item
  }

  for (const [key, label] of assemblyChecklist) {
    const row = document.createElement('div')
    const name = document.createElement('span')
    const select = document.createElement('select')
    const reference = document.createElement('input')
    name.textContent = label
    select.append(option('Pending', 'pending'), option('Evidence recorded', 'recorded'), option('Needs action', 'action'))
    select.setAttribute('aria-label', `Review status for ${label}`)
    reference.type = 'text'
    reference.maxLength = 140
    reference.hidden = true
    reference.placeholder = 'Document reference or action'
    reference.setAttribute('aria-label', `Document reference or action for ${label}`)
    select.addEventListener('change', () => {
      reviews[key].status = select.value
      reference.hidden = select.value === 'pending'
    })
    reference.addEventListener('input', () => { reviews[key].reference = reference.value.trim() })
    reviewControls.push({ key, select, reference })
    row.append(name, select, reference)
    get('assembly-reviews').append(row)
  }

  function message(text, state) {
    status.textContent = text
    status.dataset.state = state
  }

  function updateSelection(report, choices) {
    const { land, parcels } = report
    const checked = summarizeAssemblySelections(parcels, choices, land)
    const { selected, blocked, floorArea, footprintArea } = checked
    const values = [land.totalArea, land.sharedArea, floorArea, footprintArea]
    metrics.forEach((key, index) => { get('assembly-' + key).textContent = values[index] == null ? '—' : area(values[index]) })
    get('assembly-selection-count').textContent = parcels.length ? `${selected.length} of ${parcels.length} selected` : ''
    get('assembly-export').disabled = !land.totalArea
    if (blocked) message('Review boundary conflicts', 'review')
    else if (land.components > 1) message('Site spans separate blocks', 'review')
    else if (selected.length) message('Independent parcel concepts', 'ready')
    else if (parcels.length) message('Select parcel concepts', 'ready')
    else message('Shared land only', 'ready')
    return checked
  }

  return {
    state(text, state = 'review') {
      message(text, state)
      metrics.forEach(key => { get('assembly-' + key).textContent = '—' })
      get('assembly-selection-count').textContent = ''
      get('assembly-export').disabled = true
      issues.hidden = true
      rows.replaceChildren()
    },
    display(report, choices) {
      rows.replaceChildren()
      issues.replaceChildren()
      const { land } = report
      const warnings = [
        land.invalid > 0 && `${land.invalid} invalid ${land.invalid === 1 ? 'boundary was' : 'boundaries were'} excluded.`,
        land.parcelOverlap > .05 && `Development parcels overlap by ${area(land.parcelOverlap)}.`,
        land.overlap > .05 && `${area(land.overlap)} is assigned to both shared land and development.`,
        land.components > 1 && `The site has ${land.components} separate land blocks. Check the connections between them.`,
      ].filter(Boolean)
      for (const warning of warnings) {
        const item = document.createElement('p')
        item.textContent = warning
        issues.append(item)
      }
      issues.hidden = !warnings.length
      for (const parcel of report.parcels) {
        const row = document.createElement('article')
        const heading = document.createElement('div')
        const name = document.createElement('h3')
        const edit = document.createElement('button')
        name.textContent = parcel.name
        edit.type = 'button'
        edit.textContent = 'Open parcel'
        edit.setAttribute('aria-label', `Open parcel ${parcel.name}`)
        edit.addEventListener('click', () => onOpenParcel(parcel.entryIndex))
        heading.append(name, edit)
        row.append(heading)
        if (parcel.designs.length) {
          const select = document.createElement('select')
          select.setAttribute('aria-label', `Concept for ${parcel.name}`)
          select.append(option('No concept selected', ''))
          for (const design of parcel.designs) select.append(option(`${design.name} · ${area(design.gross)}`, String(design.index)))
          select.value = choices.has(parcel.entryIndex) ? String(choices.get(parcel.entryIndex)) : ''
          select.addEventListener('change', () => onSelection(parcel.entryIndex, select.value))
          row.append(select)
        } else {
          const hint = document.createElement('p')
          hint.className = 'hint'
          hint.textContent = parcel.status
          row.append(hint)
        }
        rows.append(row)
      }
      if (!report.parcels.length) rows.textContent = 'Add a development parcel to compare concepts.'
      return updateSelection(report, choices)
    },
    updateSelection,
    markForReview() {
      for (const { key, select, reference } of reviewControls) {
        if (select.value !== 'recorded') continue
        reviews[key].status = select.value = 'action'
        reference.hidden = false
      }
    },
    reviewStatus: () => Object.fromEntries(Object.entries(reviews).map(([key, { status, reference }]) =>
      [key, { status: status === 'recorded' && !reference ? 'pending' : status, reference: reference || null }])),
  }
}
