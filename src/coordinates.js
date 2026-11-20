const radius = 6378137
const radians = Math.PI / 180
const eccentricitySquared = 0.0066943799901413165

// Local WGS84 metric scales for parcel-sized distances. The study engine
// caps the distance from the frontage origin before applying this projection.
export function metresPerDegree(latitude) {
  const angle = latitude * radians
  const sin = Math.sin(angle)
  const denominator = Math.sqrt(1 - eccentricitySquared * sin * sin)
  return {
    longitude: radius / denominator * Math.cos(angle) * radians,
    latitude: radius * (1 - eccentricitySquared) / denominator ** 3 * radians,
  }
}

export function frontageFrame(ring, edge) {
  const [lon, lat] = ring[edge]
  const next = ring[(edge + 1) % ring.length]
  const { longitude: longitudeScale, latitude: latitudeScale } = metresPerDegree(lat)
  const east = (next[0] - lon) * longitudeScale
  const north = (next[1] - lat) * latitudeScale
  const length = Math.hypot(east, north)
  if (length < 0.1) throw new Error('Choose a frontage edge at least 10 cm long.')
  const along = [east / length, north / length]
  let inward = [-along[1], along[0]]
  const side = ring.reduce((sum, point) => sum +
    inward[0] * (point[0] - lon) * longitudeScale + inward[1] * (point[1] - lat) * latitudeScale, 0)
  if (side < 0) inward = inward.map(value => -value)
  const toLocal = ([lng, latitude]) => {
    const e = (lng - lon) * longitudeScale
    const n = (latitude - lat) * latitudeScale
    return [e * along[0] + n * along[1], e * inward[0] + n * inward[1]]
  }
  const toMap = ([x, y]) => [lon + (along[0] * x + inward[0] * y) / longitudeScale,
    lat + (along[1] * x + inward[1] * y) / latitudeScale]
  return { toLocal, toMap, length }
}

export function convertGeometry(geometry, transform) {
  const convertPolygon = rings => rings.map(ring => ring.map(transform))
  return { type: geometry.type, coordinates: geometry.type === 'Polygon'
    ? convertPolygon(geometry.coordinates)
    : geometry.coordinates.map(convertPolygon) }
}

export function eastNorthFrame([longitude, latitude]) {
  const scale = metresPerDegree(latitude)
  return ([x, y]) => [(x - longitude) * scale.longitude, (y - latitude) * scale.latitude]
}

export function edgeReadings(ring) {
  if (ring.length < 2) return []
  return ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length]
    const scale = metresPerDegree((point[1] + next[1]) / 2)
    const east = (next[0] - point[0]) * scale.longitude
    const north = (next[1] - point[1]) * scale.latitude
    return { index, point, next, metres: Math.hypot(east, north) }
  })
}

export function pointInRings(point, rings) {
  let inside = false
  const [x, y] = point
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = ring[i]
      const [c, d] = ring[j]
      if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside
    }
  }
  return inside
}

export function geometryBounds(geometry) {
  const rings = geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : geometry.coordinates
  return rings.flat().reduce((bounds, [x, y]) => [
    Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y),
  ], [Infinity, Infinity, -Infinity, -Infinity])
}

export function overlapsBounds(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

export function distanceToSegment([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0
  return Math.hypot(x - ax - dx * t, y - ay - dy * t)
}

export function nearestEdge(pixel, edges, project, threshold = 12) {
  let edge
  for (const candidate of edges) {
    const distance = distanceToSegment(pixel, project(candidate.point), project(candidate.next))
    if (distance <= threshold) {
      edge = candidate
      threshold = distance
    }
  }
  return edge
}
