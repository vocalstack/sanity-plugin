export type { ConnectionResponse, JobOutcome, StartRequest, StartResponse } from '../wire.js';
export type VocalStackHandlerOptions = {
    /** A VocalStack API key (`vs_key_…`, Read + Write). Default: `process.env.VOCALSTACK_API_KEY`. */
    apiKey?: string;
    /** The dataset the Studio edits, and a token that can read it (a Viewer token is enough). */
    sanity: {
        apiVersion?: string;
        dataset: string;
        projectId: string;
        token: string;
    };
    /** A Whisper language code (`en`, `ro`, …). Leave out to auto-detect. */
    spokenLanguage?: string;
    /**
     * The public URL VocalStack fetches the audio from. Default: the asset's URL on
     * Sanity's CDN. Return a signed URL here if your assets are private.
     */
    fileURL?: (asset: SanityFileAsset) => Promise<string | undefined> | string | undefined;
    /**
     * Origins allowed to call the handler (the Studio's), e.g. `['https://my.sanity.studio']`.
     * Default: any. Callers prove themselves with a Studio session, not a cookie, so any origin is safe.
     */
    allowedOrigins?: string[];
    /** Default https://api.vocalstack.com */
    apiURL?: string;
};
export type SanityFileAsset = {
    _id: string;
    mimeType?: string;
    originalFilename?: string;
    url?: string;
};
type Handler = (request: Request) => Promise<Response>;
export declare function createVocalStackHandler(options: VocalStackHandlerOptions): Handler;
