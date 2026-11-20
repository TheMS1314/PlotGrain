import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixture.js'
import { workspaceApi } from '../../worker/workspaces.js'
import { testDatabase } from '../../worker/sqlite-test-db.js'

async function mountApi(context, user, dropResponse) {
  const db = testDatabase()
  await context.route('**/api/**', async route => {
    const request = route.request()
    const headers = await request.allHeaders()
    if (user) {
      headers['oai-authenticated-user-id'] = user
      headers['oai-authenticated-user-email'] = user + '@example.test'
    }
    const result = await workspaceApi(new Request(request.url(), {
      method: request.method(), headers,
      ...(request.postData() !== null && { body: request.postData() }),
    }), db)
    if (dropResponse?.(request, result)) return route.abort('connectionreset')
    await route.fulfill({ status: result.status, contentType: 'application/json', body: await result.text() })
  })
  return db
}

test('sign-in uses the hosted account route', async ({ context, page, site }) => {
  await mountApi(context, null)
  await page.goto(site.origin + '/projects/')
  const signIn = page.getByRole('link', { name: 'Sign in with ChatGPT' })
  await expect(signIn).toHaveAttribute('href', '/signin-with-chatgpt?return_to=%2Fprojects%2F')
  await expect(signIn).toHaveAttribute('target', '_top')
  await expect(page.getByRole('button', { name: 'Add customer' })).toBeHidden()
  await page.getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(signIn).toHaveAttribute('href', '/signin-with-chatgpt?return_to=%2Fprofile%2F')
  await expect(signIn).toHaveAttribute('target', '_top')
  await expect(page.getByLabel('Display name')).toBeHidden()
})

