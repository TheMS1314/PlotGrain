import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDXF, buildIFC } from './drawing-export.js'

const plot = { type:'Polygon', coordinates:[
  [[0,0],[20,0],[20,20],[0,20],[0,0]],
  [[5,5],[5,10],[10,10],[10,5],[5,5]],
] }
const study = { site:"Bang Son's court", plot, frontage: 0,
  anchor: { origin_lon_lat:[100.53,13.82], true_north_xy:[0,1] },
  concept: { name:'Court', stories:2, roofHeight:7, footprint:plot },
}

test('DXF preserves metric units, elevations and open frontage alongside void layers', () => {
  const cad = buildDXF(study).replace(/\r/g, '')
  assert.match(cad, /\$INSUNITS\n70\n6\n/)
  assert.match(cad, /8\nFLOOR_2_VOID\n100\nAcDbPolyline\n90\n4\n70\n1\n38\n3\.5\n/)
  assert.match(cad, /8\nROOF\n100\nAcDbPolyline\n90\n4\n70\n1\n38\n7\n/)
  assert.match(cad, /8\nFRONTAGE\n100\nAcDbPolyline\n90\n2\n70\n0\n/)
})

test('IFC4 exports correctly elevated storeys and solids with a void profile', () => {
  const bim = buildIFC(study)
  assert.match(bim, /FILE_SCHEMA\(\('IFC4'\)\)/)
  assert.match(bim, /'Bang Son''s court'/)
  assert.match(bim, /\(13,49,12,0\),\(100,31,48,0\)/)
  assert.match(bim, /IFCDIRECTION\(\(0\.,1\.\)\)/)
  assert.equal((bim.match(/=IFCBUILDINGSTOREY\(/g) ?? []).length,2)
  assert.equal((bim.match(/=IFCARBITRARYPROFILEDEFWITHVOIDS\(/g) ?? []).length,3)
  assert.match(bim, /'Floor 2'[^\n]*,3\.5\);/)
})

test('CAD and BIM envelope exports keep separated massing above each slice base', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [plot.coordinates, [
    [[30,0],[35,0],[35,5],[30,5],[30,0]],
  ]] }
  const enclosure = { ...study, concept: null, sections: [
    { base:0, height:3, geometry: null }, { base:3, height:6, geometry },
  ] }
  const cad = buildDXF(enclosure).replace(/\r/g,'')
  assert.equal((cad.match(/8\nENVELOPE_2\n/g) ?? []).length,2)
  assert.match(cad, /ENVELOPE_2_VOID\n100\nAcDbPolyline\n90\n4\n70\n1\n38\n6\n/)
  const bim = buildIFC(enclosure)
  assert.match(bim, /'Envelope to 6 m'[^\n]*,3\.\);/)
  assert.equal((bim.match(/=IFCEXTRUDEDAREASOLID\(/g) ?? []).length,3)
})
