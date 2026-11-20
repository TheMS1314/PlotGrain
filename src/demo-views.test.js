import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { demoViews, fromDemoURL } from './demo-views.js'
import { frontageFrame, convertGeometry } from './coordinates.js'
import { analyzeStudy } from './study-worker.js'

test('preview links open each supported view and reject unknown query values', () => {
  for (const [slug, demo] of Object.entries(demoViews)) {
    assert.equal(fromDemoURL('?view=' + slug), demo.view)
  }
  assert.equal(fromDemoURL(''), 'envelope')
  assert.equal(fromDemoURL('?view=constructor'), 'envelope')
  assert.equal(fromDemoURL('?view=unsupported'), 'envelope')
})

test('landing preview measurements match the modeled Bang Son example', () => {
  const demo = JSON.parse(readFileSync(new URL('../public/data/demo.geojson', import.meta.url), 'utf8'))
  const geometry = demo.features[0].geometry
  const frame = frontageFrame(geometry.coordinates[0].slice(0, -1), 0)
  const plot = convertGeometry(geometry, frame.toLocal)
  plot.coordinates[0][1][1] = 0
  const result = analyzeStudy({ plot, road: { centerY: -2.5, nearY: 0, farY: -5 }, buildingType: 'residential' })
  const squareMetres = amount => `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(amount)} m²`
  assert.equal(demoViews.envelope.primary, squareMetres(result.plotArea))
  assert.equal(demoViews.envelope.secondary, squareMetres(result.budget))
  for (const view of [demoViews.garden, demoViews.compact]) {
    const concept = result.concepts[Number(view.view)]
    assert.equal(view.name, concept.name)
    assert.equal(view.primary, squareMetres(concept.gross))
    assert.equal(view.secondary, `${concept.roofHeight} m`)
    assert.ok(concept.checks.every(check => check.status === 'pass'))
  }
})
