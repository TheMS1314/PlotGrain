import proj4 from 'proj4'
import { parcelGeometry, readParcelShape } from './study-file.js'

const utm47North = '+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs'

export function readSurveyOutline(document, crs) {
  let shape = document
  if (crs === '32647') {
    if (shape?.type === 'FeatureCollection' && shape.features?.length === 1) shape = shape.features[0]
    if (shape?.type === 'Feature') shape = shape.geometry
    if (shape?.type !== 'Polygon' || !Array.isArray(shape.coordinates)) throw new Error('Choose a single survey polygon.')
    const converter = proj4(utm47North, 'EPSG:4326')
    const coordinates = shape.coordinates.map(ring => {
      if (!Array.isArray(ring) || ring.length > 101) throw new Error('Use no more than 100 survey vertices.')
      return ring.map(point => {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) ||
            point[0] < 100000 || point[0] > 900000 || point[1] < 0 || point[1] > 10000000) {
          throw new Error('The coordinates must be easting and northing in metres in WGS84 / UTM zone 47N.')
        }
        return converter.forward(point)
      })
    })
    shape = { type: 'Polygon', coordinates }
  } else if (crs !== '4326') {
    throw new Error('Choose the coordinate system written on the survey file.')
  }
  const { points, holes } = readParcelShape(shape)
  return parcelGeometry(points, holes)
}
