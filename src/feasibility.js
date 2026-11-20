import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import BufferParameters from 'jsts/org/locationtech/jts/operation/buffer/BufferParameters.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'

const reader = new GeoJSONReader()
const writer = new GeoJSONWriter()
const areaTolerance = 1e-6
const metresTolerance = 1e-7

export const ruleset = 'bangkok-r8-2013-bma-2544-v3'

export const sources = Object.freeze({
  local: 'https://webportal.bangkok.go.th/public/user_files_editor/76/law/tk24.pdf',
  plan: 'https://webportal.bangkok.go.th/public/user_files_editor/76/law/tk10.pdf',
  buildingControl: 'https://webportal.bangkok.go.th/public/user_files_editor/95/ITA2566/O4/CI/ci-11.pdf',
})

function polygon(geometry, label) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error(`${label} must be a polygon or multipolygon.`)
  }
  const { coordinates } = geometry
  const rings = Array.isArray(coordinates)
    ? geometry.type === 'Polygon' ? coordinates : coordinates.flat() : []
  if (!rings.length || rings.some(ring => !Array.isArray(ring) || ring.length < 4 || ring.some(point =>
    !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value))
  ) || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) {
    throw new Error(`${label} needs closed rings with finite coordinates in metres.`)
  }
  const result = reader.read(geometry)
  if (!new IsValidOp(result).isValid() || result.getArea() <= areaTolerance) {
    throw new Error(`${label} needs valid, non-overlapping rings and positive area.`)
  }
  return result
}

function rectangle(left, bottom, right, top) {
  return { type: 'Polygon', coordinates: [[
    [left, bottom], [right, bottom], [right, top], [left, top], [left, bottom],
  ]] }
}

