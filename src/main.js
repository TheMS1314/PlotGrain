import { bangkokToday, solarPosition } from './solar-study.js'
import { createSiteView, paintSite, siteProjection } from './site-view.js'
import { locationReading, readLocation, screenInputs } from './site-input.js'
import { drawRoadSection } from './road-section.js'
import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './brand.css'
import './style.css'
import './workspace-design.css'
import { buildStudyFile, parcelGeometry } from './study-file.js'
import { importParcels, exportWorkspace, summarizeOption, parcelLimit } from './parcel-workspace.js'
import { frontageFrame, convertGeometry, eastNorthFrame, edgeReadings, geometryBounds, overlapsBounds, metresPerDegree } from './coordinates.js'
import { createAssemblyPanel } from './assembly-panel.js'
import { compareSurvey, readSurveyRecord } from './survey-record.js'
import { fromDemoURL } from './demo-views.js'
import { compareConcepts } from './concept-comparison.js'
import { activateDesignPreview, setUpWorkspacePreview } from './design-preview.js'
import { draftKey, encodeWorkspaceDraft, decodeWorkspaceDraft } from './workspace-draft.js'
import { workspaceRequest } from './workspace-api.js'
import { passwordSignInLink, signInDestination } from './sign-in-links.js'

const $ = id => document.getElementById(id)
const params = new URLSearchParams(window.location.search)
const savedStudyId = params.get('saved')
const savedVersion = params.get('version')
const designPreview = activateDesignPreview('map')
const selectWorkspacePanel = setUpWorkspacePreview(designPreview, params.has('layout'))
const tabRecovery = !params.has('example') && !params.has('view') && !params.has('saved')
$('print-sheet').hidden = false
const studyTools = $('study-tools')
const studyToolsTrigger = studyTools.querySelector('summary')
studyTools.addEventListener('click', event => {
  if (!event.target.closest('button')) return
  studyTools.open = false
  studyToolsTrigger.focus({ preventScroll: true })
}, { capture: true })
studyTools.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !studyTools.open) return
  event.stopPropagation()
  studyTools.open = false
  studyToolsTrigger.focus({ preventScroll: true })
})
document.addEventListener('click', event => {
  if (studyTools.open && !studyTools.contains(event.target)) studyTools.open = false
})
const center = [100.5300, 13.8251]
const collection = features => ({ type: 'FeatureCollection', features })
const feature = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties })
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
const area = value => `${number.format(value)} m²`
const surveyNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 3 })
const surveyArea = value => `${surveyNumber.format(value)} m²`
const conceptPreviews = new WeakMap()
const conceptColors = [
  ['#287966', '#65a894'],
  ['#3d6d8b', '#77a0b4'],
]
const fetchJSON = async (url, options) => {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`Data request failed (${response.status}).`)
  return response.json()
}
const [demoResult, contextResult, fallbackRoads] = await Promise.allSettled([
  fetchJSON('/data/demo.geojson'),
  fetchJSON('/data/buildings.geojson'),
  fetchJSON('/data/streets.geojson'),
])
const demo = demoResult.status === 'fulfilled' ? demoResult.value.features[0].geometry.coordinates[0].slice(0, -1) : []
const narrowDemo = demo.length ? [[0, 0], [3.5, 0], [3.5, 9], [0, 9]].map(frontageFrame(demo, 0).toMap) : []
const opensNarrow = params.get('example') === 'narrow'
const savedContext = contextResult.status === 'fulfilled' ? contextResult.value : collection([])
let context = savedContext
let contextSource = ''
let contextRequest = 0
let contextNeedsReload = false
let contextIndex = indexBuildings(context.features)
function indexBuildings(buildings) {
  return buildings.map((item, index) => {
    item.properties ||= {}
    item.properties.id ??= `context-${index}`
    return { item, bounds: geometryBounds(item.geometry) }
  })
}
const siteName = 'Soi Krung Thep–Nonthaburi 35'
const narrowSiteName = 'Bang Son narrow parcel'
const narrowEvidence = 'Schematic 3.5 × 9 m parcel. The boundary clearances leave no buildable envelope.'

let map
let ready = false
let presenting = false
let orbit = false
let modelURL
let modelRequest = 0
let modelStudy
let lastSolarResult
let points = (opensNarrow ? narrowDemo : demo).map(point => [...point])
let holes = []
let drawing = false
let previousStudy
let nextSitePlan = 0
let nextAssembly = 0
let assembly
let lastAssemblyKey
let surveyUpload
let surveyRequest = 0
let surveyLoading = false
let pickingFrontage = false
let studyName = opensNarrow ? narrowSiteName : siteName
let pendingNotice
const parcelEntries = []
let activeParcel
let newParcelOnFinish = false
let parcelMetrics
let nextBatch = 0
const reviewBatches = new Map()
let currentEdges = []
let editing = false
let handles = []
let scenario = true
let frontage = 0
let activeView = fromDemoURL(window.location.search)
let compareOnLoad = params.get('view') === 'compare'
let comparisonMapView = null
let result
let currentFrame
let revision = 0
let timer
let analysisRunning = false
let latestAnalysis
let draftTimer
let lastDraftText
let parcelImportRequest = 0
let cloudStudy
let lastCloudSnapshot
const worker = new Worker(new URL('./study-worker.js', import.meta.url), { type: 'module' })

function mapMessage(message) {
  $('map-message').textContent = message
  $('map-message').hidden = !message
}

function setSource(id, features) {
  if (ready) map.setFeatures(id, features)
}

try {
  map = createSiteView($('map'), {
    center,
    ...(designPreview && { pitch: 58, bearing: -48 }),
    streets: fallbackRoads.status === 'fulfilled' ? fallbackRoads.value.features : [],
    buildings: context.features,
    onPoint(point, { edge, closes }) {
      if (pickingFrontage) {
        if (edge) setFrontage(edge.index)
        else mapMessage('Click near a plot edge to select the road frontage.')
        return
      }
      if (!drawing) return
      if (closes) return finishDrawing()
      if (points.length >= 100) return mapMessage('Finish this plot or undo a point. A plot can have up to 100 vertices.')
      const previous = points.at(-1)
      if (previous && edgeReadings([previous, point])[0].metres < 0.1) return
      points.push(point)
      mapMessage('')
      renderPlot()
      updateDrawHelp()
    },
    onInspect(info, pixel) {
      const tip = $('map-tooltip')
      tip.hidden = !info
      if (!info) return
      tip.firstElementChild.textContent = info.label
      tip.lastElementChild.textContent = info.detail
      tip.style.left = `${Math.min(pixel[0] + 13, Math.max(5, $('map').clientWidth - tip.offsetWidth - 8))}px`
      tip.style.top = `${Math.min(pixel[1] + 16, Math.max(5, $('map').clientHeight - tip.offsetHeight - 8))}px`
    },
    onCamera(camera) {
      const scale = [1, 2, 5, 10, 20, 50, 100].findLast(metres => metres * camera.scale <= 100) ?? 1
      $('map-scale').style.width = `${scale * camera.scale}px`
      $('map-scale').textContent = `${scale} m`
      $('compass').style.transform = `rotate(${-camera.bearing}deg)`
    },
    onPitch(pitch) {
      $('pitch').setAttribute('aria-pressed', String(pitch > 10))
      $('pitch').textContent = pitch > 10 ? 'Plan view' : '3D view'
    },
  })
  ready = true
  if (opensNarrow && points.length) map.easeTo({ center: locationReading(points, false).center })
  $('zoom-in').addEventListener('click', map.zoomIn)
  $('zoom-out').addEventListener('click', map.zoomOut)
  $('rotate').addEventListener('click', map.rotate)
  $('north').addEventListener('click', map.north)
  $('recenter').addEventListener('click', () => {
    const bounds = assembly ? assembly.items.flatMap(entry => entry.points) : points
    if (bounds.length >= 3) map.fitPoints(bounds, true)
    else map.reset()
  })
  renderPlot()
  if (contextResult.status === 'rejected' || fallbackRoads.status === 'rejected') mapMessage('Some saved site context could not load. Plot tools are available.')
} catch (error) {
  console.error(error)
  mapMessage('The site view could not start. The study calculations are still available.')
  for (const id of ['draw', 'pitch', 'zoom-in', 'zoom-out', 'rotate', 'recenter']) $(id).disabled = true
}

function polygonFrom(ring) {
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
}

function renderPlot() {
  currentEdges = edgeReadings(points)
  setSource('edges', drawing ? currentEdges.slice(0, -1) : currentEdges)
  const activeRing = JSON.stringify([points, holes])
  setSource('parcels', parcelEntries.filter(entry => entry !== activeParcel && entry.points.length >= 3 &&
    JSON.stringify([entry.points, entry.holes]) !== activeRing).map(entry =>
      feature(parcelGeometry(entry.points, entry.holes), { name: entry.name, role: entry.role })))
  const geometry = !drawing && points.length >= 3 ? parcelGeometry(points, holes) :
    points.length >= 2 ? { type: 'LineString', coordinates: points } : null
  setSource('plot', geometry ? [feature(geometry)] : [])
  setSource('vertices', drawing ? points.map(coordinates => feature({ type: 'Point', coordinates })) : [])
  updatePlotLabel()
  renderLocation()
  renderRoad()
  const next = points[(frontage + 1) % points.length]
  setSource('frontage', !drawing && frontage !== null && points.length >= 3 && next ? [
    feature({ type: 'LineString', coordinates: [points[frontage], next] }),
  ] : [])
}

function updatePlotLabel() {
  if (drawing || !result?.plotArea || points.length < 3) {
    setSource('label', null)
    return
  }
  setSource('label', { vertices: points,
    text: `${studyName.length > 25 ? studyName.slice(0, 24) + '…' : studyName} · ${area(result.plotArea)}` })
}

function hasMappedCoverage(ring = points) {
  return Boolean(locationReading(ring, !contextSource && context.features.length)?.inContext)
}

function renderLocation() {
  const reading = locationReading(points, !contextSource && context.features.length)
  const exact = reading && points.length >= 3 && !drawing
  $('input-location').textContent = exact ? `${reading.center[1].toFixed(5)}, ${reading.center[0].toFixed(5)}` : 'Draw or import a boundary'
  $('input-coverage').textContent = exact ? contextSource ? 'Uploaded building context' :
    reading.inContext ? 'Bang Son building context' : 'Building context limited' : ''
  $('map-place').textContent = contextSource ? 'Uploaded building context' :
    exact && !reading.inContext ? 'Imported or drawn coordinates' : 'Bang Son · Bangkok'
  $('input-basis').textContent = drawing ? 'Drawing' : activeParcel?.role === 'shared' ? 'Shared land' :
    scenario ? 'Example' : $('zone').checked && $('zone-choice').value === 'r8' ? 'R.8 supplied' : 'Verify zoning'
}

$('location-search').addEventListener('toggle', () => {
  if (!$('location-search').open) return
  const reading = locationReading(points, context.features.length)
  const [lng, lat] = reading?.center ?? center
  $('longitude').value = lng.toFixed(6)
  $('latitude').value = lat.toFixed(6)
  $('location-error').textContent = ''
})
$('location-form').addEventListener('submit', event => {
  event.preventDefault()
  try {
    const coordinate = readLocation($('longitude').valueAsNumber, $('latitude').valueAsNumber)
    map?.easeTo({ center: coordinate, pitch: 0, bearing: 0, zoom: 1 })
    $('location-search').open = false
    mapMessage('')
  } catch (error) {
    $('location-error').textContent = error.message
  }
})

function updateOverlap() {
  const box = $('site-overlap')
  const existing = result?.existing
  const covered = existing?.ids.length
  const withinContext = hasMappedCoverage()
  box.hidden = !result?.plotArea
  $('overlap-key').hidden = !$('show-existing').checked || !$('cutaway').checked || !covered
  box.textContent = covered ?
    `${covered} mapped building ${covered === 1 ? 'footprint overlaps' : 'footprints overlap'} this plot by ${area(existing.area)} (${number.format(existing.area / result.plotArea * 100)}%). Redevelopment massing assumes the site is cleared. Verify which buildings can be removed or retained.${contextSource ? ' Uses uploaded footprints.' : withinContext ? '' : ' Saved context only covers part of this site.'}` :
    contextSource ? 'No overlap with the uploaded building footprints.' :
      withinContext ? 'No overlap with buildings in the saved map data.' : 'Saved building data does not cover this entire plot.'
  map?.setOverlap(existing?.ids ?? [])
  setSource('overlap', existing?.geometry && currentFrame ?
    [feature(convertGeometry(existing.geometry, currentFrame.toMap))] : [])
}

