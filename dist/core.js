export const TRANSCRIPT_TYPE = 'vocalstack.transcript';
export const POLL_MS = 3000;
export const API_VERSION = '2024-01-01';
const fileRef = (v) => {
    const ref = v?.asset?._ref;
    return typeof ref === 'string' && ref.startsWith('file-') ? ref : undefined;
};
/** The file asset ids next to a transcript: the one in `audioField`, or every sibling file. */
export function siblingFileRefs(siblings, audioField) {
    if (!siblings)
        return [];
    if (audioField)
        return [fileRef(siblings[audioField])].filter((r) => Boolean(r));
    return Object.values(siblings).map(fileRef).filter((r) => Boolean(r));
}
/** The first of these assets that is audio (in the order given). */
export async function findAudio(client, refs) {
    if (!refs.length)
        return undefined;
    const assets = await client.fetch('*[_id in $ids]{ _id, url, mimeType, originalFilename }', { ids: refs });
    return refs.map((id) => assets.find((a) => a._id === id)).find((a) => a?.mimeType?.startsWith('audio/'));
}
/** The transcription's name in VocalStack: the document's title, else the file's name. */
export function jobName(document, asset) {
    for (const key of ['title', 'name', 'heading']) {
        const v = document[key];
        if (typeof v === 'string' && v.trim())
            return v.trim();
    }
    return asset.originalFilename ?? `${document._type} ${document._id.replace(/^drafts\./, '')}`;
}
/** A stopped job leaves the field as it was before Transcribe: the earlier transcript, if any. */
export const restored = (value) => ({
    error: null,
    status: (value?.transcript ? 'done' : 'idle'),
});
