import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const design = read('../../DESIGN.md')
const frontMatter = design.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
assert.ok(frontMatter, 'DESIGN.md requires YAML front matter')
const tokens = parse(frontMatter)
const declarations = [...read('../../src/brand.css').matchAll(/(--[\w-]+):\s*([^;]+);/g)]
const css = Object.fromEntries(declarations.map(([, key, value]) => [key, value.trim()]))

for (const [name, expected] of Object.entries(tokens.colors)) {
  const variable = `--brand-${name}`
  assert.equal(css[variable], expected, `${variable} must match DESIGN.md`)
}
for (const [name, expected] of Object.entries(tokens.rounded)) {
  const variable = `--radius-${name}`
  const actual = css[variable]
  const magnitude = Number.parseFloat(actual)
  const pixels = actual?.endsWith('rem') ? magnitude * 16 : magnitude
  assert.equal(`${pixels}px`, expected, `${variable} must match DESIGN.md at the default root size`)
}
for (const component of Object.values(tokens.components)) {
  for (const value of Object.values(component)) {
    const reference = typeof value === 'string' && value.match(/^\{([\w.-]+)\}$/)?.[1]
    if (!reference) continue
    const resolved = reference.split('.').reduce((target, key) => target?.[key], tokens)
    assert.notEqual(resolved, undefined, `Unresolved design token: ${reference}`)
  }
}

function luminance(color) {
  assert.match(color, /^#[\da-f]{6}$/i)
  const channel = offset => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }
  return .2126 * channel(1) + .7152 * channel(3) + .0722 * channel(5)
}

for (const [foreground, background, minimum] of [
  ['ink', 'paper', 4.5], ['muted', 'paper', 4.5], ['surface', 'primary', 4.5],
  ['control-line', 'paper', 3], ['focus', 'surface', 3],
]) {
  const values = [foreground, background].map(key => luminance(tokens.colors[key]))
  const contrast = (Math.max(...values) + .05) / (Math.min(...values) + .05)
  assert.ok(contrast >= minimum, `${foreground} on ${background} has contrast ${contrast.toFixed(2)}:1`)
}
console.log('DESIGN.md colors, radii, component references, and key contrast pairs passed.')