function renderRoad() {
  if (!ready) return
  setSource('road', [])
  const width = $('width').valueAsNumber
  if (drawing || frontage === null || points.length < 3 || !(width >= .2 && width <= 120)) return
  try {
    const frame = frontageFrame(points, frontage)
    const band = [[0, 0], [frame.length, 0], [frame.length, -width], [0, -width]].map(frame.toMap)
    setSource('road', [feature(polygonFrom(band))])
  } catch {
    // An invalid edge is reported by the study input validation.
  }
}

function inspectedSection() {
  return result?.sections?.[Number($('slice-height').value)]
}

const constraintLabel = id => ({ plot: 'Plot before setbacks', boundary: 'Boundary setbacks applied', road: 'Road setback applied' })[id]

function selectedConstraint() {
  return inspectedSection()?.stages?.find(stage => stage.id === $('constraint-step').value)
}

function renderMassing() {
  renderSolar()
  if (!result?.sections || !currentFrame) {
    setSource('massing', [])
    setSource('planting', [])
    return
  }
  const toMap = geometry => convertGeometry(geometry, currentFrame.toMap)
  const concept = result.concepts[Number(activeView)]
  $('map-legend').textContent = activeView === 'envelope' ? 'Buildable envelope' : 'Concept'
  if (activeView === 'envelope') {
    const stage = selectedConstraint()
    if (stage) {
      $('map-legend').textContent = constraintLabel(stage.id)
      setSource('massing', stage.geometry ? [feature(toMap(stage.geometry), {
        height: 0, base: 0, area: stage.area, name: constraintLabel(stage.id), color: '#557f9a',
      })] : [])
    } else {
      setSource('massing', result.sections.filter(section => section.geometry && section.height <= inspectedSection()?.height).map(section =>
        feature(toMap(section.geometry), { height: section.height, base: section.base, area: section.area, name: 'Buildable envelope', color: '#3b9c7c' })))
    }
    setSource('planting', [])
  } else if (concept?.available) {
    const level = concept.roofHeight / concept.stories
    setSource('massing', Array.from({ length: concept.stories }, (_, index) =>
      feature(toMap(concept.footprint), { base: index * level, height: (index + 1) * level,
        name: concept.name, area: concept.floorPlate, proposal: true, color: conceptColors[Number(activeView)][index % 2] })))
    setSource('planting', [feature(toMap(concept.permeable))])
  } else {
    setSource('massing', [])
    setSource('planting', [])
  }
}

function sectionPlateCap(section) {
  const limits = [
    { label: 'geometric clearances', value: section.area },
    { label: 'FAR', value: section.plateBudgets.far },
    { label: 'open space', value: section.plateBudgets.openSpace },
  ]
  return limits.reduce((lowest, current) => current.value < lowest.value ? current : lowest)
}

function evidenceSummary() {
  if (!result?.plotArea) return ''
  const siteInputs = scenario ? 'Schematic parcel and assumed road measurements.' : 'User-supplied parcel and road inputs.'
  const mapped = hasMappedCoverage()
  const contextBasis = contextSource ? 'Building footprints and heights supplied by the user.' : mapped
    ? 'Mapped building footprints with estimated heights.' : 'Saved building coverage is limited. Any saved heights are estimates.'
  const streets = fallbackRoads.status === 'fulfilled' && mapped ? ' Mapped streets.' : ''
  return `${siteInputs}${streets} ${contextBasis}`
}

function conceptVerdict(concept) {
  if (concept.checks.every(check => check.status === 'pass')) return { state: 'pass', label: 'Pass on modeled checks' }
  if (concept.checks.some(check => check.status === 'fail')) return { state: 'fail', label: 'Fails modeled checks' }
  return { state: 'review', label: 'Modeled checks need review' }
}

function renderResults(message) {
  $('plot-area').textContent = result?.plotArea ? area(result.plotArea) : '–'
  $('budget').textContent = result?.budget ? area(result.budget) : '–'
  const fitCount = result?.concepts?.filter(concept => concept.available && concept.checks.every(check => check.status === 'pass')).length
  $('status').textContent = message ?? (fitCount === 0 ? 'No fitting concept' : 'Screened')
  $('status').dataset.state = result?.sections && !message && fitCount !== 0 ? 'ready' : message === 'Calculating' ? 'loading' : 'review'
  $('result-basis').textContent = result?.sections ?
    `R.8 ${scenario ? 'example' : 'screening'} · ${$('use').selectedOptions[0].textContent} · Edge ${frontage + 1}, ${number.format($('width').valueAsNumber)} m ${scenario ? 'assumed ' : ''}road, ${number.format($('center').valueAsNumber)} m to centerline` :
    result?.plotArea ? 'Outline measurements' : ''
  $('concept-count').textContent = result?.concepts?.length ? `${fitCount} pass modeled checks` : ''
  $('concept-count').hidden = !result?.concepts?.length
  $('concept-basis').hidden = !result?.concepts?.some(concept => concept.available)
  if (result?.sections && activeView !== 'envelope' && !result.concepts?.[Number(activeView)]?.available) activeView = 'envelope'
  $('present').disabled = !presenting && (!map || !result?.sections || drawing || editing)
  updateStudio()
  $('concept-count').dataset.fit = fitCount === undefined ? '' : fitCount === result.concepts.length ? 'all' : 'review'
  renderLocation()
  renderSurvey()
  $('result-evidence').textContent = evidenceSummary()
  $('result-evidence').hidden = !$('result-evidence').textContent
  $('local-open-rule').textContent = $('use').value === 'office' ? '10% of plot' : '30% of plot'
  $('export').disabled = !result?.plotArea
  $('export').textContent = result?.plotArea && !result.sections ? 'Export outline' : 'Export study'
  $('views').hidden = !result?.sections
  const comparison = compareConcepts(result?.concepts)
  $('compare-concepts').disabled = !comparison
  $('compare-concepts').hidden = !comparison
  if (designPreview === 'review') renderReviewBoard(comparison)
  $('slice-control').hidden = !result?.sections || activeView !== 'envelope'
  const section = inspectedSection()
  const cap = section?.plateBudgets ? sectionPlateCap(section) : null
  $('capacity').hidden = !cap
  if (cap) {
    $('plate-cap').textContent = area(cap.value)
    $('plate-basis').textContent = `${number.format(section.height)} m · ${section.stories} ${section.stories === 1 ? 'floor' : 'equal floors'} · Limited by ${cap.label}`
    $('concept-basis').textContent = `Generated concepts target preset sizes. At ${number.format(section.height)} m, the modeled floor-plate cap is ${area(cap.value)}.`
  }
  $('slice-value').textContent = section ? `${number.format(section.height)} m` : ''
  $('slice-height').setAttribute('aria-valuetext', section ? `${section.height} metres` : '')
  const concepts = $('concepts')
  concepts.replaceChildren()
  const insight = $('insight')
  insight.replaceChildren()
  const summary = document.createElement('p')
  summary.className = 'section-note'
  insight.append(summary)
  for (const button of $('views').querySelectorAll('button')) {
    const view = button.dataset.view
    button.setAttribute('aria-pressed', String(view === activeView))
    if (view !== 'envelope') {
      const option = result?.concepts?.[Number(view)]
      button.textContent = option?.name ?? (view === '0' ? 'Garden Court' : 'Compact Stack')
      button.disabled = !option?.available
    }
  }
  updateOverlap()
  updatePlotLabel()
  const selected = result?.concepts?.[Number(activeView)]
  if (!result?.sections) {
    summary.hidden = true
  } else if (activeView === 'envelope') {
    const top = inspectedSection()
    const stage = selectedConstraint()
    summary.textContent = stage ? `${constraintLabel(stage.id)}. Remaining mapped area ${area(stage.area)}.` :
      top?.area ? `${area(top.area)} of geometric clearance at this height. FAR and open-space checks apply to each concept.` :
        result.sections.every(slice => !slice.area) ? 'Setbacks and road-height limits leave no buildable area at any modeled height.' :
          'Setbacks and road-height limits leave no buildable area at this height.'
    if (top?.requirements) {
      const limits = document.createElement('dl')
      limits.className = 'rule-list slice-rules'
      for (const [name, value] of [
        ['Boundary clearance', top.requirements.boundaryInset],
        ['Road setback', top.requirements.roadSetback],
        ['Height-plane setback', top.requirements.heightSetback],
      ]) {
        const row = document.createElement('div')
        const label = document.createElement('dt')
        const reading = document.createElement('dd')
        label.textContent = name
        reading.textContent = `${number.format(value)} m`
        row.append(label, reading)
        limits.append(row)
      }
      insight.append(limits)
      if (top.plateBudgets) {
        const budget = document.createElement('p')
        budget.className = 'hint'
        const controlling = sectionPlateCap(top)
        budget.textContent = `With ${top.stories} ${top.stories === 1 ? 'floor' : 'equal floors'}, each floor plate is capped at ${area(controlling.value)} by ${controlling.label}. FAR allows ${area(top.plateBudgets.far)} per floor, open space allows ${area(top.plateBudgets.openSpace)}, and the geometric section has ${area(top.area)}.`
        insight.append(budget)
      }
      if (top.area && $('width').valueAsNumber > 0) {
        const crossSection = document.createElement('canvas')
        crossSection.className = 'road-section'
        crossSection.width = 280
        crossSection.height = 100
        crossSection.setAttribute('role', 'img')
        if (crossSection.getContext('2d')) {
          drawRoadSection(crossSection, { width: $('width').valueAsNumber, height: top.height, requirements: top.requirements })
          insight.append(crossSection)
        }
      }
    }
  } else {
    summary.textContent = selected?.available
      ? `${selected.name} reserves ${area(selected.plantingArea)} as permeable planting.`
      : 'This concept needs more buildable area under the selected inputs.'
    if (selected?.available) insight.append(conceptSchedule(selected))
  }
  for (const [index, concept] of (result?.concepts ?? []).entries()) {
    const card = document.createElement('article')
    card.className = 'card'
    card.dataset.selected = String(String(index) === activeView)
    const heading = document.createElement('div')
    heading.className = 'card-title'
    const title = document.createElement('h3')
    title.textContent = concept.name
    const subtitle = document.createElement('small')
    subtitle.textContent = concept.available
      ? `${concept.stories} ${concept.stories === 1 ? 'floor' : 'floors'} · ${number.format(concept.roofHeight)} m high`
      : concept.reason ?? 'No viable fit under the selected inputs'
    heading.append(title)
    if (concept.available) {
      const show = document.createElement('button')
      show.type = 'button'
      show.textContent = 'View'
      show.setAttribute('aria-label', `View ${concept.name} on map`)
      show.addEventListener('click', () => selectView(String(index), true))
      heading.append(show)
    }
    card.append(heading, subtitle)
    if (concept.available) {
      const verdict = document.createElement('p')
      const { state, label } = conceptVerdict(concept)
      verdict.className = 'concept-verdict'
      verdict.dataset.verdict = state
      verdict.textContent = label
      card.append(verdict)
      const preview = makeConceptPreview(concept, index)
      const gross = document.createElement('strong')
      gross.className = 'concept-gross'
      gross.textContent = area(concept.gross)
      const grossLabel = document.createElement('span')
      grossLabel.className = 'concept-gross-label'
      grossLabel.textContent = 'Example gross floor area'
      const hero = document.createElement('div')
      hero.className = 'concept-hero'
      const metric = document.createElement('div')
      metric.append(gross, grossLabel)
      hero.append(metric)
      if (preview) hero.append(preview)
      card.append(hero)
      const list = document.createElement('ul')
      list.className = 'checklist'
      for (const check of concept.checks) {
        const row = document.createElement('li')
        const name = document.createElement(check.source ? 'a' : 'span')
        name.textContent = check.name
        if (check.source) Object.assign(name, { href: check.source, target: '_blank', rel: 'noopener', title: `Clause ${check.clause}` })
        const status = document.createElement('strong')
        status.className = check.status
        status.textContent = { pass: 'Pass', fail: 'Fail', unverified: 'Unverified' }[check.status]
        const reading = document.createElement('div')
        reading.append(name)
        if (Number.isFinite(check.actual) && Number.isFinite(check.limit)) {
          const measure = document.createElement('small')
          measure.className = 'check-measure'
          const comparison = check.name === 'Floor area ratio' ? 'max' : 'min'
          measure.textContent = `${area(check.actual)} · ${comparison} ${area(check.limit)}`
          reading.append(measure)
        }
        row.append(reading, status)
        list.append(row)
      }
      const controlling = concept.openRequirements.find(rule => rule.area === concept.openMinimum)
      const basis = document.createElement('small')
      basis.textContent = `Open-space minimum: ${controlling.label}.`
      card.append(list, basis)
    }
    concepts.append(card)
  }
}

