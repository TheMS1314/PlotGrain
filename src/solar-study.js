import SunCalc from 'suncalc'
import { metresPerDegree } from './coordinates.js'

const radians = Math.PI / 180
const hours = 60 * 60 * 1000

export function bangkokToday() {
  return new Date(Date.now() + 7 * hours).toISOString().slice(0, 10)
}

export function solarPosition({ day, time, coordinates }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Choose a date and time in Bangkok local time.')
  }
  const instant = new Date(`${day}T${time}:00+07:00`)
  if (!Number.isFinite(+instant) || new Date(+instant + 7*hours).toISOString().slice(0,16) !== `${day}T${time}`) {
    throw new Error('Choose a valid date and time.')
  }
  const [longitude, latitude] = coordinates
  const position = SunCalc.getPosition(instant, latitude, longitude)
  const azimuth = (position.azimuth + Math.PI * 3) % (2 * Math.PI)
  return {
    altitude: position.altitude / radians,
    azimuth: azimuth / radians,
    perMetre: position.altitude < radians ? null : [
      -Math.sin(azimuth) / Math.tan(position.altitude), -Math.cos(azimuth) / Math.tan(position.altitude),
    ],
  }
}

export function heightOfBuilding(feature) {
  const height = feature.properties?.height_m
  return Number.isFinite(height) && height > 0 ? height : 6
}

function oriented(ring, positive = true) {
  const [ox,oy] = ring[0]
  let cross = 0
  for (let i=1;i<ring.length;i++) {
    cross += (ring[i-1][0] - ox)*(ring[i][1] - oy) - (ring[i][0] - ox)*(ring[i-1][1] - oy)
  }
  return (cross > 0) === positive ? ring : ring.toReversed()
}

export function shadowPaths(geometry, height, perMetre, latitude) {
  const scale = metresPerDegree(latitude)
  const offset = [perMetre[0]*height / scale.longitude, perMetre[1]*height / scale.latitude]
  const away = ([x,y]) => [x+offset[0], y+offset[1]]
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  return polygons.flatMap(polygon => {
    const rings = polygon.map((ring,index) => oriented(ring,index === 0))
    const shifted = rings.map(ring => ring.map(away))
    const sides = rings.flatMap((ring,index) => ring.slice(1).map((point,i) => {
      const from = ring[i]
      return oriented([from,point,shifted[index][i+1],shifted[index][i],from])
    }))
    // A path made from consistently wound swept rings can be filled once so
    // intersecting shadow polygons do not appear to be darker.
    return [...rings,...shifted,...sides]
  })
}
