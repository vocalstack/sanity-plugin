import type { VocalStackPluginOptions } from './types.js';
/**
 * `vocalstack.transcript`: an object field to put next to a `file` field. Its input
 * renders the Transcribe button, the progress and the editable transcript; the rest
 * is written by the plugin and readable with GROQ like any field.
 */
export declare const transcriptType: (options: VocalStackPluginOptions) => {
    type: "object";
    name: "vocalstack.transcript";
} & Omit<import("sanity").ObjectDefinition, "preview"> & {
    preview?: import("sanity").PreviewConfig<Record<string, string>, Record<never, any>> | undefined;
};
