/**
 * A small fake of Sanity's Content Lake: just what a Sanity Studio needs to boot, sign
 * in, query, listen, mutate and upload a file, for the e2e test. Not a Sanity API in
 * general: anything it does not know it logs and answers 404.
 *
 * One port serves every host the Studio derives from `apiHost` (the global API and
 * `<projectId>.<host>`), and a CDN path for file assets.
 *
 *   node e2e/fake-lake.mjs            # PORT=8711, TOKEN=…, LOG=1
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Mutation } from '@sanity/mutator'
import { evaluate, parse } from 'groq-js'

/** HTTPS + HTTP/2, for the browser: the Studio keeps several listeners open, more than HTTP/1.1's six connections per host. */
const PORT = Number(process.env.PORT ?? 8711)
/** Plain HTTP, the same API, for the handler (Node) and the file CDN. */
const PLAIN_PORT = Number(process.env.PLAIN_PORT ?? PORT + 2)
const PROJECT = process.env.PROJECT_ID ?? 'vse2e'
const DATASET = process.env.DATASET ?? 'e2e'
/** The editor's token (what a Sanity login would give the Studio). */
const EDITOR_TOKEN = process.env.EDITOR_TOKEN ?? 'e2e-editor-token-0000000000000000000000'
/** The handler's read token (a Viewer robot). */
const ROBOT_TOKEN = process.env.ROBOT_TOKEN ?? 'e2e-robot-token-00000000000000000000000'
/** Where file assets are served from (the CDN). */
const PUBLIC_BASE = process.env.PUBLIC_BASE ?? `http://127.0.0.1:${PLAIN_PORT}`
const LOG = process.env.LOG !== '0'

const EDITOR = {
  id: 'pE2eEditor',
  name: 'E2E Editor',
  email: 'editor@example.com',
  profileImage: null,
  provider: 'sanity',
  role: 'administrator',
  roles: [{ name: 'administrator', title: 'Administrator', description: 'Full access' }],
}
const ROBOT = { id: 'pE2eRobot', name: 'VocalStack handler', provider: 'robot', role: 'viewer', roles: [{ name: 'viewer', title: 'Viewer' }] }

const log = (...args) => LOG && console.log(new Date().toISOString().slice(11, 23), ...args)

// ---------------------------------------------------------------- the dataset

/** id → document */
const docs = new Map()
/** asset path → { bytes, type } */
const files = new Map()
const rev = () => randomBytes(11).toString('base64url')

const seed = (doc) => {
  const now = new Date().toISOString()
  docs.set(doc._id, { _createdAt: now, _updatedAt: now, _rev: rev(), ...doc })
}
seed({ _id: 'episode-42', _type: 'episode', title: 'Episode 42' })

const isDraft = (id) => id.startsWith('drafts.')
const isVersion = (id) => id.startsWith('versions.')
const publishedId = (id) => id.replace(/^drafts\./, '').replace(/^versions\.[^.]+\./, '')

/** The documents a perspective sees. */
function view(perspective) {
  const all = [...docs.values()]
  const p = Array.isArray(perspective) ? perspective : perspective ? String(perspective).split(',') : ['raw']
  if (p[0] === 'raw') return all
  const published = all.filter((d) => !isDraft(d._id) && !isVersion(d._id))
  if (p[0] === 'published') return published
  // drafts / previewDrafts / a release stack: drafts win over published.
  const byId = new Map(published.map((d) => [d._id, d]))
  for (const d of all) if (isDraft(d._id)) byId.set(publishedId(d._id), { ...d, _id: publishedId(d._id), _originalId: d._id })
  return [...byId.values()]
}

async function runQuery(query, params, perspective, identity) {
  const tree = parse(query, { params })
  const value = await evaluate(tree, { dataset: view(perspective), identity, params })
  return value.get()
}

