import test from 'node:test'
import assert from 'node:assert/strict'
import { metresPerDegree } from './coordinates.js'
import { heightOfBuilding, shadowPaths, solarPosition } from './solar-study.js'

const coordinates = [100.53, 13.825]

test('Bangkok sun positions agree with independent geometric elevation and azimuth references', () => {
  // Astral 3.2, geometric elevation without atmospheric refraction.
  const references = [
    ['2026-03-20', '09:00', 37.2631, 101.0646],
    ['2026-06-21', '12:00', 79.3234, 25.0803],
    ['2026-11-19', '15:00', 35.2088, 233.5519],
    ['2026-12-21', '09:00', 29.3535, 127.4675],
  ]
  for (const [day, time, altitude, azimuth] of references) {
    const actual = solarPosition({ day, time, coordinates })
    assert.ok(Math.abs(actual.altitude - altitude) < .5)
    assert.ok(Math.abs(actual.azimuth - azimuth) < .5)
    assert.ok(actual.perMetre[0] * Math.sin(actual.azimuth * Math.PI / 180) < 0)
  }
})

test('night, missing dates and impossible Bangkok calendar values are handled', () => {
  const reading = solarPosition({ day: '2026-11-19', time: '00:00', coordinates })
  assert.ok(reading.altitude < 0)
  assert.equal(reading.perMetre, null)
  assert.throws(() => solarPosition({ day: '2026-02-29', time: '09:00', coordinates }), /valid date/)
  assert.throws(() => solarPosition({ day: '', time: '09:00', coordinates }), /Choose a date/)
  assert.throws(() => solarPosition({ day: '2026-11-19', time: '24:00', coordinates }), /valid date/)
})

test('ground shadows preserve excluded rings and translate by the expected metric distance', () => {
  const [x,y] = coordinates
  const scale = metresPerDegree(y)
  const ring = (low, high) => [[low,low],[high,low],[high,high],[low,high],[low,low]]
    .map(([a,b]) => [x + a / scale.longitude, y + b / scale.latitude])
  const plot = { type: 'Polygon', coordinates: [ring(0, 16), ring(5, 11)] }
  const [outer, inner, shiftedOuter] = shadowPaths(plot, 12, [-1,.5], y)
  assert.deepEqual(outer, plot.coordinates[0])
  assert.deepEqual(inner, plot.coordinates[1].toReversed())
  assert.ok(Math.abs((shiftedOuter[0][0] - x) * scale.longitude + 12) < 1e-8)
  assert.ok(Math.abs((shiftedOuter[0][1] - y) * scale.latitude - 6) < 1e-8)
  assert.equal(heightOfBuilding({ properties: { height_m: 18 } }), 18)
  assert.equal(heightOfBuilding({ properties: {} }), 6)
})
