import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixture.js'
import { testDatabase } from '../../worker/sqlite-test-db.js'

test('signup checks confirmation and shows password strength and visibility', async ({ context, page, site }) => {
  const invitation = 'a'.repeat(64)
  const destination = '/projects/?customer=9f9d2206-d90c-4126-8859-9ba43a947b84'
  await context.route('**/api/auth/options', route => route.fulfill({ json: { emailPassword: true } }))
  let submitted = false
  await context.route('**/api/auth/sign-up/email', route => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: 'customer@example.test', password: 'Dusty violin - luminous airport', confirmation: 'Dusty violin - luminous airport',
      callbackURL: '/sign-in/?verified=1&return=' + encodeURIComponent(destination),
    })
    submitted = true
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto(site.origin + '/sign-in/?return=' + encodeURIComponent(destination) + '#invite=' + invitation)
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible()
  await page.getByLabel('Email address').fill('customer@example.test')
  const password = page.getByLabel('Password', { exact: true })
  await password.fill('passwordpassword')
  await expect(page.getByText('Choose a less predictable password.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Show password', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await password.fill('Dusty violin - luminous airport')
  await expect(page.getByText('Strong password', { exact: true })).toBeVisible()
  const confirmation = page.getByLabel('Confirm password', { exact: true })
  await confirmation.fill('different')
  await expect(page.getByText('Passwords must match.', { exact: true })).toBeVisible()
  await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: 'Show password confirmation' }).click()
  await expect(confirmation).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide password confirmation' }).click()
  await expect(confirmation).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Create account' }).click()
  expect(await confirmation.evaluate(input => input.validationMessage)).toBe('Passwords must match.')
  expect(submitted).toBe(false)
  await confirmation.fill('Dusty violin - luminous airport')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'you’ll receive a verification email' })).toBeVisible()
  await expect(page.getByText('reopen your original invitation link', { exact: false })).toBeVisible()
  expect(submitted).toBe(true)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth)
  )
  expect(site.errors).toEqual([])
})

