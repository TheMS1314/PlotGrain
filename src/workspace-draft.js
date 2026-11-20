import { exportWorkspace, importParcels, parcelLimit, workspaceSchema } from './parcel-workspace.js'
import { readParcelShape } from './study-file.js'

export const draftKey = 'plotgrain.workspace-draft.v1'
const maxDraftLength = 512 * 1024

export function encodeWorkspaceDraft(entries, active, { view, slice, customContext }) {
  if (!entries.length || entries.length > parcelLimit || !entries.includes(active)) return null
  const workspace = exportWorkspace(entries)
  for (const feature of workspace.features) {
    readParcelShape(feature)
    delete feature.properties.results
  }
  const text = JSON.stringify({ schema: draftKey, workspace, active: entries.indexOf(active), view, slice, customContext })
  if (text.length > maxDraftLength) throw new Error('Draft exceeds the local recovery limit.')
  return text
}

export function decodeWorkspaceDraft(text) {
  if (typeof text !== 'string' || text.length > maxDraftLength) throw new Error('Invalid workspace draft.')
  const draft = JSON.parse(text)
  const workspace = draft?.workspace
  if (draft?.schema !== draftKey || workspace?.workspace?.schema !== workspaceSchema ||
      workspace?.type !== 'FeatureCollection' || !Array.isArray(workspace.features) ||
      workspace.features.some(feature => feature?.geometry?.type !== 'Polygon')) {
    throw new Error('Unrecognized workspace draft.')
  }
  const entries = importParcels(workspace).map((parcel, index) => {
    const { source, zoning_asserted: zone } = workspace.features[index].properties
    return { ...parcel, scenario: source === 'schematic example', zone: zone === true }
  })
  if (!Number.isInteger(draft.active) || !entries[draft.active]) throw new Error('Invalid active parcel.')
  return {
    entries, active: draft.active,
    view: ['envelope', '0', '1'].includes(draft.view) ? draft.view : 'envelope',
    slice: Number.isInteger(draft.slice) && draft.slice >= 0 ? draft.slice : null,
    customContext: draft.customContext === true,
  }
}
