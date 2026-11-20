import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStudyModel, extrudeMetricGeometry } from './model-export.js'

const ring = (a, b) => [[a,a],[b,a],[b,b],[a,b],[a,a]]
const plot = { type: 'Polygon', coordinates: [ring(0,10),ring(3,7)] }

function frontMesh(bytes) {
  const header = new DataView(bytes.buffer)
  const jsonLength = header.getUint32(12, true)
  return { header, jsonLength, model: JSON.parse(new TextDecoder().decode(bytes.slice(20,20+jsonLength))) }
}

test('extruded metric cap preserves exclusion rings and correct surface normals', () => {
  const { position, normal } = extrudeMetricGeometry(plot, 0, 6)
  assert.equal(position.length, normal.length)
  assert.ok(position.length > 0)
  let roofArea = 0
  for (let at = 0; at < position.length; at += 9) {
    if (normal[at + 1] < .99) continue
    const [a,,c,b,,d,e,,f] = position.slice(at, at + 9)
    roofArea += Math.abs((b-a)*(f-c)-(e-a)*(d-c))/2
  }
  assert.equal(roofArea, 84)
  assert.ok(normal.includes(-1) && normal.includes(1))
})

test('GLB uses metric storeys, site anchor, valid bin ranges, and explicit draft metadata', () => {
  const bytes = buildStudyModel({ site: 'Bang Son', plot, anchor: { origin_lon_lat: [100,13] }, ruleset: 'R.8',
    concept: { name: 'Court', footprint: plot, stories: 2, roofHeight: 6, floorPlate: 84 } })
  const { header, jsonLength, model } = frontMesh(bytes)
  assert.equal(header.getUint32(0, true),0x46546c67)
  assert.equal(header.getUint32(4, true),2)
  assert.equal(header.getUint32(8, true),bytes.length)
  assert.equal(model.bufferViews.reduce((sum, item) => sum + item.byteLength,0), header.getUint32(20+jsonLength,true))
  assert.deepEqual(model.nodes[0].extras.wgs84.origin_lon_lat,[100,13])
  assert.equal(model.nodes[0].extras.units,'meters')
  const floors = model.nodes.filter(node=>node.name.includes('Floor'))
  assert.deepEqual(floors.map(node=>node.extras.roof_height_m),[3,6])
  const top = model.accessors[model.meshes[floors[1].mesh].primitives[0].attributes.POSITION]
  assert.equal(top.min[1],3)
  assert.equal(top.max[1],6)
})

test('envelope export handles separated polygons and excludes empty slices', () => {
  const type = 'MultiPolygon'
  const other = ring(20,23)
  const geometry = { type, coordinates: [...[plot.coordinates], [other]] }
  const bytes = buildStudyModel({ site: 'Test', plot, sections: [
    { height: 3, base: 0, geometry, area: 93 },
    { height: 6, base: 3, geometry: null, area: 0 },
  ] })
  const { model } = frontMesh(bytes)
  assert.equal(model.nodes[0].children.length,2)
  const envelope = model.nodes.find(node=>node.name.startsWith('Envelope'))
  assert.equal(envelope.extras.section_area_m2,93)
  const accessor = model.accessors[model.meshes[envelope.mesh].primitives[0].attributes.POSITION]
  assert.equal(accessor.max[0],23)
  assert.equal(accessor.max[1],3)
})
