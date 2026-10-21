/**
 * The server half of VocalStack for Sanity. VocalStack API keys are for servers
 * (the API refuses one sent from a web page), so the Studio calls this handler
 * and the handler calls VocalStack.
 *
 * Web-standard: `(Request) => Promise<Response>`, for a Next.js route handler,
 * any Node server with a Fetch adapter, or an edge function.
 */
import type { ConnectionResponse, ErrorResponse, JobOutcome, StartRequest, StartResponse } from '../wire.js'

import { accountLabel, DEFAULT_API_URL, VocalStackAPI, VocalStackAPIError } from '../api.js'
import { SESSION_MAX_AGE_MS, SESSION_PREFIX, SESSION_TYPE, sha256Hex } from '../wire.js'
import { checkJob, stopJob } from './jobs.js'

export type { ConnectionResponse, JobOutcome, StartRequest, StartResponse } from '../wire.js'

export type VocalStackHandlerOptions = {
  /** A VocalStack API key (`vs_key_…`, Read + Write). Default: `process.env.VOCALSTACK_API_KEY`. */
  apiKey?: string
  /** The dataset the Studio edits, and a token that can read it (a Viewer token is enough). */
  sanity: { apiVersion?: string; dataset: string; projectId: string; token: string }
  /** A Whisper language code (`en`, `ro`, …). Leave out to auto-detect. */
  spokenLanguage?: string
  /**
   * The public URL VocalStack fetches the audio from. Default: the asset's URL on
   * Sanity's CDN. Return a signed URL here if your assets are private.
   */
  fileURL?: (asset: SanityFileAsset) => Promise<string | undefined> | string | undefined
  /**
   * Origins allowed to call the handler (the Studio's), e.g. `['https://my.sanity.studio']`.
   * Default: any. Callers prove themselves with a Studio session, not a cookie, so any origin is safe.
   */
  allowedOrigins?: string[]
  /** Default https://api.vocalstack.com */
  apiURL?: string
}

export type SanityFileAsset = { _id: string; mimeType?: string; originalFilename?: string; url?: string }

type Handler = (request: Request) => Promise<Response>

/** Verified sessions, briefly, so a poll every 3 s is not a Sanity query every 3 s. */
const SESSION_CACHE_MS = 60_000

