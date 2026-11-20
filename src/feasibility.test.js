import test from 'node:test'
import assert from 'node:assert/strict'
import { createFeasibility } from './feasibility.js'

const plot = { type: 'Polygon', coordinates: [[
  [0,0], [30,0], [30,25], [20,25], [20,40], [0,40], [0,0],
]] }
const road = { centerY: -2.5, nearY: 0, farY: -5 }
const inputs = { plot, road, buildingType: 'residential' }
const box = (x, y, right, top) => ({
  type: 'Polygon', coordinates: [[[x,y], [right,y], [right,top], [x,top], [x,y]]],
})

test('concave reference matches the independently calculated envelope', () => {
  const model = createFeasibility(inputs)
  assert.equal(model.plotArea, 1050)
  assert.equal(model.floorAreaBudget, 6300)
  assert.equal(model.section(17, 5).area, 654)
  assert.equal(model.section(18, 6).area, 642)
  assert.deepEqual(model.section(18, 6).requirements, { boundaryInset: 3, roadSetback: 3.5, heightSetback: 4 })
  assert.equal(model.section(21, 7).area, 606)
})

test('narrowing the road reduces the tall section', () => {
  const model = createFeasibility({ ...inputs, road: { centerY: -2, nearY: 0, farY: -4 } })
  assert.equal(model.section(18, 6).area, 618)
})

test('checks account for floor area, modeled open space, and missing planting evidence', () => {
  const model = createFeasibility(inputs)
  const concept = model.checkConcept({ footprint: box(3, 3.5, 17, 23), stories: 5, roofHeight: 15 })
  assert.equal(concept.gross, 1365)
  assert.equal(concept.openArea, 777)
  assert.ok(concept.openMinimum === 315)
  assert.equal(concept.plantingMinimum, 388.5)
  assert.deepEqual(concept.checks.map(check => check.status), [
    'pass', 'pass', 'pass', 'unverified', 'unverified',
  ])
})

test('rejects a design that breaks the height plane or counts roof as open planting', () => {
  const model = createFeasibility(inputs)
  const concept = model.checkConcept({
    footprint: box(3, 3.5, 17, 23),
    stories: 6,
    roofHeight: 18,
    permeable: box(0, 0, 20, 25),
  })
  assert.equal(concept.checks[1].status, 'fail')
  assert.equal(concept.checks[3].status, 'fail')
})

test('returns an empty envelope for a narrow plot and rejects a crossed boundary', () => {
  const narrow = createFeasibility({ ...inputs, plot: box(0, 0, 4, 20) })
  assert.equal(narrow.section(18, 6).geometry, null)
  assert.equal(narrow.section(18, 6).area, 0)
  assert.throws(() => createFeasibility({
    ...inputs,
    plot: { type: 'Polygon', coordinates: [[[0,0], [30,30], [0,30], [30,0], [0,0]]] },
  }), /valid/)
})

test('two generated concepts satisfy the modeled checks on the reference case', async () => {
  const { generateConcepts } = await import('./feasibility.js')
  const concepts = generateConcepts(createFeasibility(inputs), plot, 'residential')
  assert.equal(concepts.length, 2)
  for (const concept of concepts) {
    assert.ok(concept.available)
    assert.ok(concept.gross > 0 && concept.gross < 1000)
    assert.ok(concept.checks.every(check => check.status === 'pass'))
  }
  assert.notEqual(concepts[0].stories, concepts[1].stories)
})

test('city open space fails despite meeting both national and zoning minima', () => {
  const model = createFeasibility({ ...inputs, plot: box(0, 0, 40, 40) })
  const design = model.checkConcept({ footprint: box(2, 2, 38, 36), stories: 1, roofHeight: 4 })
  assert.equal(design.gross, 1224)
  assert.equal(design.openArea, 376)
  assert.ok(design.openRequirements[1].area < design.openArea)
  assert.equal(design.openMinimum, 480)
  assert.equal(design.checks.find(check => check.name === 'Open space').status, 'fail')
})

test('third-floor clearance applies even when the roof is at 9 m', () => {
  const model = createFeasibility({ plot: box(0, 0, 20, 20),
    road: { centerY: -6, nearY: 0, farY: -12 }, buildingType: 'residential' })
  assert.equal(model.section(9, 2).area, 256)
  assert.equal(model.section(9, 3).area, 196)
})

test('road setback uses centerline below 10 m and the near boundary at or above 10 m', () => {
  const small = { plot: box(0, 0, 20, 20), buildingType: 'residential' }
  const nine = createFeasibility({ ...small, road: { centerY: -2, nearY: 0, farY: -9 } })
  const ten = createFeasibility({ ...small, road: { centerY: -2, nearY: 0, farY: -10 } })
  assert.equal(nine.section(9, 2).area, 224)
  assert.equal(ten.section(9, 2).area, 256)
})

