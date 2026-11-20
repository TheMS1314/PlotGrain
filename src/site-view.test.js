import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { paintSite, siteProjection } from './site-view.js'

const camera = { center: [100.53, 13.8251], width: 470, height: 760, scale: 3.76, pitch: 53, bearing: -22 }
const load = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.geojson`, import.meta.url)))
const demo = load('demo').features[0]

test('ground picking and projection agree in plan and rotated 3D views', () => {
  const plotPoint = demo.geometry.coordinates[0][2]
  for (const pitch of [0, 53, 57]) {
    const projection = siteProjection({ ...camera, pitch })
    const pixel = projection.project(plotPoint)
    const point = projection.unproject(pixel)
    assert.ok(point.every((value, i) => Math.abs(value - plotPoint[i]) < 1e-10))
    assert.equal(projection.project(plotPoint, 12)[1] < pixel[1], pitch > 0)
  }
})

test('the embedded-size scene draws real site context, massing, and plot points without WebGL', () => {
  const calls = []
  const ctx = new Proxy({}, {
    get(target, method) {
      return target[method] ?? ((...args) => calls.push([method, ...args]))
    },
  })
  const vertices = demo.geometry.coordinates[0].slice(0, -1).map(coordinates => ({
    geometry: { type: 'Point', coordinates },
  }))
  paintSite(ctx, { ...camera, projection: siteProjection(camera),
    streets: load('streets').features, buildings: load('buildings').features,
    layers: { plot: [demo], vertices, massing: [{ ...demo, properties: { base: 0, height: 12, color: '#3b9c7c' } }] },
  })
  assert.ok(calls.filter(([method]) => method === 'stroke').length > 45)
  assert.equal(calls.filter(([method]) => method === 'arc').length, vertices.length)
  assert.deepEqual(calls.filter(([method]) => method === 'fillText').map(call => call[1]), ['1','2','3','4','5','6'])
})

test('edge picking finds the displayed frontage and ignores distant points', async () => {
  const { edgeReadings, nearestEdge } = await import('./coordinates.js')
  const ring = demo.geometry.coordinates[0].slice(0, -1)
  const edges = edgeReadings(ring)
  const projection = siteProjection({ ...camera, pitch: 0 })
  const [a, b] = [edges[0].point, edges[0].next].map(projection.project)
  const pointer = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  assert.equal(nearestEdge(pointer, edges, projection.project).index, 0)
  assert.ok(Math.abs(edges[0].metres - 29.981484442) < .001)
  assert.equal(nearestEdge([0, 0], edges, projection.project), undefined)
})

test('display settings hide context, render dimensions and names, and apply massing opacity', () => {
  const calls = []
  const ctx = new Proxy({}, {
    get(target, method) {
      if (method === 'measureText') return text => ({ width: text.length * 6 })
      return target[method] ?? ((...args) => calls.push([method, target.globalAlpha, ...args]))
    },
  })
  const edges = [{ point: demo.geometry.coordinates[0][0], next: demo.geometry.coordinates[0][1], metres: 30 }]
  paintSite(ctx, { ...camera, pitch: 0, projection: siteProjection({ ...camera, pitch: 0 }), streets: [], buildings: load('buildings').features,
    layers: { edges, label: { vertices: demo.geometry.coordinates[0], text: 'Redevelopment parcel' },
      massing: [{ ...demo, properties: { base: 0, height: 12, color: '#3b9c7c' } }] },
    display: { showBuildings: false, dimensions: true, labels: true, massingOpacity: .41 } })
  assert.ok(calls.some(([method, alpha]) => method === 'fill' && alpha === .41))
  assert.deepEqual(calls.filter(([method]) => method === 'fillText').map(call => call[2]), ['30.0 m', 'Redevelopment parcel'])
  assert.ok(calls.filter(([method]) => method === 'stroke').length < 10)
})
