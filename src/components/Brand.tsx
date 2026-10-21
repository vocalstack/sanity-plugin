import { useRootTheme } from '@sanity/ui'

import { BRAND, LOGO_DARK, LOGO_LIGHT, MARK_DARK, MARK_LIGHT } from './brandAssets.js'

/** Whether the Studio is in its dark scheme. */
export function useDark(): boolean {
  try {
    return useRootTheme().scheme === 'dark'
  } catch {
    return false
  }
}

/** The accent for progress bars, following the Studio's scheme. */
export const useAccent = () => (useDark() ? BRAND.lightBlue : BRAND.blue)

/** The artwork has no width or height of its own: size it by the wrapper's height. */
const sized = (svg: string) => svg.replace('<svg ', '<svg style="height:100%;width:auto" ')

const Art: React.FC<{ dark: string; height: number; label?: string; light: string }> = ({ dark, height, label, light }) => (
  <span
    aria-label={label}
    dangerouslySetInnerHTML={{ __html: sized(useDark() ? dark : light) }}
    role={label ? 'img' : undefined}
    style={{ display: 'inline-flex', height, lineHeight: 0, verticalAlign: 'middle' }}
  />
)

/** The VocalStack wordmark. */
export const Logo: React.FC<{ height?: number }> = ({ height = 16 }) => <Art dark={LOGO_DARK} height={height} label="VocalStack" light={LOGO_LIGHT} />

/** The V on its own, for small spaces (the tool's icon). */
export const Mark: React.FC<{ height?: number }> = ({ height = 18 }) => <Art dark={MARK_DARK} height={height} light={MARK_LIGHT} />
