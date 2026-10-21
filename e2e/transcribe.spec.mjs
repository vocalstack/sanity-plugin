/**
 * The Studio, in a real browser, transcribing an audio file through the plugin's
 * handler on a real VocalStack. Run by e2e/run.sh, which starts the fake Content Lake,
 * the handler and `sanity dev` first.
 *
 * Env: STUDIO_URL, LAKE_INSPECT_URL, LAKE_PLAIN_URL, EDITOR_TOKEN, AUDIO, SHOTS, CHROME_PATH (optional).
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

const STUDIO = process.env.STUDIO_URL ?? 'http://127.0.0.1:3711'
const INSPECT = process.env.LAKE_INSPECT_URL ?? 'http://127.0.0.1:8811'
const LAKE = process.env.LAKE_PLAIN_URL ?? 'http://127.0.0.1:8713'
const EDITOR_TOKEN = process.env.EDITOR_TOKEN ?? 'e2e-editor-token-0000000000000000000000'
const AUDIO = process.env.AUDIO
const SHOTS = process.env.SHOTS ?? new URL('./shots', import.meta.url).pathname
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 240_000)
if (!AUDIO) throw new Error('Set AUDIO to a short speech recording (mp3, wav, m4a…).')
mkdirSync(SHOTS, { recursive: true })

const DOC = 'episode-42'
const DRAFT = `drafts.${DOC}`

/** The document as stored in the fake Content Lake. */
const stored = async (id) => (await fetch(`${INSPECT}/${encodeURIComponent(id)}`)).json()
const groq = async (query, perspective = 'raw') => {
  const url = new URL(`${LAKE}/v2025-02-19/data/query/e2e`)
  url.searchParams.set('query', query)
  url.searchParams.set('perspective', perspective)
  const res = await fetch(url, { headers: { authorization: `Bearer ${EDITOR_TOKEN}` } })
  return (await res.json()).result
}
async function until(what, fn, timeout = 30_000, every = 500) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, every))
  }
}