function makeConceptPreview(concept, index, comparisonHeight) {
  if (comparisonHeight === undefined && conceptPreviews.has(concept)) return conceptPreviews.get(concept)
  if (!currentFrame || points.length < 3) return null
  const canvas = document.createElement('canvas')
  canvas.className = 'concept-preview'
  canvas.width = comparisonHeight === undefined ? 246 : 540
  canvas.height = comparisonHeight === undefined ? 146 : 292
  canvas.setAttribute('aria-hidden', 'true')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const shape = convertGeometry(concept.footprint, currentFrame.toMap)
  const geometry = parcelGeometry(points, holes)
  const [west, south, east, north] = geometryBounds(geometry)
  const center = [(west + east) / 2, (south + north) / 2]
  const metricScale = metresPerDegree(center[1])
  const span = Math.hypot((east - west) * metricScale.longitude, (north - south) * metricScale.latitude)
  const scale = Math.min(canvas.width * .83 / span, canvas.height * .85 / (span * .62 + (comparisonHeight ?? concept.roofHeight) * .81))
  const camera = { center, width: canvas.width, height: canvas.height, scale, pitch: 55, bearing: -20 }
  if (comparisonHeight !== undefined) {
    camera.pitch = 58
    camera.bearing = -48
    const framing = siteProjection({ ...camera, scale: 1 })
    const plot = points.map(point => framing.project(point))
    const [left, top, right, bottom] = geometryBounds(parcelGeometry(plot))
    const roofTop = top - comparisonHeight * Math.sin(camera.pitch * Math.PI / 180)
    camera.center = framing.unproject([(left + right) / 2, (roofTop + bottom) / 2])
    camera.scale = Math.min(canvas.width * .9 / (right - left), canvas.height * .84 / (bottom - roofTop))
  }
  const floorHeight = concept.roofHeight / concept.stories
  const levels = Array.from({ length: concept.stories }, (_, floor) => feature(shape, {
    base: floor * floorHeight, height: (floor + 1) * floorHeight, proposal: true, color: conceptColors[index][floor % 2],
  }))
  paintSite(ctx, { ...camera, projection: siteProjection(camera), streets: [], buildings: [],
    layers: { plot: [feature(geometry)], massing: levels, planting: [
      feature(convertGeometry(concept.permeable, currentFrame.toMap)),
    ] },
    display: { architectural: true, dimensions: false, labels: false, massingOpacity: 1 },
  })
  if (comparisonHeight === undefined) conceptPreviews.set(concept, canvas)
  return canvas
}

function renderReviewBoard(comparison) {
  const board = $('review-board')
  board.hidden = !comparison
  board.replaceChildren()
  if (!comparison) return
  const heading = document.createElement('p')
  heading.className = 'review-board-label'
  heading.textContent = 'Example concepts'
  board.append(heading)
  for (const { concept, index } of comparison.options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-pressed', String(activeView === String(index)))
    const preview = makeConceptPreview(concept, index, comparison.height)
    const title = document.createElement('strong')
    title.textContent = concept.name
    const measures = document.createElement('span')
    measures.textContent = `${area(concept.gross)} gross · ${number.format(concept.roofHeight)} m high`
    if (preview) {
      preview.className = 'review-massing'
      button.append(preview)
    }
    button.append(title, measures)
    button.addEventListener('click', () => selectView(String(index), true))
    board.append(button)
  }
}

function renderSheetEvidence() {
  const basis = $('sheet-basis')
  basis.textContent = `${$('result-basis').textContent} · Base FAR budget ${area(result.budget)}.`
  const section = inspectedSection()
  if (section?.plateBudgets) {
    const cap = sectionPlateCap(section)
    const limit = document.createElement('p')
    limit.textContent = `At ${number.format(section.height)} m, the equal floor plate cap is ${area(cap.value)}. The controlling limit is ${cap.label}.`
    basis.append(limit)
  }
  const evidence = document.createElement('p')
  evidence.className = 'sheet-site-evidence'
  evidence.textContent = evidenceSummary()
  basis.append(evidence)
  basis.hidden = false
  const sources = $('sheet-sources')
  const list = sources.querySelector('ul')
  list.replaceChildren()
  for (const [key, label] of [
    ['plan', 'Bangkok Comprehensive Plan, clause 15'],
    ['local', 'Bangkok Building Ordinance, clauses 49–55'],
    ['buildingControl', 'Ministerial Regulation 55, clauses 33, 41, 44 and 50'],
  ]) {
    if (!result.sources?.[key]) continue
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = result.sources[key]
    link.textContent = label
    link.target = '_blank'
    link.rel = 'noopener'
    item.append(link)
    list.append(item)
  }
  sources.hidden = false
}

function openConceptComparison() {
  const comparison = compareConcepts(result?.concepts)
  const dialog = $('compare-dialog')
  if (!comparison || dialog.open) return
  const { options, height, grossDifference, checks } = comparison
  const [first, second] = options.map(({ concept }) => concept)
  $('compare-location').textContent = studyName
  $('compare-first').textContent = first.name
  $('compare-second').textContent = second.name
  $('compare-visuals').replaceChildren()
  $('compare-captions').replaceChildren()
  $('compare-measures').replaceChildren()
  $('compare-checks').replaceChildren($('compare-checks').firstElementChild)
  $('compare-split').value = '50'
  setComparisonMode(designPreview === 'map' ? 'overlay' : 'pair')
  updateComparisonSplit()

  for (const { concept, index } of options) {
    const preview = makeConceptPreview(concept, index, height)
    if (preview) {
      preview.className = 'compare-canvas'
      $('compare-visuals').append(preview)
    }
    const caption = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = concept.name
    const verdict = document.createElement('small')
    const { state, label } = conceptVerdict(concept)
    verdict.className = 'concept-verdict'
    verdict.dataset.verdict = state
    verdict.textContent = label
    const description = document.createElement('div')
    description.append(name, verdict)
    const show = document.createElement('button')
    show.type = 'button'
    show.textContent = 'View on map'
    show.setAttribute('aria-label', `View on map: ${concept.name}`)
    show.addEventListener('click', () => {
      comparisonMapView = String(index)
      dialog.close()
    })
    caption.append(description, show)
    $('compare-captions').append(caption)
  }

  const [larger, smaller] = grossDifference > 0 ? [second, first] : [first, second]
  $('compare-takeaway').textContent = Math.abs(grossDifference) >= .05
    ? `${larger.name} has ${area(Math.abs(grossDifference))} more gross floor area than ${smaller.name}.`
    : 'Both concepts have the same gross floor area to the displayed precision.'
  for (const [label, key, format] of [
    ['Example gross floor area', 'gross', area],
    ['Building footprint', 'floorPlate', area],
    ['Open space', 'openArea', area],
    ['Permeable planting', 'plantingArea', area],
    ['Storeys', 'stories', String],
    ['Roof height', 'roofHeight', value => `${number.format(value)} m`],
  ]) {
    $('compare-measures').append(comparisonRow(label, [format(first[key]), format(second[key])]))
  }
  const checkLabels = { pass: 'Pass', fail: 'Fail', unverified: 'Unverified' }
  for (const { name, statuses } of checks) {
    const row = comparisonRow(name, statuses.map(status => checkLabels[status] ?? '—'))
    statuses.forEach((status, index) => {
      if (status) row.cells[index + 1].dataset.check = status
    })
    $('compare-checks').append(row)
  }
  renderSheetEvidence()
  dialog.showModal()
}

const comparisonModes = document.querySelectorAll('[data-compare-mode]')

function setComparisonMode(mode) {
  $('compare-visuals').dataset.mode = mode
  $('compare-reveal').hidden = mode !== 'overlay'
  for (const button of comparisonModes) button.setAttribute('aria-pressed', String(button.dataset.compareMode === mode))
}

function updateComparisonSplit() {
  const slider = $('compare-split')
  const left = slider.valueAsNumber
  $('compare-visuals').style.setProperty('--split', left + '%')
  const first = $('compare-first').textContent
  const second = $('compare-second').textContent
  slider.setAttribute('aria-valuetext', `${left}% ${first}, ${100 - left}% ${second}`)
}

for (const button of comparisonModes) button.addEventListener('click', () => setComparisonMode(button.dataset.compareMode))
$('compare-split').addEventListener('input', updateComparisonSplit)

function comparisonRow(label, values) {
  const row = document.createElement('tr')
  const heading = document.createElement('th')
  heading.scope = 'row'
  heading.textContent = label
  row.append(heading)
  for (const value of values) {
    const cell = document.createElement('td')
    cell.textContent = value
    row.append(cell)
  }
  return row
}

$('compare-concepts').addEventListener('click', openConceptComparison)
$('print-sheet').addEventListener('click', () => window.print())
$('close-compare').addEventListener('click', () => $('compare-dialog').close())
$('compare-dialog').addEventListener('close', () => {
  if (comparisonMapView === null) $('compare-concepts').focus({ preventScroll: true })
  else selectView(comparisonMapView, true)
  comparisonMapView = null
})

function conceptSchedule(concept) {
  const details = document.createElement('details')
  details.className = 'concept-schedule'
  const title = document.createElement('summary')
  title.textContent = 'Floor area schedule'
  details.append(title)
  const grid = document.createElement('dl')
  grid.className = 'rule-list'
  for (const [label, amount] of [
    ['Area per floor', area(concept.floorPlate)],
    ['Floors', String(concept.stories)],
    ['Total floor area', area(concept.gross)],
    ['Base FAR budget', area(result.budget)],
    ['FAR used', `${(concept.gross / result.plotArea).toFixed(2)} : 1`],
    ['Open space provided', area(concept.openArea)],
    ['Open-space minimum', area(concept.openMinimum)],
  ]) {
    const row = document.createElement('div')
    const name = document.createElement('dt')
    const value = document.createElement('dd')
    name.textContent = label
    value.textContent = amount
    row.append(name, value)
    grid.append(row)
  }
  details.append(grid)
  return details
}

function projectStudy(ring, selectedEdge, exclusions = []) {
  // Outline measurements still need a local metric frame before a road is chosen.
  const edge = selectedEdge ?? edgeReadings(ring).reduce((longest, candidate) =>
    candidate.metres > longest.metres ? candidate : longest).index
  const frame = frontageFrame(ring, edge)
  const projected = ring.map((point, index) => {
    const [x, y] = frame.toLocal(point)
    return [x, index === edge || index === (edge + 1) % ring.length ? 0 : y]
  })
  const projectedExclusions = exclusions.map(exclusion => exclusion.map(frame.toLocal))
  if ([...projected, ...projectedExclusions.flat()].some(point => Math.hypot(...point) > 1500)) {
    throw new Error('Keep plot vertices within 1.5 km of the local study origin.')
  }
  const bounds = geometryBounds(parcelGeometry(ring, exclusions))
  const buildings = contextIndex.filter(entry => overlapsBounds(bounds, entry.bounds)).map(({ item }) => ({
    id: item.properties.id, geometry: convertGeometry(item.geometry, frame.toLocal),
  }))
  return { frame, plot: parcelGeometry(projected, projectedExclusions), buildings }
}

function reviewImported(entries) {
  const batchId = ++nextBatch
  const batch = []
  for (const [id, entry] of entries.entries()) {
    try {
      const { plot, buildings } = projectStudy(entry.points, entry.frontage, entry.holes)
      batch.push({ id, plot, buildings })
    } catch {
      entry.metrics = { status: 'Review geometry' }
    }
  }
  if (!batch.length) return
  reviewBatches.set(batchId, entries)
  worker.postMessage({ batch, batchId })
}

