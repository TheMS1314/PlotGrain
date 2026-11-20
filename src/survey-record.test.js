import assert from 'node:assert/strict'
import test from 'node:test'
import { readSurveyRecord, compareSurvey } from './survey-record.js'
import { readSurveyOutline } from './survey-coordinate.js'
import { buildStudyFile } from './study-file.js'
import { importParcels, exportWorkspace } from './parcel-workspace.js'

const record = { reference:' Survey S-104 ', date:'2026-11-15', area_m2:1000, tolerance_m2:1.5 }

test('survey evidence requires a reference and distinguishes limits from changed boundaries', () => {
  assert.throws(() => readSurveyRecord({ ...record, reference:' ' }), /reference/)
  assert.throws(() => readSurveyRecord({ ...record, date:'2026-02-30' }), /date/)
  assert.throws(() => readSurveyRecord({ ...record, area_m2:null }), /recorded area/)
  const checked = readSurveyRecord(record)
  assert.equal(checked.reference, 'Survey S-104')
  assert.equal(compareSurvey(checked, 1001.5).status, 'within_tolerance')
  assert.equal(compareSurvey(checked, 998.499).status, 'outside_tolerance')
  assert.equal(compareSurvey({ ...checked, tolerance_m2:null }, 998).status, 'difference_only')
  assert.equal(compareSurvey({ ...checked, stale:true }, 998).status, 'boundary_changed')
})

test('UTM zone 47N is converted using the stated CRS and independently computed PROJ references', () => {
  const numbers = [
    [665367.6822209556,1528900.011853946],[665389.3034952924,1528900.1498617558],
    [665389.162257344,1528922.2755886517],[665367.5410014878,1528922.1375790022],
  ]
  const fixture = { type:'Polygon', coordinates:[[...numbers,numbers[0]]] }
  const actual = readSurveyOutline(fixture, '32647').coordinates[0]
  assert.ok(Math.abs(actual[0][0] - 100.53) < 1e-8 && Math.abs(actual[0][1] - 13.825) < 1e-8)
  assert.ok(Math.abs(actual[2][0] - 100.5302) < 1e-8 && Math.abs(actual[2][1] - 13.8252) < 1e-8)
  assert.throws(() => readSurveyOutline(fixture, '4326'), /WGS84/)
  assert.throws(() => readSurveyOutline(fixture, '24047'), /coordinate system/)
  assert.throws(() => readSurveyOutline({ ...fixture, coordinates:[numbers.map(([x,y]) => [y,x])] }, '32647'), /easting and northing/)
})

test('survey geometry and provenance survive a study and workspace round trip', () => {
  const ring = [[100.53,13.82],[100.531,13.82],[100.531,13.821],[100.53,13.82]]
  const plot = { type:'Polygon', coordinates:[ring] }
  const outline = { ...plot, coordinates:[ring.map(([x,y]) => [x+.0001,y])] }
  const survey = readSurveyRecord({ ...record, boundary:outline, source_crs:'32647', stale:true })
  const result = { plotArea:1000, ruleset:'R.8', surveyComparison:{ outside_m2:40 } }
  const exported = buildStudyFile({ plot, frame:x=>x, frontage:0, result, survey })
  assert.deepEqual(exported.study.survey.outline_comparison, { outside_m2:40 })
  assert.equal(exported.study.survey.boundary, undefined)
  assert.deepEqual(exported.features.find(item => item.properties.layer === 'survey_boundary').geometry, outline)
  assert.deepEqual(importParcels(exported)[0].survey, survey)
  const comparison = exportWorkspace([{ name:'A', width:'', centerOffset:'', frontage:0, points:ring.slice(0,-1), survey }])
  assert.deepEqual(importParcels(comparison)[0].survey, survey)
})
