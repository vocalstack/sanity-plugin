import { VocalStackAPIError } from '../api.js';
import { transcriptText } from '../text.js';
/** A transcript's sentences: seconds, speaker, text. */
export function toSentences(t) {
    return t.sentences
        .filter((s) => !s.suppressed && s.text.trim())
        .map(({ end, sentenceId, speaker, start, text }) => ({ id: sentenceId, end, speaker, start, text: text.trim() }));
}
const round = (n) => Math.round(n * 1000) / 1000;
/** As stored on the document: an array item needs a `_key`. */
export const toSaved = (sentences) => sentences.map((s, i) => ({ _key: `s${s.id ?? i}`, _type: 'sentence', end: round(s.end), speaker: s.speaker, start: round(s.start), text: s.text }));
export async function checkJob(api, recordingId) {
    const job = await api.job(recordingId);
    if (job.state === 'stopped' || (job.state === 'failed' && job.errorCode === 'stopped'))
        return { kind: 'stopped' };
    if (job.state === 'failed' || job.state === 'cropping') {
        const error = job.state === 'cropping' ? 'VocalStack is waiting for a crop window; open the transcription in VocalStack.' : (job.error ?? 'The transcription failed.');
        return { kind: 'failed', message: error, save: { error, status: 'failed' } };
    }
    if (job.state !== 'done') {
        const progress = job.state === 'fetching' ? (job.progress.phasePct ?? 0) : job.progress.pct;
        if (job.state !== 'transcribing')
            return { kind: 'processing', phase: job.progress.phase ?? job.state, progress };
        // Sentences are readable while the job runs; send what is there so far.
        const partial = await api.transcript(recordingId).then(toSentences, () => undefined);
        return { audio: { processedS: job.progress.processedS ?? 0, totalS: job.progress.totalS ?? undefined }, kind: 'processing', partial, phase: 'transcribing', progress };
    }
    const transcript = await api.transcript(recordingId);
    const sentences = toSentences(transcript);
    return {
        kind: 'done',
        save: {
            error: null,
            language: transcript.lang ?? transcript.sentences.find((s) => s.language)?.language ?? null,
            sentences: toSaved(sentences),
            status: 'done',
            transcribedAt: new Date().toISOString(),
            transcript: transcriptText(sentences),
        },
    };
}
/** Stop a job. If it ended meanwhile, take its outcome instead. */
export async function stopJob(api, recordingId) {
    try {
        await api.stop(recordingId, 'Stopped from Sanity');
        return { kind: 'stopped' };
    }
    catch (err) {
        if (err instanceof VocalStackAPIError && err.status === 409)
            return checkJob(api, recordingId).catch(() => ({ kind: 'stopped' }));
        throw err;
    }
}
