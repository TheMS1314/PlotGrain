import { compareReferenceBoundary, createFeasibility, generateConcepts, ruleset, sources, summarizeSite, summarizeSitePlan } from './feasibility.js'

const maximumBatchSize = 24
const roofHeights = [3, 6, 8, 9, 12, 15, 17, 18, 21, 22.9]

export function analyzeStudy({ revision, plot, road, buildingType, buildings, surveyBoundary } = {}) {
  let site
  try {
    site = summarizeSite(plot, buildings)
  } catch (error) {
    return { revision, error: error.message }
  }
  const measured = { revision, ...site, ruleset, sources,
    ...(surveyBoundary && { surveyComparison: compareReferenceBoundary(plot, surveyBoundary) }) }
  if (!road) return measured

  let model
  let sections
  try {
    model = createFeasibility({ plot, road, buildingType })
    const typicalStorey = buildingType === 'office' ? 3.4 : 3
    // Use the number of full typical storeys within the sampled roof height.
    sections = roofHeights.map((height, index) => ({
      ...model.section(height, Math.max(1, Math.floor(height / typicalStorey + 1e-9)), true),
      height, base: roofHeights[index - 1] ?? 0,
    }))
  } catch (error) {
    return { ...measured, notice: error.message }
  }
  const envelope = { ...measured, sections, budget: model.floorAreaBudget }
  try {
    return { ...envelope, concepts: generateConcepts(model, plot, buildingType) }
  } catch {
    return { ...envelope, concepts: [], notice: 'Envelope calculated. Concept geometry needs review for this boundary.' }
  }
}

function reviewBatch(batch) {
  return batch.slice(0, maximumBatchSize).map(entry => {
    try {
      const { plotArea, existing } = summarizeSite(entry.plot, entry.buildings)
      return { id: entry.id, plotArea, existing: { area: existing.area, ids: existing.ids } }
    } catch (error) {
      return { id: entry?.id, error: error.message }
    }
  })
}

export function analyzeAssembly(entries, studies) {
  const land = summarizeSitePlan(entries.slice(0, maximumBatchSize), true)
  const parcels = studies.slice(0, maximumBatchSize).map(({ entryIndex, name, error, ...inputs }) => {
    const study = error ? { error } : analyzeStudy(inputs)
    const designs = (study.concepts ?? []).flatMap((design, index) =>
      design.available && design.checks.every(check => check.status === 'pass') ? [{ ...design, index }] : [])
    return { entryIndex, name, designs, existingIds: study.existing?.ids ?? [],
      status: study.error ?? study.notice ?? (!inputs.road ? inputs.notReady : designs.length ? 'Choose a screened concept.' : 'No concept fits the modeled checks.') }
  })
  return { land, parcels }
}

if (typeof self !== 'undefined') {
  self.onmessage = ({ data }) => {
    if (Array.isArray(data?.assembly) && Array.isArray(data.studies)) {
      try {
        return self.postMessage({ assemblyId: data.assemblyId, report: analyzeAssembly(data.assembly, data.studies) })
      } catch {
        return self.postMessage({ assemblyId: data.assemblyId, report: null })
      }
    }
    if (Array.isArray(data?.sitePlan)) {
      try {
        return self.postMessage({ sitePlanId: data.sitePlanId, plan: summarizeSitePlan(data.sitePlan.slice(0, maximumBatchSize)) })
      } catch {
        return self.postMessage({ sitePlanId: data.sitePlanId, plan: null })
      }
    }
    if (Array.isArray(data?.batch)) {
      return self.postMessage({ batchId: data.batchId, reviews: reviewBatch(data.batch) })
    }
    return self.postMessage(analyzeStudy(data ?? {}))
  }
}