// Coordinates are local metric coordinates. The x-axis runs along the selected
// straight frontage, and the positive y direction points into the parcel.
export function createFeasibility({ plot, road, buildingType }) {
  if (!['residential', 'office'].includes(buildingType)) {
    throw new Error('Choose a supported building type.')
  }
  const parcel = polygon(plot, 'Plot')
  const bounds = parcel.getEnvelopeInternal()
  const { centerY, nearY, farY } = road ?? {}
  const shells = plot.type === 'Polygon' ? [plot.coordinates[0]] : plot.coordinates.map(part => part[0])
  const touchesFrontage = shells.some(ring => ring.slice(1).some(([x, y], index) =>
    Math.abs(y - nearY) <= metresTolerance &&
    Math.abs(ring[index][1] - nearY) <= metresTolerance &&
    Math.abs(x - ring[index][0]) > metresTolerance
  ))
  if (![centerY, nearY, farY].every(Number.isFinite) ||
      !(farY < centerY && centerY < nearY) || bounds.getMinY() < nearY - metresTolerance || !touchesFrontage) {
    throw new Error('Provide the road centerline and both right-of-way edges. Place the near edge at the plot frontage.')
  }

  const plotArea = parcel.getArea()
  const width = nearY - farY
  if (width < .2 || width > 120) throw new Error('Enter a public right-of-way between 0.2 m and 120 m.')
  const far = 6
  const floorAreaBudget = plotArea * far
  const insets = new Map()
  const settings = new BufferParameters()
  settings.setJoinStyle(BufferParameters.JOIN_MITRE)
  const minimumOpenRatio = buildingType === 'residential' ? 0.30 : 0.10

  function fitAt(roofHeight, stories, trace = false) {
    if (!Number.isFinite(roofHeight) || roofHeight <= 0 || roofHeight >= 23 ||
        !Number.isInteger(stories) || stories < 1) {
      throw new Error('Enter a positive roof height below 23 m and a whole number of floors.')
    }

    const boundaryInset = roofHeight <= 9 && stories <= 2 ? 2 : 3
    if (!insets.has(boundaryInset)) {
      insets.set(boundaryInset, BufferOp.bufferOp(parcel, -boundaryInset, settings))
    }
    const setbackY = stories > 2 || roofHeight > 8
      ? (width < 10 ? centerY + 6 : nearY + Math.min(width / 10, 2))
      : (width < 6 ? centerY + 3 : nearY)
    const heightY = farY + roofHeight / 2
    const floorY = Math.max(setbackY, heightY, bounds.getMinY())
    const inset = insets.get(boundaryInset)
    const requirements = { boundaryInset, roadSetback: Math.max(0, setbackY - nearY), heightSetback: Math.max(0, heightY - nearY) }
    const cut = y => {
      if (inset.isEmpty() || y >= bounds.getMaxY()) return null
      if (y <= inset.getEnvelopeInternal().getMinY()) return inset
      const mask = reader.read(rectangle(bounds.getMinX() - 1, y, bounds.getMaxX() + 1, bounds.getMaxY() + 1))
      const fit = OverlayOp.intersection(inset, mask)
      return fit.getArea() > areaTolerance ? fit : null
    }
    const geometry = cut(floorY)
    if (!trace) return { geometry, requirements }
    const stage = (id, item) => ({ id, geometry: item && !item.isEmpty() ? writer.write(item) : null, area: item?.getArea() ?? 0 })
    const roadOnly = heightY <= setbackY ? geometry : cut(setbackY)
    return { geometry, requirements, stages: [
      stage('plot', parcel), stage('boundary', inset), stage('road', roadOnly),
    ] }
  }

  function section(roofHeight, stories, trace = false) {
    const { geometry: fit, requirements, stages } = fitAt(roofHeight, stories, trace)
    return { geometry: fit ? writer.write(fit) : null, area: fit?.getArea() ?? 0, requirements,
      ...(trace ? { stages, plateBudgets: { far: floorAreaBudget / stories, openSpace: maxOpenSpacePlate(stories) }, stories } : {}) }
  }

  function checkConcept({ roofHeight, stories, footprint, permeable }) {
    const candidate = polygon(footprint, 'Building footprint')
    const floorPlate = candidate.getArea()
    const gross = floorPlate * stories
    const { geometry: allowed } = fitAt(roofHeight, stories)
    const open = OverlayOp.difference(parcel, candidate)
    const openArea = open.getArea()
    const openRequirements = [
      { label: 'Zoning open space', area: gross * 0.05, clause: '15', source: sources.plan },
      { label: 'National building-control open space', area: floorPlate * minimumOpenRatio, clause: '33', source: sources.buildingControl },
      { label: 'Bangkok open space', area: plotArea * minimumOpenRatio, clause: '52', source: sources.local },
    ]
    const controlling = openRequirements.reduce((a, b) => a.area >= b.area ? a : b)
    const openMinimum = controlling.area
    const planting = permeable ? polygon(permeable, 'Planting area') : null
    const plantingMinimum = openArea * 0.50
    const plantingWithinOpenSpace = planting &&
      OverlayOp.difference(planting, open).getArea() <= areaTolerance
    const largeBuilding = gross > 2000 || (roofHeight >= 15 && gross > 1000)
    const check = (name, status, clause, source, actual, limit) => ({ name, status, clause, source, actual, limit })
    const result = (value) => value ? 'pass' : 'fail'
    const checks = [
      check('Floor area ratio', result(gross <= floorAreaBudget + areaTolerance), '15', sources.plan, gross, floorAreaBudget),
      check('Setbacks and road-height plane', result(allowed &&
        OverlayOp.difference(candidate, allowed).getArea() <= areaTolerance), '41, 44, 50', sources.buildingControl),
      check('Open space', result(openArea + areaTolerance >= openMinimum), controlling.clause, controlling.source, openArea, openMinimum),
      check('Permeable planting', planting ? result(plantingWithinOpenSpace &&
        planting.getArea() + areaTolerance >= plantingMinimum) : 'unverified', '15', sources.plan, planting?.getArea(), plantingMinimum),
    ]
    if (largeBuilding) checks.push(check('Additional large-building review', 'unverified', '1', sources.buildingControl))
    if (buildingType === 'office' && gross > 1000) {
      checks.push(check('Office use eligibility', 'unverified', '15(12)', sources.plan))
    }
    return { gross, floorPlate, openArea, openMinimum, openRequirements, plantingMinimum, largeBuilding, checks }
  }

  function maxOpenSpacePlate(stories) {
    return Math.min(plotArea * (1 - minimumOpenRatio), plotArea / (1 + minimumOpenRatio),
      plotArea / (1 + .05 * stories))
  }

  return { plotArea, floorAreaBudget, section, checkConcept, maxOpenSpacePlate }
}