function recalculate() {
  scheduleDraft()
  clearTimeout(timer)
  const current = ++revision
  latestAnalysis = null
  result = null
  parcelMetrics = null
  renderRoad()
  renderMassing()
  if (drawing || points.length < 3) return renderResults(drawing ? 'Add corners and finish the outline.' : 'Draw or import a plot.')
  const { road, notice } = screenInputs({
    zoneChoice: $('zone-choice').value, zoningChecked: $('zone').checked, scenario, shared: activeParcel?.role === 'shared',
    inStudyRegion: locationReading(points, context.features.length)?.inStudyRegion,
    frontage,
    width: $('width').valueAsNumber, centerOffset: $('center').valueAsNumber,
  })
  pendingNotice = notice
  try {
    const { frame, plot, buildings } = projectStudy(points, frontage, holes)
    currentFrame = frame
    const reference = activeParcel?.survey?.boundary
    const surveyBoundary = reference ? convertGeometry(reference, frame.toLocal) : null
    renderResults('Calculating')
    timer = setTimeout(() => queueAnalysis({ revision: current, plot, buildings, surveyBoundary,
      road,
      buildingType: $('use').value }), 65)
  } catch (error) {
    renderResults(error.message)
  }
}

function queueAnalysis(request) {
  if (analysisRunning) {
    latestAnalysis = request
    return
  }
  analysisRunning = true
  worker.postMessage(request)
}

worker.onmessage = ({ data }) => {
  if (data.assemblyId) {
    if (assembly?.id === data.assemblyId) displayAssembly(data.report)
    return
  }
  if (data.sitePlanId) {
    if (data.sitePlanId === nextSitePlan) displaySitePlan(data.plan)
    return
  }
  if (data.reviews) {
    const entries = reviewBatches.get(data.batchId)
    reviewBatches.delete(data.batchId)
    if (!entries) return
    for (const review of data.reviews) {
      const entry = entries[review.id]
      if (entry === activeParcel || !parcelEntries.includes(entry) || entry.metrics) continue
      entry.metrics = review.error ? { status: 'Review geometry' } : summarizeOption(review, hasMappedCoverage(entry.points))
      if (entry.role === 'shared' && !review.error && entry.metrics) entry.metrics.status = 'Shared land'
    }
    if ($('parcel-workspace').open) renderWorkspace()
    return
  }
  analysisRunning = false
  if (latestAnalysis?.revision === revision) {
    const next = latestAnalysis
    latestAnalysis = null
    queueAnalysis(next)
  }
  if (data.revision !== revision) return
  result = data.error ? null : data
  parcelMetrics = summarizeOption(result, hasMappedCoverage())
  if (parcelMetrics && activeParcel?.role === 'shared') parcelMetrics.status = 'Shared land'
  if (parcelMetrics && data.notice) parcelMetrics.status = 'Review frontage'
  if (data.error) parcelMetrics = { status: 'Review geometry' }
  if (result?.sections) {
    $('slice-height').max = String(result.sections.length - 1)
    if (Number($('slice-height').value) >= result.sections.length) $('slice-height').value = $('slice-height').max
  }
  renderResults(data.error ?? data.notice ?? pendingNotice)
  renderMassing()
  if (compareOnLoad) {
    compareOnLoad = false
    openConceptComparison()
  }
  if ($('parcel-workspace').open) renderWorkspace()
}
worker.onerror = () => {
  analysisRunning = false
  latestAnalysis = null
  renderResults('The analysis engine could not run.')
  if (assembly) displayAssembly(null)
}

function updateEdges() {
  $('frontage').replaceChildren(new Option('Choose road-facing edge', ''))
  points.forEach((_, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = `Edge ${index + 1} · ${number.format(currentEdges[index]?.metres ?? 0)} m`
    $('frontage').append(option)
  })
  $('frontage').value = frontage === null ? '' : String(frontage)
  $('frontage').disabled = drawing || points.length < 3
}

function updateDrawHelp() {
  const shared = activeParcel?.role === 'shared' && !drawing
  $('width').disabled = shared
  $('center').disabled = shared
  $('use').disabled = shared
  $('zone-choice').disabled = shared
  $('zone').disabled = shared || $('zone-choice').value !== 'r8'
  updateZonePrompt()
  $('draw').textContent = drawing ? 'Finish plot' : 'Draw plot'
  $('draw').disabled = !map
  $('orbit').disabled = !map || drawing || editing || pickingFrontage
  if (drawing || editing) $('solar-panel').open = false
  $('present').disabled = !presenting && (!map || !result?.sections || drawing || editing)
  if ($('orbit').disabled && orbit) setOrbit(false)
  $('locate').disabled = !map
  $('open-parcels').disabled = drawing
  $('open-assembly').disabled = drawing || !map
  $('edit-survey').disabled = drawing || editing || points.length < 3
  $('open-parcels').textContent = parcelEntries.length > 1 ? `Parcels (${parcelEntries.length})` : 'Parcels'
  $('pitch').disabled = !map || drawing || editing || pickingFrontage
  $('center-road').disabled = shared || !($('width').valueAsNumber >= .2 && $('width').valueAsNumber <= 120)
  $('edit').disabled = drawing || !map || points.length < 3
  $('edit').textContent = editing ? 'Finish edit' : 'Edit vertices'
  $('edit').hidden = drawing
  $('import').hidden = drawing
  $('cancel').hidden = !drawing
  $('pick-edge').disabled = drawing || editing || !map || points.length < 3
  $('undo').hidden = !drawing
  $('undo').disabled = points.length === 0
  $('drawing-tools').hidden = !drawing
  $('map-draw-undo').disabled = points.length === 0
  $('map-draw-finish').disabled = points.length < 3
  $('draw-help').textContent = drawing ? `${points.length} corners. Click the first point or use Finish plot to close.` :
    pickingFrontage ? 'Click the plot edge facing the road.' : ''
}

function setStudyName(next) {
  studyName = next.trim() || 'Untitled plot'
  $('study-name').value = next
  $('map-name').textContent = studyName
  updatePlotLabel()
}

function setFrontage(index) {
  if (frontage !== null && index !== frontage) {
    $('width').value = ''
    $('center').value = ''
  }
  frontage = index
  setPicking(false)
  $('frontage').value = index === null ? '' : String(index)
  mapMessage('')
  renderPlot()
  recalculate()
}

function setPicking(next) {
  pickingFrontage = next
  $('pick-edge').setAttribute('aria-pressed', String(next))
  map?.setInteraction(next ? 'frontage' : drawing ? 'draw' : 'explore')
  updateDrawHelp()
}

function updateStudy() {
  renderPlot()
  updateDrawHelp()
  updateEdges()
  recalculate()
}

function finishDrawing() {
  if (points.length < 3) return mapMessage('Add at least three corners to finish.')
  drawing = false
  previousStudy = null
  if (newParcelOnFinish) {
    activeParcel = importedEntry({ points, holes, name: studyName })
    parcelEntries.push(activeParcel)
  } else markSurveyBoundaryChanged()
  newParcelOnFinish = false
  setPicking(false)
  mapMessage('')
  updateStudy()
}

function beginDrawing(addParcel = false) {
  if (!map || drawing) return
  saveActiveParcel()
  newParcelOnFinish = addParcel
  stopEditing()
  previousStudy = { points, holes, scenario, frontage, name: studyName, width: $('width').value,
    centerOffset: $('center').value, view: activeView, zoneChoice: $('zone-choice').value, zone: $('zone').checked, evidence: $('evidence').textContent }
  drawing = true
  activeView = 'envelope'
  points = []
  holes = []
  frontage = null
  scenario = false
  $('zone').checked = false
  $('zone-choice').value = 'r8'
  updateZonePrompt()
  $('width').value = ''
  $('center').value = ''
  $('evidence').textContent = 'Draw a plot around the land you want to study. Existing structures can be included.'
  setStudyName('New plot')
  map.easeTo({ pitch: 0, bearing: 0 })
  if (window.matchMedia?.('(max-width: 820px)').matches) $('site-map').scrollIntoView({ block: 'start' })
  setPicking(false)
  mapMessage('')
  updateStudy()
}

$('draw').addEventListener('click', () => drawing ? finishDrawing() : beginDrawing())
$('cancel').addEventListener('click', () => {
  if (!previousStudy) return
  const saved = previousStudy
  previousStudy = null
  newParcelOnFinish = false
  drawing = false
  points = saved.points
  holes = saved.holes
  scenario = saved.scenario
  frontage = saved.frontage
  activeView = saved.view
  $('width').value = saved.width
  $('center').value = saved.centerOffset
  $('zone').checked = saved.zone
  $('zone-choice').value = saved.zoneChoice
  updateZonePrompt()
  $('evidence').textContent = saved.evidence
  setStudyName(saved.name)
  setPicking(false)
  mapMessage('')
  updateStudy()
})
$('undo').addEventListener('click', () => {
  points.pop()
  mapMessage('')
  renderPlot()
  updateDrawHelp()
})
for (const [mapButton, control] of [['map-draw-undo', 'undo'], ['map-draw-cancel', 'cancel'], ['map-draw-finish', 'draw']]) {
  $(mapButton).addEventListener('click', () => $(control).click())
}
$('frontage').addEventListener('change', () => {
  const edge = $('frontage').value
  setFrontage(edge === '' ? null : Number(edge))
})
$('pick-edge').addEventListener('click', () => {
  if (!pickingFrontage) map.easeTo({ pitch: 0 })
  setPicking(!pickingFrontage)
})
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return
  const openMapPanel = [$('map-settings'), $('solar-panel')].find(panel => panel.open)
  if (openMapPanel) {
    openMapPanel.open = false
    openMapPanel.querySelector('summary').focus({ preventScroll: true })
  } else if (drawing) $('cancel').click()
  else if (pickingFrontage) setPicking(false)
  else if (presenting) setPresentation(false)
})
for (const id of ['width', 'center']) $(id).addEventListener('input', () => {
  $('center-road').disabled = !($('width').valueAsNumber >= .2 && $('width').valueAsNumber <= 120)
  recalculate()
})
$('center-road').addEventListener('click', () => {
  const width = $('width').valueAsNumber
  if (!(width >= .2 && width <= 120)) return
  $('center').value = String(Math.round(width * 500) / 1000)
  recalculate()
})
function updateZonePrompt() {
  const unsupported = $('zone-choice').value !== 'r8'
  const shared = activeParcel?.role === 'shared' && !drawing
  $('zone-confirm').hidden = scenario || shared || unsupported
  $('zone-rules').hidden = shared || unsupported
}

$('zone-choice').addEventListener('change', () => {
  $('zone').checked = false
  $('zone').disabled = $('zone-choice').value !== 'r8'
  updateZonePrompt()
  recalculate()
})
for (const id of ['use', 'zone']) $(id).addEventListener('change', recalculate)
$('pitch').addEventListener('click', () => {
  $('solar-panel').open = false
  map.easeTo({ pitch: map.getPitch() > 10 ? 0 : 57 })
})
$('views').addEventListener('click', event => {
  const button = event.target.closest('button[data-view]')
  if (!button) return
  selectView(button.dataset.view)
})
function isPristineExample(entry, name, outline) {
  return entry?.scenario && entry.name === name && !entry.survey && entry.role === 'parcel' &&
    entry.zoneChoice === 'r8' && entry.use === 'residential' && entry.frontage === 0 &&
    entry.width === '5' && entry.centerOffset === '2.5' && !entry.holes.length &&
    JSON.stringify(entry.points) === JSON.stringify(outline)
}