/** Whether a listener's query (a filter, `*[…]`) matches a document. */
async function matches(listener, doc) {
  if (!doc) return false
  try {
    const tree = parse(listener.query, { params: listener.params })
    const result = await (await evaluate(tree, { dataset: [doc], params: listener.params })).get()
    return Array.isArray(result) ? result.length > 0 : Boolean(result)
  } catch (err) {
    log('listen query failed', listener.query, err.message)
    return false
  }
}

// ---------------------------------------------------------------- listeners

const listeners = new Set()

async function broadcast(transactionId, changes, identity) {
  const timestamp = new Date().toISOString()
  for (const l of listeners) {
    const relevant = []
    for (const c of changes) if ((await matches(l, c.before)) || (await matches(l, c.after))) relevant.push(c)
    relevant.forEach((c, i) => {
      const { _rev: _a, ...afterNoRev } = c.after ?? {}
      const { _rev: _b, ...beforeNoRev } = c.before ?? {}
      const event = {
        documentId: c.id,
        eventId: `${transactionId}#${c.id}`,
        identity,
        previousRev: c.before?._rev,
        resultRev: c.after?._rev ?? transactionId,
        timestamp,
        transactionCurrentEvent: i + 1,
        transactionId,
        transactionTotalEvents: relevant.length,
        transition: !c.before ? 'appear' : !c.after ? 'disappear' : 'update',
        visibility: 'query',
      }
      if (l.includeMutations) event.mutations = c.mutations
      if (l.includeResult) event.result = c.after ?? undefined
      if (l.includePreviousRevision) event.previous = c.before ?? undefined
      // A Mendoza patch that is just the new value: op 0 is "Value".
      if (l.effectFormat === 'mendoza') event.effects = { apply: [0, c.after ? afterNoRev : null], revert: [0, c.before ? beforeNoRev : null] }
      l.send('mutation', event)
    })
  }
}

// ---------------------------------------------------------------- mutations

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

async function targetIds(selector) {
  if (selector.id) return [selector.id]
  if (selector.query) {
    const result = await runQuery(`${selector.query}._id`, selector.params ?? {}, 'raw')
    return Array.isArray(result) ? result : []
  }
  return []
}

const newId = (prefix = '') => prefix + randomBytes(12).toString('base64url').replace(/[-_]/g, 'x')

async function mutate(mutations, { transactionId = rev(), identity, dryRun = false } = {}) {
  const now = new Date().toISOString()
  /** id → { before, after, mutations } */
  const touched = new Map()
  const results = []
  const current = (id) => (touched.has(id) ? touched.get(id).after : (docs.get(id) ?? null))
  const write = (id, after, m) => {
    const t = touched.get(id) ?? { before: docs.get(id) ?? null, mutations: [] }
    t.after = after
    t.mutations.push(m)
    touched.set(id, t)
  }

  for (const m of mutations) {
    const [kind] = Object.keys(m)
    const body = m[kind]
    if (kind === 'create' || kind === 'createIfNotExists' || kind === 'createOrReplace') {
      const doc = structuredClone(body)
      if (!doc._id || doc._id.endsWith('.')) doc._id = newId(doc._id ?? '')
      if (!doc._type) throw new HttpError(400, `${kind}: _type is required`)
      const existing = current(doc._id)
      if (kind === 'create' && existing) throw new HttpError(409, `Document by ID "${doc._id}" already exists`, { type: 'documentAlreadyExistsError' })
      if (kind === 'createIfNotExists' && existing) {
        results.push({ id: doc._id, operation: 'none' })
        continue
      }
      const after = { ...doc, _createdAt: doc._createdAt ?? existing?._createdAt ?? now, _updatedAt: now }
      write(doc._id, after, m)
      results.push({ id: doc._id, operation: existing ? 'update' : 'create' })
      continue
    }
    if (kind === 'delete') {
      for (const id of await targetIds(body)) {
        if (!current(id)) continue
        write(id, null, { delete: { id } })
        results.push({ id, operation: 'delete' })
      }
      continue
    }
    if (kind === 'patch') {
      const { id: _id, query: _q, params: _p, ifRevisionID, ...ops } = body
      for (const id of await targetIds(body)) {
        const doc = current(id)
        if (!doc) {
          if (body.id) throw new HttpError(404, `Document "${id}" not found`, { type: 'documentNotFoundError' })
          continue
        }
        if (ifRevisionID && ifRevisionID !== doc._rev) throw new HttpError(409, `Document "${id}" has unexpected revision ID ("${doc._rev}"), expected "${ifRevisionID}"`, { type: 'conflictError' })
        const after = new Mutation({ mutations: [{ patch: { id, ...ops } }] }).apply(structuredClone(doc))
        write(id, { ...after, _updatedAt: now }, { patch: { id, ...ops } })
        results.push({ id, operation: 'update' })
      }
      continue
    }
    throw new HttpError(400, `Unsupported mutation: ${kind}`)
  }

  const changes = [...touched.entries()].map(([id, t]) => ({ id, ...t, after: t.after ? { ...t.after, _rev: transactionId } : null }))
  if (!dryRun) {
    for (const c of changes) c.after ? docs.set(c.id, c.after) : docs.delete(c.id)
    void broadcast(transactionId, changes, identity)
  }
  return { changes, results, transactionId }
}

