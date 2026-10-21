import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Button, Card, Flex, Stack, Text, TextArea } from '@sanity/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { set, setIfMissing, unset, useFormValue } from 'sanity';
import { findAudio, jobName, POLL_MS, restored, siblingFileRefs, TRANSCRIPT_TYPE } from '../core.js';
import { HandlerError, useConnection, useHandler } from '../handler.js';
import { transcriptText } from '../text.js';
import { Logo, useAccent } from './Brand.js';
/** 2433.0 → "40:33", 4000 → "1:06:40". */
const clock = (s) => {
    const t = Math.floor(s);
    const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
    return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};
const PHASES = {
    extracting: 'Extracting audio',
    fetching: 'Fetching the file',
    queued: 'Queued',
    transcribing: 'Transcribing',
};
/** `['body', { _key: 'a1' }, 'transcript']` → `body[_key=="a1"].transcript`, for the job's idempotency key. */
export const pathString = (path) => path
    .map((p, i) => (typeof p === 'string' ? (i ? `.${p}` : p) : typeof p === 'number' ? `[${p}]` : Array.isArray(p) ? `[${p.join(':')}]` : `[_key=="${p._key}"]`))
    .join('');
export function TranscriptInput(props) {
    const { onChange, path, pluginOptions: options, readOnly, schemaType, value } = props;
    const accent = useAccent();
    const { call, client } = useHandler(options);
    const connection = useConnection(call);
    const document = useFormValue([]);
    // The object holding this field: the document itself, or an object field inside it.
    const parent = useFormValue(path.slice(0, -1));
    const audioField = schemaType.options?.audioField;
    const refs = siblingFileRefs(parent, audioField);
    const refsKey = refs.join(',');
    const [asset, setAsset] = useState();
    useEffect(() => {
        let live = true;
        setAsset(undefined);
        findAudio(client, refsKey ? refsKey.split(',') : []).then((a) => live && setAsset(a ?? null), () => live && setAsset(null));
        return () => {
            live = false;
        };
    }, [client, refsKey]);
    const [starting, setStarting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [progress, setProgress] = useState({});
    const [error, setError] = useState();
    // A short note after a job ends. Inline rather than a toast: Sanity UI moved its toasts between versions.
    const [notice, setNotice] = useState();
    useEffect(() => {
        if (!notice)
            return;
        const t = setTimeout(() => setNotice(undefined), 5000);
        return () => clearTimeout(t);
    }, [notice]);
    const valueRef = useRef(value);
    valueRef.current = value;
    /** Write fields of the transcript object (null removes one). */
    const apply = useCallback((fields) => {
        if (readOnly)
            return;
        onChange([
            setIfMissing({ _type: TRANSCRIPT_TYPE }),
            ...Object.entries(fields).map(([k, v]) => (v === null || v === undefined ? unset([k]) : set(v, [k]))),
        ]);
    }, [onChange, readOnly]);
    const finish = useCallback((outcome) => {
        apply(outcome.kind === 'stopped' ? restored(valueRef.current) : outcome.save);
        setProgress({});
        if (outcome.kind === 'stopped')
            setNotice('Transcription stopped.');
        else if (outcome.kind === 'done')
            setNotice('Transcript ready.');
    }, [apply]);
    // Follow a running job, also one started before a reload or from the document action:
    // recordingId and status are saved on the document.
    const status = value?.status ?? 'idle';
    const recordingId = value?.recordingId;
    useEffect(() => {
        if (status !== 'processing' || !recordingId)
            return;
        let cancelled = false;
        let timer;
        const tick = async () => {
            try {
                const outcome = await call(`/recordings/${encodeURIComponent(recordingId)}/job`);
                if (cancelled)
                    return;
                setError(undefined);
                if (outcome.kind === 'processing') {
                    setProgress(outcome);
                    timer = setTimeout(tick, POLL_MS);
                }
                else
                    finish(outcome);
            }
            catch (err) {
                if (cancelled)
                    return;
                // A network blip or a server hiccup should not end the wait; anything refused should.
                if (err instanceof HandlerError && err.status && err.status < 500)
                    return setError(err.message);
                if (err instanceof HandlerError && err.status)
                    setError(err.message);
                timer = setTimeout(tick, POLL_MS * 2);
            }
        };
        void tick();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [call, finish, recordingId, status]);
    const transcribe = async () => {
        if (!asset)
            return;
        setError(undefined);
        setNotice(undefined);
        setStarting(true);
        setProgress({});
        try {
            const body = { assetId: asset._id, documentId: document._id, fieldPath: pathString(path), name: jobName(document, asset) };
            apply({ ...(await call('/transcriptions', { body, method: 'POST' })), error: null });
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setStarting(false);
        }
    };
    /** Stop the job. The field goes back to how it was; VocalStack keeps what it heard so far. */
    const stop = async () => {
        if (!recordingId)
            return;
        if (!window.confirm('Stop transcribing? What VocalStack has transcribed so far stays in your VocalStack dashboard.'))
            return;
        setStopping(true);
        try {
            const outcome = await call(`/recordings/${encodeURIComponent(recordingId)}/stop`, { method: 'POST' });
            if (outcome.kind !== 'processing')
                finish(outcome);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setStopping(false);
        }
    };
    const busy = status === 'processing';
    const shownError = error ?? (status === 'failed' ? (value?.error ?? undefined) : undefined);
    const partialText = useMemo(() => (busy && progress.partial?.length ? transcriptText(progress.partial) : undefined), [busy, progress.partial]);
    const muted = { muted: true, size: 1 };
    let action;
    if (!connection)
        action = _jsx(Text, { ...muted, children: "Checking the VocalStack connection\u2026" });
    else if (!connection.connected) {
        action = (_jsx(Card, { padding: 2, radius: 2, tone: "caution", children: _jsx(Text, { size: 1, children: connection.error ?? 'VocalStack is not connected.' }) }));
    }
    else if (asset === undefined && refs.length)
        action = _jsx(Text, { ...muted, children: "Looking for the audio file\u2026" });
    else if (!asset && !busy)
        action = _jsx(Text, { ...muted, children: refs.length ? 'Only audio files can be transcribed.' : 'Add an audio file, then transcribe.' });
    else {
        action = (_jsxs(Flex, { gap: 2, wrap: "wrap", children: [_jsx(Button, { disabled: busy || starting || readOnly || !asset, onClick: transcribe, text: busy || starting ? 'Transcribing…' : status === 'done' ? 'Transcribe again' : 'Transcribe', tone: "primary" }), busy && _jsx(Button, { disabled: stopping || readOnly, mode: "ghost", onClick: stop, text: stopping ? 'Stopping…' : 'Stop' })] }));
    }
    return (_jsx(Card, { border: true, padding: 3, radius: 2, children: _jsxs(Stack, { space: 3, children: [_jsx(Logo, { height: 14 }), action, busy && (_jsxs(Stack, { space: 2, children: [_jsxs(Text, { ...muted, children: [PHASES[progress.phase ?? 'queued'] ?? progress.phase, progress.progress ? ` · ${progress.progress}%` : '…', progress.audio?.totalS ? ` · ${clock(progress.audio.processedS)} of ${clock(progress.audio.totalS)}` : ''] }), _jsx(Card, { radius: 1, style: { height: 4, overflow: 'hidden' }, tone: "transparent", children: _jsx("div", { style: { background: accent, height: '100%', transition: 'width .4s', width: `${progress.progress || 2}%` } }) })] })), notice && (_jsx(Card, { padding: 2, radius: 2, tone: "positive", children: _jsx(Text, { size: 1, children: notice }) })), !busy && status === 'done' && !shownError && (_jsxs(Text, { ...muted, children: ["Transcribed", value?.language ? ` (${value.language})` : '', value?.sentences?.length ? ` · ${value.sentences.length} sentences with timings` : '', "."] })), shownError && (_jsx(Card, { padding: 2, radius: 2, tone: "critical", children: _jsx(Text, { size: 1, children: shownError }) })), (partialText || value?.transcript) && (_jsx(Box, { children: _jsx(TextArea, { onChange: (e) => {
                            const text = e.currentTarget.value;
                            onChange([setIfMissing({ _type: TRANSCRIPT_TYPE }), text ? set(text, ['transcript']) : unset(['transcript'])]);
                        }, readOnly: readOnly || Boolean(partialText), rows: 10, value: partialText ?? value?.transcript ?? '' }) }))] }) }));
}
