import { jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from '@sanity/ui';
import { useState } from 'react';
import { useDocumentOperation, useSchema } from 'sanity';
import { findAudio, jobName, siblingFileRefs, TRANSCRIPT_TYPE } from './core.js';
import { useHandler } from './handler.js';
import { Mark } from './components/Brand.js';
const isTranscript = (type) => {
    for (let t = type; t; t = t.type)
        if (t.name === TRANSCRIPT_TYPE)
            return true;
    return false;
};
/** Transcript fields in a document: top level and inside object fields (not arrays). */
export function transcriptFields(type, doc, path = [], depth = 0) {
    if (!type || type.jsonType !== 'object' || depth > 4)
        return [];
    return type.fields.flatMap((field) => {
        const value = doc?.[field.name];
        if (isTranscript(field.type)) {
            const audioField = field.type.options?.audioField;
            return [{ audioField, path: [...path, field.name], siblings: doc, value: value }];
        }
        return field.type.jsonType === 'object' ? transcriptFields(field.type, value, [...path, field.name], depth + 1) : [];
    });
}
/** "Transcribe audio": start a job for every transcript field next to an audio file. The field's input follows it. */
export const transcribeAction = (options) => {
    const TranscribeAudioAction = (props) => {
        const schema = useSchema();
        const { call, client } = useHandler(options);
        const { patch } = useDocumentOperation(props.id, props.type);
        const [running, setRunning] = useState(false);
        // What happened, in a popover under the action (Sanity UI moved its toasts between versions).
        const [message, setMessage] = useState();
        const doc = (props.draft ?? props.published);
        const targets = transcriptFields(schema.get(props.type), doc ?? undefined).filter((t) => siblingFileRefs(t.siblings, t.audioField).length);
        const idle = targets.filter((t) => t.value?.status !== 'processing');
        return {
            disabled: running || !doc || !idle.length || Boolean(patch.disabled),
            icon: () => _jsx(Mark, { height: 16 }),
            label: running ? 'Transcribing…' : 'Transcribe audio',
            dialog: message
                ? {
                    type: 'popover',
                    content: (_jsx(Box, { padding: 3, style: { maxWidth: 320 }, children: _jsx(Text, { size: 1, children: message }) })),
                    onClose: () => {
                        setMessage(undefined);
                        props.onComplete();
                    },
                }
                : undefined,
            title: !targets.length ? 'Add an audio file first.' : !idle.length ? 'Already transcribing.' : undefined,
            onHandle: async () => {
                if (!doc)
                    return;
                setRunning(true);
                let started = 0;
                try {
                    for (const t of idle) {
                        const asset = await findAudio(client, siblingFileRefs(t.siblings, t.audioField));
                        if (!asset)
                            continue;
                        const at = t.path.join('.');
                        const body = { assetId: asset._id, documentId: doc._id, fieldPath: at, name: jobName(doc, asset) };
                        const fields = await call('/transcriptions', { body, method: 'POST' });
                        patch.execute([
                            { setIfMissing: { [at]: { _type: TRANSCRIPT_TYPE } } },
                            { set: { [`${at}.status`]: fields.status, [`${at}.recordingId`]: fields.recordingId, [`${at}.transcriptionId`]: fields.transcriptionId } },
                            { unset: [`${at}.error`] },
                        ]);
                        started++;
                    }
                    setMessage(started ? 'Transcribing. The transcript appears in the field when it is ready.' : 'Only audio files can be transcribed.');
                }
                catch (err) {
                    setMessage(err.message);
                }
                finally {
                    setRunning(false);
                }
            },
        };
    };
    return TranscribeAudioAction;
};
