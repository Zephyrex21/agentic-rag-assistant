import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Reads the CURRENT Ledger accent/highlight/bg CSS custom properties into
 * THREE.Color objects. Deliberately reads from getComputedStyle rather
 * than importing hardcoded hex values, so this automatically follows
 * Ledger's light/dark toggle (already on Hero, see ThemeToggle) without
 * needing its own color definitions that could drift out of sync with
 * index.css over time.
 *
 * `theme` is taken as a dependency purely to trigger a re-read when the
 * toggle flips - the actual color values still come from the DOM, not
 * from `theme` itself, since Ledger's exact hex values live in one place
 * (index.css) and this should never need to know what they are.
 */
export function useThemeColors(theme: 'light' | 'dark') {
  return useMemo(() => {
    if (typeof window === 'undefined') {
      // SSR/test-environment guard - arbitrary but valid colors, never
      // actually rendered in that context.
      return { accent: new THREE.Color('#2ed9b3'), highlight: new THREE.Color('#ff7a47'), bg: new THREE.Color('#0b0f16') };
    }
    const styles = getComputedStyle(document.documentElement);
    const read = (varName: string, fallback: string) => {
      const value = styles.getPropertyValue(varName).trim();
      return new THREE.Color(value || fallback);
    };
    return {
      accent: read('--accent', '#2ed9b3'),
      highlight: read('--highlight', '#ff7a47'),
      bg: read('--bg', '#0b0f16'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
