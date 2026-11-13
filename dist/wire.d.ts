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
export type StartResponse = Required<Pick<VocalStackTranscript, 'status' | 'transcriptionId'>>;
/** `GET {handlerURL}/connection` */
export type ConnectionResponse = {
    /** The workspace's name; against an older VocalStack, the key's label. */
    account?: string;
    connected: boolean;
    /** The workspace the handler's API key belongs to. Absent against a VocalStack that does not say. */
    workspace?: ConnectionWorkspace;
};
/**
 * A VocalStack workspace. `iconUrl` is its own icon as an absolute link that needs no
 * key (re-signed from time to time, so not for keeping), or null when it has none.
 */
export type ConnectionWorkspace = {
    iconUrl: null | string;
    id: string;
    name: string;
    personal: boolean;
};
/** The handler's `code` when a transcription is not in the workspace its key belongs to. */
export declare const NOT_IN_WORKSPACE = "not_in_workspace";
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
