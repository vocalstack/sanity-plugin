export type VocalStackPluginOptions = {
    /**
     * Where the server handler (`@vocalstack/sanity/server`) is mounted, e.g.
     * `https://www.example.com/api/vocalstack`. The Studio calls only this URL;
     * the VocalStack API key stays on that server.
     */
    handlerURL: string;
};
/** Options on a `vocalstack.transcript` field itself. */
export type TranscriptFieldOptions = {
    /** The sibling `file` field holding the audio. Default: the first sibling file whose asset is `audio/*`. */
    audioField?: string;
};
/** What the plugin reads from a `sanity.fileAsset`. */
export type AudioAsset = {
    _id: string;
    mimeType?: null | string;
    originalFilename?: null | string;
    url?: null | string;
};
export type TranscriptStatus = 'done' | 'failed' | 'idle' | 'processing';
/** A sentence as stored on the document: seconds, and the speaker's number. */
export type SavedSentence = {
    _key: string;
    _type?: string;
    end: number;
    speaker: number;
    start: number;
    text: string;
};
/** The `vocalstack.transcript` value. */
export type VocalStackTranscript = {
    _type?: 'vocalstack.transcript';
    error?: null | string;
    language?: null | string;
    recordingId?: null | string;
    sentences?: null | SavedSentence[];
    status?: null | TranscriptStatus;
    transcript?: null | string;
    transcriptionId?: null | string;
    transcribedAt?: null | string;
};
/** [start, end, text], seconds. */
export type TranscriptWord = [number, number, string];
export type TranscriptSentence = {
    /** Live only: words heard after the last settled sentence. */
    draft?: boolean;
    end: number;
    /** VocalStack's sentenceId. */
    id?: number;
    speaker: number;
    start: number;
    text: string;
    words?: TranscriptWord[];
};
