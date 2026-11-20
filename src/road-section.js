// A perpendicular cut through the stated road and plot frontage. Screen
// coordinates are deliberately separate from the parcel plan and geometry engine.
export function roadSectionAt(width, sliceHeight, requirements) {
  const firstPermitted = Math.max(requirements.roadSetback, requirements.heightSetback, requirements.boundaryInset)
  return { farEdge: -width, nearEdge: 0, firstPermitted,
    roadPlaneHeight: distance => Math.max(0, 2 * (distance + width)),
    distanceRight: Math.max(8, firstPermitted + 4), heightTop: Math.max(24, sliceHeight + 3),
  }
}

export function drawRoadSection(canvas, { width, height, requirements }) {
  const section = roadSectionAt(width, height, requirements)
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  const left = 20
  const right = w - 20
  const grade = h - 30
  const top = 14
  const x = d => left + (d - section.farEdge) / (section.distanceRight - section.farEdge) * (right - left)
  const y = z => grade - z / section.heightTop * (grade - top)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#eceee7'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#d6dcd3'
  ctx.fillRect(x(section.farEdge), grade - 5, x(0) - x(section.farEdge), 10)
  function line(x1, y1, x2, y2, color, weight = 1, dash = []) {
    ctx.strokeStyle = color
    ctx.lineWidth = weight
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
  }
  const planeEnds = Math.min(section.distanceRight, section.heightTop / 2 - width)
  line(left, grade, right, grade, '#72847a')
  line(x(section.farEdge), grade, x(planeEnds), y(section.roadPlaneHeight(planeEnds)), '#6b8072', 1.4)
  line(x(0), grade, x(0), top, '#a3774d', 1.1, [4, 3])
  line(x(section.firstPermitted), grade, x(section.firstPermitted), y(height), '#17614a', 1.2, [3, 2])
  line(x(section.firstPermitted), y(height), right, y(height), '#17614a', 3)
  ctx.fillStyle = '#314e42'
  ctx.font = '600 10px system-ui'
  ctx.textAlign = 'left'
  ctx.fillText('Road', left, grade + 17)
  ctx.textAlign = 'right'
  ctx.fillText(`${height} m section`, right, Math.max(12, y(height) - 5))
  ctx.fillText('Plot', right, grade + 17)
  canvas.setAttribute('aria-label',
    `Road section at ${height} metres. The modeled section starts ${section.firstPermitted.toFixed(1)} metres behind the road edge.`)
}
