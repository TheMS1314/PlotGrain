import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, cp, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { rolldown } from 'rolldown'

const dir = 'dist/server'
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.png': 'image/png', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}
const assets = {}
for (const file of await readdir('dist', { recursive: true, withFileTypes: true })) {
  if (!file.isFile()) continue
  const path = join(file.parentPath, file.name)
  if (path.startsWith(dir + '/')) continue
  const type = types[extname(path)]
  if (!type) throw new Error(`No content type for ${path}`)
  const bytes = await readFile(path)
  const tag = '"' + createHash('sha256').update(bytes).digest('hex').slice(0, 24) + '"'
  assets['/' + path.slice('dist/'.length)] = [type, bytes.toString('base64'), tag]
}
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'site-assets.js'), 'export default ' + JSON.stringify(assets))
const worker = await rolldown({
  input: 'worker/index.js', platform: 'neutral', treeshake: true,
  resolve: { mainFields: ['module', 'main'], conditionNames: ['worker', 'import', 'default'] },
})
await worker.write({ file: join(dir, 'index.js'), format: 'esm', minify: true, codeSplitting: false })
await rm(join(dir, 'site-assets.js'))
await cp('drizzle', join(dir, 'drizzle'), { recursive: true })
