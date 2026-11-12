/**
 * A workspace's mark when it has no icon of its own, exactly as the VocalStack
 * Dashboard draws it: its initials, on a tile tinted with its colour.
 */
/** "Acme studio" → "AS", "Podcast" → "PO"; words with no letter or digit are skipped. */
export declare function workspaceInitials(name: string): string;
/** The hue of a workspace's colour, `oklch(.66 .13 <hue>)`: always the same for one id. */
export declare function workspaceHue(id: string): number;
