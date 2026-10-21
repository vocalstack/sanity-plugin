# @vocalstack/sanity

VocalStack for [Sanity](https://www.sanity.io) Studio 3 and later: a **Transcribe** button next to every audio file. The transcript is saved on the document as text plus timed sentences.

## Install

Not on npm. Install from this repo; `dist/` is committed, so nothing builds on install (run `pnpm build` and commit `dist/` with every change):

```sh
npm i github:vocalstack/sanity-plugin
```

VocalStack API keys are for servers: the API refuses a key sent from a web page. So the plugin has two halves, the Studio plugin and a small server handler that holds the key.

**1. The handler.** A Web-standard `(Request) => Promise<Response>`. In a Next.js app (most Sanity sites have one):

```ts
// app/api/vocalstack/[...path]/route.ts
import { createVocalStackHandler } from '@vocalstack/sanity/server'

const handler = createVocalStackHandler({
  apiKey: process.env.VOCALSTACK_API_KEY, // the default; a vs_key_… key with Read and Write
  sanity: {
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
    token: process.env.SANITY_API_READ_TOKEN!, // a Viewer token is enough
  },
})

export { handler as GET, handler as OPTIONS, handler as POST }
```

Any other host works the same way: Remix, Hono, Bun, Deno, Cloudflare Workers, a Node server with a Fetch adapter. The handler matches the end of the path, so mount it under any prefix.

**2. The Studio plugin.**

```ts
// sanity.config.ts
import { vocalstack } from '@vocalstack/sanity'

export default defineConfig({
  // …
  plugins: [
    vocalstack({
      handlerURL: 'https://www.example.com/api/vocalstack', // or '/api/vocalstack' for a Studio embedded in the same Next.js app
    }),
  ],
})
```

Then add a transcript field next to the audio:

```ts
defineType({
  name: 'episode',
  type: 'document',
  fields: [
    defineField({ name: 'title', type: 'string' }),
    defineField({ name: 'audio', type: 'file', options: { accept: 'audio/*' } }),
    defineField({ name: 'transcript', type: 'vocalstack.transcript' }),
  ],
})
```

## What it adds

- **A `vocalstack.transcript` field type**, to put next to a `file` field (at the top level of a document, or inside an object). Its input has:
  - a **Transcribe** button, shown when the sibling file is `audio/*`. It shows progress and survives a reload mid-job, because `recordingId` and `status` are saved on the document. **Stop** ends a job you no longer want: the field goes back to how it was (an earlier transcript stays), and VocalStack keeps what it transcribed before the stop.
  - the stored value:
    - `transcript`: text you can edit; paragraphs break on a speaker change or a pause.
    - `sentences`: `[{ start, end, speaker, text }]` in seconds.
    - `status` (`idle`, `processing`, `done` or `failed`), `language`, `error`, `recordingId`, `transcriptionId` and `transcribedAt`.
- **A "Transcribe audio" document action** on every document type with a transcript field. It starts a job for each transcript field next to an audio file; the field follows the job from there.
- **The handler** (`@vocalstack/sanity/server`): `GET …/connection`, `POST …/transcriptions`, `GET …/recordings/:id/job` and `POST …/recordings/:id/stop`.

Like any edit in the Studio, the transcript lands in the draft; publish to make it public. Transcripts are plain fields, so GROQ reads them like any other:

```groq
*[_type == "episode"]{ title, "text": transcript.transcript, "captions": transcript.sentences }
```

## Options

The Studio plugin, `vocalstack({ … })`:

| Option | Default | |
|---|---|---|
| `handlerURL` | required | Where the handler is mounted. The Studio calls only this URL. |

A transcript field, `options: { … }`:

| Option | Default | |
|---|---|---|
| `audioField` | the first sibling `file` field holding `audio/*` | The name of the sibling file field to transcribe. |

The handler, `createVocalStackHandler({ … })`:

| Option | Default | |
|---|---|---|
| `apiKey` | `process.env.VOCALSTACK_API_KEY` | A `vs_key_…` key with Read and Write. |
| `sanity` | required | `{ projectId, dataset, token, apiVersion?, apiHost?, useProjectHostname? }`: the Studio's dataset, and a token that can read it. `apiHost` and `useProjectHostname` work as in `@sanity/client`, for a custom API domain. |
| `spokenLanguage` | auto-detect | A Whisper language code (`en`, `ro`, …). |
| `fileURL` | the asset's URL on Sanity's CDN | `(asset) => string`: the audio's address. Return a signed URL if your assets are private. |
| `allowedOrigins` | any | The Studio origins allowed to call the handler (CORS), e.g. `['https://example.sanity.studio']`. |
| `apiURL` | `https://api.vocalstack.com` | |

**How the audio reaches VocalStack.** The Studio sends the handler the file's asset id; the handler reads the asset from your dataset, checks that it is `audio/*`, and VocalStack fetches it from Sanity's CDN (`POST /v1/transcriptions { url }`). VocalStack does not fetch loopback or private addresses, so for those the handler reads the file and uploads it. The job runs on VocalStack, and the Studio polls the handler every 3 s. The account is billed per second, with a 5-minute minimum per transcription.

## How the handler knows the caller

The handler only answers someone signed in to the Studio with permission to edit the dataset:

1. The Studio makes a random secret and, with the editor's own Sanity login, creates a document `vocalstack-session.<sha256 of the secret>` (type `vocalstack.session`).
2. Every call to the handler carries `Authorization: Bearer <secret>`. The handler hashes it and looks the document up with its own token; a session is good for 12 hours from the document's `_updatedAt`.

Only someone who can write to the dataset can create a session. The id has a dot in it, so Sanity never serves it to unauthenticated requests, even from a public dataset; project members who can read the dataset see the hash, never the secret. Expired sessions are swept by the Studio. The handler keeps no cookies, so CORS from any origin is safe; `allowedOrigins` narrows it further.

The VocalStack key never reaches a browser: it lives in the handler's environment only. Anyone who can edit the dataset can start, follow and stop transcriptions on that key's account.

## Testing

`e2e/run.sh` runs a real Studio on a fake Content Lake against the handler and a real VocalStack, in Chromium; see [e2e/README.md](e2e/README.md).

## One-click connect

Not in this version. The handler has no storage of its own to keep a connected key in, and the Studio cannot redeem a connect code (the API refuses it from a web page), so the key goes in `VOCALSTACK_API_KEY`. Create one with Read and Write permissions under [Developers → API keys](https://app.vocalstack.com/developers/keys).
