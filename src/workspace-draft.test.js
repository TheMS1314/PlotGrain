import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeWorkspaceDraft, encodeWorkspaceDraft } from './workspace-draft.js'

const points = [[100.53, 13.825], [100.5303, 13.825], [100.5303, 13.8253], [100.53, 13.8253]]
const parcel = {
  name: 'Office parcel', points, role: 'parcel', use: 'office', zoneChoice: 'r8', zone: true,
  scenario: false, width: '12', centerOffset: '3.4', frontage: 1,
  survey: { reference: 'Survey A', date: '2026-10-12', area_m2: 950, tolerance_m2: 1, stale: true },
  metrics: { area: 930, conceptArea: 940, status: 'Screened' },
}

test('tab recovery restores inputs and active view while recalculating results', () => {
  const example = { ...parcel, name: 'Example', scenario: true, zone: false, survey: null }
  const text = encodeWorkspaceDraft([example, parcel], parcel, { view: '1', slice: 4, customContext: true })
  const restored = decodeWorkspaceDraft(text)
  assert.equal(restored.active, 1)
  assert.equal(restored.view, '1')
  assert.equal(restored.slice, 4)
  assert.equal(restored.customContext, true)
  assert.equal(restored.entries[0].scenario, true)
  assert.equal(restored.entries[1].zone, true)
  assert.deepEqual(restored.entries[1].points, points)
  assert.deepEqual(restored.entries[1].survey, parcel.survey)
  assert.deepEqual(restored.entries[1].savedInputs, {
    frontage: 1, width: '12', centerOffset: '3.4', use: 'office', role: 'parcel', zoneChoice: 'r8',
  })
  assert.equal(JSON.parse(text).workspace.features[1].properties.results, undefined)
})

test('tab recovery rejects missing, malformed and incomplete drafts', () => {
  assert.equal(encodeWorkspaceDraft([], parcel, {}), null)
  assert.throws(() => decodeWorkspaceDraft('{}'), /Unrecognized/)
  assert.throws(() => decodeWorkspaceDraft('broken JSON'), SyntaxError)
  const broken = { ...parcel, points: [points[0], ...points] }
  assert.throws(() => encodeWorkspaceDraft([broken], broken, {}), /duplicate/)
  const snapshot = JSON.parse(encodeWorkspaceDraft([parcel], parcel, {}))
  snapshot.active = 2
  assert.throws(() => decodeWorkspaceDraft(JSON.stringify(snapshot)), /active parcel/)
})