/**
 * The Actions API (Studio 4 commits through it): each action becomes mutations, one
 * transaction for the request.
 */
function actionMutations(actions) {
  const out = []
  /** What a document will be by the time this mutation runs, inside the request. */
  const pending = new Map()
  const state = (id) => (pending.has(id) ? pending.get(id) : (docs.get(id) ?? null))
  const draftOf = (publishedId) => `drafts.${publishedId}`
  for (const a of actions) {
    const type = a.actionType
    if (type === 'sanity.action.document.edit') {
      const draftId = a.draftId ?? draftOf(a.publishedId)
      if (!state(draftId)) {
        const base = state(a.publishedId)
        if (!base) throw new HttpError(409, `Cannot edit "${a.publishedId}": it has no draft or published version`, { type: 'actionError' })
        const { _rev, _updatedAt, ...copy } = base
        out.push({ create: { ...copy, _id: draftId } })
        pending.set(draftId, { ...copy, _id: draftId })
      }
      out.push({ patch: { id: draftId, ...a.patch } })
      continue
    }
    if (type === 'sanity.action.document.create' || type === 'sanity.action.document.version.create') {
      const attrs = a.attributes ?? a.document
      const id = attrs._id ?? draftOf(a.publishedId)
      if (state(id)) {
        if (a.ifExists === 'ignore') continue
        throw new HttpError(409, `Document "${id}" already exists`, { type: 'documentAlreadyExistsError' })
      }
      out.push({ create: { ...attrs, _id: id } })
      pending.set(id, attrs)
      continue
    }
    if (type === 'sanity.action.document.replaceDraft') {
      out.push({ createOrReplace: { ...a.attributes, _id: draftOf(a.publishedId) } })
      continue
    }
    if (type === 'sanity.action.document.publish') {
      const draftId = a.draftId ?? draftOf(a.publishedId)
      const draft = state(draftId)
      if (!draft) throw new HttpError(409, `There is no draft "${draftId}" to publish`, { type: 'actionError' })
      const { _rev, ...doc } = draft
      out.push({ createOrReplace: { ...doc, _id: a.publishedId } }, { delete: { id: draftId } })
      pending.set(a.publishedId, doc)
      pending.set(draftId, null)
      continue
    }
    if (type === 'sanity.action.document.unpublish') {
      const published = state(a.publishedId)
      if (published) {
        const { _rev, ...doc } = published
        out.push({ createIfNotExists: { ...doc, _id: a.draftId ?? draftOf(a.publishedId) } }, { delete: { id: a.publishedId } })
      }
      continue
    }
    if (type === 'sanity.action.document.discard' || type === 'sanity.action.document.version.discard') {
      out.push({ delete: { id: a.draftId ?? a.versionId } })
      continue
    }
    if (type === 'sanity.action.document.delete') {
      out.push({ delete: { id: a.publishedId } }, ...(a.includeDrafts ?? [draftOf(a.publishedId)]).map((id) => ({ delete: { id } })))
      continue
    }
    throw new HttpError(400, `The fake Content Lake does not know the action ${type}`, { type: 'actionError' })
  }
  return out
}

