export type { ConnectionResponse, JobOutcome, StartRequest, StartResponse } from '../wire.js';
export type VocalStackHandlerOptions = {
    /** A VocalStack API key (`vs_key_…`, Read + Write). Default: `process.env.VOCALSTACK_API_KEY`. */
    apiKey?: string;
    /**
     * The dataset the Studio edits, and a token that can read it (a Viewer token is enough).
     * `apiHost` and `useProjectHostname` work as in `@sanity/client`: requests go to
     * `https://<projectId>.api.sanity.io` unless you use a custom API domain.
     */
    sanity: {
        apiHost?: string;
        apiVersion?: string;
        dataset: string;
        projectId: string;
        token: string;
        useProjectHostname?: boolean;
    };
    /** A Whisper language code (`en`, `ro`, …). Leave out to auto-detect. */
    spokenLanguage?: string;
    /**
     * The URL of the audio. Default: the asset's URL on Sanity's CDN. Return a signed URL
     * here if your assets are private. VocalStack fetches a public URL itself; for one it
     * cannot reach (localhost, a private network) the handler reads the file and uploads it.
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
