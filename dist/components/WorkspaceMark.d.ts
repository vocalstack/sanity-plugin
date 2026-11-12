import type { ConnectionWorkspace } from '../wire.js';
/**
 * A workspace's mark, as the VocalStack Dashboard draws it: its own icon when it has
 * one; else a person for the personal workspace; else its initials on its colour.
 */
export declare function WorkspaceMark({ size, workspace }: {
    size?: number;
    workspace: ConnectionWorkspace;
}): import("react").JSX.Element;
