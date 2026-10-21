import { jsx as _jsx } from "react/jsx-runtime";
import { defineField, defineType } from 'sanity';
import { TranscriptInput } from './components/TranscriptInput.js';
import { TRANSCRIPT_TYPE } from './core.js';
/**
 * `vocalstack.transcript`: an object field to put next to a `file` field. Its input
 * renders the Transcribe button, the progress and the editable transcript; the rest
 * is written by the plugin and readable with GROQ like any field.
 */
export const transcriptType = (options) => defineType({
    name: TRANSCRIPT_TYPE,
    title: 'Transcript',
    type: 'object',
    fields: [
        defineField({ name: 'transcript', title: 'Transcript', type: 'text', description: 'Paragraphs break on a speaker change or a pause.' }),
        defineField({
            name: 'sentences',
            title: 'Sentences',
            description: 'Timed sentences, in seconds, for captions or a synced player.',
            type: 'array',
            readOnly: true,
            of: [
                {
                    name: 'sentence',
                    type: 'object',
                    fields: [
                        defineField({ name: 'start', type: 'number' }),
                        defineField({ name: 'end', type: 'number' }),
                        defineField({ name: 'speaker', type: 'number' }),
                        defineField({ name: 'text', type: 'string' }),
                    ],
                },
            ],
        }),
        defineField({
            name: 'status',
            type: 'string',
            initialValue: 'idle',
            readOnly: true,
            options: { list: ['idle', 'processing', 'done', 'failed'] },
        }),
        defineField({ name: 'language', type: 'string', readOnly: true }),
        defineField({ name: 'error', type: 'string', readOnly: true }),
        defineField({ name: 'recordingId', title: 'Recording ID', type: 'string', readOnly: true }),
        defineField({ name: 'transcriptionId', title: 'Transcription ID', type: 'string', readOnly: true }),
        defineField({ name: 'transcribedAt', type: 'datetime', readOnly: true }),
    ],
    components: {
        input: (props) => _jsx(TranscriptInput, { ...props, pluginOptions: options }),
    },
});
