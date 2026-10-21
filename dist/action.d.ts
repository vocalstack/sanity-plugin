import type { DocumentActionComponent, SchemaType } from 'sanity';
import type { VocalStackPluginOptions, VocalStackTranscript } from './types.js';
type Found = {
    path: string[];
    siblings: Record<string, unknown> | undefined;
    value: VocalStackTranscript | undefined;
    audioField?: string;
};
/** Transcript fields in a document: top level and inside object fields (not arrays). */
export declare function transcriptFields(type: SchemaType | undefined, doc?: Record<string, unknown>, path?: string[], depth?: number): Found[];
/** "Transcribe audio": start a job for every transcript field next to an audio file. The field's input follows it. */
export declare const transcribeAction: (options: VocalStackPluginOptions) => DocumentActionComponent;
export {};
