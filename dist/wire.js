/** The document type of a Studio session (see `SESSION_PREFIX`). */
export const SESSION_TYPE = 'vocalstack.session';
/** Session ids are `vocalstack-session.<sha256 hex of the secret>`: dotted, so never public. */
export const SESSION_PREFIX = 'vocalstack-session.';
/** How long a Studio session lasts, from the session document's `_updatedAt`. */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export async function sha256Hex(text) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
