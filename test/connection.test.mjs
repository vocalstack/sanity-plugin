import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

import { accountLabel, workspaceOf } from '../dist/api.js'
import { CONNECTION_CACHE_MS, createVocalStackHandler } from '../dist/server/index.js'

const API = 'https://api.vocalstack.test'
const SECRET = 's'.repeat(43)
const WORKSPACE = { iconUrl: '/workspace-icons/ws-1?v=3&exp=1800000000&sig=abc', id: 'ws-1', name: 'Acme studio', personal: false }

let me
let meCalls
let transcriptionStatus
let apiPaths
const realFetch = globalThis.fetch

beforeEach(() => {
  me = { key: { name: 'Sanity key' }, principal: { name: 'Sanity key' }, workspace: WORKSPACE }
  meCalls = 0
  transcriptionStatus = 404
  apiPaths = []
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-12T09:00:00Z') })
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    // The Studio session: always fresh.
    if (url.pathname.includes('/data/query/')) return Response.json({ result: new Date(Date.now()).toISOString() })
    assert.equal(url.origin, API)
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer vs_key_test')
    if (url.pathname === '/v1/me') {
      meCalls++
      return Response.json(me)
    }
    apiPaths.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (url.pathname.startsWith('/v1/transcriptions/tx-done/')) {
      if (url.pathname.endsWith('/job')) return Response.json({ progress: { pct: 100 }, state: 'done', transcriptionId: 'tx-done' })
      if (url.pathname.endsWith('/transcript')) return Response.json({ lang: 'en', segments: [], sentences: [{ end: 1.5, sentenceId: 0, speaker: 0, start: 0, text: ' Hello there. ' }] })
    }
    if (url.pathname.startsWith('/v1/transcriptions/')) return Response.json({ error: { code: 'not_found', message: 'transcription not found' } }, { status: transcriptionStatus })
    return Response.json({ error: { code: 'not_found', message: 'no such route' } }, { status: 404 })
  }
})

afterEach(() => {
  mock.timers.reset()
  globalThis.fetch = realFetch
})

const handler = () => createVocalStackHandler({ apiKey: 'vs_key_test', apiURL: API, sanity: { dataset: 'production', projectId: 'p1', token: 'robot' } })
const ask = async (h, path, method = 'GET') => {
  const res = await h(new Request(`https://www.example.com/api/vocalstack${path}`, { headers: { authorization: `Bearer ${SECRET}` }, method }))
  return { body: await res.json(), status: res.status }
}

test('the connection names the workspace, its icon an absolute link on the API', async () => {
  const { body, status } = await ask(handler(), '/connection')
  assert.equal(status, 200)
  assert.deepEqual(body, {
    account: 'Acme studio',
    connected: true,
    workspace: { iconUrl: `${API}/workspace-icons/ws-1?v=3&exp=1800000000&sig=abc`, id: 'ws-1', name: 'Acme studio', personal: false },
  })
})

test('a workspace with no icon, and the personal one', async () => {
  me.workspace = { iconUrl: null, id: 'ws-2', name: 'Personal workspace', personal: true }
  const { body } = await ask(handler(), '/connection')
  assert.deepEqual(body.workspace, { iconUrl: null, id: 'ws-2', name: 'Personal workspace', personal: true })
  assert.equal(body.account, 'Personal workspace')
})

test('an older VocalStack says no workspace: the answer is what it was', async () => {
  delete me.workspace
  const { body, status } = await ask(handler(), '/connection')
  assert.equal(status, 200)
  assert.deepEqual(body, { account: 'Sanity key', connected: true })
})

test('the connection is kept for a few minutes, then asked again', async () => {
  const h = handler()
  await ask(h, '/connection')
  me.workspace = { ...WORKSPACE, iconUrl: '/workspace-icons/ws-1?v=4&exp=1900000000&sig=def', name: 'Acme radio' }
  mock.timers.tick(CONNECTION_CACHE_MS - 1000)
  assert.equal((await ask(h, '/connection')).body.workspace.name, 'Acme studio')
  assert.equal(meCalls, 1)

  mock.timers.tick(1000)
  const { body } = await ask(h, '/connection')
  assert.equal(meCalls, 2)
  assert.equal(body.account, 'Acme radio')
  assert.equal(body.workspace.iconUrl, `${API}/workspace-icons/ws-1?v=4&exp=1900000000&sig=def`)
  assert.ok(CONNECTION_CACHE_MS >= 60_000 && CONNECTION_CACHE_MS <= 10 * 60_000)
})

test('each handler keeps its own connection', async () => {
  await ask(handler(), '/connection')
  await ask(handler(), '/connection')
  assert.equal(meCalls, 2)
})

test('a transcription the key’s workspace does not have: a plain sentence, for the job and for Stop', async () => {
  const h = handler()
  for (const [path, method] of [['/transcriptions/tx-1/job', 'GET'], ['/transcriptions/tx-1/stop', 'POST']]) {
    const { body, status } = await ask(h, path, method)
    assert.equal(status, 404)
    assert.equal(body.code, 'not_in_workspace')
    assert.match(body.error, /not in the workspace VocalStack is connected to now/)
    assert.match(body.error, /Transcribe the audio again/)
  }
})

test('other refusals on a transcription keep VocalStack’s own message', async () => {
  transcriptionStatus = 403
  const { body, status } = await ask(handler(), '/transcriptions/tx-1/job')
  assert.equal(status, 403)
  assert.equal(body.code, 'not_found')
  assert.equal(body.error, 'transcription not found')
})

test('a job is followed and stopped by its transcription id', async () => {
  const h = handler()
  const { body, status } = await ask(h, '/transcriptions/tx-done/job')
  assert.equal(status, 200)
  assert.equal(body.kind, 'done')
  assert.equal(body.save.transcript, 'Hello there.')
  assert.equal(body.save.language, 'en')
  await ask(h, '/transcriptions/tx-1/stop', 'POST')
  assert.deepEqual(apiPaths, ['GET /v1/transcriptions/tx-done/job', 'GET /v1/transcriptions/tx-done/transcript', 'POST /v1/transcriptions/tx-1/stop'])
})

test('the old recording routes are gone', async () => {
  const { body, status } = await ask(handler(), '/recordings/rec-1/job')
  assert.equal(status, 404)
  assert.equal(body.error, 'Not a VocalStack route.')
})

test('workspaceOf reads only a whole workspace, and only web links for the icon', () => {
  assert.equal(workspaceOf({}), undefined)
  assert.equal(workspaceOf({ workspace: null }), undefined)
  assert.equal(workspaceOf({ workspace: { id: 'ws-1' } }), undefined)
  assert.equal(workspaceOf({ workspace: { id: 'ws-1', name: '  ' } }), undefined)
  assert.deepEqual(workspaceOf({ workspace: { id: 'ws-1', name: 'Acme' } }), { iconUrl: null, id: 'ws-1', name: 'Acme', personal: false })
  assert.equal(workspaceOf({ workspace: { ...WORKSPACE, iconUrl: 'javascript:alert(1)' } }).iconUrl, null)
  assert.equal(workspaceOf({ workspace: WORKSPACE }).iconUrl, `https://api.vocalstack.com${WORKSPACE.iconUrl}`)
  assert.equal(workspaceOf({ workspace: WORKSPACE }, 'http://127.0.0.1:8090').iconUrl, `http://127.0.0.1:8090${WORKSPACE.iconUrl}`)
  assert.equal(accountLabel({ principal: { name: 'Key name' } }), 'Key name')
})