function loadExample(narrow = false) {
  const example = narrow ? narrowDemo : demo
  const name = narrow ? narrowSiteName : siteName
  if (!example.length) return mapMessage('The example data is unavailable. Import or draw a parcel to continue.')
  saveActiveParcel()
  const existing = parcelEntries.find(entry => isPristineExample(entry, name, example))
  if (existing) activeParcel = existing
  else if (!isPristineExample(activeParcel, siteName, demo) && !isPristineExample(activeParcel, narrowSiteName, narrowDemo)) {
    if (parcelEntries.length >= parcelLimit) return mapMessage('Remove a study from Parcels before loading another example.')
    activeParcel = importedEntry({ points: example, name })
    parcelEntries.push(activeParcel)
  }
  if (assembly) setAssemblyMode(false)
  stopEditing()
  newParcelOnFinish = false
  drawing = false
  $('slice-height').value = $('slice-height').max
  scenario = true
  if (activeParcel) {
    activeParcel.role = 'parcel'
    activeParcel.survey = null
  }
  frontage = 0
  activeView = 'envelope'
  points = example.map(point => [...point])
  holes = []
  $('zone-choice').value = 'r8'
  $('zone').checked = false
  updateZonePrompt()
  $('width').value = '5'
  $('center').value = '2.5'
  $('use').value = 'residential'
  $('evidence').textContent = narrow ? narrowEvidence : 'Schematic example on a real site. Parcel outline and road dimensions are scenario inputs.'
  previousStudy = null
  setStudyName(name)
  setPicking(false)
  if (map) {
    map.getCanvas().style.cursor = ''
    map.reset()
    if (narrow && points.length) map.easeTo({ center: locationReading(points, false).center })
  }
  selectWorkspacePanel('results', false)
  updateStudy()
}

$('reset').addEventListener('click', () => loadExample())
$('load-narrow').addEventListener('click', () => loadExample(true))

function selectView(view, focus = false) {
  activeView = view
  if (result?.sections) renderResults()
  renderMassing()
  scheduleDraft()
  if (focus) {
    $('views').querySelector(`[data-view="${view}"]`)?.focus({ preventScroll: true })
    if (window.matchMedia?.('(max-width: 820px)').matches) $('site-map').scrollIntoView({ block: 'start' })
  }
}

function stopEditing() {
  handles.forEach(handle => handle.remove())
  handles = []
  editing = false
}

$('edit').addEventListener('click', () => {
  if (editing) {
    stopEditing()
    updateDrawHelp()
    return
  }
  editing = true
  setPicking(false)
  map.easeTo({ pitch: 0 })
  handles = [points, ...holes].flatMap((ring, ringIndex) => ring.map((point, index) => {
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'plot-handle'
    handle.textContent = ringIndex ? '×' : String(index + 1)
    handle.setAttribute('aria-label', `${ringIndex ? `Exclusion ${ringIndex}, vertex` : 'Vertex'} ${index + 1}. Drag or use arrow keys to move.`)
    const move = coordinate => {
      markSurveyBoundaryChanged()
      ring[index] = coordinate
      if (scenario) $('evidence').textContent = 'Edited example. Parcel outline and road dimensions are scenario inputs.'
      renderPlot()
      updateEdges()
      recalculate()
    }
    const marker = map.addHandle(handle, point, move)
    handle.addEventListener('keydown', event => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
      const delta = steps[event.key]
      if (!delta) return
      event.preventDefault()
      const [lng, lat] = marker.getPoint()
      const step = event.shiftKey ? .000045 : .000009
      marker.setPoint([lng + delta[0] * step, lat + delta[1] * step])
      move(marker.getPoint())
    })
    return marker
  }))
  updateDrawHelp()
  $('draw-help').textContent = 'Drag a vertex, or focus it and use the arrow keys. Exclusion vertices use a × marker.'
})

function saveActiveParcel() {
  if (!activeParcel || drawing) return
  Object.assign(activeParcel, { points: points.map(point => [...point]), holes: structuredClone(holes), name: studyName, scenario, frontage,
    width: $('width').value, centerOffset: $('center').value, use: $('use').value, zoneChoice: $('zone-choice').value, zone: $('zone').checked,
    evidence: $('evidence').textContent, metrics: parcelMetrics })
}

function setDraftStatus(message) {
  const status = $('draft-status')
  if (status.textContent !== message) status.textContent = message
  status.hidden = !message
}

function saveTabDraft() {
  clearTimeout(draftTimer)
  if (!tabRecovery || !activeParcel) return
  try {
    const text = currentSnapshot()
    if (!text || text === lastDraftText) return
    window.sessionStorage.setItem(draftKey, text)
    lastDraftText = text
    if (!contextNeedsReload) setDraftStatus('Saved in this tab')
  } catch {
    setDraftStatus('Tab save unavailable. Export to keep your work.')
  }
}

function currentSnapshot() {
  saveActiveParcel()
  return encodeWorkspaceDraft(parcelEntries.filter(entry => entry.points.length >= 3), activeParcel, {
    view: activeView, slice: Number($('slice-height').value), customContext: Boolean(contextSource || contextNeedsReload),
  })
}

function scheduleDraft() {
  if (!tabRecovery) return
  clearTimeout(draftTimer)
  draftTimer = setTimeout(saveTabDraft, 220)
}

function recoverTabDraft() {
  if (!tabRecovery) return null
  try {
    const text = window.sessionStorage.getItem(draftKey)
    if (!text) return null
    const draft = decodeWorkspaceDraft(text)
    lastDraftText = text
    return draft
  } catch {
    setDraftStatus('The tab draft could not be opened.')
    return null
  }
}

window.addEventListener('pagehide', saveTabDraft)

function importedEntry({ points, holes = [], name, savedInputs, split, survey }) {
  return {
    points: points.map(point => [...point]), holes: structuredClone(holes), role: 'parcel', name, scenario: false, frontage: null, width: '', centerOffset: '',
    use: 'residential', zoneChoice: 'r8', ...savedInputs, zone: false,
    evidence: savedInputs ? 'Restored comparison inputs. Check the frontage and road dimensions before confirming zoning.' :
      split ? 'One component of a multipart boundary. Confirm its legal site and road before screening.' :
        'Imported or drawn boundary. Confirm zoning and road measurements for this parcel.',
    metrics: null, survey,
  }
}

function openParcel(entry, { view = 'envelope', slice = null } = {}) {
  if (entry !== activeParcel) saveActiveParcel()
  activeParcel = entry
  stopEditing()
  drawing = false
  previousStudy = null
  newParcelOnFinish = false
  points = entry.points.map(point => [...point])
  holes = structuredClone(entry.holes ?? [])
  frontage = entry.frontage
  scenario = entry.scenario
  activeView = view
  $('slice-height').value = slice === null ? $('slice-height').max : String(slice)
  $('zone').checked = entry.zone
  $('zone-choice').value = entry.zoneChoice ?? 'r8'
  updateZonePrompt()
  $('width').value = entry.width
  $('center').value = entry.centerOffset
  $('use').value = entry.use
  $('evidence').textContent = entry.evidence
  setStudyName(entry.name)
  setPicking(false)
  map?.fitPoints(points)
  mapMessage('')
  updateStudy()
}

function renderWorkspace() {
  saveActiveParcel()
  scheduleDraft()
  const rows = $('parcel-rows')
  rows.replaceChildren()
  const validEntries = parcelEntries.filter(entry => entry.points.length >= 3)
  const maxConcept = Math.max(1, ...validEntries.map(entry => entry.metrics?.conceptArea ?? 0))
  for (const entry of validEntries) {
    const row = document.createElement('tr')
    row.dataset.current = String(entry === activeParcel)
    const nameCell = document.createElement('td')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = entry.name
    if (entry === activeParcel) button.setAttribute('aria-current', 'true')
    button.addEventListener('click', () => {
      $('parcel-workspace').close()
      if (entry !== activeParcel) openParcel(entry)
    })
    nameCell.append(button)
    if (entry !== activeParcel) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'remove-parcel'
      remove.textContent = 'Remove'
      remove.setAttribute('aria-label', `Remove ${entry.name} from comparison`)
      remove.addEventListener('click', () => {
        parcelEntries.splice(parcelEntries.indexOf(entry), 1)
        renderPlot()
        renderWorkspace()
        requestSitePlan()
        $('open-parcels').textContent = `Parcels (${parcelEntries.length})`
        $('workspace-notice').textContent = `${entry.name} removed.`
        $('new-parcel').focus()
      })
      nameCell.append(remove)
    }
    const roleCell = document.createElement('td')
    const role = document.createElement('select')
    role.setAttribute('aria-label', `Planning role for ${entry.name}`)
    for (const [id, text] of [['parcel', 'Parcel'], ['shared', 'Shared land'], ['option', 'Alternative']]) {
      const option = document.createElement('option')
      option.value = id
      option.textContent = text
      role.append(option)
    }
    role.value = entry.role
    role.addEventListener('change', () => {
      entry.role = role.value
      if (entry === activeParcel) {
        updateDrawHelp()
        recalculate()
      } else if (entry.role === 'shared' && entry.metrics?.area) {
        entry.metrics = { ...entry.metrics, baseFar: null, conceptArea: null, status: 'Shared land' }
      } else if (entry.metrics?.status === 'Shared land') {
        entry.metrics.status = 'Open to screen'
      }
      renderPlot()
      renderWorkspace()
      requestSitePlan()
      $('parcel-rows').querySelectorAll('select')[validEntries.indexOf(entry)]?.focus()
    })
    roleCell.append(role)
    row.append(nameCell, roleCell)
    const metrics = entry.metrics
    const report = [metrics?.area, metrics?.baseFar, metrics?.conceptArea, metrics?.overlapArea]
    for (const [index, value] of report.entries()) {
      const cell = document.createElement('td')
      cell.textContent = value == null ? '—' : area(value)
      if (index === 2 && value > 0) {
        const bar = document.createElement('span')
        bar.className = 'metric-bar'
        bar.style.width = `${value / maxConcept * 100}%`
        bar.setAttribute('aria-hidden', 'true')
        cell.append(bar)
      }
      if (index === 3 && value != null && metrics?.overlapIsPartial) {
        cell.append(' (partial)')
      }
      row.append(cell)
    }
    const status = document.createElement('td')
    status.textContent = metrics?.status ?? 'Open parcel to calculate'
    row.append(status)
    rows.append(row)
  }
  const full = parcelEntries.length >= parcelLimit
  $('new-parcel').disabled = full || !map
  $('add-parcel-file').disabled = full
  $('duplicate-parcel').disabled = full || !activeParcel?.points.length
  $('fit-parcels').disabled = !map || !validEntries.length
  $('export-parcels').disabled = !validEntries.length
  $('workspace-notice').textContent = full ? `This workspace has its maximum of ${parcelLimit} studies.` :
    `${validEntries.length} ${validEntries.length === 1 ? 'study' : 'studies'} · Open each parcel to review geometry and enter site inputs.`
  $('open-parcels').textContent = parcelEntries.length > 1 ? `Parcels (${parcelEntries.length})` : 'Parcels'
}

function showWorkspace() {
  renderWorkspace()
  if (!$('parcel-workspace').open) $('parcel-workspace').showModal()
  requestSitePlan()
}

function requestSitePlan() {
  const items = parcelEntries.filter(entry => entry.role !== 'option' && entry.points.length >= 3)
  const sitePlanId = ++nextSitePlan
  const container = $('site-plan-summary')
  container.hidden = items.length < 2 && !items.some(entry => entry.role === 'shared')
  if (container.hidden) return
  const [lng, lat] = items[0].points[0]
  const scale = metresPerDegree(lat)
  const position = ([x, y]) => [(x - lng) * scale.longitude, (y - lat) * scale.latitude]
  const sitePlan = items.map(entry => ({ role: entry.role,
    geometry: convertGeometry(parcelGeometry(entry.points, entry.holes), position) }))
  const distant = sitePlan.some(entry => entry.geometry.coordinates.some(ring => ring.some(point => Math.hypot(...point) > 3000)))
  if (distant) {
    $('site-plan-metrics').textContent = 'These studies span more than 3 km. Compare them individually or mark distant alternatives as Alternative.'
    return
  }
  $('site-plan-metrics').textContent = 'Measuring the site plan…'
  worker.postMessage({ sitePlan, sitePlanId })
}

function displaySitePlan(plan) {
  $('site-plan-metrics').textContent = !plan ? 'Site union unavailable. Review the individual boundaries.' :
    `${area(plan.totalArea)} mapped site area · ${area(plan.sharedArea)} shared land.${plan.overlap > .05 ?
      ` ${area(plan.overlap)} is marked as both parcel and shared land. Review the overlapping boundaries.` : ''}${plan.invalid ?
      ` Excluded ${plan.invalid} invalid ${plan.invalid === 1 ? 'boundary' : 'boundaries'}. Review before relying on this total.` : ''}`
}

