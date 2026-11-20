import { heightOfBuilding, shadowPaths } from './solar-study.js'
import { nearestEdge, pointInRings, metresPerDegree, edgeReadings } from './coordinates.js'

const radians = Math.PI / 180

export function siteProjection({ center, width, height, scale, pitch, bearing }) {
  const { longitude: longitudeScale, latitude: latitudeScale } = metresPerDegree(center[1])
  const c = Math.cos(bearing * radians)
  const s = Math.sin(bearing * radians)
  const tilt = pitch * radians
  const groundScale = scale * Math.cos(tilt)
  return {
    project([lng, lat], elevation = 0) {
      const east = (lng - center[0]) * longitudeScale
      const north = (lat - center[1]) * latitudeScale
      return [width / 2 + (east * c - north * s) * scale,
        height / 2 - (east * s + north * c) * groundScale - elevation * scale * Math.sin(tilt)]
    },
    unproject([x, y]) {
      const across = (x - width / 2) / scale
      const forward = (height / 2 - y) / groundScale
      return [center[0] + (across * c + forward * s) / longitudeScale,
        center[1] + (-across * s + forward * c) / latitudeScale]
    },
  }
}

function polygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  return geometry.type === 'MultiPolygon' ? geometry.coordinates : []
}

export function paintSite(ctx, { width, height, projection, pitch, scale = 1, layers, streets, buildings, display = {}, overlapIds = new Set(), pointerPreview }) {
  const assembled = Boolean(layers.assembly)
  if (assembled) {
    layers = layers.assembly
    overlapIds = layers.overlapIds ?? new Set()
  }
  const architectural = display.architectural && pitch > 0
  ctx.fillStyle = architectural ? '#e0e1d7' : '#e9ede5'
  ctx.fillRect(0, 0, width, height)

  function trace(points, z = 0, close = false) {
    points.forEach((point, i) => {
      const [x, y] = projection.project(point, z)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    if (close) ctx.closePath()
  }

  function surface(rings, z, fill, stroke, weight = 1) {
    ctx.beginPath()
    for (const ring of rings) trace(ring, z, true)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill('evenodd')
    }
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = weight
      ctx.stroke()
    }
  }

  function line(points, color, weight) {
    ctx.beginPath()
    trace(points)
    ctx.strokeStyle = color
    ctx.lineWidth = weight
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  function wallPanel(a, b, start, end, bottom, top, color) {
    const between = fraction => [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]
    const left = between(start)
    const right = between(end)
    ctx.beginPath()
    ctx.moveTo(...projection.project(left, bottom))
    ctx.lineTo(...projection.project(right, bottom))
    ctx.lineTo(...projection.project(right, top))
    ctx.lineTo(...projection.project(left, top))
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  function extrusion(rings, base, roof, fill, wall, outline, alpha = 1, facade = false) {
    if (pitch > 0) {
      const sides = []
      for (const [ringIndex, ring] of rings.entries()) {
        const [originX, originY] = ring[0]
        let orientation = 0
        for (let i = 1; i < ring.length; i++) {
          orientation += (ring[i - 1][0] - originX) * (ring[i][1] - originY) -
            (ring[i][0] - originX) * (ring[i - 1][1] - originY)
        }
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]
          const b = ring[i]
          const depth = (projection.project(a)[1] + projection.project(b)[1]) / 2
          const horizontal = projection.project(a)[0] <= projection.project(b)[0]
          const front = horizontal === (ringIndex ? orientation < 0 : orientation > 0)
          const dx = (b[0] - a[0]) * Math.cos((a[1] + b[1]) * radians / 2)
          const dy = b[1] - a[1]
          const outward = (orientation > 0) === (ringIndex === 0) ? 1 : -1
          const light = Math.max(0, outward * (-.6 * dy - .8 * dx) / (Math.hypot(dx, dy) || 1))
          if (!facade || front) sides.push({ a, b, depth, horizontal, light })
        }
      }
      sides.sort((a, b) => a.depth - b.depth)
      for (const { a, b, horizontal, light } of sides) {
        ctx.beginPath()
        ctx.moveTo(...projection.project(a, base))
        ctx.lineTo(...projection.project(b, base))
        ctx.lineTo(...projection.project(b, roof))
        ctx.lineTo(...projection.project(a, roof))
        ctx.closePath()
        ctx.fillStyle = facade ? `hsl(37 18% ${57 + 14 * light}%)` : wall
        ctx.globalAlpha = alpha * (facade ? 1 : horizontal ? .76 : .96)
        ctx.fill()
        if (facade && roof - base >= 2.4 && Math.abs(projection.project(a)[0] - projection.project(b)[0]) >= 10) {
          const span = edgeReadings([a, b])[0].metres
          const bays = Math.min(22, Math.floor(span / 2.25))
          for (let i = 0; i < bays; i++) {
            const start = (i + .17) / bays
            const end = (i + .80) / bays
            wallPanel(a,b,start,end,base + .72,roof - .53,`hsl(181 20% ${29 + 14 * light}%)`)
            wallPanel(a,b,start,end,roof - .77,roof - .56,`hsl(162 14% ${55 + 14 * light}%)`)
          }
          wallPanel(a,b,0,1,roof - .23,roof,'#e1dac7')
        }
        ctx.globalAlpha = 1
      }
    }
    ctx.globalAlpha = alpha
    surface(rings, roof, facade ? '#e1dac8' : fill, facade ? '#948e7c' : outline)
    ctx.globalAlpha = 1
  }

  for (const { geometry, properties } of streets) {
    const screen = geometry.coordinates.map(point => projection.project(point))
    if (screen.every(([x]) => x < -6) || screen.every(([x]) => x > width + 6) ||
        screen.every(([, y]) => y < -6) || screen.every(([, y]) => y > height + 6)) continue
    const wide = properties.class === 'secondary' || properties.class === 'tertiary'
    ctx.beginPath()
    screen.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y))
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = architectural ? '#e7e5d9' : '#d4d8cc'
    ctx.lineWidth = wide ? 9 : 5
    ctx.stroke()
    ctx.strokeStyle = architectural ? '#a8aba1' : '#fbfaf4'
    ctx.lineWidth = wide ? 7 : 3.5
    ctx.stroke()
  }
  const visible = []
  for (const feature of buildings) {
    for (const rings of polygons(feature.geometry)) {
      if (!rings[0]?.length || display.showBuildings === false) continue
      const roofHeight = heightOfBuilding(feature)
      const screen = rings[0].map(point => projection.project(point))
      const extents = pitch > 0 ? [...screen, ...rings[0].map(point => projection.project(point, roofHeight))] : screen
      if (extents.every(([x]) => x < -45) || extents.every(([x]) => x > width + 45) ||
          extents.every(([, y]) => y < -45) || extents.every(([, y]) => y > height + 45)) continue
      visible.push({ feature, rings, depth: Math.max(...screen.map(point => point[1])) })
    }
  }
  visible.sort((a, b) => a.depth - b.depth)
  if (architectural) {
    ctx.save()
    ctx.translate(Math.max(1, scale * 1.1), Math.max(1, scale * .75))
    ctx.globalAlpha = .20 * (display.contextOpacity ?? 1)
    for (const { rings, feature } of visible) {
      if (!overlapIds.has(feature.properties.id) || display.cutaway === false) surface(rings,0,'#585f55')
    }
    ctx.restore()
  }
  for (const { rings, feature } of visible) {
    const affected = overlapIds.has(feature.properties.id)
    if (affected && display.cutaway !== false) surface(rings, 0, '#dca97b55', '#ac714f')
    else extrusion(rings, 0, heightOfBuilding(feature), architectural ? '#d0cfc1' : '#c8d1c7',
      architectural ? '#a3a496' : '#929f95', architectural ? '#adada0' : '#aab5aa', display.contextOpacity ?? 1)
  }
  for (const { geometry } of layers.road ?? []) {
    for (const rings of polygons(geometry)) surface(rings, 0, '#e4a55575', '#d39a51')
  }
  for (const { geometry, properties } of layers.parcels ?? []) {
    const shared = properties.role === 'shared'
    if (!assembled || shared) ctx.setLineDash([5, 4])
    for (const rings of polygons(geometry)) surface(rings, 0, shared ? '#b3c982a0' : assembled ? '#edf2dacc' : '#58738a24',
      shared ? '#6b873c' : assembled ? '#286b57' : '#667887', 2)
    ctx.setLineDash([])
  }
  for (const { geometry } of layers.plot ?? []) {
    if (geometry.type === 'LineString') line(geometry.coordinates, '#195d4b', 3)
    for (const rings of polygons(geometry)) surface(rings, 0, '#f2f5e1c9', '#195d4b', 3)
  }
  if (layers.survey?.length) {
    ctx.setLineDash([6, 4])
    for (const { geometry } of layers.survey) {
      for (const rings of polygons(geometry)) surface(rings, 0, null, '#5260a0', 2.5)
    }
    ctx.setLineDash([])
  }
  for (const { geometry } of layers.overlap ?? []) {
    if (assembled || (display.showBuildings !== false && display.cutaway !== false)) {
      for (const rings of polygons(geometry)) surface(rings, 0, assembled ? '#c77c6a8c' : '#c581513b', assembled ? '#a84642' : '#b37451')
    }
  }
  for (const { geometry } of layers.planting ?? []) {
    for (const rings of polygons(geometry)) {
      surface(rings, 0, architectural ? '#a4b48b' : '#acd188', '#6e965d')
      if (architectural) {
        ctx.save()
        ctx.beginPath()
        for (const ring of rings) trace(ring, 0, true)
        ctx.clip('evenodd')
        const pixels = rings[0].map(point => projection.project(point))
        const minX = Math.max(0,Math.floor(Math.min(...pixels.map(point => point[0])) / 9) * 9)
        const maxX = Math.min(width,Math.max(...pixels.map(point => point[0])))
        const minY = Math.max(0,Math.floor(Math.min(...pixels.map(point => point[1])) / 7) * 7)
        const maxY = Math.min(height,Math.max(...pixels.map(point => point[1])))
        ctx.fillStyle = '#869b73'
        for (let x = minX; x < maxX; x += 9) {
          for (let y = minY; y < maxY; y += 7) ctx.fillRect(x + (y % 5), y, 1.7, 1.5)
        }
        ctx.restore()
      }
    }
  }
  if (layers.solar?.perMetre && pitch === 0) {
    const { perMetre, latitude, useContext, proposal } = layers.solar
    const shadows = useContext && display.showBuildings !== false
      ? buildings.filter(item => display.cutaway === false || !overlapIds.has(item.properties.id))
        .map(item => ({ geometry: item.geometry, height: heightOfBuilding(item) }))
      : []
    if (proposal) shadows.push(proposal)
    ctx.beginPath()
    for (const { geometry, height } of shadows) {
      for (const ring of shadowPaths(geometry, height, perMetre, latitude)) trace(ring, 0, true)
    }
    ctx.fillStyle = '#28375349'
    ctx.fill()
    for (const { rings, feature } of visible) {
      if (display.cutaway === false || !overlapIds.has(feature.properties.id)) surface(rings, 0, '#c8d1c7', '#9ca99b')
    }
  }
  for (const { geometry } of layers.frontage ?? []) line(geometry.coordinates, '#bc7121', 4)
  const masses = layers.massing ?? []
  if (architectural && masses[0]?.properties.proposal) {
    ctx.save()
    ctx.translate(scale * 2.1, scale * 1.4)
    ctx.globalAlpha = .25
    for (const rings of polygons(masses[0].geometry)) surface(rings, 0, '#556655')
    ctx.restore()
  }
  let displayed = pitch > 0 ? masses : assembled ? masses.filter(item => item.properties.top) : masses.slice(-1)
  if (assembled && pitch > 0) {
    displayed = displayed.map(item => ({ item, depth: Math.max(...polygons(item.geometry).flatMap(rings =>
      rings[0].map(point => projection.project(point)[1]))) }))
      .sort((a, b) => a.depth - b.depth || a.item.properties.base - b.item.properties.base)
      .map(({ item }) => item)
  }
  for (const { geometry, properties } of displayed) {
    for (const rings of polygons(geometry)) {
      extrusion(rings, properties.base, properties.height, properties.color, '#20604d', '#185643',
        display.massingOpacity ?? .87, architectural && properties.proposal)
    }
  }
  if (pointerPreview) {
    ctx.setLineDash([5, 5])
    line(pointerPreview, '#376758', 2)
    ctx.setLineDash([])
  }

  function label(text, x, y) {
    ctx.font = '600 11px system-ui'
    const size = ctx.measureText(text).width
    ctx.fillStyle = '#fffdf5eb'
    ctx.fillRect(x - size / 2 - 4, y - 9, size + 8, 18)
    ctx.fillStyle = '#203c33'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y)
  }

  if (display.dimensions !== false && pitch === 0) {
    for (const edge of layers.edges ?? []) {
      const a = projection.project(edge.point)
      const b = projection.project(edge.next)
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 28) continue
      label(`${edge.metres.toFixed(1)} m`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    }
  }
  if (display.labels !== false && layers.label) {
    const corners = layers.label.vertices?.map(point => projection.project(point))
    if (corners?.length) {
      const left = Math.min(...corners.map(point => point[0]))
      const right = Math.max(...corners.map(point => point[0]))
      const bottom = Math.max(...corners.map(point => point[1]))
      label(layers.label.text, (left + right) / 2, bottom + (pitch === 0 ? 24 : 19))
    }
  }

  ;(layers.vertices ?? []).forEach(({ geometry }, index) => {
    const [x, y] = projection.project(geometry.coordinates)
    ctx.beginPath()
    ctx.arc(x, y, 9, 0, Math.PI * 2)
    ctx.fillStyle = '#fcfdf5'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#195d4b'
    ctx.stroke()
    ctx.fillStyle = '#193d33'
    ctx.font = '600 10px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(index + 1), x, y)
  })
  return visible
}

