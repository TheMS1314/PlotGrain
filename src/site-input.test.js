import assert from 'node:assert/strict'
import test from 'node:test'
import { locationReading, readLocation, screenInputs } from './site-input.js'

const input = { zoneChoice: 'r8', zoningChecked: true, frontage: 0, width: 5, centerOffset: 2.5 }
test('R.8 and measured road values are required before running modeled zoning', () => {
  assert.deepEqual(screenInputs(input).road, { centerY: -2.5, nearY: 0, farY: -5 })
  assert.equal(screenInputs({ ...input, zoneChoice: 'unknown', scenario: true }).road, null)
  assert.match(screenInputs({ ...input, zoningChecked: false }).notice, /Confirm/)
  assert.equal(screenInputs({ ...input, shared: true }).road, null)
  assert.match(screenInputs({ ...input, inStudyRegion: false }).notice, /Outside the Bangkok/)
  assert.match(screenInputs({ ...input, frontage: null }).notice, /road-facing edge/)
  for (const geometry of [{ width: NaN }, { width: 0.1 }, { width: 121 }, { centerOffset: 0 }, { centerOffset: 5 }]) {
    assert.match(screenInputs({ ...input, ...geometry }).notice, /road width/)
  }
})
test('coordinates distinguish saved building context from a location outside its coverage', () => {
  assert.deepEqual(readLocation(100.53, 13.825), [100.53,13.825])
  assert.throws(() => readLocation(13.825, 100.53), /decimal degrees/)
  assert.throws(() => readLocation(100.531, 13.96), /outside the saved Bang Son map/)
  assert.ok(locationReading([[100.53,13.825],[100.5301,13.825]], true).inContext)
  assert.equal(locationReading([[100.53,14]], true).inContext, false)
  assert.equal(locationReading([[72.83,21.17]], true).inStudyRegion, false)
})