export function createVocalStackHandler(options: VocalStackHandlerOptions): Handler {
  const apiKey = options.apiKey ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VOCALSTACK_API_KEY
  const { dataset, projectId, token } = options.sanity
  const sanityBase = `https://${projectId}.api.sanity.io/v${(options.sanity.apiVersion ?? '2024-01-01').replace(/^v/, '')}`
  const sessions = new Map<string, number>()
  let account: string | undefined

  async function query<T>(groq: string, params: Record<string, unknown>): Promise<T> {
    const url = new URL(`${sanityBase}/data/query/${encodeURIComponent(dataset)}`)
    url.searchParams.set('query', groq)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v))
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Sanity answered ${res.status} to the handler's query. Check its projectId, dataset and token.`)
    return ((await res.json()) as { result: T }).result
  }

  /**
   * Is the caller signed in to the Studio? The Studio creates a session document whose id
   * is the hash of a random secret and sends the secret. Only someone who may write to the
   * dataset can create one; readers see the hash, never the secret.
   */
  async function signedIn(request: Request): Promise<boolean> {
    const secret = request.headers.get('authorization')?.match(/^Bearer\s+(\S{32,})$/)?.[1]
    if (!secret) return false
    const id = SESSION_PREFIX + (await sha256Hex(secret))
    const cached = sessions.get(id)
    if (cached && cached > Date.now()) return true
    const updatedAt = await query<null | string>('*[_id == $id && _type == $type][0]._updatedAt', { id, type: SESSION_TYPE })
    const expires = updatedAt ? Date.parse(updatedAt) + SESSION_MAX_AGE_MS : 0
    if (expires <= Date.now()) return false
    sessions.set(id, Math.min(expires, Date.now() + SESSION_CACHE_MS))
    return true
  }

  const cors = (request: Request): Record<string, string> => {
    const origin = request.headers.get('origin')
    const allowed = !options.allowedOrigins || (origin !== null && options.allowedOrigins.includes(origin))
    return allowed
      ? {
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-origin': options.allowedOrigins ? (origin ?? '') : '*',
          'access-control-max-age': '86400',
          vary: 'origin',
        }
      : {}
  }

  return async (request) => {
    const headers = { ...cors(request), 'cache-control': 'no-store' }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { headers: { ...headers, 'content-type': 'application/json' }, status })
    const fail = (status: number, error: string, code?: string) => json({ code, error } satisfies ErrorResponse, status)

    if (request.method === 'OPTIONS') return new Response(null, { headers, status: 204 })

    // The route's tail, wherever the handler is mounted: …/connection, …/transcriptions,
    // …/recordings/:id/job, …/recordings/:id/stop.
    const path = new URL(request.url).pathname.replace(/\/+$/, '')
    const route = path.match(/\/(connection|transcriptions)$/)?.[1] ?? path.match(/\/recordings\/([^/]+)\/(job|stop)$/)?.slice(1).join(' ')
    if (!route) return fail(404, 'Not a VocalStack route.')

    try {
      if (!(await signedIn(request))) return fail(401, 'Sign in to the Studio again.', 'session')
    } catch (err) {
      return fail(502, (err as Error).message, 'sanity')
    }
    if (!apiKey) return fail(503, 'VOCALSTACK_API_KEY is not set where the VocalStack handler runs.', 'not_connected')
    const api = new VocalStackAPI(apiKey, options.apiURL ?? DEFAULT_API_URL)

    try {
      if (route === 'connection' && request.method === 'GET') {
        account ??= accountLabel(await api.me())
        return json({ account, connected: true } satisfies ConnectionResponse)
      }

      if (route === 'transcriptions' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Partial<StartRequest>
        if (typeof body.assetId !== 'string' || !body.assetId.startsWith('file-') || typeof body.documentId !== 'string') return fail(400, 'Send assetId and documentId.')
        const asset = await query<null | SanityFileAsset>('*[_id == $id][0]{ _id, url, mimeType, originalFilename }', { id: body.assetId })
        if (!asset) return fail(404, 'There is no such file in the dataset.')
        if (!asset.mimeType?.startsWith('audio/')) return fail(400, 'Only audio files can be transcribed.')
        const url = (await options.fileURL?.(asset)) ?? asset.url
        if (!url) return fail(400, 'There is no audio file here.')

        const tx = await api.transcribeURL(url, {
          idempotencyKey: `sanity:${body.documentId.replace(/^drafts\./, '')}:${body.fieldPath ?? ''}:${crypto.randomUUID()}`,
          name: (typeof body.name === 'string' && body.name.trim()) || asset.originalFilename || 'Sanity audio',
          spokenLanguage: options.spokenLanguage,
        })
        if (!tx.job) return fail(502, 'VocalStack did not start a job for this file.')
        return json({ recordingId: tx.job.recordingId, status: 'processing', transcriptionId: tx.id } satisfies StartResponse, 202)
      }

      const [recordingId, action] = route.split(' ')
      if (action === 'job' && request.method === 'GET') return json(await checkJob(api, decodeURIComponent(recordingId)) satisfies JobOutcome)
      if (action === 'stop' && request.method === 'POST') return json(await stopJob(api, decodeURIComponent(recordingId)) satisfies JobOutcome)
      return fail(405, 'Method not allowed.')
    } catch (err) {
      if (err instanceof VocalStackAPIError) {
        if (err.status === 401) return fail(502, 'VocalStack refused the API key in VOCALSTACK_API_KEY.', 'not_connected')
        return fail(err.status >= 500 ? 502 : err.status, err.message, err.code)
      }
      return fail(500, err instanceof Error ? err.message : String(err))
    }
  }
}
