import test from 'node:test'
import assert from 'node:assert/strict'
import { readHeightContext } from './survey-context.js'

const exterior = [[100.53,13.82],[100.5304,13.82],[100.5304,13.8204],[100.53,13.8204],[100.53,13.82]]
const exclusion = [[100.5301,13.8201],[100.5302,13.8201],[100.5302,13.8202],[100.5301,13.8202],[100.5301,13.8201]]
const feature = {
  type: 'Feature', properties: { height_m: 21.5, name: ' Warehouse A ' },
  geometry: { type: 'Polygon', coordinates: [exterior, exclusion] },
}
const document = (...features) => ({ type: 'FeatureCollection', features })

test('context upload keeps metric heights and excluded rings with safe local identifiers', () => {
  const context = readHeightContext(document(feature, feature))
  assert.deepEqual(context.features[0].geometry.coordinates, [exterior, exclusion])
  assert.deepEqual(context.features[0].properties, { id: 'survey-1', height_m: 21.5, name: 'Warehouse A' })
  assert.equal(context.features[1].properties.id,'survey-2')
})

test('invalid heights, self-crossings, foreign coordinates and collection limits fail with guidance', () => {
  assert.throws(() => readHeightContext(document(feature, { ...feature, properties: { height_m: '18' } })), /Building 2.*numeric height_m/)
  const crossed = [exterior[0], exterior[2], exterior[1], exterior[3], exterior[0]]
  assert.throws(() => readHeightContext(document({ ...feature, geometry: { type: 'Polygon', coordinates: [crossed] } })), /Building 1/)
  const foreign = exterior.map(([x,y])=>[x+2,y])
  assert.throws(() => readHeightContext(document({ ...feature, geometry: { type: 'Polygon', coordinates: [foreign] } })), /outside the Bangkok/)
  assert.throws(() => readHeightContext(document()), /1–1,000/)
  assert.throws(() => readHeightContext(document(...Array(1001).fill(feature))), /1–1,000/)
})