export function createSiteView(container, { center, streets, buildings, bearing = -22, pitch = 53, onPoint, onPitch, onInspect, onCamera }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'site-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('aria-describedby', 'map-keyboard')
  canvas.setAttribute('aria-label', 'Bang Son site plan and 3D building study')
  container.append(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas drawing is unavailable.')
  const initialCenter = [...center]
  const camera = { center: [...center], width: 1, height: 1, scale: 2.7, pitch, bearing }
  const layers = Object.create(null)
  const handles = new Set()
  let pending = false
  let zoom = 1
  let pointer
  let interaction = 'explore'
  let orbit = false
  let display = {}
  let overlapIds = new Set()
  let visible = []
  let pointerPreview
  const touches = new Map()
  let pinch
  let projection = siteProjection(camera)

  function requestPaint() {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      camera.width = Math.max(container.clientWidth, 1)
      camera.height = Math.max(container.clientHeight, 1)
      camera.scale = Math.min(4.7, Math.max(1.35, camera.width / 125)) * zoom
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const pixelWidth = Math.round(camera.width * dpr)
      const pixelHeight = Math.round(camera.height * dpr)
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      projection = siteProjection(camera)
      visible = paintSite(ctx, { ...camera, projection, layers, streets, buildings, display, overlapIds, pointerPreview })
      onCamera?.(camera)

      for (const handle of handles) handle.position()
    })
  }
  new ResizeObserver(requestPaint).observe(container)
  const pixel = event => {
    const rect = canvas.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }
  function inspect(pixel) {
    const activeLayers = layers.assembly ?? layers
    const activeOverlap = layers.assembly ? activeLayers.overlapIds : overlapIds
    if (interaction === 'draw') {
      const last = layers.vertices?.at(-1)?.geometry.coordinates
      const first = layers.vertices?.[0]?.geometry.coordinates
      const nearStart = first && layers.vertices.length >= 3 &&
        Math.hypot(...projection.project(first).map((v, i) => v - pixel[i])) <= 14
      pointerPreview = last ? [last, nearStart ? first : projection.unproject(pixel)] : null
      canvas.style.cursor = nearStart ? 'pointer' : 'crosshair'
      requestPaint()
      onInspect?.(nearStart ? { label: 'Close plot', detail: 'Click the first vertex to finish.' } : null, pixel)
      return
    }
    const edge = nearestEdge(pixel, activeLayers.edges ?? [], projection.project)
    if (edge) {
      canvas.style.cursor = interaction === 'frontage' ? 'pointer' : ''
      onInspect?.({ label: `Edge ${edge.index + 1}`, detail: `${edge.metres.toFixed(1)} m${interaction === 'frontage' ? ' · click to select frontage' : ''}` }, pixel)
      return
    }
    const mass = activeLayers.massing?.findLast(({ geometry, properties }) =>
      polygons(geometry).some(rings => pointInRings(pixel, rings.map(ring =>
        ring.map(point => projection.project(point, properties.height))))))
    if (mass) {
      const { name, height, area } = mass.properties
      const size = area ? ` · ${Math.round(area).toLocaleString()} m² section` : ''
      onInspect?.({ label: name || 'Proposed massing', detail: `${height.toFixed(1)} m elevation${size}` }, pixel)
      return
    }
    const adjacent = activeLayers.parcels?.find(item => polygons(item.geometry).some(rings =>
      pointInRings(projection.unproject(pixel), rings)))
    if (adjacent) {
      onInspect?.({ label: adjacent.properties.name, detail: adjacent.properties.role === 'shared' ? 'Shared land in site plan' : 'Parcel in this comparison' }, pixel)
      return
    }
    if (display.showBuildings !== false) {
      const match = visible.findLast(({ rings, feature }) => {
        const flat = display.cutaway !== false && activeOverlap?.has(feature.properties.id)
        const roof = rings.map(ring => ring.map(point => projection.project(point, flat ? 0 : heightOfBuilding(feature))))
        return pointInRings(pixel, roof)
      })
      if (match) {
        const { properties } = match.feature
        canvas.style.cursor = ''
        onInspect?.({ label: properties.name || 'Mapped building footprint',
          detail: activeOverlap?.has(properties.id) ? 'Intersects study plot' : Number.isFinite(properties.height_m) ? `${properties.height_m} m · supplied height` :
            camera.pitch ? 'Height shown as a 6 m estimate' : 'Overture building data' }, pixel)
        return
      }
    }
    canvas.style.cursor = ''
    onInspect?.(null)
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    if (event.pointerType === 'mouse') canvas.focus({ preventScroll: true })
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, pixel(event))
      if (touches.size === 2) {
        const [a, b] = [...touches.values()]
        pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom }
        pointer = null
        canvas.setPointerCapture(event.pointerId)
        return
      }
    }
    onInspect?.(null)
    pointer = { id: event.pointerId, start: pixel(event), center: [...camera.center], projection, moved: false,
      orbit: interaction === 'explore' && (orbit || event.shiftKey) && camera.pitch > 0,
      bearing: camera.bearing, pitch: camera.pitch }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    const current = pixel(event)
    if (touches.has(event.pointerId)) touches.set(event.pointerId, current)
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()]
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (pinch.distance > 0) changeZoom(pinch.zoom * distance / pinch.distance / zoom, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
      return
    }
    if (!pointer || pointer.id !== event.pointerId) {
      if (event.pointerType !== 'touch') inspect(current)
      return
    }
    if (Math.hypot(current[0] - pointer.start[0], current[1] - pointer.start[1]) < 5 && !pointer.moved) return
    pointer.moved = true
    if (pointer.orbit) {
      camera.bearing = (pointer.bearing + (current[0] - pointer.start[0]) * .48) % 360
      camera.pitch = Math.min(74, Math.max(16, pointer.pitch - (current[1] - pointer.start[1]) * .28))
      onPitch(camera.pitch)
      requestPaint()
      return
    }
    const from = pointer.projection.unproject(pointer.start)
    const to = pointer.projection.unproject(current)
    camera.center = pointer.center.map((value, i) => value + from[i] - to[i])
    requestPaint()
  })
  function releaseTouch(event) {
    touches.delete(event.pointerId)
    if (touches.size < 2) pinch = null
  }
  canvas.addEventListener('pointerup', event => {
    releaseTouch(event)
    if (!pointer || pointer.id !== event.pointerId) return
    if (!pointer.moved) {
      const position = pixel(event)
      const edge = nearestEdge(position, layers.edges ?? [], projection.project)
      const start = layers.vertices?.[0]?.geometry.coordinates
      const closes = interaction === 'draw' && start && layers.vertices.length >= 3 &&
        Math.hypot(...projection.project(start).map((v, i) => v - position[i])) <= 14
      onPoint(projection.unproject(position), { edge, closes })
    }
    pointer = null
  })
  canvas.addEventListener('pointercancel', event => { pointer = null; releaseTouch(event) })
  canvas.addEventListener('pointerleave', () => {
    pointerPreview = null
    requestPaint()
    onInspect?.(null)
  })
  canvas.addEventListener('wheel', event => {
    event.preventDefault()
    changeZoom(Math.exp(-event.deltaY * .0015), pixel(event))
  }, { passive: false })

  function changeZoom(factor, anchor) {
    const oldZoom = zoom
    zoom = Math.min(10, Math.max(.15, zoom * factor))
    if (anchor && oldZoom !== zoom) {
      const around = siteProjection({ ...camera, scale: camera.scale * zoom / oldZoom })
      const before = projection.unproject(anchor)
      const after = around.unproject(anchor)
      camera.center = camera.center.map((value, i) => value + before[i] - after[i])
    }
    requestPaint()
  }
  canvas.addEventListener('keydown', event => {
    const move = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] }[event.key]
    if (move) camera.center = projection.unproject([camera.width / 2 + move[0], camera.height / 2 + move[1]])
    else if (event.key === '+' || event.key === '=') changeZoom(1.25)
    else if (event.key === '-') changeZoom(.8)
    else return
    event.preventDefault()
    requestPaint()
  })
  function easeTo(values) {
    if (values.center) camera.center = [...values.center]
    if (values.bearing !== undefined) camera.bearing = values.bearing
    if (values.pitch !== undefined) camera.pitch = values.pitch
    if (values.zoom !== undefined) zoom = 1
    onPitch(camera.pitch)
    requestPaint()
  }
  function fitPoints(points, keepPitch = false) {
    const bounds = points.reduce((box, [lng, lat]) => [
      Math.min(box[0], lng), Math.min(box[1], lat), Math.max(box[2], lng), Math.max(box[3], lat),
    ], [Infinity, Infinity, -Infinity, -Infinity])
    const middle = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
    const scale = metresPerDegree(middle[1])
    const metres = Math.max((bounds[2] - bounds[0]) * scale.longitude, (bounds[3] - bounds[1]) * scale.latitude, 1)
    zoom = Math.min(10, Math.max(.15, Math.min(camera.width, camera.height) * .65 / (metres * camera.scale / zoom)))
    easeTo({ center: middle, ...(keepPitch ? {} : { pitch: 0, bearing: 0 }) })
  }
  function addHandle(element, point, onMove) {
    let coordinate = point
    const handle = {
      position() {
        const [x, y] = projection.project(coordinate)
        element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
      },
      remove() { handles.delete(handle); element.remove() },
      getPoint() { return coordinate },
      setPoint(next) { coordinate = next; handle.position() },
    }
    element.addEventListener('pointerdown', event => {
      event.stopPropagation()
      element.setPointerCapture(event.pointerId)
    })
    element.addEventListener('pointermove', event => {
      if (!element.hasPointerCapture(event.pointerId)) return
      handle.setPoint(projection.unproject(pixel(event)))
      onMove(handle.getPoint())
    })
    container.append(element)
    handles.add(handle)
    handle.position()
    return handle
  }

  requestPaint()
  return {
    setBuildings(next) { buildings = next; requestPaint() },
    setDisplay(next) { display = next; requestPaint() },
    setOrbit(enabled) { orbit = enabled },
    setOverlap(ids) { overlapIds = new Set(ids); requestPaint() },
    setInteraction(mode) {
      interaction = mode
      canvas.style.cursor = mode === 'draw' ? 'crosshair' : ''
      pointerPreview = null
      onInspect?.(null)
      requestPaint()
    },
    setFeatures(id, features) { layers[id] = features; requestPaint() },
    getCanvas: () => canvas,
    getPitch: () => camera.pitch,
    easeTo, fitPoints, addHandle,
    north: () => easeTo({ bearing: 0 }),
    rotate: () => easeTo({ bearing: camera.bearing + 45 }),
    reset: () => easeTo({ center: initialCenter, zoom: 1, pitch, bearing }),
    zoomIn: () => changeZoom(1.25),
    zoomOut: () => changeZoom(.8),
  }
}
