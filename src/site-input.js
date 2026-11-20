import { edgeReadings, geometryBounds } from './coordinates.js'

export const contextCenter = Object.freeze([100.530, 13.825])

export function locationReading(points, contextAvailable) {
  if (!points.length) return null
  const [west, south, east, north] = geometryBounds({ type: 'Polygon', coordinates: [points] })
  const distance = Math.max(...points.map(point => edgeReadings([contextCenter, point])[0].metres))
  return {
    center: [(west + east) / 2, (south + north) / 2],
    inContext: Boolean(contextAvailable && distance <= 280),
    inStudyRegion: distance <= 50_000,
  }
}

export function readLocation(longitude, latitude) {
  if (![longitude, latitude].every(Number.isFinite) ||
      longitude < -180 || longitude > 180 || latitude <= -85 || latitude >= 85) {
    throw new Error('Enter a valid longitude and latitude in decimal degrees.')
  }
  const coordinate = [longitude, latitude]
  if (edgeReadings([contextCenter, coordinate])[0].metres > 650) {
    throw new Error('These coordinates are outside the saved Bang Son map. Import a parcel outline to inspect it without local context.')
  }
  return coordinate
}

export function screenInputs({ zoneChoice, zoningChecked, scenario, shared, inStudyRegion = true, frontage, width, centerOffset }) {
  if (shared) return { road: null, notice: 'Shared land · area only' }
  if (!inStudyRegion) return { road: null, notice: 'Outside the Bangkok screening area · outline only' }
  if (zoneChoice !== 'r8') return { road: null, notice: 'Select and confirm R.8 to screen this plot.' }
  if (!scenario && !zoningChecked) return { road: null, notice: 'Confirm the R.8 study scope.' }
  if (!Number.isInteger(frontage) || frontage < 0) return { road: null, notice: 'Choose the road-facing edge.' }
  if (!(width >= .2 && width <= 120 && centerOffset > 0 && centerOffset < width)) {
    return { road: null, notice: 'Enter the road width and centerline offset.' }
  }
  return { road: { centerY: -centerOffset, nearY: 0, farY: -width }, notice: null }
}
