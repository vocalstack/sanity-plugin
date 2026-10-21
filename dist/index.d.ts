import type { VocalStackPluginOptions } from './types.js';
export type * from './types.js';
export { timedTokens, transcriptText } from './text.js';
export { TRANSCRIPT_TYPE } from './core.js';
/**
 * VocalStack for Sanity: a `vocalstack.transcript` field with a Transcribe button and
 * a "Transcribe audio" document action. Both call the server handler at `handlerURL`
 * (`@vocalstack/sanity/server`), which holds the VocalStack API key.
 */
export declare const vocalstack: import("sanity").Plugin<VocalStackPluginOptions>;