test('unconfigured email sign-in shows the hosted sign-in option', async ({ context, page, site }) => {
  await context.route('**/api/auth/options', route => route.fulfill({ json: { emailPassword: false } }))
  await page.goto(site.origin + '/sign-in/')
  await expect(page.getByText('Email sign-in is being set up.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeHidden()
  await expect(page.getByRole('link', { name: 'Continue with ChatGPT' })).toHaveAttribute('target', '_top')
})

test('email signup, verification, password sign-in, sign-out, and recovery use the compiled Worker', async ({ context, page, site }) => {
  test.setTimeout(60000)
  site.setHostedUser(null)
  const db = testDatabase()
  site.setWorkerEnvironment({
    DB: db, PLOTGRAIN_AUTH_ORIGIN: site.origin, PLOTGRAIN_AUTH_SECRET: 'browser-test-only-4f20e4b033d6550a7d',
    PLOTGRAIN_AUTH_FROM: 'Plotgrain <auth@example.test>', RESEND_API_KEY: 'fixture-key',
  })
  const mail = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, options) => {
    if (input !== 'https://api.resend.com/emails') throw new Error('Only test email delivery is supported.')
    mail.push(JSON.parse(options.body))
    return Response.json({ id: 'test-email' })
  }
  const address = 'designer@example.test'
  const password = 'Dusty violin - luminous airport'
  const replacement = 'Marble kettle. Silent tropical sunrise'
  const signIn = async value => {
    await page.getByLabel('Email address').fill(address)
    await page.getByLabel('Password', { exact: true }).fill(value)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  const messageLink = index => mail[index].text.match(/https:\/\/[^\s]+/)[0]
  const follow = async url => {
    await page.evaluate(target => {
      const link = document.createElement('a')
      link.href = target
      link.textContent = 'Open fixture link'
      document.getElementById('main').append(link)
    }, url)
    await page.getByRole('link', { name: 'Open fixture link' }).click()
  }

  try {
    await page.goto(site.origin + '/sign-in/?return=%2Fprojects%2F')
    await page.getByRole('link', { name: 'Create an account' }).click()
    await page.getByLabel('Email address').fill(address)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await expect(page.getByText('Strong password', { exact: true })).toBeVisible()
    await page.getByLabel('Confirm password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('you’ll receive a verification email', { exact: false })).toBeVisible()
    expect(mail).toHaveLength(1)
    expect(mail[0].to).toEqual([address])
    expect(await context.cookies(site.origin)).toEqual([])

    await follow(messageLink(0))
    await expect(page.getByText('Email verified. You can sign in now.')).toBeVisible()
    await signIn(password)
    await expect(page).toHaveURL(site.origin + '/projects/')
    await expect(page.getByText('Signed in as ' + address)).toBeVisible()
    const session = (await context.cookies(site.origin)).find(cookie => cookie.name === '__Secure-plotgrain.session_token')
    expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax' })
    await page.getByRole('link', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(site.origin + '/sign-in/')
    await follow(site.origin + '/profile/')
    await expect(page).toHaveURL(site.origin + '/sign-in/')

    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await page.getByLabel('Email address').fill(address)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText('you’ll receive a reset link', { exact: false })).toBeVisible()
    expect(mail).toHaveLength(2)
    await follow(messageLink(1))
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await page.getByLabel('Password', { exact: true }).fill(replacement)
    await page.getByLabel('Confirm password', { exact: true }).fill(replacement)
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByText('Password updated. Sign in with your new password.')).toBeVisible()
    await signIn(password)
    await expect(page.getByText('The email or password is incorrect.')).toBeVisible()
    await signIn(replacement)
    await expect(page).toHaveURL(site.origin + '/profile/')
    await expect(page.getByText(address, { exact: true })).toBeVisible()
    expect(site.errors.filter(message => !/^HTTP 401: \/api\/auth\/sign-in\/email$|^Failed to load resource:.*401/.test(message))).toEqual([])
  } finally {
    globalThis.fetch = originalFetch
    db.raw.close()
  }
})

test('email signup and repeat sign-in work without an email provider or ChatGPT', async ({ context, page, site }) => {
  test.setTimeout(60000)
  site.setHostedUser(null)
  const db = testDatabase()
  site.setWorkerEnvironment({
    DB: db, PLOTGRAIN_AUTH_ORIGIN: site.origin, PLOTGRAIN_AUTH_SECRET: 'independent-browser-fixture-secret-7120',
  })
  try {
    await page.goto(site.origin + '/sign-in/?mode=signup')
    await page.getByLabel('Email address').fill('independent@example.test')
    await page.getByLabel('Password', { exact: true }).fill('Dusty violin - luminous airport')
    await page.getByLabel('Confirm password', { exact: true }).fill('Dusty violin - luminous airport')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(site.origin + '/profile/')
    await expect(page.getByText('independent@example.test', { exact: true })).toBeVisible()
    await expect(page.getByText('Email address · unverified')).toBeVisible()
    await page.getByRole('banner').getByRole('link', { name: 'Customer workspaces' }).click()
    await page.getByLabel('Customer name', { exact: true }).fill('Independent account')
    await page.getByRole('button', { name: 'Add customer' }).click()
    await expect(page.getByRole('heading', { name: 'Independent account' })).toBeVisible()
    await page.getByRole('link', { name: 'Sign out', exact: true }).click()
    await expect(page.getByLabel('Email address')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeHidden()
    await page.getByLabel('Email address').fill('independent@example.test')
    await page.getByLabel('Password', { exact: true }).fill('Dusty violin - luminous airport')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByText('independent@example.test', { exact: true })).toBeVisible()
    await page.getByRole('banner').getByRole('link', { name: 'Customer workspaces' }).click()
    await expect(page.getByRole('link', { name: 'Independent account', exact: true })).toBeVisible()
  } finally { db.raw.close() }
})