test('narrow corridors can split the inset and never fill the missing land', () => {
  const dumbbell = { type: 'Polygon', coordinates: [[
    [0,0], [12,0], [12,8], [22,8], [22,0], [34,0], [34,20], [22,20],
    [22,12], [12,12], [12,20], [0,20], [0,0],
  ]] }
  const model = createFeasibility({ ...inputs, plot: dumbbell })
  assert.equal(model.section(12, 4).geometry.type, 'MultiPolygon')
})

test('rejects frontages where the parcel crosses behind the road edge', () => {
  assert.throws(() => createFeasibility({ ...inputs, plot: box(0, -2, 10, 10) }), /frontage/)
})

test('mapped footprints are clipped to the parcel and overlapping records count once', async () => {
  const { summarizeSite } = await import('./feasibility.js')
  const parcel = box(0, 0, 20, 20)
  const result = summarizeSite(parcel, [
    { id: 'A', geometry: box(-5, -5, 10, 10) },
    { id: 'B', geometry: box(5, 5, 15, 15) },
    { id: 'touch-only', geometry: box(20, 0, 25, 5) },
    { id: 'outside', geometry: box(25, 5, 30, 10) },
  ])
  assert.equal(result.plotArea, 400)
  assert.equal(result.existing.area, 175)
  assert.deepEqual(result.existing.ids, ['A', 'B'])
})

test('constant floor plates use the correct open-space budget for each building use', () => {
  const residential = createFeasibility(inputs)
  const office = createFeasibility({ ...inputs, buildingType: 'office' })
  assert.equal(residential.maxOpenSpacePlate(4), 735)
  assert.equal(office.maxOpenSpacePlate(4), 875)
  assert.equal(office.maxOpenSpacePlate(2), 945)
})

test('the mapped example agrees with an independent WGS84 geodesic area benchmark', async () => {
  const { readFileSync } = await import('node:fs')
  const { frontageFrame, edgeReadings } = await import('./coordinates.js')
  const { summarizeSite } = await import('./feasibility.js')
  const geometry = JSON.parse(readFileSync(new URL('../public/data/demo.geojson', import.meta.url))).features[0].geometry
  const ring = geometry.coordinates[0]
  const frame = frontageFrame(ring.slice(0, -1), 0)
  const local = { type: 'Polygon', coordinates: [ring.map(frame.toLocal)] }
  assert.ok(Math.abs(summarizeSite(local).plotArea - 1043.767886294052) < .01)
  assert.ok(Math.abs(edgeReadings(ring)[0].metres - 29.981484442381813) < .001)
})

test('constraint stages show the separate reductions from the boundary, road and height plane', () => {
  const study = createFeasibility(inputs)
  const cut = study.section(18, 6, true)
  assert.deepEqual(cut.stages.map(step => [step.id, step.area]), [['plot',1050],['boundary',666],['road',654]])
  assert.equal(cut.area, 642)
  assert.equal(cut.plateBudgets.far, 1050)
  assert.equal(cut.plateBudgets.openSpace, 735)
})

test('exclusions stay empty in geometric slices and are deducted from the FAR budget', async () => {
  const { summarizeSite, generateConcepts } = await import('./feasibility.js')
  const boundary = box(0, 0, 40, 40)
  const hole = box(15, 15, 25, 25)
  const plotWithHole = { ...boundary, coordinates: [...boundary.coordinates, ...hole.coordinates] }
  const model = createFeasibility({ ...inputs, plot: plotWithHole })
  assert.equal(model.plotArea, 1500)
  assert.equal(model.floorAreaBudget, 9000)
  const cut = model.section(15, 5)
  assert.ok(cut.geometry.coordinates.length > 1)
  assert.equal(summarizeSite(plotWithHole, [{ id: 'in exclusion', geometry: hole }]).existing.area, 0)
  const concepts = generateConcepts(model, plotWithHole, 'residential')
  assert.equal(concepts.length, 2)
  assert.ok(concepts.every(concept => concept.available && concept.checks.every(check => check.status === 'pass')))
})

test('an excluded ring outside the parcel is rejected before a budget is shown', () => {
  const outline = box(0,0,20,20)
  const invalid = { ...outline, coordinates: [...outline.coordinates, ...box(25,25,30,30).coordinates] }
  assert.throws(() => createFeasibility({ ...inputs, plot: invalid }), /valid/)
})

test('site area counts overlapping land once and omits alternative schemes', async () => {
  const { summarizeSitePlan } = await import('./feasibility.js')
  const report = summarizeSitePlan([
    { geometry: box(0,0,20,20), role: 'parcel' },
    { geometry: box(20,0,30,20), role: 'parcel' },
    { geometry: box(16,0,24,10), role: 'shared' },
    { geometry: box(0,20,5,25), role: 'shared' },
    { geometry: box(50,50,100,100), role: 'option' },
    { geometry: null, role: 'parcel' },
  ])
  assert.deepEqual(report, { totalArea: 625, plotArea: 600, sharedArea: 105, overlap: 80, invalid: 1 })
})
