/**
 * The handful of VocalStack API calls the plugin needs, on plain fetch (the
 * SDK is not on npm yet). Contract: https://api.vocalstack.com/v1/openapi.json
 */
import type { ConnectionWorkspace } from './wire.js';
export declare const DEFAULT_API_URL = "https://api.vocalstack.com";
/** Sent as the User-Agent of every call to VocalStack (they run in the
 *  handler, on the server): VocalStack lists the transcriptions it makes
 *  as made in Sanity. Keep it to package.json's version. */
export declare const PLUGIN_VERSION = "0.3.0";
export declare const DEFAULT_DASHBOARD_URL = "https://app.vocalstack.com";
export type JobState = 'cropping' | 'done' | 'failed' | 'fetching' | 'queued' | 'stopped' | 'transcribing';
export type Job = {
    error?: null | string;
    /** Why a failed job failed; `stopped` when its owner stopped it. */
    errorCode?: null | string;
    progress: {
        pct: number;
        phase?: null | string;
        phasePct?: null | number;
        processedS?: number;
        totalS?: null | number;
    };
    state: JobState;
    transcriptionId: string;
};
export type Transcription = {
    id: string;
    job?: Job | null;
    name: string;
};
export type Transcript = {
    lang?: null | string;
    segments: {
        end: number;
        seq: number;
        start: number;
        suppressed?: boolean;
        words?: {
            end: number;
            start: number;
            text: string;
        }[] | null;
    }[];
    sentences: {
        end: number;
        language?: null | string;
        sentenceId: number;
        speaker: number;
        start: number;
        suppressed?: boolean;
        text: string;
    }[];
};
export declare class VocalStackAPIError extends Error {
    code: string;
    status: number;
    constructor(status: number, code: string, message: string);
}
export declare class VocalStackAPI {
    private apiKey;
    private baseURL;
    constructor(apiKey: string, baseURL?: string);
    private request;
    me(): Promise<Record<string, unknown>>;
    transcribeURL(url: string, opts: {
        idempotencyKey: string;
        name: string;
        spokenLanguage?: string;
    }): Promise<Transcription>;
    transcribeFile(file: Blob, fileName: string, opts: {
        idempotencyKey: string;
        name: string;
        spokenLanguage?: string;
    }): Promise<Transcription>;
    job(transcriptionId: string): Promise<Job>;
    /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
    stop(transcriptionId: string, reason?: string): Promise<unknown>;
    transcript(transcriptionId: string): Promise<Transcript>;
}
/** A short label for the connected account, from whatever `/v1/me` carries. */
export declare function accountLabel(me: Record<string, unknown>): string | undefined;
/**
 * The workspace the key belongs to, from `/v1/me` (`workspace: { id, name, personal,
 * iconUrl }`), with the icon's link made absolute against the API's address. Undefined
 * when the API does not say (an older VocalStack).
 */
export declare function workspaceOf(me: Record<string, unknown>, baseURL?: string): ConnectionWorkspace | undefined;