function markSurveyBoundaryChanged() {
  if (activeParcel?.survey) activeParcel.survey = { ...activeParcel.survey, stale: true }
}

function renderSurvey() {
  const record = activeParcel?.survey
  $('edit-survey').textContent = record ? 'Edit record' : 'Add record'
  const summary = $('survey-summary')
  const check = compareSurvey(record, result?.plotArea)
  summary.dataset.status = check?.status ?? ''
  if (!check) summary.textContent = 'No source recorded'
  else if (check.status === 'boundary_changed') summary.textContent = 'Boundary changed · review the record'
  else if (check.difference_m2 == null) summary.textContent = record.reference
  else {
    const difference = surveyArea(Math.abs(check.difference_m2))
    const tolerance = check.status === 'within_tolerance' ? ' · within tolerance' :
      check.status === 'outside_tolerance' ? ' · outside tolerance' : ''
    summary.textContent = `${difference} area difference${tolerance}`
  }
  const comparison = $('survey-comparison')
  const outlineCheck = result?.surveyComparison
  comparison.hidden = !record?.boundary
  comparison.textContent = outlineCheck?.error ?? (!outlineCheck ? 'Measuring survey outline…' :
    `${surveyArea(outlineCheck.outside_m2)} outside survey · ${surveyArea(outlineCheck.missing_m2)} missing from plot`)
  const showOutline = Boolean(record?.boundary && !drawing && outlineCheck && !outlineCheck.error)
  $('survey-key').hidden = !showOutline
  setSource('survey', showOutline ? [feature(record.boundary)] : [])
}

function showSurveyFile() {
  $('survey-file-status').textContent = surveyUpload ? `Outline loaded · EPSG:${surveyUpload.source_crs}` : ''
  $('remove-survey-file').hidden = !surveyUpload
}

$('edit-survey').addEventListener('click', () => {
  const record = activeParcel?.survey
  $('survey-parcel').textContent = studyName
  $('survey-reference').value = record?.reference ?? ''
  $('survey-date').value = record?.date ?? ''
  $('survey-area').value = record?.area_m2 ?? ''
  $('survey-tolerance').value = record?.tolerance_m2 ?? ''
  $('clear-survey').hidden = !record
  $('survey-error').textContent = record?.stale ? 'Confirm that this record applies to the current boundary before saving.' : ''
  $('survey-crs').value = record?.source_crs ?? '4326'
  surveyUpload = record?.boundary ? { boundary: record.boundary, source_crs: record.source_crs } : null
  showSurveyFile()
  $('survey-dialog').showModal()
})
$('close-survey').addEventListener('click', () => $('survey-dialog').close())
$('survey-dialog').addEventListener('close', () => {
  if ($('survey-dialog').open) return
  surveyRequest++
  surveyLoading = false
  $('edit-survey').focus({ preventScroll: true })
})
$('clear-survey').addEventListener('click', () => {
  const hadOutline = Boolean(activeParcel.survey?.boundary)
  activeParcel.survey = null
  scheduleDraft()
  if (hadOutline) recalculate()
  else renderSurvey()
  $('survey-dialog').close()
})
$('pick-survey-file').addEventListener('click', () => $('survey-file').click())
$('remove-survey-file').addEventListener('click', () => {
  surveyRequest++
  surveyLoading = false
  surveyUpload = null
  showSurveyFile()
})
$('survey-file').addEventListener('change', async () => {
  const file = $('survey-file').files[0]
  $('survey-file').value = ''
  if (!file) return
  const id = ++surveyRequest
  const source_crs = $('survey-crs').value
  surveyLoading = true
  $('survey-file-status').textContent = 'Reading survey outline…'
  try {
    if (file.size > 1024 * 1024) throw new Error('Choose a survey outline under 1 MB.')
    const { readSurveyOutline } = await import('./survey-coordinate.js')
    const boundary = readSurveyOutline(JSON.parse(await file.text()), source_crs)
    if (id !== surveyRequest || !$('survey-dialog').open) return
    surveyUpload = { boundary, source_crs }
    showSurveyFile()
  } catch (error) {
    if (id !== surveyRequest || !$('survey-dialog').open) return
    const message = error instanceof SyntaxError ? 'The file is not valid JSON.' : error.message
    $('survey-file-status').textContent = surveyUpload ? `${message} The previous outline is still loaded.` : message
  } finally {
    if (id === surveyRequest) surveyLoading = false
  }
})
$('survey-form').addEventListener('submit', event => {
  event.preventDefault()
  if (surveyLoading) {
    $('survey-error').textContent = 'Wait for the outline to finish loading.'
    return
  }
  const optionalValue = id => $(id).value === '' ? null : $(id).valueAsNumber
  try {
    const hadOutline = Boolean(activeParcel.survey?.boundary)
    const record = readSurveyRecord({ reference: $('survey-reference').value, date: $('survey-date').value,
      area_m2: optionalValue('survey-area'), tolerance_m2: optionalValue('survey-tolerance'), ...surveyUpload })
    activeParcel.survey = record
    scheduleDraft()
    if (hadOutline || record.boundary) recalculate()
    else renderSurvey()
    $('survey-dialog').close()
  } catch (error) {
    $('survey-error').textContent = error.message
  }
})

const assemblyPanel = createAssemblyPanel(document, {
  area,
  onSelection(index, value) {
    const { items, choices, report, keys } = assembly
    assemblyPanel.markForReview()
    if (value === '') {
      choices.delete(index)
      items[index].selection = null
    } else {
      const selected = Number(value)
      choices.set(index, selected)
      items[index].selection = { key: keys[index], selected }
    }
    drawAssembly(assemblyPanel.updateSelection(report, choices))
  },
  onOpenParcel(index) {
    const entry = assembly.items[index]
    setAssemblyMode(false)
    openParcel(entry)
    selectWorkspacePanel('inputs', false)
    $('frontage').focus({ preventScroll: true })
  },
})

function setAssemblyMode(enabled) {
  if (!map || (enabled && drawing)) return
  document.body.dataset.assembly = String(enabled)
  $('assembly-panel').hidden = !enabled
  $('assembly-legend').hidden = !enabled
  $('assembly-map-title').hidden = !enabled
  $('map-name').hidden = enabled
  $('open-assembly').setAttribute('aria-pressed', String(enabled))
  if (enabled) {
    if (presenting) setPresentation(false)
    stopEditing()
    setPicking(false)
    setOrbit(false)
    $('map-settings').open = false
    $('solar-panel').open = false
    map.easeTo({ pitch: 0, bearing: 0 })
    requestAssembly(true)
    $('assembly-title').focus({ preventScroll: true })
  } else {
    assembly = null
    setSource('assembly', null)
    setOrbit(false)
    requestAnimationFrame(() => { if (!assembly && points.length >= 3) map.fitPoints(points) })
    studyToolsTrigger.focus({ preventScroll: true })
  }
}

function requestAssembly(fit = false) {
  saveActiveParcel()
  const items = parcelEntries.filter(entry => entry.role !== 'option' && entry.points.length >= 3)
  const choices = new Map()
  const keys = items.map(entry => JSON.stringify([entry.points, entry.holes, entry.frontage, entry.width,
    entry.centerOffset, entry.zone, entry.zoneChoice, entry.use, entry.scenario, entry.role]))
  const planKey = JSON.stringify(keys)
  if (lastAssemblyKey && lastAssemblyKey !== planKey) assemblyPanel.markForReview()
  lastAssemblyKey = planKey
  assembly = { id: ++nextAssembly, items, choices, keys, layers: {
    parcels: items.map(entry => feature(parcelGeometry(entry.points, entry.holes), { name: entry.name, role: entry.role })),
  } }
  setSource('assembly', assembly.layers)
  if (fit && items.length) requestAnimationFrame(() => {
    if (assembly?.items === items) map.fitPoints(items.flatMap(entry => entry.points))
  })
  if (!items.length) return assemblyPanel.state('Add a parcel to open a site plan.')
  const origin = items[0].points[0]
  const project = eastNorthFrame(origin)
  const scale = metresPerDegree(origin[1])
  assembly.toWorld = ([x, y]) => [origin[0] + x / scale.longitude, origin[1] + y / scale.latitude]
  const plan = assembly.layers.parcels.map(({ geometry, properties }) => ({
    role: properties.role, geometry: convertGeometry(geometry, project),
  }))
  if (plan.some(entry => entry.geometry.coordinates.some(ring => ring.some(point => Math.hypot(...point) > 3000)))) {
    return assemblyPanel.state('The parcels span more than 3 km from the plan origin. Mark distant studies as alternatives and try again.')
  }
  const studies = []
  const frames = new Map()
  const frontages = []
  assembly.frames = frames
  items.forEach((entry, entryIndex) => {
    if (entry.role === 'shared') return
    const { road, notice } = screenInputs({ zoneChoice: entry.zoneChoice, zoningChecked: entry.zone, scenario: entry.scenario,
      inStudyRegion: locationReading(entry.points, false)?.inStudyRegion,
      frontage: entry.frontage,
      width: Number(entry.width), centerOffset: Number(entry.centerOffset) })
    try {
      const { frame, plot, buildings } = projectStudy(entry.points, entry.frontage, entry.holes)
      frames.set(entryIndex, frame)
      if (road) frontages.push(feature({ type: 'LineString', coordinates: [
        entry.points[entry.frontage], entry.points[(entry.frontage + 1) % entry.points.length],
      ] }, { layer: 'frontage', parcel: entry.name, road_width_m: Number(entry.width) }))
      studies.push({ entryIndex, name: entry.name, plot, buildings, road, notReady: notice, buildingType: entry.use })
      if (entry.selection?.key === keys[entryIndex]) choices.set(entryIndex, entry.selection.selected)
    } catch (error) {
      studies.push({ entryIndex, name: entry.name, error: error.message })
    }
  })
  assembly.layers.frontage = frontages
  assemblyPanel.state('Measuring land and screening parcels…', 'loading')
  worker.postMessage({ assemblyId: assembly.id, assembly: plan, studies })
}

function displayAssembly(report) {
  if (!report) return assemblyPanel.state('The plan could not be calculated. Review parcel boundaries and try again.')
  assembly.report = report
  for (const parcel of report.parcels) {
    if (!parcel.designs.some(design => design.index === assembly.choices.get(parcel.entryIndex))) assembly.choices.delete(parcel.entryIndex)
  }
  drawAssembly(assemblyPanel.display(report, assembly.choices))
}

function drawAssembly(selection) {
  const { report: { land, parcels }, toWorld, frames, layers } = assembly
  assembly.selection = selection
  layers.overlap = land.conflicts ? [feature(convertGeometry(land.conflicts, toWorld))] : []
  const included = new Set(selection.selected.map(design => design.entryIndex))
  layers.overlapIds = new Set(parcels.filter(parcel => included.has(parcel.entryIndex)).flatMap(parcel => parcel.existingIds))
  layers.massing = selection.selected.flatMap(design => {
    const footprint = convertGeometry(design.footprint, frames.get(design.entryIndex).toMap)
    const level = design.roofHeight / design.stories
    return Array.from({ length: design.stories }, (_, index) => feature(footprint, {
      base: index * level, height: (index + 1) * level, name: `${design.parcelName} · ${design.name}`,
      area: design.floorPlate, proposal: true, top: index === design.stories - 1, color: conceptColors[design.index][index % 2],
    }))
  })
  layers.planting = selection.selected.filter(design => design.permeable).map(design =>
    feature(convertGeometry(design.permeable, frames.get(design.entryIndex).toMap)))
  setSource('assembly', layers)
}

