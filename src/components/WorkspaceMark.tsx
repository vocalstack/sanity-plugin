import { useEffect, useState } from 'react'

import type { ConnectionWorkspace } from '../wire.js'

import { workspaceHue, workspaceInitials } from '../workspaceMark.js'
import { useDark } from './Brand.js'

const PERSON =
  'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z'

/**
 * A workspace's mark, as the VocalStack Dashboard draws it: its own icon when it has
 * one; else a person for the personal workspace; else its initials on its colour.
 */
export function WorkspaceMark({ size = 20, workspace }: { size?: number; workspace: ConnectionWorkspace }) {
  const dark = useDark()
  const { iconUrl } = workspace
  // An icon that does not load (a link signed long ago, a network that blocks it) gives way to the drawn mark.
  const [broken, setBroken] = useState<string>()
  useEffect(() => setBroken(undefined), [iconUrl])

  const ink = dark ? '#fff' : '#101112'
  const hair = `inset 0 0 0 1px color-mix(in oklab, ${ink} 14%, transparent)`
  const tile: React.CSSProperties = {
    alignItems: 'center',
    borderRadius: Math.round(size * 0.29),
    display: 'inline-flex',
    flex: 'none',
    fontSize: Math.round(size * 0.39),
    fontWeight: 600,
    height: size,
    justifyContent: 'center',
    letterSpacing: '.02em',
    lineHeight: 1,
    width: size,
  }

  if (iconUrl && broken !== iconUrl) {
    return (
      <span aria-hidden="true" data-mark="icon" style={{ ...tile, background: `color-mix(in oklab, ${ink} 6%, transparent)`, boxShadow: hair, overflow: 'hidden' }}>
        <img alt="" draggable={false} onError={() => setBroken(iconUrl)} src={iconUrl} style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }} />
      </span>
    )
  }
  if (workspace.personal) {
    const glyph = Math.round(size * 0.55)
    return (
      <span aria-hidden="true" data-mark="personal" style={{ ...tile, background: `color-mix(in oklab, ${ink} 9%, transparent)`, boxShadow: hair, color: `color-mix(in oklab, ${ink} 70%, transparent)` }}>
        <svg fill="none" height={glyph} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} viewBox="0 0 24 24" width={glyph}>
          <path d={PERSON} />
        </svg>
      </span>
    )
  }
  const colour = `oklch(.66 .13 ${workspaceHue(workspace.id)})`
  return (
    <span
      aria-hidden="true"
      data-mark="initials"
      style={{
        ...tile,
        background: `color-mix(in oklab, ${colour} 22%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colour} 30%, transparent)`,
        color: `color-mix(in oklab, ${colour} 72%, ${ink})`,
      }}
    >
      {workspaceInitials(workspace.name)}
    </span>
  )
}
