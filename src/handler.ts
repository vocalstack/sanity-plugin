import type { SanityClient } from 'sanity'

import { useCallback, useEffect, useState } from 'react'
import { useClient } from 'sanity'

import type { VocalStackPluginOptions } from './types.js'
import type { ConnectionResponse, ErrorResponse } from './wire.js'

import { API_VERSION } from './core.js'
import { SESSION_MAX_AGE_MS, SESSION_PREFIX, SESSION_TYPE, sha256Hex } from './wire.js'

export class HandlerError extends Error {
  code?: string
  status: number
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

type Stored = { createdAt: number; secret: string }
const memory = new Map<string, Stored>()
const pending = new Map<string, Promise<string>>()

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function load(key: string): Stored | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as Stored
  } catch {}
  return memory.get(key)
}

function keep(key: string, value: Stored | undefined) {
  if (value) memory.set(key, value)
  else memory.delete(key)
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
  } catch {}
}

/**
 * Prove to the handler that this browser is signed in to the Studio: write a session
 * document `vocalstack-session.<sha256(secret)>` with the editor's own Sanity login,
 * and send the secret. The handler looks the hash up with its own token. The dotted id
 * keeps the document out of a public dataset's API; readers see the hash, not the secret.
 */
async function session(client: SanityClient, fresh: boolean): Promise<string> {
  const { dataset, projectId } = client.config()
  const key = `vocalstack:session:${projectId}:${dataset}`
  const stored = load(key)
  // An hour's margin, so a session never runs out between two polls.
  if (!fresh && stored && stored.createdAt + SESSION_MAX_AGE_MS - 3600_000 > Date.now()) return stored.secret

  let creating = pending.get(key)
  if (!creating) {
    creating = (async () => {
      const secret = base64url(crypto.getRandomValues(new Uint8Array(32)))
      await client.createOrReplace({ _id: SESSION_PREFIX + (await sha256Hex(secret)), _type: SESSION_TYPE })
      if (stored) void client.delete(SESSION_PREFIX + (await sha256Hex(stored.secret))).catch(() => undefined)
      // Sweep sessions that ran out, anyone's.
      void client
        .delete({ query: '*[_type == $type && _updatedAt < $before]', params: { before: new Date(Date.now() - SESSION_MAX_AGE_MS).toISOString(), type: SESSION_TYPE } })
        .catch(() => undefined)
      keep(key, { createdAt: Date.now(), secret })
      return secret
    })().finally(() => pending.delete(key))
    pending.set(key, creating)
  }
  return creating.catch((err: { statusCode?: number }) => {
    if (err?.statusCode === 403 || err?.statusCode === 401) throw new HandlerError(403, 'Transcribing needs permission to edit this dataset.', 'forbidden')
    throw err
  })
}

/** Calls to the server handler, signed with the Studio session. */
export function useHandler(options: VocalStackPluginOptions) {
  const client = useClient({ apiVersion: API_VERSION })
  const base = options.handlerURL.replace(/\/+$/, '')

  const call = useCallback(
    async <T>(path: string, init: { body?: unknown; method?: 'GET' | 'POST' } = {}): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const secret = await session(client, attempt > 0)
        let res: Response
        try {
          res = await fetch(`${base}${path}`, {
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            headers: { accept: 'application/json', authorization: `Bearer ${secret}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
            method: init.method ?? 'GET',
          })
        } catch {
          // No status: the handler is down or its CORS refuses this Studio. Callers retry these.
          throw new HandlerError(0, `Could not reach the VocalStack handler at ${base}.`)
        }
        const body = (await res.json().catch(() => ({}))) as ErrorResponse & T
        if (res.ok) return body
        // A session that ran out or was swept: make a new one, once.
        if (res.status === 401 && body.code === 'session' && attempt === 0) continue
        throw new HandlerError(res.status, body.error ?? `The VocalStack handler answered ${res.status}.`, body.code)
      }
    },
    [base, client],
  )

  return { call, client }
}

/** Whether the handler is up and has a VocalStack key. */
export function useConnection(call: ReturnType<typeof useHandler>['call']) {
  const [connection, setConnection] = useState<ConnectionResponse & { error?: string }>()
  useEffect(() => {
    let live = true
    call<ConnectionResponse>('/connection').then(
      (c) => live && setConnection(c),
      (err: Error) => live && setConnection({ connected: false, error: err.message }),
    )
    return () => {
      live = false
    }
  }, [call])
  return connection
}
