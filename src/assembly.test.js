import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeAssemblySelections } from './assembly.js'
import { compareReferenceBoundary, summarizeSitePlan } from './feasibility.js'
import { analyzeAssembly } from './study-worker.js'

const box = (a,b,c,d) => ({ type:'Polygon', coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]]] })
const parcel = geometry => ({ geometry, role: 'parcel' })

test('site diagnostics count each conflicted square metre once, even under triple overlap', () => {
  const result = summarizeSitePlan([
    parcel(box(0,0,10,10)), parcel(box(5,0,15,10)), parcel(box(5,0,10,10)),
    { geometry: box(9,0,12,3), role: 'shared' },
    parcel(box(25,0,30,10)), { geometry: null, role: 'parcel' },
    { geometry: box(100,100,200,200), role: 'option' },
  ], true)
  assert.equal(result.totalArea, 200)
  assert.equal(result.parcelOverlap, 50)
  assert.equal(result.overlap, 9)
  assert.equal(result.components, 2)
  assert.equal(result.invalid, 1)
  assert.equal(result.conflicts.type, 'Polygon')
})

test('edge-touching parcels have one connected block and serve only checked selections', () => {
  const first = box(0,0,30,30)
  const second = box(30,0,60,30)
  const road = { centerY:-2.5, nearY:0, farY:-5 }
  const result = analyzeAssembly([parcel(first), parcel(second)], [
    { entryIndex:0, name:'A', plot:first, road, buildingType:'residential' },
    { entryIndex:1, name:'B', plot:first, road, buildingType:'office' },
    { entryIndex:2, name:'No road', plot:first, road:null, notReady:'Enter road dimensions' },
  ])
  assert.equal(result.land.totalArea, 1800)
  assert.equal(result.land.conflicts, null)
  assert.equal(result.land.components, 1)
  assert.equal(result.parcels[2].status, 'Enter road dimensions')
  assert.deepEqual(result.parcels.map(item => item.designs.length), [2,2,0])
  const selected = summarizeAssemblySelections(result.parcels, new Map([[0,0],[1,1],[2,0]]), result.land)
  assert.equal(selected.selected.length, 2)
  assert.equal(selected.floorArea, result.parcels[0].designs[0].gross + result.parcels[1].designs[1].gross)
  const conflicted = summarizeAssemblySelections(result.parcels, new Map([[0,0],[1,1]]), { ...result.land, parcelOverlap: .25 })
  assert.equal(conflicted.floorArea, null)
  assert.equal(conflicted.footprintArea, null)
})

test('outline comparison detects offset even when reported areas agree', () => {
  assert.deepEqual(compareReferenceBoundary(box(0,0,20,20), box(1,0,21,20)), {
    survey_area_m2: 400, overlap_m2: 380, outside_m2: 20, missing_m2: 20,
  })
  assert.deepEqual(compareReferenceBoundary(box(0,0,20,20), box(21,0,41,20)), {
    survey_area_m2: 400, overlap_m2: 0, outside_m2: 400, missing_m2: 400,
  })
  assert.match(compareReferenceBoundary(box(0,0,20,20), box(3100,0,3120,20)).error, /3 km/)
})