test('landing profile shows the signed-in details and remembers the display name', async ({ context, page, site }) => {
  await mountApi(context, 'tester')
  await page.goto(site.origin + '/?layout=review')
  await page.getByRole('banner').getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(page).toHaveURL(/\/profile\/$/)
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible()
  await expect(page.getByText('tester@example.test', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign out' })).toHaveAttribute('target', '_top')
  await expect(page.getByRole('link', { name: 'Sign in with ChatGPT' })).toBeHidden()
  await expect(page.getByText('Saved study versions will appear here.')).toBeVisible()
  await page.getByLabel('Display name').fill('Meer · มีร์')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Display name')).toHaveValue('Meer · มีร์')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth)
  )
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
  await page.getByRole('banner').getByRole('link', { name: 'Customer workspaces' }).click()
  await expect(page.locator('#account')).toHaveText('Signed in as Meer · มีร์ · tester@example.test')
  expect(site.errors).toEqual([])
})

test('signing in reopens the requested historical study', async ({ context, page, site }) => {
  await mountApi(context, null)
  await page.route('**/api/auth/options', route => route.fulfill({ json: { emailPassword: true } }))
  await page.route('**/api/auth/sign-in/email', route => route.fulfill({ json: { ok: true } }))
  const path = '/study/?saved=9f9d2206-d90c-4126-8859-9ba43a947b84&version=4'
  await page.goto(site.origin + path)
  await page.getByRole('link', { name: 'Sign in to open study' }).click()
  await expect(page).toHaveURL(site.origin + '/sign-in/?return=' + encodeURIComponent(path))
  await page.getByLabel('Email address', { exact: true }).fill('customer@example.test')
  await page.getByLabel('Password', { exact: true }).fill('Valid test password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(site.origin + path)
})

test('a conflicting cloud save leaves edits available to export', async ({ context, page, site }) => {
  const db = await mountApi(context, 'tester')
  await page.goto(site.origin + '/projects/')
  await page.getByLabel('Customer name', { exact: true }).fill('Parkside')
  await page.getByRole('button', { name: 'Add customer' }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Bang Son')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByLabel('Study name', { exact: true }).fill('Conflict test')
  await page.getByRole('button', { name: 'Create study' }).click()
  await expect(page.locator('#saved-study-message')).toHaveText('Conflict test · New study')
  const study = new URL(page.url()).searchParams.get('saved')
  db.raw.prepare('UPDATE studies SET head = 1 WHERE id = ?').run(study)
  await page.locator('#study-tools summary').click()
  await page.getByRole('button', { name: 'Save project version' }).click()
  await page.getByLabel('Version name', { exact: true }).fill('My edits')
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  await expect(page.getByText('Your edits are still open in this tab.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open latest version in a new tab' })).toHaveAttribute('target', '_blank')
  await page.getByRole('button', { name: 'Export my edits' }).click()
  const exportDialog = page.locator('#export-dialog')
  await expect(exportDialog).toBeVisible()
  const payload = JSON.parse(await exportDialog.locator('#export-preview').inputValue())
  expect(payload.type).toBe('FeatureCollection')
  expect(payload.features[0].geometry.type).toBe('Polygon')
})

test('record names update, persist and reject a stale rename', async ({ context, page, site }) => {
  test.setTimeout(60000)
  const db = await mountApi(context, 'tester')
  const rename = async (button, value) => {
    await page.getByRole('button', { name: button, exact: true }).click()
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(value)
    await page.getByRole('button', { name: 'Save name', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  await page.goto(site.origin + '/projects/')
  await page.getByLabel('Customer name', { exact: true }).fill('Original customer')
  await page.getByRole('button', { name: 'Add customer' }).click()
  await rename('Rename customer', 'Parkside')
  await expect(page.getByRole('heading', { name: 'Parkside', exact: true })).toBeVisible()
  await page.getByLabel('Project name', { exact: true }).fill('Original project')
  await page.getByRole('button', { name: 'Create project' }).click()
  await rename('Rename project', 'Bang Son')
  await page.getByLabel('Topic', { exact: true }).fill('Original discussion')
  await page.getByRole('button', { name: 'Start thread' }).click()
  await rename('Rename discussion', 'Road access review')
  await expect(page.getByRole('heading', { name: 'Road access review' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Road access review' })).toBeVisible()

  await page.getByRole('button', { name: 'Rename project', exact: true }).click()
  const key = new URL(page.url()).searchParams.get('project')
  db.raw.prepare("UPDATE projects SET name = 'Concurrent revision' WHERE id = ?").run(key)
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('My old revision')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(page.getByText('The name changed while you were editing.', { exact: false })).toBeVisible()
  expect(db.raw.prepare('SELECT name FROM projects WHERE id = ?').get(key).name).toBe('Concurrent revision')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rename project', exact: true })).toBeFocused()
})

test('customer workspace keeps links and study history through reloads and a lost save response', async ({ context, page, site }) => {
  test.setTimeout(60000)
  let dropNextSave = true
  const db = await mountApi(context, 'tester', (request, result) => {
    if (!dropNextSave || request.method() !== 'POST' || result.status !== 201 || !request.url().endsWith('/versions')) return false
    dropNextSave = false
    return true
  })
  await page.goto(site.origin + '/projects/')
  await expect(page.locator('#account')).toContainText('tester@example.test')
  await page.getByLabel('Customer name', { exact: true }).fill('Parkside Development')
  await page.getByRole('button', { name: 'Add customer' }).click()
  await expect(page.getByRole('heading', { name: 'Parkside Development' })).toBeVisible()

  await page.getByLabel('Project name', { exact: true }).fill('Bang Son')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'Bang Son', exact: true })).toBeVisible()
  await page.getByLabel('Topic', { exact: true }).fill('Road access')
  await page.getByRole('button', { name: 'Start thread' }).click()
  await expect(page.getByRole('heading', { name: 'Road access' })).toBeVisible()
  await page.getByLabel('Reply', { exact: true }).fill('Confirm the public right-of-way.')
  await page.getByRole('button', { name: 'Post reply' }).click()
  await expect(page.getByText('Confirm the public right-of-way.', { exact: true })).toBeVisible()
  const discussionURL = page.url()
  expect(new URL(discussionURL).searchParams.get('thread')).toBeTruthy()
  await page.reload()
  await expect(page.getByText('Confirm the public right-of-way.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Road access', exact: true })).toHaveAttribute('aria-current', 'page')
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])

  await page.getByLabel('Study name', { exact: true }).fill('Site feasibility')
  await page.getByRole('button', { name: 'Create study' }).click()
  await expect(page).toHaveURL(/\/study\/\?saved=/)
  await expect(page.locator('#saved-study-message')).toHaveText('Site feasibility · New study')
  await expect(page.locator('#plate-cap')).toHaveText('578.4 m²')
  await page.locator('#study-tools summary').click()
  await page.getByRole('button', { name: 'Save project version' }).click()
  await page.getByLabel('Version name', { exact: true }).fill('First client review')
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  await expect(page.getByText('The save could not be confirmed.', { exact: false })).toBeVisible()
  const committed = JSON.parse(db.raw.prepare('SELECT snapshot FROM study_versions').get().snapshot)
  await page.locator('#slice-height').evaluate((slider, previous) => {
    slider.value = previous === 0 ? '1' : '0'
  }, committed.slice)
  expect(Number(await page.locator('#slice-height').inputValue())).not.toBe(committed.slice)
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  await expect(page.locator('#saved-study-message')).toHaveText('Site feasibility · Saved v1')
  expect(db.raw.prepare('SELECT count(*) AS count FROM study_versions').get().count).toBe(1)
  await page.locator('#slice-height').evaluate((slider, previous) => { slider.value = String(previous) }, committed.slice)
  await page.reload()
  await expect(page.locator('#saved-study-message')).toHaveText('Site feasibility · Saved v1')
  await expect(page.locator('#plate-cap')).toHaveText('578.4 m²')
  expect(await page.evaluate(() => sessionStorage.getItem('plotgrain.workspace-draft.v1'))).toBeNull()

  await page.locator('#return-to-project').click()
  await page.getByRole('link', { name: 'Site feasibility', exact: true }).click()
  await expect(page.getByText('v1 · First client review', { exact: true })).toBeVisible()
  const historyURL = page.url()
  expect(new URL(historyURL).searchParams.get('study')).toBeTruthy()
  await page.getByRole('link', { name: 'Road access', exact: true }).click()
  await expect(page.getByText('Confirm the public right-of-way.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(discussionURL)
  await page.goBack()
  await expect(page).toHaveURL(historyURL)
  await expect(page.getByText('v1 · First client review', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Open version', exact: true }).click()
  await expect(page.locator('#saved-study-message')).toHaveText('Site feasibility · Historical v1')
  await expect(page.locator('#show-save-version')).toBeHidden()
  await page.locator('#study-tools summary').click()
  await page.getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(page.getByText('Parkside Development · Bang Son · v1 First client review')).toBeVisible()
  await page.getByRole('link', { name: 'Site feasibility', exact: true }).click()
  await expect(page.locator('#saved-study-message')).toHaveText('Site feasibility · Saved v1')
  expect(site.errors.filter(message => !message.includes('ERR_CONNECTION_RESET'))).toEqual([])
})
