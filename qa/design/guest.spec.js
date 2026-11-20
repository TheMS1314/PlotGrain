import { test, expect } from './fixture.js'
import worker from '../../dist/server/index.js'
import { signInDestination } from '../../src/sign-in-links.js'

test('a guest explores the example and signs in only when opening the editor', async ({ page, site }) => {
  site.setHostedUser(null)
  await page.route('**/api/auth/options', route => route.fulfill({ json: { emailPassword: true } }))
  await page.route('**/api/auth/sign-in/email', route => {
    site.setHostedUser('returning-visitor')
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto(site.origin + '/?layout=review')
  await page.getByRole('link', { name: 'Explore the example' }).click()
  await page.getByRole('button', { name: 'Garden Court', exact: true }).click()
  await expect(page.locator('#demo-name')).toHaveText('Garden Court')
  await expect(page).toHaveURL(site.origin + '/?layout=review#preview')
  const open = page.getByRole('link', { name: 'Open in workspace', exact: true })
  const target = signInDestination(await open.getAttribute('href'))
  await open.click()
  await expect(page.getByText('Sign in to open your workspace.', { exact: false })).toBeVisible()
  const createAccount = page.getByRole('link', { name: 'Create an account', exact: true })
  expect(new URL(await createAccount.getAttribute('href'), site.origin).searchParams.get('return')).toBe(target)
  await page.getByLabel('Email address').fill('visitor@example.test')
  await page.getByLabel('Password', { exact: true }).fill('Example fixture password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(site.origin + target)
  await expect(page.locator('#site-map')).toBeVisible()
  expect(site.errors).toEqual([])
})

test('direct page requests, aliases, and expired sessions enforce the gate', async ({ page, site }) => {
  site.setHostedUser(null)
  const token = 'a'.repeat(64)
  await page.goto(site.origin)
  const invitation = page.getByRole('link', { name: 'Customer workspaces' })
  await invitation.evaluate((link, token) => { link.hash = 'invite=' + token }, token)
  await invitation.click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#invite=' + token)
  await expect(page.getByRole('link', { name: 'Continue with ChatGPT' })).toHaveAttribute('href',
    '/signin-with-chatgpt?return_to=' + encodeURIComponent('/projects/#invite=' + token))

  for (const path of ['/study/', '/study/index.html', '/projects/', '/projects/index.html', '/profile/', '/profile/index.html']) {
    const response = await worker.fetch(new Request(site.origin + path, { method: 'HEAD' }), {})
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toMatch(/^\/sign-in\//)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).toBe('')
  }
  const expired = await worker.fetch(new Request(site.origin + '/study/', {
    headers: {
      cookie: '__Secure-plotgrain.session_token=expired',
      'oai-authenticated-user-id': 'another-fixture',
      'oai-authenticated-user-email': 'fixture@example.test',
    },
  }), {})
  expect(expired.status).toBe(303)
  expect(expired.headers.get('set-cookie')).toContain('Max-Age=0')
  const anonymous = await worker.fetch(new Request(site.origin + '/api/customers'), {})
  expect(anonymous.status).toBe(401)
  const external = await worker.fetch(new Request(site.origin + '/study/?return=https%3A%2F%2Felsewhere.test%2F'), {})
  expect(new URL(external.headers.get('location'), site.origin).searchParams.get('return')).toBe('/study/')
})
