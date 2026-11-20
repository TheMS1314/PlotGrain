import assert from 'node:assert/strict'
import test from 'node:test'
import { readParcelShape, buildStudyFile } from './study-file.js'

const ring = [[100.53,13.82], [100.531,13.82], [100.531,13.821], [100.53,13.82]]
const plot = { type: 'Polygon', coordinates: [ring] }

test('exports and reimports a study plot without treating the drawn frontage as survey evidence', () => {
  const study = buildStudyFile({ plot, frame: g => g, frontage: 2, site: 'Sample', scenario: true,
    width: 5, centerOffset: 2.5, buildingType: 'residential', height: 9,
    result: { sections: [], concepts: [], plotArea: 100, budget: 600, ruleset: 'r8-test', sources: {} } })
  assert.deepEqual(study.features[1].geometry.coordinates, [ring[2], ring[0]])
  assert.equal(study.study.mode, 'schematic example')
  assert.deepEqual(readParcelShape(study).points, ring.slice(0, -1))
})

test('rejects unclosed, invalid-coordinate, and multi-ring imports', () => {
  assert.throws(() => readParcelShape({ ...plot, coordinates: [[...ring.slice(0, -1), [100,13]]] }), /match/)
  assert.throws(() => readParcelShape({ ...plot, coordinates: [[[400,12], ...ring]] }), /WGS84/)
  assert.equal(readParcelShape({ ...plot, coordinates: [ring, ring] }).holes.length, 1)
})

test('an outline can be exported before road measurements and zoning screening', () => {
  const output = buildStudyFile({ plot, frame: g => g, frontage: 0, site: 'Draft', scenario: false,
    width: NaN, centerOffset: NaN, buildingType: 'residential',
    result: { plotArea: 100, ruleset: 'r8-test', sources: {} } })
  assert.equal(output.study.analysis, 'outline_only')
  assert.equal(output.study.zone, null)
  assert.equal(output.study.frontageWidthM, null)
  assert.equal(output.study.baseFloorAreaBudgetM2, null)
  assert.deepEqual(output.features.map(feature => feature.properties.layer), ['plot', 'frontage'])
  assert.deepEqual(readParcelShape(output).points, ring.slice(0, -1))
})
