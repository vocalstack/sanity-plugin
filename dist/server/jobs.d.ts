import type { TranscriptSentence, SavedSentence } from '../types.js';
import type { JobOutcome } from '../wire.js';
import { type Transcript, type VocalStackAPI } from '../api.js';
/** A transcript's sentences: seconds, speaker, text. */
export declare function toSentences(t: Pick<Transcript, 'sentences'>): TranscriptSentence[];
/** As stored on the document: an array item needs a `_key`. */
export declare const toSaved: (sentences: TranscriptSentence[]) => SavedSentence[];
export declare function checkJob(api: VocalStackAPI, recordingId: string): Promise<JobOutcome>;
/** Stop a job. If it ended meanwhile, take its outcome instead. */
export declare function stopJob(api: VocalStackAPI, recordingId: string): Promise<JobOutcome>;