// ---------------------------------------------------------------- HTTP

const ACL = [{ filter: '_id in path("**")', permissions: ['history', 'read', 'update', 'create'] }]

const PROJECT_INFO = {
  id: PROJECT,
  displayName: 'VocalStack e2e',
  studioHost: null,
  isBlocked: false,
  isDisabled: false,
  isDisabledByUser: false,
  metadata: { color: '#2276fc', externalStudioHost: 'http://localhost:3711' },
  organizationId: 'oE2e',
  createdAt: '2026-01-01T00:00:00Z',
  features: [],
  pendingInvites: 0,
  members: [{ id: EDITOR.id, role: 'administrator', roles: EDITOR.roles, isRobot: false, isCurrentUser: true, createdAt: '2026-01-01T00:00:00Z' }],
}

function caller(req, url) {
  const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/)?.[1] ?? url.searchParams.get('token') ?? undefined
  if (auth === EDITOR_TOKEN) return EDITOR
  if (auth === ROBOT_TOKEN) return ROBOT
  return undefined
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

function paramsFrom(url) {
  const params = {}
  for (const [k, v] of url.searchParams) if (k.startsWith('$')) params[k.slice(1)] = JSON.parse(v)
  return params
}

async function serve(req, res) {
  const host = req.headers.host ?? req.headers[':authority']
  const url = new URL(req.url, `http://${host}`)
  const origin = req.headers.origin
  const cors = origin
    ? {
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': req.headers['access-control-request-headers'] ?? 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'access-control-allow-origin': origin,
        'access-control-max-age': '600',
        vary: 'origin',
      }
    : {}
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { ...cors, 'content-type': 'application/json', ...headers })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()

  // `/v2021-06-07/data/query/e2e` → ['data','query','e2e']
  const path = url.pathname.replace(/^\/v\d+(-\d\d-\d\d)?(?=\/)/, '').replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  const user = caller(req, url)
  // Optional services the Studio copes without: presence (a websocket), help, onboarding journeys.
  const optional = parts[0] === 'socket' || parts[0] === 'journey' || parts[0] === 'help' || parts[0] === 'intake'
  if (optional && parts[0] !== 'intake') return send(404, { error: 'Not in the fake' })
  if (!optional && !path.startsWith('/files/')) log(req.method, host, url.pathname + (url.search.length > 160 ? url.search.slice(0, 160) + '…' : url.search), user ? `(${user.id})` : '(anonymous)')

  try {
    // ---- the CDN: file assets are public, as on cdn.sanity.io
    if (parts[0] === 'files' && req.method === 'GET') {
      const file = files.get(parts.slice(1).join('/'))
      if (!file) return send(404, { error: 'Not found' })
      log('GET file', parts.at(-1), file.bytes.length, 'bytes')
      res.writeHead(200, { ...cors, 'content-length': file.bytes.length, 'content-type': file.type })
      return res.end(file.bytes)
    }

    if (path === '/ping' || (parts[0] === 'data' && parts[1] === 'ping')) return send(200, 'PONG')
    if (path === '/auth/providers') return send(200, { providers: [], thirdPartyLogin: false, sso: { saml: false } })
    if (path.startsWith('/intake')) return send(200, path === '/intake/telemetry-status' ? { status: 'denied' } : {})

    if (!user) return send(401, { error: 'Unauthorized', message: 'Unauthorized - Session not found', statusCode: 401 })

    if (path === '/users/me') return send(200, user)
    if (parts[0] === 'users' && parts[1] === 'me' && parts[2] === 'keyvalue') {
      if (req.method === 'GET') return send(200, (parts[3] ?? '').split(',').filter(Boolean).map((key) => ({ key, value: null })))
      return send(200, JSON.parse((await readBody(req)).toString() || '[]'))
    }
    if (parts[0] === 'users' && parts[1]) return send(200, parts[1].split(',').map((id) => (id === EDITOR.id ? EDITOR : { id, displayName: id })))

    if (parts[0] === 'projects' && parts[1]) {
      const rest = parts.slice(2).join('/')
      if (!rest) return send(200, PROJECT_INFO)
      if (rest === 'datasets') return send(200, url.searchParams.get('datasetProfile') ? [] : [{ name: DATASET, aclMode: 'private', tags: [] }])
      if (rest === `datasets/${DATASET}/acl`) return send(200, ACL)
      if (rest === 'grants') return send(200, { 'sanity.project': [], 'sanity.project.datasets': [] })
      if (rest === 'features' || rest === 'user-applications') return send(200, [])
      if (rest.startsWith(`datasets/${DATASET}/settings`)) return send(200, {})
    }
    if (path === '/features') return send(200, [])

    // ---- data
    if (parts[0] === 'data' && parts[2] && parts[2] !== DATASET) return send(404, { error: 'Dataset not found' })

    if (parts[0] === 'data' && parts[1] === 'query') {
      let query = url.searchParams.get('query')
      let params = paramsFrom(url)
      let perspective = url.searchParams.get('perspective') ?? undefined
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}')
        query = body.query
        params = body.params ?? {}
        perspective = body.perspective ?? body.options?.perspective ?? perspective
      }
      if (!perspective) {
        const version = url.pathname.match(/^\/v(\d{4}-\d\d-\d\d)/)?.[1]
        perspective = version && version >= '2025-02-19' ? 'published' : 'raw'
      }
      const started = Date.now()
      try {
        const result = await runQuery(query, params, perspective, user.id)
        return send(200, { ms: Date.now() - started, query, result })
      } catch (err) {
        log('query error', query, err.message)
        return send(400, { error: { description: err.message, query, type: 'queryParseError' } })
      }
    }

    if (parts[0] === 'data' && parts[1] === 'doc') {
      const ids = (parts[3] ?? '').split(',').filter(Boolean)
      return send(200, {
        documents: ids.map((id) => docs.get(id)).filter(Boolean),
        omitted: ids.filter((id) => !docs.has(id)).map((id) => ({ id, reason: 'existence' })),
      })
    }

    if (parts[0] === 'data' && parts[1] === 'mutate' && req.method === 'POST') {
      if (user === ROBOT) return send(403, { error: { description: 'Viewer tokens cannot write', type: 'mutationError' } })
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const { changes, results, transactionId } = await mutate(body.mutations ?? [], {
        dryRun: url.searchParams.get('dryRun') === 'true',
        identity: user.id,
        transactionId: body.transactionId,
      })
      log('  mutate', changes.map((c) => `${c.id}${c.after ? '' : ' (deleted)'}`).join(', '))
      const out = { transactionId, results }
      if (url.searchParams.get('returnDocuments') === 'true') out.documents = changes.map((c) => c.after).filter(Boolean)
      return send(200, out)
    }

    if (parts[0] === 'data' && parts[1] === 'actions' && req.method === 'POST') {
      if (user === ROBOT) return send(403, { error: { description: 'Viewer tokens cannot write', type: 'actionError' } })
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const actions = Array.isArray(body.actions) ? body.actions : [body.actions]
      const { changes, transactionId } = await mutate(actionMutations(actions), {
        dryRun: body.dryRun === true,
        identity: user.id,
        transactionId: body.transactionId,
      })
      log('  actions', actions.map((a) => a.actionType.replace('sanity.action.document.', '')).join(', '), '→', changes.map((c) => `${c.id}${c.after ? '' : ' (deleted)'}`).join(', '))
      return send(200, { transactionId })
    }

    if (parts[0] === 'data' && parts[1] === 'listen') {
      const listener = {
        effectFormat: url.searchParams.get('effectFormat'),
        includeMutations: url.searchParams.get('includeMutations') !== 'false',
        includePreviousRevision: url.searchParams.get('includePreviousRevision') === 'true',
        includeResult: url.searchParams.get('includeResult') !== 'false',
        params: paramsFrom(url),
        query: url.searchParams.get('query'),
        send: (event, data) => res.write(`event: ${event}\nid: ${data.eventId ?? rev()}\ndata: ${JSON.stringify(data)}\n\n`),
      }
      res.writeHead(200, { ...cors, 'cache-control': 'no-cache', 'content-type': 'text/event-stream' })
      res.write(`event: welcome\ndata: ${JSON.stringify({ listenerName: rev() })}\n\n`)
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
      listeners.add(listener)
      req.on('close', () => {
        clearInterval(ping)
        listeners.delete(listener)
      })
      return
    }

    // No history: no events, and an empty NDJSON list of transactions.
    if (parts[0] === 'data' && parts[1] === 'history') {
      if (parts[3] === 'events') return send(200, { events: {}, nextCursor: null })
      if (parts[3] === 'transactions') return res.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson' }).end('')
      return send(404, { error: 'No history in the fake' })
    }

    // ---- assets: POST /assets/files/:dataset (raw bytes)
    if (parts[0] === 'assets' && (parts[1] === 'files' || parts[1] === 'images') && req.method === 'POST') {
      if (user === ROBOT) return send(403, { error: 'Viewer tokens cannot upload' })
      const bytes = await readBody(req)
      const sha1 = createHash('sha1').update(bytes).digest('hex')
      const filename = url.searchParams.get('filename') ?? 'file'
      const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'bin'
      const type = req.headers['content-type'] ?? 'application/octet-stream'
      const assetPath = `${PROJECT}/${DATASET}/${sha1}.${ext}`
      files.set(assetPath, { bytes, type })
      const id = `file-${sha1}-${ext}`
      const existing = docs.get(id)
      const asset = existing ?? {
        _id: id,
        _type: 'sanity.fileAsset',
        assetId: sha1,
        extension: ext,
        mimeType: type,
        originalFilename: filename,
        path: `files/${assetPath}`,
        sha1hash: sha1,
        size: bytes.length,
        uploadId: rev(),
        url: `${PUBLIC_BASE}/files/${assetPath}`,
      }
      if (!existing) await mutate([{ create: asset }], { identity: user.id })
      log('  uploaded', filename, type, bytes.length, 'bytes →', id)
      return send(200, { document: docs.get(id) })
    }

    log('  unknown route →', 404)
    return send(404, { error: 'Not found', message: `The fake Content Lake has no ${req.method} ${path}`, statusCode: 404 })
  } catch (err) {
    if (err instanceof HttpError) return send(err.status, { error: { description: err.message, ...err.extra } })
    log('  error', err.stack)
    return send(500, { error: err.message })
  }
}

/** A throwaway self-signed certificate for localhost and *.localhost (the browser ignores certificate errors). */
function certificate() {
  const dir = mkdtempSync(join(tmpdir(), 'fake-lake-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' })
  return { cert: readFileSync(join(dir, 'cert.pem')), key: readFileSync(join(dir, 'key.pem')) }
}

const server = http2.createSecureServer({ ...certificate(), allowHTTP1: true }, serve)
const plain = http.createServer(serve)

// Test hooks: read a document as the test sees it, without a token.
const inspect = http.createServer((req, res) => {
  const id = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1))
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(id ? (docs.get(id) ?? null) : [...docs.values()]))
})

server.listen(PORT, () => log(`fake Content Lake on https://localhost:${PORT} (HTTP/2; project ${PROJECT}, dataset ${DATASET})`))
plain.listen(PLAIN_PORT, () => log(`… and on http://127.0.0.1:${PLAIN_PORT} for the handler and files`))
inspect.listen(PORT + 100, '127.0.0.1', () => log(`inspect on 127.0.0.1:${PORT + 100}/<documentId>`))
