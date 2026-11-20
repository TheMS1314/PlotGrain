import assert from 'node:assert/strict'
import test from 'node:test'
import { exportWorkspace, importParcels, summarizeOption, parcelLimit } from './parcel-workspace.js'

const ring = [[100.53,13.82],[100.531,13.82],[100.531,13.821],[100.53,13.82]]
const shape = name => ({ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [ring] } })
const collection = features => ({ type: 'FeatureCollection', features })

test('imports standalone polygons, GIS parcels and exported plot studies', () => {
  assert.equal(importParcels(shape('A').geometry)[0].name, 'Imported plot')
  assert.deepEqual(importParcels(collection([shape('A'), shape('B')])).map(plot => plot.name), ['A', 'B'])
  const source = { ...collection([{ ...shape('A'), properties: { layer: 'plot' } }, { ...shape('B'), properties: { layer: 'concept' } }]),
    study: { title: 'A reviewed plot', ruleset: 'example' } }
  assert.deepEqual(importParcels(source).map(plot => plot.name), ['A reviewed plot'])
})

test('reopens study inputs as drafts only when the recorded frontage matches a parcel edge', () => {
  const frontage = { type: 'Feature', properties: { layer: 'frontage' },
    geometry: { type: 'LineString', coordinates: ring.slice(1, 3) } }
  const report = { ...collection([{ ...shape('A'), properties: { layer: 'plot' } }, frontage]),
    study: { title: 'Reviewed plot', ruleset: 'example', zone: 'R.8', frontageWidthM: 8, centerOffsetM: 3, buildingType: 'office' } }
  const [restored] = importParcels(report)
  assert.deepEqual(restored.savedInputs, { frontage: 1, width: '8', centerOffset: '3', use: 'office' })
  assert.equal(restored.zone, undefined)
  frontage.geometry.coordinates = [ring[1], [100.532, 13.82]]
  assert.deepEqual(importParcels(report)[0].savedInputs, { frontage: null, width: '', centerOffset: '', use: 'office' })
})

test('rejects a malformed or mixed parcel file without silently skipping features', () => {
  assert.throws(() => importParcels(collection([shape('A'), { type: 'Point', coordinates: [100,13] }])), /Parcel 2/)
  assert.throws(() => importParcels(collection(Array.from({ length: parcelLimit + 1 }, () => shape('A')))), /between 1 and 24/)
  assert.throws(() => importParcels({ type: 'FeatureCollection', features: {} }), /features array/)
})

test('comparison distinguishes unmeasured coverage, missing inputs, and tested concepts', () => {
  const base = { plotArea: 100, existing: { area: 0, ids: [] } }
  assert.equal(summarizeOption(base, false).overlapArea, null)
  assert.equal(summarizeOption(base, true).overlapArea, 0)
  assert.equal(summarizeOption(base, true).status, 'Inputs needed')
  const screened = { ...base, budget: 600, sections: [], concepts: [
    { available: true, gross: 180, checks: [{ status: 'pass' }] },
    { available: true, gross: 250, checks: [{ status: 'fail' }] },
  ] }
  assert.equal(summarizeOption(screened, true).conceptArea, 180)
  assert.equal(summarizeOption({ ...screened, concepts: [] }, true).status, 'No concept fit')
})

test('export preserves independent parcels and restores only reviewable draft inputs', () => {
  const entry = { name: 'A', points: ring.slice(0,-1), frontage: 1, width: '5', centerOffset: '2.5',
    use: 'office', metrics: { area: 100 }, zone: true, scenario: false }
  const saved = exportWorkspace([entry, { ...entry, name: 'B', width: '8' }])
  assert.equal(saved.features[0].properties.frontage_edge, 2)
  assert.equal(saved.features[1].properties.right_of_way_m, 8)
  assert.deepEqual(importParcels(saved), [
    { name: 'A', points: entry.points, savedInputs: { frontage: 1, width: '5', centerOffset: '2.5', use: 'office', role: 'parcel', zoneChoice: 'r8' } },
    { name: 'B', points: entry.points, savedInputs: { frontage: 1, width: '8', centerOffset: '2.5', use: 'office', role: 'parcel', zoneChoice: 'r8' } },
  ])
})

test('multipart import splits the components and preserves exclusion rings', () => {
  const exterior = [[100.53,13.82],[100.54,13.82],[100.54,13.83],[100.53,13.83],[100.53,13.82]]
  const small = [[100.531,13.821],[100.532,13.821],[100.532,13.822],[100.531,13.822],[100.531,13.821]]
  const multipart = { type: 'Feature', properties: { name: 'Block C' }, geometry: {
    type: 'MultiPolygon', coordinates: [[exterior, small], [ring.map(([x,y])=>[x+.03,y])]],
  } }
  const result = importParcels(multipart)
  assert.deepEqual(result.map(entry => entry.name), ['Block C · Part 1','Block C · Part 2'])
  assert.deepEqual(result[0].holes, [small.slice(0,-1)])
  assert.ok(result.every(entry => entry.split && !entry.savedInputs))
})

test('comparison exports shared land and preserves its exclusion rings on import', () => {
  const item = { name: 'Shared garden', points: ring.slice(0,-1), holes: [[[100.5305,13.8201],[100.5306,13.8201],[100.5306,13.8202]]],
    role: 'shared', frontage: 0, width: '', centerOffset: '', scenario: false }
  const output = exportWorkspace([item])
  assert.equal(output.features[0].properties.planning_role, 'shared')
  const [restored] = importParcels(output)
  assert.deepEqual(restored.holes, item.holes)
  assert.equal(restored.savedInputs.role, 'shared')
})
