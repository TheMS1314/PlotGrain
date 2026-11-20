export const assemblyChecklist = [
  ['access', 'Legal access and road rights'],
  ['fire', 'Fire access and egress'],
  ['services', 'Drainage and utilities'],
  ['planning', 'Zoning overlays and permit pathway'],
]

export function defaultReviews() {
  return Object.fromEntries(assemblyChecklist.map(([key]) => [key, { status: 'pending', reference: '' }]))
}

export function summarizeAssemblySelections(parcels, choices, land) {
  const selected = parcels.flatMap(parcel => {
    const design = parcel.designs.find(item => item.index === choices.get(parcel.entryIndex))
    return design ? [{ ...design, entryIndex: parcel.entryIndex, parcelName: parcel.name }] : []
  })
  const blocked = !land || land.invalid > 0 || land.overlap > .05 || land.parcelOverlap > .05
  return {
    selected,
    blocked,
    floorArea: !blocked && selected.length ? selected.reduce((sum, design) => sum + design.gross, 0) : null,
    footprintArea: !blocked && selected.length ? selected.reduce((sum, design) => sum + design.floorPlate, 0) : null,
  }
}