// Generate a single connected floor plate and a drawn planting allocation.
export function generateConcepts(model, plot, buildingType) {
  const parcel = polygon(plot, 'Plot')
  const chooseLargest = geometry => {
    if (geometry.getGeometryType() === 'Polygon') return geometry
    let largest = null
    for (let i = 0; i < geometry.getNumGeometries(); i++) {
      const part = geometry.getGeometryN(i)
      if (part.getGeometryType() === 'Polygon' && (!largest || part.getArea() > largest.getArea())) largest = part
    }
    return largest
  }

  const profiles = [
    { name: 'Garden Court', stories: 3, roofHeight: buildingType === 'office' ? 10.2 : 9, targetGross: 940, side: 'left' },
    { name: 'Compact Stack', stories: 4, roofHeight: buildingType === 'office' ? 13.6 : 12, targetGross: 970, side: 'right' },
  ]
  const lowRiseStorey = buildingType === 'office' ? 3.4 : 3

  function makeConcept(profile) {
    const section = model.section(profile.roofHeight, profile.stories)
    if (!section.geometry) return { ...profile, available: false, reason: 'The modeled setbacks and height limit leave no footprint for this concept.' }
    const fit = chooseLargest(reader.read(section.geometry))
    if (!fit) return { ...profile, available: false, reason: 'No connected floor plate remains at this height.' }
    const bounds = fit.getEnvelopeInternal()
    const low = bounds.getMinX()
    const high = bounds.getMaxX()
    const target = Math.min(profile.targetGross / profile.stories, model.floorAreaBudget / profile.stories,
      fit.getArea() * 0.97, model.maxOpenSpacePlate(profile.stories)) * (profile.plateFraction ?? 1)
    let lower = 0
    let upper = high - low
    let candidate
    for (let attempt = 0; attempt < 24; attempt++) {
      const width = (lower + upper) / 2
      const [left, right] = profile.side === 'left' ? [low - 1, low + width] : [high - width, high + 1]
      const mask = reader.read(rectangle(left, bounds.getMinY() - 1, right, bounds.getMaxY() + 1))
      const piece = chooseLargest(OverlayOp.intersection(fit, mask))
      if (piece && piece.getArea() > target) {
        upper = width
      } else {
        lower = width
        candidate = piece
      }
    }
    // This is a massing viability threshold, not a statutory minimum.
    if (!candidate || candidate.getArea() < 25) return { ...profile, available: false,
      reason: 'The remaining connected floor plate is below the 25 m² concept threshold.' }
    const open = OverlayOp.difference(parcel, candidate)
    const openBounds = open.getEnvelopeInternal()
    let bottom = openBounds.getMinY()
    let top = openBounds.getMaxY()
    let planting = open
    for (let attempt = 0; attempt < 20; attempt++) {
      const line = (top + bottom) / 2
      const mask = reader.read(rectangle(openBounds.getMinX() - 1, line, openBounds.getMaxX() + 1, openBounds.getMaxY() + 1))
      const piece = OverlayOp.intersection(open, mask)
      if (piece.getArea() >= open.getArea() * 0.55) {
        bottom = line
        planting = piece
      } else {
        top = line
      }
    }
    const footprint = writer.write(candidate)
    const permeable = writer.write(planting)
    const checks = model.checkConcept({ ...profile, footprint, permeable })
    return { ...profile, available: true, footprint, permeable, plantingArea: planting.getArea(), ...checks }
  }

  const passes = concept => concept.available && concept.checks.every(check => check.status === 'pass')
  return profiles.map((profile, index) => {
    const standard = makeConcept(profile)
    if (passes(standard)) return standard

    // Lower stories can use a different legal setback profile. Each alternative
    // runs the full check, including FAR, open space and permeable area.
    const alternatives = index === 0 ? [2, 1] : [1, 2]
    for (const stories of alternatives) {
      const option = makeConcept({
        ...profile,
        name: index === 0 ? 'Low-rise Court' : 'Compact Low-rise',
        stories,
        roofHeight: stories * lowRiseStorey,
        plateFraction: index === 0 ? 1 : 0.86,
      })
      if (passes(option)) return option
    }
    return standard.available ? standard : { ...standard,
      reason: `${standard.reason} Neither lower option passed the modeled checks.`, }
  })
}

