import { parcelGeometry, readParcelShape } from './study-file.js'
import { importSurveyRecord, compareSurvey } from './survey-record.js'

export const parcelLimit = 24
export const workspaceSchema = 'bangkok-plot-workspace/v1'

function roadDraft(width, centerOffset) {
  const validWidth = Number.isFinite(width) && width >= .2 && width <= 120
  return {
    width: validWidth ? String(width) : '',
    centerOffset: validWidth && Number.isFinite(centerOffset) && centerOffset > 0 && centerOffset < width ? String(centerOffset) : '',
  }
}

function studyRoadDraft(data, points) {
  const geometry = data.features?.find(item => item?.properties?.layer === 'frontage')?.geometry
  const matches = (position, point) => Array.isArray(position) && position.length === 2 &&
    position[0] === point[0] && position[1] === point[1]
  const frontage = geometry?.type === 'LineString' && geometry.coordinates?.length === 2
    ? points.findIndex((point, index) => matches(geometry.coordinates[0], point) &&
      matches(geometry.coordinates[1], points[(index + 1) % points.length])) : -1
  return {
    frontage: frontage >= 0 ? frontage : null,
    ...roadDraft(frontage >= 0 ? data.study.frontageWidthM : null, data.study.centerOffsetM),
    use: data.study.buildingType === 'office' ? 'office' : 'residential',
  }
}

export function importParcels(data) {
  let candidates = [data]
  if (data?.type === 'FeatureCollection') {
    if (!Array.isArray(data.features)) throw new Error('A GeoJSON FeatureCollection needs a features array.')
    const exportedStudy = data.study?.ruleset
    candidates = exportedStudy || data.site_plan?.schema === 'bangkok-site-plan/v1'
      ? data.features.filter(item => item?.properties?.layer === 'plot') : data.features
  }
  if (!candidates.length || candidates.length > parcelLimit) {
    throw new Error(`Import between 1 and ${parcelLimit} parcel polygons per file.`)
  }
  candidates = candidates.flatMap(candidate => {
    const geometry = candidate?.type === 'Feature' ? candidate.geometry : candidate
    if (geometry?.type !== 'MultiPolygon') return [candidate]
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length || geometry.coordinates.length > parcelLimit) {
      throw new Error('A MultiPolygon needs 1–24 polygon components.')
    }
    return geometry.coordinates.map((coordinates, index) => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates },
      properties: { name: `${String(candidate.properties?.name ?? 'Multipart plot').slice(0, 34)} · Part ${index + 1}`, split: true },
    }))
  })
  if (candidates.length > parcelLimit) throw new Error(`Import at most ${parcelLimit} polygon components per file.`)
  return candidates.map((candidate, index) => {
    try {
      const { points, holes } = readParcelShape(candidate)
      const label = data.study?.title ?? candidate?.properties?.name ?? candidate?.properties?.title
      const name = typeof label === 'string' && label.trim() ? label.trim().slice(0, 45) :
        candidates.length === 1 ? 'Imported plot' : `Imported parcel ${index + 1}`
      const imported = { points, name }
      const savedSurvey = data.study?.survey ?? candidate?.properties?.survey
      const surveyShape = data.study?.survey ? data.features?.find(item => item?.properties?.layer === 'survey_boundary') :
        savedSurvey?.boundary
      let boundary
      if (surveyShape) {
        const shape = readParcelShape(surveyShape)
        boundary = parcelGeometry(shape.points, shape.holes)
      }
      const survey = importSurveyRecord(savedSurvey, boundary)
      if (survey) imported.survey = survey
      if (holes.length) imported.holes = holes
      if (candidate?.properties?.split) imported.split = true
      if (data.workspace?.schema === workspaceSchema) {
        const props = candidate.properties ?? {}
        const frontage = props.frontage_edge - 1
        imported.savedInputs = {
          frontage: Number.isInteger(frontage) && frontage >= 0 && frontage < points.length ? frontage : null,
          ...roadDraft(props.right_of_way_m, props.centreline_offset_m),
          use: props.building_type === 'office' ? 'office' : 'residential',
          role: ['shared', 'option'].includes(props.planning_role) ? props.planning_role : 'parcel',
          zoneChoice: props.zoning_district === 'unknown' ? 'unknown' : 'r8',
        }
      } else if (data.type === 'FeatureCollection' && data.study?.ruleset && candidates.length === 1 && !candidate.properties?.split) {
        imported.savedInputs = studyRoadDraft(data, points)
      }
      return imported
    } catch (error) {
      throw new Error(`Parcel ${index + 1}: ${error.message}`)
    }
  })
}

export function summarizeOption(result, hasCoverage) {
  if (!result?.plotArea) return null
  const feasible = (result.concepts ?? []).filter(concept =>
    concept.available && concept.checks.every(check => check.status === 'pass'))
  return {
    area: result.plotArea,
    baseFar: result.budget ?? null,
    conceptArea: feasible.length ? Math.max(...feasible.map(concept => concept.gross)) : null,
    overlapArea: hasCoverage || result.existing?.ids.length ? result.existing?.area ?? null : null,
    overlapIsPartial: !hasCoverage,
    status: !result.sections ? 'Inputs needed' : feasible.length ? 'Screened' : 'No concept fit',
  }
}

export function exportWorkspace(entries) {
  return {
    type: 'FeatureCollection',
    workspace: {
      schema: workspaceSchema,
      scope: 'Independent R.8 parcel studies. Combined entitlements require separate review. Reimported road inputs are drafts, and zoning requires confirmation.',
      measurements: 'WGS84 local tangent scale. Floor areas and plot areas are in square metres.',
    },
    features: entries.map(entry => ({
      type: 'Feature',
      geometry: parcelGeometry(entry.points, entry.holes),
      properties: {
        name: entry.name,
        planning_role: entry.role ?? 'parcel',
        source: entry.scenario ? 'schematic example' : 'user boundary',
        building_type: entry.use,
        frontage_edge: Number.isInteger(entry.frontage) ? entry.frontage + 1 : null,
        zoning_attestation_requires_review: true,
        right_of_way_m: entry.width === '' ? null : Number(entry.width),
        centreline_offset_m: entry.centerOffset === '' ? null : Number(entry.centerOffset),
        zoning_district: entry.zoneChoice ?? 'r8',
        zoning_asserted: (entry.zoneChoice ?? 'r8') === 'r8' && (entry.scenario || entry.zone),
        results: entry.metrics,
        ...(entry.survey && { survey: { ...entry.survey, ...compareSurvey(entry.survey, entry.metrics?.area) } }),
      },
    })),
  }
}
