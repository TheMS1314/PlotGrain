import { test as base } from '@playwright/test'
import worker from '../../dist/server/index.js'

const origin = 'https://plotgrain.test'
// Serve the compiled Worker and its response headers in an isolated Chromium context.
export const test = base.extend({
  site: async ({ context, page }, use) => {
    let hostedUser = 'design-fixture'
    let env = {}
    const errors = []
    const files = new Map()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) {
        errors.push(`Unexpected network request: ${url.origin}`)
        await route.abort()
        return
      }
      const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname
      const method = route.request().method()
      const headers = new Headers(await route.request().allHeaders())
      headers.delete('oai-authenticated-user-id')
      headers.delete('oai-authenticated-user-email')
      if (hostedUser) {
        headers.set('oai-authenticated-user-id', hostedUser)
        headers.set('oai-authenticated-user-email', hostedUser + '@example.test')
      }
      const payload = route.request().postDataBuffer()
      const response = await worker.fetch(new Request(url, { method, headers, ...(payload && { body: payload }) }), env)
      const body = Buffer.from(await response.arrayBuffer())
      if (response.status >= 400) errors.push(`HTTP ${response.status}: ${pathname}`)
      files.set(pathname, body.length)
      const output = Object.fromEntries(response.headers)
      const cookies = response.headers.getSetCookie()
      if (cookies.length) output['set-cookie'] = cookies.join('\n')
      await route.fulfill({ status: response.status, body, headers: output })
    })
    await use({ origin, errors, files, setHostedUser: user => { hostedUser = user }, setWorkerEnvironment: config => { env = config } })
  },
})

export { expect } from '@playwright/test'
