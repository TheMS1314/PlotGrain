export function compareConcepts(concepts = []) {
  const options = concepts.flatMap((concept, index) => concept.available ? [{ concept, index }] : [])
  if (options.length !== 2) return null

  const checks = options.map(({ concept }) => new Map(concept.checks.map(check => [check.name, check.status])))
  const checkNames = [...new Set(checks.flatMap(check => [...check.keys()]))]
  return {
    options,
    height: Math.max(...options.map(({ concept }) => concept.roofHeight)),
    grossDifference: options[1].concept.gross - options[0].concept.gross,
    checks: checkNames.map(name => ({ name, statuses: checks.map(check => check.get(name) ?? null) })),
  }
}
