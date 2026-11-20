import earcut from 'earcut'

const palette = {
  plot: [0.87, 0.87, 0.78, 1],
  planting: [0.43, 0.58, 0.37, 1],
  concept: [0.45, 0.62, 0.62, 1],
  envelope: [0.29, 0.63, 0.49, 0.62],
}

function signedArea(ring) {
  return ring.reduce((sum, [x, y], i) => {
    const [nextX, nextY] = ring[(i + 1) % ring.length]
    return sum + x * nextY - nextX * y
  }, 0)
}

export function extrudeMetricGeometry(geometry, base, top) {
  const position = []
  const normal = []
  function triangle(a, b, c) {
    const u = b.map((value, i) => value - a[i])
    const v = c.map((value, i) => value - a[i])
    const cross = [u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0]]
    const length = Math.hypot(...cross)
    if (length <= 1e-10) return
    const unit = cross.map(value => value / length)
    position.push(...a, ...b, ...c)
    normal.push(...unit, ...unit, ...unit)
  }
  const heightPoint = ([x, y], height) => [x, height, -y]
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  for (const rings of polygons) {
    const points = []
    const holes = []
    const openRings = rings.map((ring, i) => {
      const open = ring.slice(0, -1)
      if (i) holes.push(points.length)
      points.push(...open)
      return (signedArea(open) > 0) === (i === 0) ? open : open.toReversed()
    })
    const triangles = earcut(points.flat(), holes, 2)
    for (let i = 0; i < triangles.length; i += 3) {
      let [a,b,c] = triangles.slice(i,i + 3).map(index => points[index])
      if (signedArea([a,b,c]) < 0) [b,c] = [c,b]
      triangle(heightPoint(a,top), heightPoint(b,top), heightPoint(c,top))
      triangle(heightPoint(a,base), heightPoint(c,base), heightPoint(b,base))
    }
    for (const ring of openRings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const lowA = heightPoint(a, base)
        const lowB = heightPoint(b, base)
        const highA = heightPoint(a, top)
        const highB = heightPoint(b, top)
        triangle(lowA, lowB, highB)
        triangle(lowA, highB, highA)
      }
    }
  }
  return { position: new Float32Array(position), normal: new Float32Array(normal) }
}

export function buildStudyModel({ site, plot, concept, sections, anchor, ruleset }) {
  const chunks = []
  const document = {
    asset: { version: '2.0', generator: 'Plotgrain' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: site, children: [], extras: {
      units: 'meters', axes: 'X east; Y up; -Z north.',
      wgs84: anchor, ruleset, source: 'Screening massing from the selected study. Heights and areas are modeled.',
    } }],
    meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
  }

  function accessor(array, position) {
    const view = { buffer: 0, byteOffset: document.buffers[0].byteLength, byteLength: array.byteLength, target: 34962 }
    document.bufferViews.push(view)
    document.buffers[0].byteLength += array.byteLength
    chunks.push(new Uint8Array(array.buffer))
    const accessor = { bufferView: document.bufferViews.length - 1, componentType: 5126, count: array.length / 3, type: 'VEC3' }
    if (position) {
      accessor.min = [Infinity,Infinity,Infinity]
      accessor.max = [-Infinity,-Infinity,-Infinity]
      array.forEach((value, index) => {
        const axis = index % 3
        accessor.min[axis] = Math.min(accessor.min[axis], value)
        accessor.max[axis] = Math.max(accessor.max[axis], value)
      })
    }
    return document.accessors.push(accessor) - 1
  }

  const materialIds = new Map()
  function add(name, geometry, base, top, style, extras) {
    if (!geometry || top <= base) return
    const mesh = extrudeMetricGeometry(geometry, base, top)
    if (!mesh.position.length) return
    if (!materialIds.has(style)) {
      const color = palette[style]
      materialIds.set(style, document.materials.push({
        name: style,
        pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: .08, roughnessFactor: .82 },
        alphaMode: color[3] < 1 ? 'BLEND' : 'OPAQUE',
      }) - 1)
    }
    const primitives = [{ attributes: { POSITION: accessor(mesh.position, true), NORMAL: accessor(mesh.normal, false) },
      material: materialIds.get(style) }]
    const meshId = document.meshes.push({ primitives }) - 1
    document.nodes[0].children.push(document.nodes.push({ name, mesh: meshId, ...(extras && { extras }) }) - 1)
  }

  add('Parcel', plot, -.10, 0, 'plot')
  if (concept) {
    const storey = concept.roofHeight / concept.stories
    for (let floor = 0; floor < concept.stories; floor++) {
      add(`${concept.name} · Floor ${floor + 1}`, concept.footprint, floor * storey, (floor + 1) * storey,
        'concept', { area_m2: concept.floorPlate, roof_height_m: (floor + 1) * storey })
    }
    add('Permeable planting allocation', concept.permeable, 0, .04, 'planting', { area_m2: concept.plantingArea })
  } else {
    for (const section of sections ?? []) {
      add(`Envelope up to ${section.height} m`, section.geometry, section.base, section.height, 'envelope', { section_area_m2: section.area })
    }
  }
  const json = new TextEncoder().encode(JSON.stringify(document))
  const jsonSpan = Math.ceil(json.length / 4) * 4
  const binarySpan = document.buffers[0].byteLength
  const bytes = new Uint8Array(28 + jsonSpan + binarySpan)
  const header = new DataView(bytes.buffer)
  header.setUint32(0, 0x46546c67, true)
  header.setUint32(4, 2, true)
  header.setUint32(8, bytes.length, true)
  header.setUint32(12, jsonSpan, true)
  header.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20, 20 + jsonSpan)
  bytes.set(json, 20)
  header.setUint32(20 + jsonSpan, binarySpan, true)
  header.setUint32(24 + jsonSpan, 0x004e4942, true)
  let offset = 28 + jsonSpan
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
