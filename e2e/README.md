# End-to-end test

A real Sanity Studio, in Chromium, transcribing a real audio file through the plugin's
real handler on a real VocalStack. No Sanity account is needed, and no one has to click
anything.

```sh
VOCALSTACK_API_KEY=vs_key_… AUDIO=~/speech.mp3 e2e/run.sh
```

- `AUDIO`: a short speech recording (about 20 s is enough; any audio type).
- `VOCALSTACK_API_URL`: default `https://api.vocalstack.com`. A local VocalStack works too (`http://127.0.0.1:8090`).
- `CHROME_PATH`: a Chromium or Chrome binary. Default: Playwright's own Chromium (`pnpm exec playwright-core install chromium`).
- `SHOTS`: where screenshots go (default `e2e/shots/`). Server logs go to `e2e/.logs/`.

Each run starts **three transcriptions** (Transcribe, the document action, Stop), billed to the key's account. The script exits non-zero if any step fails, and stops every server it started.

## What runs

| Piece | Port | |
|---|---|---|
| `studio/` | 3711 | `sanity dev`, with the plugin from the committed `dist/` and an `episode` type (`title`, `audio`, `transcript`). |
| `fake-lake.mjs` | 8711 (HTTPS, HTTP/2), 8713 (HTTP), 8811 (inspect) | A small fake of Sanity's Content Lake. |
| `handler-server.mjs` | 8712 | `createVocalStackHandler` from `dist/server`, on a Node server. |
| `transcribe.spec.mjs` | | The test (Playwright). |

The Studio reaches the fake through Sanity's own `apiHost` option. Sanity puts the project id in front of the host (`vse2e.localhost`), which browsers resolve to this machine. The fake serves HTTPS with a throwaway self-signed certificate, because the Studio keeps more listeners open than HTTP/1.1 allows per host; real Sanity uses HTTP/2 too. The handler reads the dataset over plain HTTP through its `sanity.apiHost` option.

Sign-in works as after a Sanity login: the Studio gets `#token=…` in the URL and keeps it. The fake knows two tokens, the editor's and the handler's read-only robot.

### The fake Content Lake

It does only what the Studio and the handler use:

- GROQ queries (with [groq-js](https://github.com/sanity-io/groq-js), and the `raw`, `published` and `drafts` perspectives);
- `getDocuments`;
- mutations (with `@sanity/mutator`) and the Actions API that Studio 4 commits through (edit, create, publish, unpublish, discard, delete);
- listeners (SSE, with Mendoza effects);
- file uploads, with the files served on a public path like Sanity's CDN;
- `users/me`, the project, its datasets and ACL;
- empty history.

Presence, comments, tasks, releases and scheduling answer 404 or empty, and the Studio works without them. Anything else it does not know it logs to `.logs/lake.log`.

The asset URLs point at `127.0.0.1`, which VocalStack refuses to fetch, so the handler uploads the bytes itself, as it does for any asset URL that is not public.

## The steps

1. **Sign in**: the Studio opens with the editor's token and lists the episode.
2. **Open the document**: the transcript field reaches the handler (`/connection`) and asks for audio.
3. **Upload the audio** through the Studio's file input; the draft references a `sanity.fileAsset` of type `audio/*`.
4. **Transcribe**: the field shows Stop, and the draft has `status: processing` and a `recordingId`.
5. **Progress shows** (phase and percentage).
6. **Reload mid-job**: after a reload the field is still following the same job.
7. **Transcript saved**: the draft has `status: done`, the text (at least five words, the same as the field shows), timed sentences, a language and `transcribedAt`. It also checks the field polled about once every 3 s.
8. **Document action**: "Transcribe audio" in the document's menu starts a new job, and the field follows it to the end.
9. **Stop**: Transcribe again, then Stop. The field goes back to the earlier transcript.
10. **Publish**: the published document carries the transcript, and GROQ reads it.

## What it does not cover

A hosted Sanity project has things this fake does not reproduce:

- Sanity's real permission checks: here the editor is an administrator and the robot can only read;
- the real sign-in flow with login providers and cookies;
- the CDN serving a public asset URL that VocalStack fetches itself;
- presence, history and releases;
- Content Lake behaviour under concurrent edits, beyond what the Studio's own optimistic updates exercise.
