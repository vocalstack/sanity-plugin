/**
 * The handful of VocalStack API calls the plugin needs, on plain fetch (the
 * SDK is not on npm yet). Contract: https://api.vocalstack.com/v1/openapi.json
 */
export const DEFAULT_API_URL = 'https://api.vocalstack.com';
/** Sent as the User-Agent of every call to VocalStack (they run in the
 *  handler, on the server): VocalStack lists the transcriptions it makes
 *  as made in Sanity. Keep it to package.json's version. */
export const PLUGIN_VERSION = '0.2.0';
export const DEFAULT_DASHBOARD_URL = 'https://app.vocalstack.com';
export class VocalStackAPIError extends Error {
    code;
    status;
    constructor(status, code, message) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
export class VocalStackAPI {
    apiKey;
    baseURL;
    constructor(apiKey, baseURL = DEFAULT_API_URL) {
        this.apiKey = apiKey;
        this.baseURL = baseURL;
    }
    async request(method, path, body, headers = {}) {
        const init = { headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}`, 'user-agent': `VocalStack-Sanity/${PLUGIN_VERSION}`, ...headers }, method };
        if (body instanceof FormData)
            init.body = body;
        else if (body !== undefined) {
            init.body = JSON.stringify(body);
            init.headers['content-type'] = 'application/json';
        }
        const res = await fetch(`${this.baseURL}${path}`, init);
        const data = await res.json().catch(() => undefined);
        if (!res.ok) {
            const err = (data?.error ?? data);
            throw new VocalStackAPIError(res.status, err?.code ?? 'http_error', err?.message ?? `VocalStack answered ${res.status}`);
        }
        return data;
    }
    me() {
        return this.request('GET', '/v1/me');
    }
    transcribeURL(url, opts) {
        return this.request('POST', '/v1/transcriptions', { name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined, url }, { 'idempotency-key': opts.idempotencyKey });
    }
    transcribeFile(file, fileName, opts) {
        const form = new FormData();
        form.append('options', JSON.stringify({ name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined }));
        form.append('file', file, fileName);
        return this.request('POST', '/v1/transcriptions', form, { 'idempotency-key': opts.idempotencyKey });
    }
    job(recordingId) {
        return this.request('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/job`);
    }
    /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
    stop(recordingId, reason) {
        return this.request('POST', `/v1/recordings/${encodeURIComponent(recordingId)}/stop`, { reason: reason ?? null });
    }
    transcript(recordingId) {
        return this.request('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/transcript`);
    }
}
/** A short label for the connected account, from whatever `/v1/me` carries. */
export function accountLabel(me) {
    const pick = (o, ...keys) => {
        if (!o || typeof o !== 'object')
            return undefined;
        for (const k of keys) {
            const v = o[k];
            if (typeof v === 'string' && v)
                return v;
        }
    };
    return pick(me.principal, 'name', 'displayName') ?? pick(me.organization, 'name') ?? pick(me.user, 'email', 'name') ?? pick(me, 'email', 'name', 'displayName');
}
/**
 * The workspace the key belongs to, from `/v1/me` (`workspace: { id, name, personal,
 * iconUrl }`), with the icon's link made absolute against the API's address. Undefined
 * when the API does not say (an older VocalStack).
 */
export function workspaceOf(me, baseURL = DEFAULT_API_URL) {
    const w = me.workspace;
    if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id || typeof w.name !== 'string' || !w.name.trim())
        return undefined;
    let iconUrl = null;
    if (typeof w.iconUrl === 'string' && w.iconUrl) {
        try {
            const url = new URL(w.iconUrl, baseURL);
            if (url.protocol === 'https:' || url.protocol === 'http:')
                iconUrl = url.href;
        }
        catch { }
    }
    return { iconUrl, id: w.id, name: w.name, personal: w.personal === true };
}