// Measure only the portion of each mapped footprint inside the plot. Union the
// pieces before measuring coverage so overlapping source features count once.
export function summarizeSite(plot, buildings = []) {
  const parcel = polygon(plot, 'Plot')
  let covered
  const ids = []
  for (const building of buildings) {
    try {
      const footprint = polygon(building.geometry, 'Mapped building')
      const intersection = OverlayOp.intersection(parcel, footprint)
      if (intersection.getArea() <= areaTolerance) continue
      covered = covered ? OverlayOp.union(covered, intersection) : intersection
      ids.push(building.id)
    } catch {
      // An invalid contextual record must not prevent checking the parcel itself.
    }
  }
  return { plotArea: parcel.getArea(), existing: { ids, area: covered?.getArea() ?? 0,
    geometry: covered ? writer.write(covered) : null } }
}

export function compareReferenceBoundary(plot, boundary) {
  try {
    if (boundary.coordinates.some(ring => ring.some(point => Math.hypot(...point) > 3000))) {
      return { error: 'The survey outline extends more than 3 km from the selected frontage.' }
    }
    const mapped = polygon(plot, 'Study plot')
    const reference = polygon(boundary, 'Survey boundary')
    const shared = OverlayOp.intersection(mapped, reference).getArea()
    const outside = Math.max(0, mapped.getArea() - shared)
    const missing = Math.max(0, reference.getArea() - shared)
    return { survey_area_m2: reference.getArea(), overlap_m2: shared, outside_m2: outside, missing_m2: missing }
  } catch (error) {
    return { error: error.message }
  }
}

export function summarizeSitePlan(entries, detailed = false) {
  let parcels
  let shared
  let conflicts
  let invalid = 0
  for (const { geometry, role } of entries) {
    if (role === 'option') continue
    try {
      const piece = polygon(geometry, 'Site area')
      if (role === 'shared') shared = shared ? OverlayOp.union(shared, piece) : piece
      else {
        const next = parcels ? OverlayOp.union(parcels, piece) : piece
        if (detailed && parcels) {
          const overlap = OverlayOp.intersection(parcels, piece)
          if (overlap.getArea() > areaTolerance) conflicts = conflicts ? OverlayOp.union(conflicts, overlap) : overlap
        }
        parcels = next
      }
    } catch {
      invalid++
    }
  }
  const plotArea = parcels?.getArea() ?? 0
  const sharedArea = shared?.getArea() ?? 0
  const sharedOverlap = parcels && shared ? OverlayOp.intersection(parcels, shared) : null
  const overlap = sharedOverlap?.getArea() ?? 0
  const report = { totalArea: plotArea + sharedArea - overlap, plotArea, sharedArea, overlap, invalid }
  if (!detailed) return report
  const parcelOverlap = conflicts?.getArea() ?? 0
  if (overlap > areaTolerance) conflicts = conflicts ? OverlayOp.union(conflicts, sharedOverlap) : sharedOverlap
  const site = parcels && shared ? OverlayOp.union(parcels, shared) : parcels ?? shared
  return { ...report, parcelOverlap,
    components: site?.getNumGeometries() ?? 0, conflicts: conflicts ? writer.write(conflicts) : null }
}
