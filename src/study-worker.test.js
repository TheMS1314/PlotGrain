import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeStudy } from './study-worker.js'
const polygon = n => ({ type: 'Polygon', coordinates: [[[0,0],[n,0],[n,30],[0,30],[0,0]]] })
const road = { centerY: -2.5, nearY: 0, farY: -5 }
const input = { revision: 12, plot: polygon(30), road, buildingType: 'residential' }

test('worker returns two checked options and linked constraints for a supported site', () => {
  const outcome = analyzeStudy(input)
  assert.equal(outcome.revision, 12)
  assert.equal(outcome.plotArea, 900)
  assert.equal(outcome.budget, 5400)
  assert.equal(outcome.sections.length, 10)
  assert.ok(outcome.sections.every(section => section.stages.length === 3))
  assert.ok(outcome.concepts.length === 2 && outcome.concepts.every(concept => concept.available &&
    concept.floorPlate * concept.stories === concept.gross && concept.checks.every(check => check.status === 'pass')))
})
test('worker keeps trustworthy outline results after unsupported or missing rule inputs', () => {
  const invalid = analyzeStudy({ ...input, buildingType: 'warehouse' })
  assert.match(invalid.notice, /building type/)
  assert.equal(invalid.plotArea, 900)
  assert.equal(invalid.sections, undefined)
  assert.equal(analyzeStudy({ ...input, road: null }).budget, undefined)
  assert.match(analyzeStudy({ ...input, road: { centerY: -70, nearY: 0, farY: -140 } }).notice, /right-of-way/)
  assert.match(analyzeStudy({ ...input, plot: { type: 'Polygon', coordinates: [null] } }).error, /closed rings/)
})
test('worker publishes explicit no-fit reasons where both options are impossible', () => {
  const outcome = analyzeStudy({ ...input, plot: polygon(3) })
  assert.ok(outcome.sections.every(section => section.area === 0))
  assert.equal(outcome.concepts.length, 2)
  assert.ok(outcome.concepts.every(concept => !concept.available && /leave no footprint/.test(concept.reason)))
})

test('a narrow site gets two checked low-rise concepts if the starting prototypes fail', () => {
  const plot = polygon(5.8)
  for (const buildingType of ['residential','office']) {
    const outcome = analyzeStudy({ ...input, plot, buildingType })
    assert.ok(outcome.sections.find(section => section.height === 12).area === 0)
    const low = outcome.sections.find(section => section.height === 8)
    assert.equal(low.stories, 2)
    assert.ok(low.area > 25)
    assert.deepEqual(outcome.concepts.map(concept => concept.stories), [2, 1])
    assert.ok(outcome.concepts.every(concept => concept.available && concept.checks.every(check => check.status === 'pass')))
    assert.notDeepEqual(outcome.concepts[0].footprint, outcome.concepts[1].footprint)
  }
})
