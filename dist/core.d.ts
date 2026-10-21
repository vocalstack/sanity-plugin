import type { SanityClient, SanityDocument } from 'sanity';
import type { AudioAsset, VocalStackTranscript } from './types.js';
export declare const TRANSCRIPT_TYPE = "vocalstack.transcript";
export declare const POLL_MS = 3000;
export declare const API_VERSION = "2024-01-01";
/** The file asset ids next to a transcript: the one in `audioField`, or every sibling file. */
export declare function siblingFileRefs(siblings: Record<string, unknown> | undefined, audioField?: string): string[];
/** The first of these assets that is audio (in the order given). */
export declare function findAudio(client: SanityClient, refs: string[]): Promise<AudioAsset | undefined>;
/** The transcription's name in VocalStack: the document's title, else the file's name. */
export declare function jobName(document: SanityDocument, asset: AudioAsset): string;
/** A stopped job leaves the field as it was before Transcribe: the earlier transcript, if any. */
export declare const restored: (value: VocalStackTranscript | undefined) => VocalStackTranscript;
