import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareConcepts } from './concept-comparison.js'

const court = {
  available: true, name: 'Court', roofHeight: 9, gross: 940,
  checks: [{ name: 'Open space', status: 'pass' }, { name: 'Setbacks', status: 'pass' }],
}
const compact = {
  available: true, name: 'Stack', roofHeight: 12, gross: 970,
  checks: [{ name: 'Setbacks', status: 'fail' }, { name: 'Open space', status: 'pass' },
    { name: 'Building eligibility', status: 'unverified' }],
}

test('comparison aligns rule names and keeps unverified and absent results distinct', () => {
  const result = compareConcepts([court, compact])
  assert.deepEqual(result.options.map(({ index }) => index), [0, 1])
  assert.equal(result.height, 12)
  assert.equal(result.grossDifference, 30)
  assert.deepEqual(result.checks, [
    { name: 'Open space', statuses: ['pass', 'pass'] },
    { name: 'Setbacks', statuses: ['pass', 'fail'] },
    { name: 'Building eligibility', statuses: [null, 'unverified'] },
  ])
})

test('comparison requires two generated concepts', () => {
  assert.equal(compareConcepts([]), null)
  assert.equal(compareConcepts([court, { available: false }]), null)
})
