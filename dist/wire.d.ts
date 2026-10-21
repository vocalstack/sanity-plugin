/**
 * What the Studio and the server handler say to each other. No imports: both
 * the Studio bundle and the server use it.
 */
import type { TranscriptSentence, VocalStackTranscript } from './types.js';
/** Where a job stands. `save` carries the fields to write on the document once it is over. */
export type JobOutcome = {
    audio?: {
        processedS: number;
        totalS?: number;
    };
    kind: 'processing';
    partial?: TranscriptSentence[];
    phase: string;
    progress: number;
} | {
    kind: 'done' | 'failed';
    message?: string;
    save: VocalStackTranscript;
}
/** Stopped before it finished: the Studio puts the field back to how it was. */
 | {
    kind: 'stopped';
};
/** `POST {handlerURL}/transcriptions` */
export type StartRequest = {
    /** The `sanity.fileAsset` id of the audio. The handler reads its URL and type itself. */
    assetId: string;
    documentId: string;
    /** The transcript field's path in the document, for the job's idempotency key. */
    fieldPath: string;
    /** The transcription's name in VocalStack. Default: the file's name. */
    name?: string;
};
export type StartResponse = Required<Pick<VocalStackTranscript, 'recordingId' | 'status' | 'transcriptionId'>>;
/** `GET {handlerURL}/connection` */
export type ConnectionResponse = {
    account?: string;
    connected: boolean;
};
/** Every error: `{ code?, error }`. `session` means the Studio should prove itself again. */
export type ErrorResponse = {
    code?: string;
    error: string;
};
/** The document type of a Studio session (see `SESSION_PREFIX`). */
export declare const SESSION_TYPE = "vocalstack.session";
/** Session ids are `vocalstack-session.<sha256 hex of the secret>`: dotted, so never public. */
export declare const SESSION_PREFIX = "vocalstack-session.";
/** How long a Studio session lasts, from the session document's `_updatedAt`. */
export declare const SESSION_MAX_AGE_MS: number;
export declare function sha256Hex(text: string): Promise<string>;
