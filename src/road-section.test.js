import assert from 'node:assert/strict'
import test from 'node:test'
import { roadSectionAt } from './road-section.js'

test('illustrated section starts behind the controlling constraint', () => {
  const section = roadSectionAt(5, 18, { roadSetback: 3.5, heightSetback: 4, boundaryInset: 3 })
  assert.equal(section.firstPermitted, 4)
  assert.equal(section.roadPlaneHeight(-5), 0)
  assert.equal(section.roadPlaneHeight(4), 18)
  assert.equal(roadSectionAt(5, 9, { roadSetback: 3.5, heightSetback: 0, boundaryInset: 3 }).firstPermitted, 3.5)
})
