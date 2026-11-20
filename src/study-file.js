import { compareSurvey } from './survey-record.js'

export function parcelGeometry(points, holes = []) {
  return { type: 'Polygon', coordinates: [points, ...holes].map(ring => [...ring, ring[0]]) }
}

export function readParcelShape(data) {
  const shape = data?.type === 'FeatureCollection' && Array.isArray(data.features)
    ? (data.features.length === 1 ? data.features[0] : data.study?.ruleset && data.features.find(item => item?.properties?.layer === 'plot')) : data
  const geometry = shape?.type === 'Feature' ? shape.geometry : shape
  const rings = geometry?.coordinates
  if (geometry?.type !== 'Polygon' || !Array.isArray(rings) || !rings.length) {
    throw new Error('Provide a GeoJSON polygon with a closed exterior ring.')
  }

  let vertexCount = 0
  const [points, ...holes] = rings.map((ring, index) => {
    const label = index === 0 ? 'Boundary' : `Excluded ring ${index}`
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > 101 || !ring.every(point =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
      Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) {
      throw new Error(`${label}: provide 3–100 vertices in WGS84 longitude, latitude order.`)
    }
    if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
      throw new Error(`${label}: the first and last GeoJSON positions must match.`)
    }
    if (ring.slice(1).some(([x, y], i) => x === ring[i][0] && y === ring[i][1])) {
      throw new Error(`${label}: remove consecutive duplicate vertices.`)
    }
    vertexCount += ring.length - 1
    return ring.slice(0, -1).map(point => [...point])
  })
  if (vertexCount > 100) throw new Error('Use at most 100 vertices across the boundary and its exclusions.')
  return { points, holes }
}

export function buildStudyFile({ plot, frame, frontage, site, scenario, width, centerOffset, buildingType, result, height, contextSource, survey }) {
  const context = { source: contextSource || 'Overture Maps Foundation, 2026-11-18',
    height_basis: contextSource ? 'user supplied' : 'estimated' }
  const features = [
    { type: 'Feature', geometry: plot, properties: { layer: 'plot', area_m2: result.plotArea } },
  ]
  if (Number.isInteger(frontage) && frontage >= 0 && frontage < plot.coordinates[0].length - 1) {
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [
      plot.coordinates[0][frontage], plot.coordinates[0][frontage + 1],
    ] }, properties: { layer: 'frontage' } })
  }
  if (survey?.boundary) features.push({ type: 'Feature', geometry: survey.boundary, properties: { layer: 'survey_boundary' } })
  const { boundary, ...surveyDetails } = survey ?? {}
  if (result.existing?.geometry) {
    features.push({ type: 'Feature', geometry: frame(result.existing.geometry), properties: {
      layer: 'mapped_footprint_overlap', area_m2: result.existing.area, feature_count: result.existing.ids.length,
      source: context.source,
    } })
  }
  for (const section of result.sections ?? []) {
    if (section.geometry) features.push({ type: 'Feature', geometry: frame(section.geometry), properties: {
      layer: 'envelope_section', base_m: section.base, elevation_m: section.height, area_m2: section.area, clearances_m: section.requirements,
      constraint_stage_areas_m2: section.stages?.map(({ id, area }) => ({ id, area })),
      equal_floor_plate_budgets_m2: section.plateBudgets,
    } })
  }
  for (const concept of result.concepts ?? []) {
    if (!concept.available) continue
    features.push({ type: 'Feature', geometry: frame(concept.footprint), properties: {
      layer: 'concept', name: concept.name, height_m: concept.roofHeight, stories: concept.stories,
      gross_floor_area_m2: concept.gross, open_area_m2: concept.openArea, minimum_open_area_m2: concept.openMinimum,
      checks: concept.checks, open_space_requirements: concept.openRequirements,
    } }, { type: 'Feature', geometry: frame(concept.permeable), properties: {
      layer: 'permeable_planting', concept: concept.name, area_m2: concept.plantingArea,
    } })
  }
  return {
    type: 'FeatureCollection', features,
    study: { title: site, ruleset: result.ruleset, zone: result.sections ? 'R.8' : null, analysis: result.sections ? 'screened' : 'outline_only', mode: scenario ? 'schematic example' : 'user inputs',
      buildingType, frontageWidthM: Number.isFinite(width) ? width : null,
      centerOffsetM: Number.isFinite(centerOffset) ? centerOffset : null, inspectionHeightM: height ?? null,
      baseFloorAreaBudgetM2: result.budget ?? null, sources: result.sources, context,
      ...(survey && { survey: { ...surveyDetails, ...compareSurvey(survey, result.plotArea),
        ...(boundary && { outline_comparison: result.surveyComparison ?? null }) } }),
      measurements: 'Local WGS84 ellipsoidal metric scale for parcel-sized distances.',
      scope: 'Screening for a single straight road frontage with flat grade and facade openings. Verify zoning, survey, local access, building category, and permit provisions.',
    },
  }
}
