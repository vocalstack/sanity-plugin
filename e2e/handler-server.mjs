/**
 * The plugin's real server handler (`@vocalstack/sanity/server`, from the committed
 * dist/), on a plain Node server, pointed at the fake Content Lake and a VocalStack API.
 *
 *   VOCALSTACK_API_KEY=vs_key_… VOCALSTACK_API_URL=http://127.0.0.1:8090 node e2e/handler-server.mjs
 */
import http from 'node:http'

import { createVocalStackHandler } from '../dist/server/index.js'

const PORT = Number(process.env.HANDLER_PORT ?? 8712)
const LAKE = process.env.LAKE_URL ?? 'http://127.0.0.1:8713'

if (!process.env.VOCALSTACK_API_KEY) throw new Error('Set VOCALSTACK_API_KEY.')

const handler = createVocalStackHandler({
  apiKey: process.env.VOCALSTACK_API_KEY,
  apiURL: process.env.VOCALSTACK_API_URL ?? 'https://api.vocalstack.com',
  allowedOrigins: process.env.STUDIO_ORIGIN ? [process.env.STUDIO_ORIGIN] : undefined,
  sanity: {
    projectId: process.env.PROJECT_ID ?? 'vse2e',
    dataset: process.env.DATASET ?? 'e2e',
    token: process.env.ROBOT_TOKEN ?? 'e2e-robot-token-00000000000000000000000',
    // Node does not resolve <project>.localhost, so the handler talks to the fake on its plain host.
    apiHost: LAKE,
    useProjectHostname: false,
  },
})

const log = (...args) => console.log(new Date().toISOString().slice(11, 23), ...args)

http
  .createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const request = new Request(new URL(req.url, `http://${req.headers.host}`), {
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]])),
      method: req.method,
    })
    const response = await handler(request)
    const text = await response.text()
    log(req.method, req.url, response.status, text.length > 200 ? text.slice(0, 200) + '…' : text)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(text)
  })
  .listen(PORT, '127.0.0.1', () => log(`VocalStack handler on 127.0.0.1:${PORT}/api/vocalstack → ${process.env.VOCALSTACK_API_URL}`))
