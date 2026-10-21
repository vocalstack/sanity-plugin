import { definePlugin } from 'sanity';
import { transcribeAction, transcriptFields } from './action.js';
import { transcriptType } from './schema.js';
export { timedTokens, transcriptText } from './text.js';
export { TRANSCRIPT_TYPE } from './core.js';
/**
 * VocalStack for Sanity: a `vocalstack.transcript` field with a Transcribe button and
 * a "Transcribe audio" document action. Both call the server handler at `handlerURL`
 * (`@vocalstack/sanity/server`), which holds the VocalStack API key.
 */
export const vocalstack = definePlugin((options) => {
    if (!options?.handlerURL)
        throw new Error('vocalstack(): set handlerURL to where the @vocalstack/sanity/server handler is mounted.');
    const action = transcribeAction(options);
    return {
        name: '@vocalstack/sanity',
        schema: { types: [transcriptType(options)] },
        document: {
            actions: (prev, ctx) => (transcriptFields(ctx.schema.get(ctx.schemaType)).length ? [...prev, action] : prev),
        },
    };
});