$('open-assembly').addEventListener('click', () => setAssemblyMode(!assembly))
$('return-study').addEventListener('click', () => setAssemblyMode(false))
$('plan-from-parcels').addEventListener('click', () => {
  $('parcel-workspace').close()
  setAssemblyMode(true)
})
$('assembly-export').addEventListener('click', () => {
  const { items, selection, report: { land }, layers, frames } = assembly
  const data = exportWorkspace(items)
  data.site_plan = {
    schema: 'bangkok-site-plan/v1',
    scope: 'Takes the union of mapped land and totals selected independent parcel concepts when land allocation is clear. Site-wide permissions and access require review.',
    mapped_area_m2: land.totalArea, shared_area_m2: land.sharedArea, blocks: land.components, invalid_boundaries: land.invalid,
    parcel_overlap_m2: land.parcelOverlap, shared_overlap_m2: land.overlap,
    selected_floor_area_m2: selection.floorArea, selected_footprint_m2: selection.footprintArea,
    reviewer_status: assemblyPanel.reviewStatus(),
  }
  for (const item of data.features) item.properties.layer = 'plot'
  data.features.push(...layers.frontage, ...layers.overlap.map(({ geometry }) => feature(geometry, { layer: 'land_conflict' })))
  for (const design of selection.selected) data.features.push(feature(
    convertGeometry(design.footprint, frames.get(design.entryIndex).toMap), {
      layer: 'selected_concept', parcel: design.parcelName, name: design.name,
      floor_area_m2: design.gross, footprint_m2: design.floorPlate, height_m: design.roofHeight, storeys: design.stories,
      checks: design.checks,
    }))
  showExport(data, 'bangkok-site-plan.geojson', 'Parcel boundaries, selected concept footprints, land conflicts, and recorded review statuses.')
})

let exportURL
let returnToComparison = false

function showExport(data, name, description, fromComparison = false) {
  const dialog = $('export-dialog')
  if (exportURL) URL.revokeObjectURL(exportURL)
  const json = JSON.stringify(data, null, 2)
  try {
    exportURL = URL.createObjectURL(new Blob([json], { type: 'application/geo+json' }))
  } catch {
    exportURL = null
  }
  const save = $('save-geojson')
  save.hidden = !exportURL
  if (exportURL) save.href = exportURL
  else save.removeAttribute('href')
  save.download = name
  $('export-file-name').textContent = name
  $('export-description').textContent = description
  $('export-preview').value = json
  $('export-status').textContent = 'You can select and copy the preview if your browser blocks saving from this panel.'
  returnToComparison = fromComparison
  if (fromComparison) $('parcel-workspace').close()
  if (!dialog.open) dialog.showModal()
}

$('close-export').addEventListener('click', () => $('export-dialog').close())
$('export-dialog').addEventListener('close', () => {
  if (exportURL) {
    URL.revokeObjectURL(exportURL)
    exportURL = null
  }
  $('save-geojson').removeAttribute('href')
  if (returnToComparison) queueMicrotask(showWorkspace)
  else $(assembly ? 'assembly-export' : 'export').focus()
  returnToComparison = false
})
$('save-geojson').addEventListener('click', () => {
  $('export-status').textContent = 'Download requested. If no file appears, use Copy GeoJSON or copy the preview.'
})
$('copy-geojson').addEventListener('click', async () => {
  const preview = $('export-preview')
  try {
    await navigator.clipboard.writeText(preview.value)
    if ($('export-dialog').open) $('export-status').textContent = 'GeoJSON copied.'
  } catch {
    if (!$('export-dialog').open) return
    preview.focus()
    preview.select()
    $('export-status').textContent = 'The preview is selected. Press Ctrl+C or Command+C to copy it.'
  }
})

$('open-parcels').addEventListener('click', showWorkspace)
$('close-parcels').addEventListener('click', () => $('parcel-workspace').close())
$('new-parcel').addEventListener('click', () => {
  $('parcel-workspace').close()
  beginDrawing(true)
})
$('fit-parcels').addEventListener('click', () => {
  saveActiveParcel()
  $('parcel-workspace').close()
  map?.fitPoints(parcelEntries.flatMap(entry => entry.points))
})
$('duplicate-parcel').addEventListener('click', () => {
  if (parcelEntries.length >= parcelLimit || !activeParcel || drawing) return
  saveActiveParcel()
  const name = `${studyName.slice(0, 35)} · Option`
  const entry = { ...activeParcel, name, points: points.map(point => [...point]), holes: structuredClone(holes), role: 'option' }
  parcelEntries.push(entry)
  $('parcel-workspace').close()
  openParcel(entry)
})
$('export-parcels').addEventListener('click', () => {
  saveActiveParcel()
  showExport(exportWorkspace(parcelEntries.filter(entry => entry.points.length >= 3)), 'bangkok-parcel-comparison.geojson',
    'Parcel outlines, recorded inputs and available comparison measurements.', true)
})
$('add-parcel-file').addEventListener('click', () => {
  $('parcel-workspace').close()
  $('import-file').click()
})
$('import').addEventListener('click', () => $('import-file').click())
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0]
  $('import-file').value = ''
  if (!file) return
  const request = ++parcelImportRequest
  const status = $('parcel-import-status')
  status.dataset.state = 'loading'
  status.textContent = 'Reading the parcel file…'
  status.hidden = false
  try {
    if (file.size > 1024 * 1024) throw new Error('Choose a GeoJSON file under 1 MB.')
    const contents = await file.text()
    if (request !== parcelImportRequest) return
    if (drawing) throw new Error('Finish or cancel the current drawing before importing a parcel.')
    const imported = importParcels(JSON.parse(contents))
    if (parcelEntries.length + imported.length > parcelLimit) {
      throw new Error(`This workspace can hold ${parcelLimit} studies. Remove a study or import fewer parcels.`)
    }
    const entries = imported.map(importedEntry)
    parcelEntries.push(...entries)
    openParcel(entries[0])
    status.dataset.state = 'ready'
    status.textContent = entries.length === 1 ? 'Parcel imported.' : `${entries.length} parcels imported.`
    if (entries.length > 1) {
      reviewImported(entries.slice(1))
      showWorkspace()
    }
  } catch (error) {
    if (request !== parcelImportRequest) return
    status.dataset.state = 'error'
    status.textContent = error instanceof SyntaxError ? 'The file is not valid JSON.' : error.message
    mapMessage(status.textContent)
  }
})

for (const [id, event] of [['slice-height', 'input'], ['constraint-step', 'change']]) {
  $(id).addEventListener(event, () => {
    renderResults()
    renderMassing()
    scheduleDraft()
  })
}

$('export').addEventListener('click', () => {
  if (!result?.plotArea || !currentFrame) return
  const study = buildStudyFile({ plot: parcelGeometry(points, holes), frame: geometry => convertGeometry(geometry, currentFrame.toMap),
    frontage, site: $('map-name').textContent, scenario, width: $('width').valueAsNumber,
    centerOffset: $('center').valueAsNumber, buildingType: $('use').value, result, height: inspectedSection()?.height, contextSource,
    survey: activeParcel?.survey })
  showExport(study, result.sections ? 'bangkok-plot-study.geojson' : 'bangkok-plot-outline.geojson',
    result.sections ? 'Plot, envelope, modeled checks and source references.' :
      'Plot and available mapped measurements. Run the zoning screen to include an envelope and concepts.')
})

function updateStudio() {
  const concept = result?.concepts?.[Number(activeView)]
  const section = inspectedSection()
  const canExport = activeView === 'envelope'
    ? $('constraint-step').value === 'final' && result?.sections?.some(item => item.geometry && item.height <= section?.height)
    : concept?.available
  $('export-model').disabled = !canExport
  $('export-model').title = canExport ? 'Choose GLB, IFC, or DXF for the visible study' : 'Select a complete envelope or a fitted concept'
  $('proposal-key').classList.toggle('architectural', activeView !== 'envelope' && $('scene-style').value === 'architectural')
  for (const button of $('presentation-views').querySelectorAll('button')) {
    const view = button.dataset.view
    button.setAttribute('aria-pressed', String(view === activeView))
    button.disabled = view !== 'envelope' && !result?.concepts?.[Number(view)]?.available
    if (view !== 'envelope') button.textContent = result?.concepts?.[Number(view)]?.name ?? 'Unavailable'
  }
  $('illustration-note').hidden = !(concept?.available && $('scene-style').value === 'architectural')
  $('illustration-note').textContent = contextSource ? 'Illustrative facade. Surrounding heights from uploaded context.' :
    'Illustrative facade. Surrounding heights are estimated.'
  $('presentation-summary').textContent = concept?.available
    ? `${concept.name} · ${area(concept.gross)} gross floor area · ${number.format(concept.roofHeight)} m`
    : `Buildable envelope${section ? ` · ${section.height} m section` : ''}`
}

function setOrbit(enabled) {
  orbit = enabled
  $('orbit').setAttribute('aria-pressed', String(orbit))
  map?.setOrbit(orbit)
  if (orbit && $('solar-panel').open) $('solar-panel').open = false
  if (orbit && map?.getPitch() === 0) map.easeTo({ pitch: 53 })
  $('map').classList.toggle('orbit-mode', orbit)
}
$('orbit').addEventListener('click', () => setOrbit(!orbit))

function setPresentation(enabled) {
  if (!map || (enabled && (!result?.sections || drawing || editing))) return
  presenting = enabled
  document.body.dataset.presentation = String(presenting)
  $('present').setAttribute('aria-pressed', String(presenting))
  $('exit-presentation').hidden = !presenting
  $('presentation-bar').hidden = !presenting
  if (presenting) {
    $('solar-panel').open = false
    $('scene-style').value = 'architectural'
    $('constraint-step').value = 'final'
    const firstFit = result.concepts.findIndex(concept => concept.available && concept.checks.every(check => check.status === 'pass'))
    if (activeView === 'envelope' && firstFit >= 0) selectView(String(firstFit))
    map.easeTo({ pitch: 58, bearing: -28 })
    $('site-map').scrollIntoView({ block: 'start' })
    requestAnimationFrame(() => {
      if (presenting && points.length >= 3) map.fitPoints(points, true)
    })
  }
  applyDisplay()
  updateStudio()
  const focusTarget = presenting ? $('exit-presentation') : studyToolsTrigger
  focusTarget.focus({ preventScroll: true })
}
$('present').addEventListener('click', () => setPresentation(!presenting))
$('exit-presentation').addEventListener('click', () => setPresentation(false))
$('presentation-views').addEventListener('click', event => {
  const button = event.target.closest('button[data-view]')
  if (button && !button.disabled) selectView(button.dataset.view)
})
const modelFormats = {
  glb: { button: 'Download GLB', type: 'model/gltf-binary',
    description: 'Metric mesh with the WGS84 frontage reference. Open it in a 3D tool such as Blender.' },
  ifc: { button: 'Download IFC', type: 'application/x-step',
    description: 'IFC4 massing with storeys and extruded solids. Use it as early-stage reference geometry in BIM.' },
  dxf: { button: 'Download DXF', type: 'application/dxf',
    description: 'Metric CAD polylines on named parcel, frontage, floor and roof or envelope layers.' },
}

async function prepareModel() {
  const study = modelStudy
  if (!study || !$('model-dialog').open) return
  const request = ++modelRequest
  const format = $('model-format').value
  const specification = modelFormats[format]
  if (!specification) return
  $('format-description').textContent = specification.description
  $('model-status').textContent = 'Preparing geometry…'
  const download = $('download-model')
  download.hidden = true
  download.textContent = specification.button
  try {
    let data
    if (format === 'glb') {
      const { buildStudyModel } = await import('./model-export.js')
      data = buildStudyModel(study)
    } else {
      const { buildDXF, buildIFC } = await import('./drawing-export.js')
      data = format === 'dxf' ? buildDXF(study) : buildIFC(study)
    }
    if (!$('model-dialog').open || request !== modelRequest) return
    if (modelURL) URL.revokeObjectURL(modelURL)
    modelURL = URL.createObjectURL(new Blob([data], { type: specification.type }))
    download.href = modelURL
    download.download = study.concept ? `bangkok-concept.${format}` : `bangkok-envelope.${format}`
    download.hidden = false
    $('model-status').textContent = 'Ready to download.'
  } catch {
    if (!$('model-dialog').open || request !== modelRequest) return
    $('model-status').textContent = 'The browser could not prepare this model. Open the study in a full browser tab and try again.'
  }
}