const results = []
let shot = 0
async function step(name, page, fn) {
  const started = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, note })
    console.log(`PASS  ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)${note ? `\n      ${note}` : ''}`)
  } catch (err) {
    results.push({ name, ok: false, note: err.message })
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').join('\n      ')}`)
    throw err
  } finally {
    await page.screenshot({ fullPage: true, path: join(SHOTS, `${String(++shot).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
// The fake lake's certificate is self-signed.
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { height: 1000, width: 1400 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
// Count the field's polls, to catch a poll loop that restarts on every render.
const polls = []
page.on('request', (r) => /\/recordings\/[^/]+\/job$/.test(new URL(r.url()).pathname) && r.method() === 'GET' && polls.push(Date.now()))
page.on('dialog', (d) => d.accept())

const field = page.locator('[data-testid="field-transcript"]')
const transcribeButton = field.getByRole('button', { name: /^Transcribe( again)?$/ })
const stopButton = field.getByRole('button', { name: 'Stop' })
const progressText = field.getByText(/^(Queued|Fetching the file|Extracting audio|Transcribing|fetching|transcribing)/)
let firstTranscript

try {
  await step('Sign in', page, async () => {
    // What a Sanity login hands the Studio: a token in the URL's hash.
    await page.goto(`${STUDIO}/structure/episode#token=${EDITOR_TOKEN}`)
    await page.getByRole('link', { name: /Episode 42/ }).waitFor({ timeout: 60_000 })
    const token = await page.evaluate(() => localStorage.getItem('__studio_auth_token_vse2e'))
    assert.ok(token?.includes('e2e-editor-token'), 'the Studio stored the token')
  })

  await step('Open the document', page, async () => {
    // Sanity's lists ignore the pointer until the mouse moves (keyboard navigation): move it first, like a person.
    await page.mouse.move(20, 300)
    await page.mouse.move(500, 300, { steps: 5 })
    await page.getByRole('link', { name: /Episode 42/ }).click()
    await field.waitFor()
    await field.getByText('Add an audio file, then transcribe.').waitFor({ timeout: 30_000 })
    return 'The transcript field says "Add an audio file, then transcribe." (the handler answered /connection).'
  })

  await step('Upload the audio', page, async () => {
    await page.locator('[data-testid="file-button-input"]').setInputFiles(AUDIO)
    await transcribeButton.waitFor({ timeout: 60_000 })
    assert.equal(await transcribeButton.isEnabled(), true)
    const draft = await until('the draft to reference the file', async () => (await stored(DRAFT))?.audio?.asset?._ref)
    const asset = await stored(draft)
    assert.match(asset.mimeType, /^audio\//)
    return `${asset.originalFilename}, ${asset.mimeType}, ${asset.size} bytes → ${asset._id}`
  })

  await step('Transcribe', page, async () => {
    await transcribeButton.click()
    await stopButton.waitFor({ timeout: 30_000 })
    const t = await until('status "processing" on the draft', async () => {
      const v = (await stored(DRAFT))?.transcript
      return v?.status === 'processing' && v.recordingId ? v : undefined
    })
    return `recordingId ${t.recordingId}, transcriptionId ${t.transcriptionId}`
  })

  await step('Progress shows', page, async () => {
    await progressText.first().waitFor({ timeout: 30_000 })
    return `"${await progressText.first().innerText()}"`
  })

  await step('Reload mid-job', page, async () => {
    const before = (await stored(DRAFT)).transcript
    assert.equal(before.status, 'processing', 'still processing before the reload')
    await page.reload()
    await field.waitFor({ timeout: 60_000 })
    await stopButton.waitFor({ timeout: 30_000 })
    await progressText.first().waitFor({ timeout: 30_000 })
    const after = (await stored(DRAFT)).transcript
    assert.equal(after.recordingId, before.recordingId, 'the same job after the reload')
    return `after the reload: "${await progressText.first().innerText()}", following ${after.recordingId}`
  })

  await step('Transcript saved', page, async () => {
    const started = polls.length ? polls[0] : Date.now()
    const t = await until('status "done" on the draft', async () => ((await stored(DRAFT))?.transcript?.status === 'done' ? (await stored(DRAFT)).transcript : undefined), JOB_TIMEOUT_MS, 1000)
    await field.getByText(/^Transcribed/).waitFor({ timeout: 15_000 })
    const shown = await field.locator('textarea').inputValue()
    assert.ok(t.transcript && t.transcript.trim().split(/\s+/).length >= 5, `a real transcript: ${JSON.stringify(t.transcript)}`)
    assert.equal(shown, t.transcript, 'the field shows the saved text')
    assert.ok(t.sentences?.length > 0, 'timed sentences')
    for (const s of t.sentences) assert.ok(s._key && s.end >= s.start && s.text, `a sentence: ${JSON.stringify(s)}`)
    assert.ok(t.language, 'a language')
    assert.ok(t.transcribedAt, 'transcribedAt')
    assert.equal(t.error, undefined)
    // About one poll per 3 s; a loop restarting on every render would poll far more often.
    const seconds = (Date.now() - started) / 1000
    assert.ok(polls.length <= seconds / 3 + 8, `${polls.length} polls in ${seconds.toFixed(0)} s`)
    firstTranscript = t
    return `${t.language}, ${t.sentences.length} sentences, ${polls.length} polls in ${seconds.toFixed(0)} s: "${t.transcript}"`
  })

  await step('Document action', page, async () => {
    const before = (await stored(DRAFT)).transcript
    await page.locator('[data-testid="action-menu-button"]').click()
    await page.getByRole('menuitem', { name: /Transcribe audio/ }).click()
    const started = await until('a new job from the action', async () => {
      const v = (await stored(DRAFT)).transcript
      return v.status === 'processing' && v.recordingId !== before.recordingId ? v : undefined
    })
    await page.keyboard.press('Escape')
    await stopButton.waitFor({ timeout: 30_000 })
    const done = await until('the action\'s job to finish', async () => {
      const v = (await stored(DRAFT)).transcript
      return v.status === 'done' && v.transcribedAt !== before.transcribedAt ? v : undefined
    }, JOB_TIMEOUT_MS, 1000)
    assert.ok(done.transcript.trim().length > 0)
    return `job ${started.recordingId} → "${done.transcript.slice(0, 80)}…"`
  })

  await step('Stop', page, async () => {
    const before = (await stored(DRAFT)).transcript
    await transcribeButton.click()
    await stopButton.waitFor({ timeout: 30_000 })
    await until('the new job on the draft', async () => (await stored(DRAFT)).transcript.recordingId !== before.recordingId)
    await stopButton.click() // the confirm dialog is accepted
    await field.getByText('Transcription stopped.').waitFor({ timeout: 30_000 })
    const after = await until('status back to "done"', async () => ((await stored(DRAFT)).transcript.status === 'done' ? (await stored(DRAFT)).transcript : undefined))
    assert.equal(after.transcript, before.transcript, 'the earlier transcript stays')
    return 'stopped; the field went back to the earlier transcript'
  })

  await step('Publish', page, async () => {
    await page.locator('[data-testid="action-publish"]').click()
    const published = await until('the published document', async () => {
      const d = await stored(DOC)
      return d?.transcript?.status === 'done' && !(await stored(DRAFT)) ? d : undefined
    })
    const [row] = await groq('*[_type == "episode"]{ title, "text": transcript.transcript, "captions": transcript.sentences }', 'published')
    assert.equal(row.text, published.transcript.transcript)
    assert.ok(row.captions.length > 0)
    return `GROQ (published): ${row.title}: "${row.text.slice(0, 80)}…"`
  })
} catch {
  // Reported by step().
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
const relevantErrors = pageErrors.filter((m) => !/WebSocket|socket/.test(m))
if (relevantErrors.length) console.log(`\nPage errors:\n  ${[...new Set(relevantErrors)].join('\n  ')}`)
console.log(`\n${results.length - failed.length}/${results.length} steps passed${failed.length ? '' : ''}. Screenshots: ${SHOTS}`)
if (firstTranscript) console.log(`\nTranscript:\n${firstTranscript.transcript}`)
process.exit(failed.length || results.length < 10 ? 1 : 0)
