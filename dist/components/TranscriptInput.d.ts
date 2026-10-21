import type { ObjectInputProps, Path } from 'sanity';
import type { VocalStackPluginOptions, VocalStackTranscript } from '../types.js';
/** `['body', { _key: 'a1' }, 'transcript']` → `body[_key=="a1"].transcript`, for the job's idempotency key. */
export declare const pathString: (path: Path) => string;
export declare function TranscriptInput(props: ObjectInputProps<VocalStackTranscript> & {
    pluginOptions: VocalStackPluginOptions;
}): import("react").JSX.Element;
