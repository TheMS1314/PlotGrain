function modelLayers({ plot, concept, sections, frontage }) {
  const layers = [{ name: 'PARCEL', geometry: plot, height: 0 }]
  if (concept) {
    for (let index = 0; index < concept.stories; index++) {
      layers.push({ name: `FLOOR_${index + 1}`, geometry: concept.footprint,
        height: index * concept.roofHeight / concept.stories })
    }
    layers.push({ name: 'ROOF', geometry: concept.footprint, height: concept.roofHeight })
    if (concept.permeable) layers.push({ name: 'PLANTING', geometry: concept.permeable, height: 0 })
  } else {
    for (const [index, section] of (sections ?? []).entries()) {
      if (section.geometry) layers.push({ name: `ENVELOPE_${index + 1}`, geometry: section.geometry, height: section.height })
    }
  }
  if (Number.isInteger(frontage)) {
    const ring = plot.coordinates[0]
    layers.push({ name: 'FRONTAGE', line: [ring[frontage], ring[frontage + 1]], height: 0 })
  }
  return layers
}

function eachPolygon(geometry) {
  return geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
}

export function buildDXF(study) {
  const parts = []
  const pair = (code, value) => parts.push(code, value)
  const layers = modelLayers(study)
  const records = []
  for (const item of layers) {
    if (item.line) {
      records.push({ name: item.name, points: item.line, height: item.height, closed: false })
      continue
    }
    for (const rings of eachPolygon(item.geometry)) {
      rings.forEach((ring, i) => records.push({
        name: i ? `${item.name}_VOID` : item.name,
        points: ring.slice(0, -1), height: item.height, closed: true,
      }))
    }
  }
  const names = [...new Set(records.map(record => record.name))]
  let nextHandle = 0x100
  const handle = () => (nextHandle++).toString(16).toUpperCase()
  const layerTable = handle()
  pair(0, 'SECTION'); pair(2, 'HEADER')
  pair(9, '$ACADVER'); pair(1, 'AC1015')
  pair(9, '$INSUNITS'); pair(70, 6)
  pair(9, '$MEASUREMENT'); pair(70, 1)
  pair(0, 'ENDSEC')
  pair(0, 'SECTION'); pair(2, 'TABLES')
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(5, layerTable); pair(330, '0')
  pair(100, 'AcDbSymbolTable'); pair(70, names.length)
  for (const name of names) {
    pair(0, 'LAYER'); pair(5, handle()); pair(330, layerTable)
    pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbLayerTableRecord')
    pair(2, name); pair(70, 0)
    pair(62, name.includes('VOID') ? 8 : name === 'PLANTING' ? 3 : name === 'FRONTAGE' ? 2 : name === 'PARCEL' ? 7 : 4)
    pair(6, 'CONTINUOUS')
  }
  pair(0, 'ENDTAB'); pair(0, 'ENDSEC')
  pair(0, 'SECTION'); pair(2, 'ENTITIES')
  for (const record of records) {
    pair(0, 'LWPOLYLINE'); pair(5, handle()); pair(100, 'AcDbEntity'); pair(8, record.name)
    pair(100, 'AcDbPolyline'); pair(90, record.points.length); pair(70, Number(record.closed)); pair(38, record.height)
    for (const [x,y] of record.points) {
      pair(10, x); pair(20, y)
    }
  }
  pair(0, 'ENDSEC'); pair(0, 'EOF')
  return parts.join('\r\n') + '\r\n'
}

function guid() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let bits = 0n
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte)
  let output = ''
  for (let i = 0; i < 22; i++) {
    output = chars[Number(bits & 63n)] + output
    bits >>= 6n
  }
  return output
}

