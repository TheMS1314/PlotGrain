import assert from 'node:assert/strict'
import test from 'node:test'
import { passwordSignInLink, signInDestination } from './sign-in-links.js'

const id = '9f9d2206-d90c-4126-8859-9ba43a947b84'

test('sign-in returns to a pinned study version and drops unrecognized parameters', () => {
  const destination = signInDestination(`/study/?saved=${id}&version=4&layout=review&unexpected=value`)
  assert.equal(destination, `/study/?saved=${id}&version=4&layout=review`)
  const link = new URL(passwordSignInLink(destination, { verified: '1' }), 'https://plotgrain.test')
  assert.equal(link.searchParams.get('return'), destination)
  assert.equal(link.searchParams.get('verified'), '1')
  assert.equal(signInDestination('/study/?saved=invalid'), '/study/')
  for (const path of ['//elsewhere.test/projects/', '/\\elsewhere.test/projects/', 'https://elsewhere.test/profile/']) {
    assert.equal(signInDestination(path), '/profile/')
  }
})

test('sign-in preserves a workspace layout, example and section', () => {
  assert.equal(signInDestination('/study/'), '/study/')
  assert.equal(signInDestination('/study/?layout=standard&view=compare&example=narrow#zone-rules'),
    '/study/?layout=standard&view=compare&example=narrow#zone-rules')
  assert.equal(passwordSignInLink('/study/?view=compare'), '/sign-in/?return=%2Fstudy%2F%3Fview%3Dcompare')
})

test('invitation tokens stay in browser fragments and are excluded from email callbacks', () => {
  const hash = '#invite=' + 'a'.repeat(64)
  const destination = signInDestination('/projects/?customer=' + id, hash)
  const link = new URL(passwordSignInLink(destination), 'https://plotgrain.test')
  assert.equal(link.hash, hash)
  assert.equal(link.searchParams.get('return'), '/projects/?customer=' + id)
  assert.ok(!passwordSignInLink(destination, { mode: 'reset' }, false).includes('invite'))
  assert.equal(signInDestination('/projects/', '#invite=invalid'), '/projects/')
})

test('sign-in preserves a nested project link and drops panels without their parent', () => {
  const href = '/projects/?customer=' + id + '&project=' + id + '&thread=' + id
  assert.equal(signInDestination(href), href)
  assert.equal(signInDestination('/projects/?customer=' + id + '&thread=' + id), '/projects/?customer=' + id)
})
