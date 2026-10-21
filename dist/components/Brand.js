import { jsx as _jsx } from "react/jsx-runtime";
import { useRootTheme } from '@sanity/ui';
import { BRAND, LOGO_DARK, LOGO_LIGHT, MARK_DARK, MARK_LIGHT } from './brandAssets.js';
/** Whether the Studio is in its dark scheme. */
export function useDark() {
    try {
        return useRootTheme().scheme === 'dark';
    }
    catch {
        return false;
    }
}
/** The accent for progress bars, following the Studio's scheme. */
export const useAccent = () => (useDark() ? BRAND.lightBlue : BRAND.blue);
/** The artwork has no width or height of its own: size it by the wrapper's height. */
const sized = (svg) => svg.replace('<svg ', '<svg style="height:100%;width:auto" ');
const Art = ({ dark, height, label, light }) => (_jsx("span", { "aria-label": label, dangerouslySetInnerHTML: { __html: sized(useDark() ? dark : light) }, role: label ? 'img' : undefined, style: { display: 'inline-flex', height, lineHeight: 0, verticalAlign: 'middle' } }));
/** The VocalStack wordmark. */
export const Logo = ({ height = 16 }) => _jsx(Art, { dark: LOGO_DARK, height: height, label: "VocalStack", light: LOGO_LIGHT });
/** The V on its own, for small spaces (the tool's icon). */
export const Mark = ({ height = 18 }) => _jsx(Art, { dark: MARK_DARK, height: height, light: MARK_LIGHT });
