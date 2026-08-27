import { useEffect, useState } from 'react';
import * as THREE from 'three';

function readColors() {
  if (typeof window === 'undefined') {
    // SSR/test-environment guard - arbitrary but valid colors, never
    // actually rendered in that context.
    return { accent: new THREE.Color('#2ed9b3'), highlight: new THREE.Color('#ff7a47'), bg: new THREE.Color('#0b0f16'), isDark: true };
  }
  const isDark = document.documentElement.classList.contains('dark');
  const styles = getComputedStyle(document.documentElement);
  const read = (varName: string, fallback: string) => {
    const value = styles.getPropertyValue(varName).trim();
    return new THREE.Color(value || fallback);
  };
  return {
    accent: read('--accent', '#2ed9b3'),
    highlight: read('--highlight', '#ff7a47'),
    bg: read('--bg', '#0b0f16'),
    isDark,
  };
}

/**
 * Reads the CURRENT Ledger accent/highlight/bg CSS custom properties into
 * THREE.Color objects. Reads from getComputedStyle rather than importing
 * hardcoded hex values, so this automatically follows Ledger's light/dark
 * toggle (already on Hero, see ThemeToggle) without needing its own color
 * definitions that could drift out of sync with index.css over time.
 *
 * Deliberately driven by a MutationObserver watching <html>'s class
 * attribute, NOT by a useEffect/useMemo keyed on the `theme` value alone -
 * this fixes a real bug where the colors could end up one toggle behind.
 * ThemeContext's toggle updates `theme` state and, in a SEPARATE
 * useEffect on the ThemeProvider itself, applies the `.dark` class to
 * <html>. React runs effects bottom-up (children before parents), so at
 * the moment a descendant's own effect fires, there's no guarantee the
 * ancestor ThemeProvider's class-toggling effect has run yet - reading
 * getComputedStyle at that point can return the PREVIOUS theme's values.
 * A MutationObserver sidesteps this entirely: it fires only once the
 * class attribute has actually changed in the DOM, independent of React's
 * render/commit/effect ordering, so this can never be stale.
 */
export function useThemeColors() {
  const [colors, setColors] = useState(readColors);

  useEffect(() => {
    const update = () => setColors(readColors());
    update(); // catch any change that happened between initial render and this effect attaching
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return colors;
}