function stepText(value) {
  return "'" + String(value).replace(/[^\x20-\x7e]|\\/g, char =>
    '\\X2\\' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0') + '\\X0\\')
    .replace(/'/g,"''") + "'"
}
const oneDecimal = value => (Number.isFinite(value) ? Number(value.toFixed(8)).toFixed(8).replace(/0+$/, '') : '0.')
const tuple = values => '(' + values.join(',') + ')'

function angle(value) {
  if (!Number.isFinite(value)) return '$'
  const sign = Math.sign(value)
  let remaining = Math.round(Math.abs(value)*3600*1e6)
  const values = [3600e6,60e6,1e6,1].map(step => {
    const digit = Math.floor(remaining / step)
    remaining -= digit * step
    return digit * sign
  })
  return tuple(values)
}

export function buildIFC({ site, plot, concept, sections, anchor }) {
  const lines = []
  const add = (name, ...args) => {
    lines.push(`#${lines.length + 1}=${name}(${args.join(',')});`)
    return '#' + lines.length
  }
  const id = () => stepText(guid())
  const point3 = (x,y,z) => add('IFCCARTESIANPOINT',tuple([x,y,z].map(oneDecimal)))
  const origin = point3(0,0,0)
  const zAxis = add('IFCDIRECTION','(0.,0.,1.)')
  const trueNorth = anchor?.true_north_xy ? add('IFCDIRECTION',tuple(anchor.true_north_xy.map(oneDecimal))) : '$'
  const basis = add('IFCAXIS2PLACEMENT3D',origin,'$','$')
  const context = add('IFCGEOMETRICREPRESENTATIONCONTEXT','$',"'Model'",3,'0.000001',basis,trueNorth)
  const length = add('IFCSIUNIT','*','.LENGTHUNIT.','$','.METRE.')
  const area = add('IFCSIUNIT','*','.AREAUNIT.','$','.SQUARE_METRE.')
  const volume = add('IFCSIUNIT','*','.VOLUMEUNIT.','$','.CUBIC_METRE.')
  const units = add('IFCUNITASSIGNMENT',tuple([length,area,volume]))
  const project = add('IFCPROJECT',id(),'$',stepText(site),'$','$','$','$',tuple([context]),units)
  const sitePlacement = add('IFCLOCALPLACEMENT','$',basis)
  const [lon,lat] = anchor?.origin_lon_lat ?? []
  const location = add('IFCSITE',id(),'$',stepText(site),'$','$',sitePlacement,'$','$','.ELEMENT.',angle(lat),angle(lon),'$','$','$')
  const buildingPlacement = add('IFCLOCALPLACEMENT',sitePlacement,basis)
  const building = add('IFCBUILDING',id(),'$',stepText(concept?.name ?? 'Modeled envelope'),'$','$',
    buildingPlacement,'$','$','.ELEMENT.','$','$','$')
  const relate = (parent, children) => add('IFCRELAGGREGATES',id(),'$','$','$',parent,tuple(children))
  const contains = (parent, elements) => {
    if (elements.length) add('IFCRELCONTAINEDINSPATIALSTRUCTURE',id(),'$','$','$',tuple(elements),parent)
  }
  relate(project,[location])
  relate(location,[building])

  function extrusion(geometry, depth) {
    return eachPolygon(geometry).map(rings => {
      const paths = rings.map(ring => {
        const points = ring.slice(0,-1).map(point => add('IFCCARTESIANPOINT',tuple(point.map(oneDecimal))))
        return add('IFCPOLYLINE',tuple([...points,points[0]]))
      })
      const profile = paths.length > 1
        ? add('IFCARBITRARYPROFILEDEFWITHVOIDS','.AREA.','$',paths[0],tuple(paths.slice(1)))
        : add('IFCARBITRARYCLOSEDPROFILEDEF','.AREA.','$',paths[0])
      return add('IFCEXTRUDEDAREASOLID',profile,basis,zAxis,oneDecimal(depth))
    })
  }
  function element(name, geometry, height, placement) {
    const solids = extrusion(geometry, height)
    const shapeRep = add('IFCSHAPEREPRESENTATION',context,"'Body'","'SweptSolid'",tuple(solids))
    const definition = add('IFCPRODUCTDEFINITIONSHAPE','$','$',tuple([shapeRep]))
    const productPlace = add('IFCLOCALPLACEMENT',placement,basis)
    return add('IFCBUILDINGELEMENTPROXY',id(),'$',stepText(name),'$','$',productPlace,definition,'$','.NOTDEFINED.')
  }
  const siteElements = [element('Parcel',plot,.05,sitePlacement)]
  if (concept?.permeable) siteElements.push(element('Permeable planting allocation',concept.permeable,.03,sitePlacement))
  contains(location,siteElements)

  const storeys = []
  const floors = concept ? Array.from({ length: concept.stories }, (_, index) => ({
    name: `Floor ${index + 1}`, geometry: concept.footprint, base: index * concept.roofHeight / concept.stories,
    depth: concept.roofHeight / concept.stories,
  })) : (sections ?? []).filter(item => item.geometry && item.height > item.base).map(item => ({
    name: `Envelope to ${item.height} m`, geometry: item.geometry, base: item.base, depth: item.height-item.base,
  }))
  for (const floor of floors) {
    const elevation = add('IFCAXIS2PLACEMENT3D',point3(0,0,floor.base),'$','$')
    const placement = add('IFCLOCALPLACEMENT',buildingPlacement,elevation)
    const storey = add('IFCBUILDINGSTOREY',id(),'$',stepText(floor.name),'$','$',placement,'$','$','.ELEMENT.',oneDecimal(floor.base))
    storeys.push(storey)
    contains(storey,[element('Feasibility massing',floor.geometry,floor.depth,placement)])
  }
  if (storeys.length) relate(building,storeys)
  return [
    'ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Early-stage feasibility massing'),'2;1');",
    `FILE_NAME('bangkok-study.ifc','${new Date().toISOString().slice(0,19)}',('Plotgrain'),(''),'Plotgrain','Plotgrain','');`,
    "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', ...lines, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n')
}
