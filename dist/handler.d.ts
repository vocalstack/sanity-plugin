import type { SanityClient } from 'sanity';
import type { VocalStackPluginOptions } from './types.js';
import type { ConnectionResponse } from './wire.js';
export declare class HandlerError extends Error {
    code?: string;
    status: number;
    constructor(status: number, message: string, code?: string);
}
/** Calls to the server handler, signed with the Studio session. */
export declare function useHandler(options: VocalStackPluginOptions): {
    call: <T>(path: string, init?: {
        body?: unknown;
        method?: "GET" | "POST";
    }) => Promise<T>;
    client: SanityClient;
};
/** Whether the handler is up and has a VocalStack key. */
export declare function useConnection(call: ReturnType<typeof useHandler>['call']): (ConnectionResponse & {
    error?: string;
}) | undefined;
