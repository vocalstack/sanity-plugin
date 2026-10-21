import type { ObjectInputProps, Path, SanityDocument } from 'sanity'

import { Box, Button, Card, Flex, Stack, Text, TextArea } from '@sanity/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { set, setIfMissing, unset, useFormValue } from 'sanity'

import type { AudioAsset, TranscriptFieldOptions, TranscriptSentence, VocalStackPluginOptions, VocalStackTranscript } from '../types.js'

import type { JobOutcome, StartRequest, StartResponse } from '../wire.js'

import { findAudio, jobName, POLL_MS, restored, siblingFileRefs, TRANSCRIPT_TYPE } from '../core.js'
import { HandlerError, useConnection, useHandler } from '../handler.js'
import { transcriptText } from '../text.js'
import { Logo, useAccent } from './Brand.js'

/** 2433.0 → "40:33", 4000 → "1:06:40". */
const clock = (s: number) => {
  const t = Math.floor(s)
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`
}

const PHASES: Record<string, string> = {
  extracting: 'Extracting audio',
  fetching: 'Fetching the file',
  queued: 'Queued',
  transcribing: 'Transcribing',
}

/** `['body', { _key: 'a1' }, 'transcript']` → `body[_key=="a1"].transcript`, for the job's idempotency key. */
export const pathString = (path: Path) =>
  path
    .map((p, i) => (typeof p === 'string' ? (i ? `.${p}` : p) : typeof p === 'number' ? `[${p}]` : Array.isArray(p) ? `[${p.join(':')}]` : `[_key=="${p._key}"]`))
    .join('')

type Progress = Extract<JobOutcome, { kind: 'processing' }>

export function TranscriptInput(props: ObjectInputProps<VocalStackTranscript> & { pluginOptions: VocalStackPluginOptions }) {
  const { onChange, path, pluginOptions: options, readOnly, schemaType, value } = props
  const accent = useAccent()
  const { call, client } = useHandler(options)
  const connection = useConnection(call)

  const document = useFormValue([]) as SanityDocument
  // The object holding this field: the document itself, or an object field inside it.
  const parent = useFormValue(path.slice(0, -1)) as Record<string, unknown> | undefined
  const audioField = (schemaType.options as TranscriptFieldOptions | undefined)?.audioField
  const refs = siblingFileRefs(parent, audioField)
  const refsKey = refs.join(',')

  const [asset, setAsset] = useState<AudioAsset | null>()
  useEffect(() => {
    let live = true
    setAsset(undefined)
    findAudio(client, refsKey ? refsKey.split(',') : []).then(
      (a) => live && setAsset(a ?? null),
      () => live && setAsset(null),
    )
    return () => {
      live = false
    }
  }, [client, refsKey])

  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [progress, setProgress] = useState<Partial<Progress>>({})
  const [error, setError] = useState<string>()
  // A short note after a job ends. Inline rather than a toast: Sanity UI moved its toasts between versions.
  const [notice, setNotice] = useState<string>()
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(undefined), 5000)
    return () => clearTimeout(t)
  }, [notice])
  const valueRef = useRef(value)
  valueRef.current = value

  /** Write fields of the transcript object (null removes one). */
  const apply = useCallback(
    (fields: VocalStackTranscript) => {
      if (readOnly) return
      onChange([
        setIfMissing({ _type: TRANSCRIPT_TYPE }),
        ...Object.entries(fields).map(([k, v]) => (v === null || v === undefined ? unset([k]) : set(v, [k]))),
      ])
    },
    [onChange, readOnly],
  )

  const finish = useCallback(
    (outcome: Exclude<JobOutcome, Progress>) => {
      apply(outcome.kind === 'stopped' ? restored(valueRef.current) : outcome.save)
      setProgress({})
      if (outcome.kind === 'stopped') setNotice('Transcription stopped.')
      else if (outcome.kind === 'done') setNotice('Transcript ready.')
    },
    [apply],
  )

  // Follow a running job, also one started before a reload or from the document action:
  // recordingId and status are saved on the document.
  const status = value?.status ?? 'idle'
  const recordingId = value?.recordingId
  useEffect(() => {
    if (status !== 'processing' || !recordingId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const outcome = await call<JobOutcome>(`/recordings/${encodeURIComponent(recordingId)}/job`)
        if (cancelled) return
        setError(undefined)
        if (outcome.kind === 'processing') {
          setProgress(outcome)
          timer = setTimeout(tick, POLL_MS)
        } else finish(outcome)
      } catch (err) {
        if (cancelled) return
        // A network blip or a server hiccup should not end the wait; anything refused should.
        if (err instanceof HandlerError && err.status && err.status < 500) return setError(err.message)
        if (err instanceof HandlerError && err.status) setError(err.message)
        timer = setTimeout(tick, POLL_MS * 2)
      }
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [call, finish, recordingId, status])

  const transcribe = async () => {
    if (!asset) return
    setError(undefined)
    setNotice(undefined)
    setStarting(true)
    setProgress({})
    try {
      const body: StartRequest = { assetId: asset._id, documentId: document._id, fieldPath: pathString(path), name: jobName(document, asset) }
      apply({ ...(await call<StartResponse>('/transcriptions', { body, method: 'POST' })), error: null })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  /** Stop the job. The field goes back to how it was; VocalStack keeps what it heard so far. */
  const stop = async () => {
    if (!recordingId) return
    if (!window.confirm('Stop transcribing? What VocalStack has transcribed so far stays in your VocalStack dashboard.')) return
    setStopping(true)
    try {
      const outcome = await call<JobOutcome>(`/recordings/${encodeURIComponent(recordingId)}/stop`, { method: 'POST' })
      if (outcome.kind !== 'processing') finish(outcome)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStopping(false)
    }
  }

  const busy = status === 'processing'
  const shownError = error ?? (status === 'failed' ? (value?.error ?? undefined) : undefined)
  const partialText = useMemo(() => (busy && progress.partial?.length ? transcriptText(progress.partial as TranscriptSentence[]) : undefined), [busy, progress.partial])
  const muted = { muted: true, size: 1 } as const

  let action: React.ReactNode
  if (!connection) action = <Text {...muted}>Checking the VocalStack connection…</Text>
  else if (!connection.connected) {
    action = (
      <Card padding={2} radius={2} tone="caution">
        <Text size={1}>{connection.error ?? 'VocalStack is not connected.'}</Text>
      </Card>
    )
  } else if (asset === undefined && refs.length) action = <Text {...muted}>Looking for the audio file…</Text>
  else if (!asset && !busy) action = <Text {...muted}>{refs.length ? 'Only audio files can be transcribed.' : 'Add an audio file, then transcribe.'}</Text>
  else {
    action = (
      <Flex gap={2} wrap="wrap">
        <Button
          disabled={busy || starting || readOnly || !asset}
          onClick={transcribe}
          text={busy || starting ? 'Transcribing…' : status === 'done' ? 'Transcribe again' : 'Transcribe'}
          tone="primary"
        />
        {busy && <Button disabled={stopping || readOnly} mode="ghost" onClick={stop} text={stopping ? 'Stopping…' : 'Stop'} />}
      </Flex>
    )
  }

  return (
    <Card border padding={3} radius={2}>
      <Stack space={3}>
        <Logo height={14} />
        {action}
        {busy && (
          <Stack space={2}>
            <Text {...muted}>
              {PHASES[progress.phase ?? 'queued'] ?? progress.phase}
              {progress.progress ? ` · ${progress.progress}%` : '…'}
              {progress.audio?.totalS ? ` · ${clock(progress.audio.processedS)} of ${clock(progress.audio.totalS)}` : ''}
            </Text>
            <Card radius={1} style={{ height: 4, overflow: 'hidden' }} tone="transparent">
              <div style={{ background: accent, height: '100%', transition: 'width .4s', width: `${progress.progress || 2}%` }} />
            </Card>
          </Stack>
        )}
        {notice && (
          <Card padding={2} radius={2} tone="positive">
            <Text size={1}>{notice}</Text>
          </Card>
        )}
        {!busy && status === 'done' && !shownError && (
          <Text {...muted}>
            Transcribed{value?.language ? ` (${value.language})` : ''}
            {value?.sentences?.length ? ` · ${value.sentences.length} sentences with timings` : ''}.
          </Text>
        )}
        {shownError && (
          <Card padding={2} radius={2} tone="critical">
            <Text size={1}>{shownError}</Text>
          </Card>
        )}
        {(partialText || value?.transcript) && (
          <Box>
            <TextArea
              onChange={(e) => {
                const text = e.currentTarget.value
                onChange([setIfMissing({ _type: TRANSCRIPT_TYPE }), text ? set(text, ['transcript']) : unset(['transcript'])])
              }}
              readOnly={readOnly || Boolean(partialText)}
              rows={10}
              value={partialText ?? value?.transcript ?? ''}
            />
          </Box>
        )}
      </Stack>
    </Card>
  )
}
