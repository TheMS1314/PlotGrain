// A supplied record travels with its parcel. Its comparison checks the stated
// area against the drawn boundary and makes no claim about boundary position.
export function readSurveyRecord(input) {
  const reference = typeof input?.reference === 'string' ? input.reference.trim() : ''
  const date = input?.date ?? ''
  const area = input?.area_m2
  const tolerance = input?.tolerance_m2
  if (!reference || reference.length > 100) throw new Error('Enter a survey or document reference of up to 100 characters.')
  if (date) {
    const day = new Date(date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+day) || day.toISOString().slice(0, 10) !== date) {
      throw new Error('Enter a valid survey date.')
    }
  }
  if (area != null && (!Number.isFinite(area) || area <= 0)) throw new Error('Enter a positive area in square metres.')
  if (tolerance != null && (area == null || !Number.isFinite(tolerance) || tolerance < 0)) {
    throw new Error('Add a recorded area and enter a non-negative tolerance in square metres.')
  }
  return { reference, date, area_m2: area ?? null, tolerance_m2: tolerance ?? null, stale: input.stale === true,
    ...(input.boundary && { boundary: input.boundary, source_crs: input.source_crs === '32647' ? '32647' : '4326' }) }
}

export function compareSurvey(record, mappedArea) {
  if (!record) return null
  if (record.stale) return { status: 'boundary_changed' }
  if (record.area_m2 == null || !Number.isFinite(mappedArea)) return { status: 'source_recorded' }
  const difference_m2 = mappedArea - record.area_m2
  const tolerance = record.tolerance_m2
  return {
    status: tolerance == null ? 'difference_only' : Math.abs(difference_m2) <= tolerance + 1e-8 ? 'within_tolerance' : 'outside_tolerance',
    difference_m2,
  }
}

export function importSurveyRecord(data, boundary) {
  if (!data) return null
  try {
    return readSurveyRecord({ ...data, boundary, stale: data.stale === true || data.status === 'boundary_changed' })
  } catch {
    return null
  }
}
