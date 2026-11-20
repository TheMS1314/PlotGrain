import { parcelGeometry, readParcelShape } from './study-file.js'
import { locationReading } from './site-input.js'
import { eastNorthFrame, convertGeometry } from './coordinates.js'
import { summarizeSite } from './feasibility.js'

export function readHeightContext(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) ||
      !data.features.length || data.features.length > 1000) {
    throw new Error('Provide a GeoJSON FeatureCollection with 1–1,000 building footprints.')
  }
  return {
    type: 'FeatureCollection',
    features: data.features.map((item, index) => {
      try {
        const height = item?.properties?.height_m
        if (item?.type !== 'Feature' || typeof height !== 'number' || !Number.isFinite(height) || height < .2 || height > 600) {
          throw new Error('Enter a numeric height_m between 0.2 and 600.')
        }
        const { points, holes } = readParcelShape(item)
        if (!locationReading(points, false).inStudyRegion) throw new Error('The footprint is outside the Bangkok study area.')
        const geometry = parcelGeometry(points, holes)
        const projected = convertGeometry(geometry, eastNorthFrame(points[0]))
        if (projected.coordinates[0].some(point => Math.hypot(...point) > 1500)) {
          throw new Error('A building footprint extends more than 1.5 km.')
        }
        summarizeSite(projected)
        return { type: 'Feature', geometry, properties: {
          id: `survey-${index + 1}`,
          name: typeof item.properties.name === 'string' ? item.properties.name.trim().slice(0,70) : '',
          height_m: height,
        } }
      } catch (error) {
        throw new Error(`Building ${index + 1}: ${error.message}`)
      }
    }),
  }
}
