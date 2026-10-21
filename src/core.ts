import type { SanityClient, SanityDocument } from 'sanity'

import type { AudioAsset, TranscriptStatus, VocalStackTranscript } from './types.js'

export const TRANSCRIPT_TYPE = 'vocalstack.transcript'
export const POLL_MS = 3000
export const API_VERSION = '2024-01-01'

type FileValue = { asset?: { _ref?: string } }
const fileRef = (v: unknown): string | undefined => {
  const ref = (v as FileValue | undefined)?.asset?._ref
  return typeof ref === 'string' && ref.startsWith('file-') ? ref : undefined
}

/** The file asset ids next to a transcript: the one in `audioField`, or every sibling file. */
export function siblingFileRefs(siblings: Record<string, unknown> | undefined, audioField?: string): string[] {
  if (!siblings) return []
  if (audioField) return [fileRef(siblings[audioField])].filter((r): r is string => Boolean(r))
  return Object.values(siblings).map(fileRef).filter((r): r is string => Boolean(r))
}

/** The first of these assets that is audio (in the order given). */
export async function findAudio(client: SanityClient, refs: string[]): Promise<AudioAsset | undefined> {
  if (!refs.length) return undefined
  const assets = await client.fetch<AudioAsset[]>('*[_id in $ids]{ _id, url, mimeType, originalFilename }', { ids: refs })
  return refs.map((id) => assets.find((a) => a._id === id)).find((a) => a?.mimeType?.startsWith('audio/'))
}

/** The transcription's name in VocalStack: the document's title, else the file's name. */
export function jobName(document: SanityDocument, asset: AudioAsset): string {
  for (const key of ['title', 'name', 'heading']) {
    const v = document[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return asset.originalFilename ?? `${document._type} ${document._id.replace(/^drafts\./, '')}`
}

/** A stopped job leaves the field as it was before Transcribe: the earlier transcript, if any. */
export const restored = (value: VocalStackTranscript | undefined): VocalStackTranscript => ({
  error: null,
  status: (value?.transcript ? 'done' : 'idle') satisfies TranscriptStatus,
})