$('export-model').addEventListener('click', () => {
  if (!result?.sections || !currentFrame || $('export-model').disabled) return
  const concept = result.concepts[Number(activeView)]
  const section = inspectedSection()
  const origin = points[frontage]
  const toEastNorth = eastNorthFrame(origin)
  const toExport = geometry => convertGeometry(geometry, point => toEastNorth(currentFrame.toMap(point)))
  const plot = convertGeometry(parcelGeometry(points, holes), toEastNorth)
  const anchor = { origin_lon_lat: origin, true_north_xy: [0, 1] }
  modelStudy = {
    site: studyName, plot, anchor, ruleset: result.ruleset, frontage,
    concept: concept ? { ...concept, footprint: toExport(concept.footprint),
      permeable: concept.permeable ? toExport(concept.permeable) : null } : null,
    sections: concept ? undefined : result.sections.filter(item => item.geometry && item.height <= section.height)
      .map(item => ({ ...item, geometry: toExport(item.geometry) })),
  }
  $('model-description').textContent = concept ? concept.name : 'Buildable envelope'
  $('model-dialog').showModal()
  prepareModel()
})
$('model-format').addEventListener('change', prepareModel)
$('close-model').addEventListener('click', () => $('model-dialog').close())
$('model-dialog').addEventListener('close', () => {
  if ($('model-dialog').open) return
  modelRequest++
  modelStudy = null
  if (modelURL) URL.revokeObjectURL(modelURL)
  modelURL = null
  $('download-model').removeAttribute('href')
  $('export-model').focus({ preventScroll: true })
})
$('download-model').addEventListener('click', () => {
  $('model-status').textContent = 'Download requested. If the embedded panel blocks it, open the study in a full browser tab.'
})

$('sun-date').value = bangkokToday()
function renderSolar() {
  const enabled = $('solar-panel').open && !drawing && !editing
  if (!enabled) {
    if (lastSolarResult) setSource('solar', null)
    lastSolarResult = null
    $('shadow-key').hidden = true
    return
  }
  const reading = locationReading(points, false)
  const coordinates = reading?.center ?? center
  const concept = result?.concepts?.[Number(activeView)]
  const withContext = $('sun-context').checked && $('show-existing').checked
  try {
    if (reading?.inStudyRegion === false) throw new Error('Sun study is supported for the Bangkok area.')
    const position = solarPosition({ day: $('sun-date').value, time: $('sun-time').value, coordinates })
    const proposal = currentFrame && concept?.available ? {
      geometry: convertGeometry(concept.footprint, currentFrame.toMap), height: concept.roofHeight,
    } : null
    const below = position.altitude <= 0 ? 'Sun below the horizon.' : 'Sun is below 1°. Very long near-horizon shadows are suppressed.'
    const distance = proposal && position.perMetre ? Math.hypot(...position.perMetre) * proposal.height : null
    const source = withContext ? contextSource ? 'Uploaded context heights.' : 'Surrounding heights are estimated.' : 'Proposed massing only.'
    $('sun-result').textContent = position.perMetre ?
      `Sun ${number.format(position.altitude)}° high · ${number.format(position.azimuth)}° from north. ${distance == null ? 'Select a concept for its shadow.' : `Proposed shadow extends ${number.format(distance)} m.`} ${source} Flat ground.` : below
    lastSolarResult = position.perMetre ? {
      ...position, latitude: coordinates[1], useContext: withContext, proposal,
    } : null
    $('shadow-key').hidden = !lastSolarResult || (!proposal && !withContext)
    setSource('solar', lastSolarResult)
  } catch (error) {
    lastSolarResult = null
    $('sun-result').textContent = error.message
    $('shadow-key').hidden = true
    setSource('solar', null)
  }
}
$('solar-panel').addEventListener('toggle', () => {
  if ($('solar-panel').open && map) {
    $('map-settings').open = false
    setOrbit(false)
    map.easeTo({ pitch: 0 })
  }
  renderSolar()
})
$('map-settings').addEventListener('toggle', () => {
  if ($('map-settings').open) $('solar-panel').open = false
})
for (const id of ['sun-date','sun-time','sun-context']) $(id).addEventListener('input', renderSolar)

function applyContext(next, source) {
  context = next
  contextSource = source
  contextNeedsReload = false
  contextIndex = indexBuildings(context.features)
  map?.setBuildings(context.features)
  $('context-key').textContent = source ? 'Existing · supplied heights' : 'Existing · estimated heights'
  $('context-state').textContent = source
    ? `${context.features.length} footprints with supplied heights · ${source}.`
    : 'GeoJSON footprints with numeric height_m values.'
  $('reset-context').hidden = !source
  $('overture-attribution').hidden = Boolean(source)
  renderLocation()
  renderSolar()
  recalculate()
  if (assembly) requestAssembly()
}
$('load-context').addEventListener('click', () => {
  if (!$('context-source').value.trim()) {
    $('context-state').textContent = 'Enter the source or survey reference first.'
    $('context-source').focus()
    return
  }
  $('context-file').click()
})
$('context-file').addEventListener('change', async () => {
  const file = $('context-file').files[0]
  const source = $('context-source').value.trim()
  $('context-file').value = ''
  if (!file) return
  const request = ++contextRequest
  try {
    if (!source) throw new Error('Enter the source or survey reference.')
    if (file.size > 2 * 1024 * 1024) throw new Error('Use a context file under 2 MB.')
    const json = JSON.parse(await file.text())
    const { readHeightContext } = await import('./survey-context.js')
    const data = readHeightContext(json)
    if (request === contextRequest) applyContext(data, source)
  } catch (error) {
    if (request === contextRequest) $('context-state').textContent = error instanceof SyntaxError ? 'The file is not valid GeoJSON text.' : error.message
  }
})
$('reset-context').addEventListener('click', () => {
  contextRequest++
  $('context-source').value = ''
  applyContext(savedContext, '')
})

function applyDisplay() {
  const value = id => Number($(id).value)
  $('mass-opacity-value').textContent = `${value('mass-opacity')}%`
  $('context-opacity-value').textContent = `${value('context-opacity')}%`
  $('cutaway').disabled = !$('show-existing').checked
  $('context-opacity').disabled = !$('show-existing').checked
  $('overlap-key').hidden = !$('show-existing').checked || !$('cutaway').checked || !result?.existing?.ids.length
  map?.setDisplay({ architectural: $('scene-style').value === 'architectural', dimensions: $('show-dims').checked, labels: $('show-labels').checked,
    showBuildings: $('show-existing').checked, cutaway: $('cutaway').checked,
    massingOpacity: value('mass-opacity') / 100, contextOpacity: value('context-opacity') / 100 })
  updateStudio()
  renderSolar()
}
for (const id of ['scene-style', 'show-dims', 'show-labels', 'show-existing', 'cutaway', 'mass-opacity', 'context-opacity']) {
  $(id).addEventListener('input', applyDisplay)
}
$('study-name').addEventListener('input', event => {
  studyName = event.target.value.trim() || 'Untitled plot'
  $('map-name').textContent = studyName
  updatePlotLabel()
  scheduleDraft()
})
async function openCloudStudy() {
  if (!params.has('saved')) return null
  $('saved-study-status').hidden = false
  $('saved-study-message').textContent = 'Opening saved study…'
  try {
    if (!/^[a-f\d-]{36}$/i.test(savedStudyId || '') || (savedVersion && !/^\d+$/.test(savedVersion))) {
      throw new Error('This saved study link is invalid.')
    }
    const { study, snapshot } = await workspaceRequest('studies/' + savedStudyId)
    const version = savedVersion ? await workspaceRequest('studies/' + savedStudyId + '/versions/' + savedVersion) : null
    const content = version ? version.snapshot : snapshot
    const restored = content ? decodeWorkspaceDraft(content) : null
    cloudStudy = study
    $('return-to-project').href = '/projects/?customer=' + study.customer_id + '&project=' + study.project_id
    $('show-save-version').hidden = Boolean(version) || study.role === 'viewer'
    const state = version ? ` · Historical v${savedVersion}` : study.head ? ` · Saved v${study.head}` : ' · New study'
    const permission = study.role === 'viewer' ? ' · View only' : ''
    $('saved-study-message').textContent = study.name + state + permission +
      (restored?.customContext ? ' · Reload the custom building context' : '')
    return restored
  } catch (error) {
    if (error.status === 401) {
      const signIn = $('resume-study-sign-in')
      signIn.href = passwordSignInLink(signInDestination(location.pathname + location.search))
      signIn.hidden = false
      $('saved-study-message').textContent = 'Sign in to open your saved study. The example workspace is open for now.'
    } else {
      $('saved-study-message').textContent = error.message + ' The example workspace is open.'
    }
    return null
  }
}

const recovered = params.has('saved') ? await openCloudStudy() : recoverTabDraft()
if (recovered) {
  const entries = recovered.entries.map(parcel => ({ ...importedEntry(parcel), scenario: parcel.scenario, zone: parcel.zone,
    evidence: parcel.scenario ? 'Recovered example with a schematic parcel and assumed road dimensions.' :
      'Recovered parcel and site inputs from this tab.' }))
  parcelEntries.push(...entries)
  contextNeedsReload = recovered.customContext
  openParcel(entries[recovered.active], recovered)
  requestAnimationFrame(() => {
    if (activeParcel === entries[recovered.active] && !drawing) map?.fitPoints(points, true)
  })
  reviewImported(entries.filter(entry => entry !== activeParcel))
  if (tabRecovery) setDraftStatus(contextNeedsReload ? 'Study recovered. Reload the custom building context.' : 'Study recovered in this tab')
} else {
  activeParcel = importedEntry({ points, holes, name: studyName })
  parcelEntries.push(activeParcel)
  if (opensNarrow) $('evidence').textContent = narrowEvidence
  saveActiveParcel()
  setStudyName(studyName)
  updateEdges()
  updateDrawHelp()
  recalculate()
}
applyDisplay()

if (cloudStudy && !savedVersion && cloudStudy.role !== 'viewer') {
  lastCloudSnapshot = currentSnapshot()
  const dialog = $('save-version-dialog')
  const conflictActions = $('save-conflict-actions')
  let pendingSave
  $('open-latest-cloud-study').href = '/study/?saved=' + cloudStudy.id
  $('show-save-version').addEventListener('click', () => {
    $('save-version-status').textContent = ''
    conflictActions.hidden = true
    dialog.showModal()
    $('version-label').focus()
  })
  $('cancel-version').addEventListener('click', () => dialog.close())
  $('export-conflict-draft').addEventListener('click', () => {
    saveActiveParcel()
    dialog.close()
    showExport(exportWorkspace(parcelEntries), 'plotgrain-edits.geojson',
      'Your current parcels and study inputs. Import this file in Parcels to reopen your edits.')
  })
  dialog.addEventListener('close', () => {
    pendingSave = null
    studyToolsTrigger.focus({ preventScroll: true })
  })
  $('save-version-form').addEventListener('submit', async event => {
    event.preventDefault()
    const button = $('confirm-version')
    if (button.disabled) return
    if (drawing) {
      $('save-version-status').textContent = 'Finish the current drawing before saving a version.'
      return
    }
    button.disabled = true
    conflictActions.hidden = true
    $('save-version-status').textContent = 'Saving…'
    try {
      const label = $('version-label').value.trim()
      const expectedVersion = cloudStudy.head
      if (!pendingSave || pendingSave.label !== label || pendingSave.expectedVersion !== expectedVersion) {
        const snapshot = currentSnapshot()
        if (!snapshot) throw new Error('Finish a parcel before saving a version.')
        pendingSave = { label, snapshot, expectedVersion, requestId: crypto.randomUUID() }
      }
      const attempt = pendingSave
      const { version } = await workspaceRequest('studies/' + cloudStudy.id + '/versions', attempt, AbortSignal.timeout(20000))
      pendingSave = null
      cloudStudy.head = version
      lastCloudSnapshot = attempt.snapshot
      $('saved-study-message').textContent = `${cloudStudy.name} · Saved v${version}`
      $('save-version-form').reset()
      dialog.close()
    } catch (error) {
      $('save-version-status').textContent = error.status === 409
        ? 'The saved study changed. Your edits are still open in this tab.'
        : pendingSave && (!error.status || error.status >= 500)
          ? 'The save could not be confirmed. Choose Save version to retry safely.'
          : error.message
      conflictActions.hidden = error.status !== 409
    } finally {
      button.disabled = false
    }
  })
  window.addEventListener('beforeunload', event => {
    let changed = drawing
    try { changed ||= currentSnapshot() !== lastCloudSnapshot } catch { changed = true }
    if (changed) {
      event.preventDefault()
      event.returnValue = true
    }
  })
}
