import { Component, type ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * A class component is still required for this - React has no hook
 * equivalent of componentDidCatch as of React 19. Scoped tightly around
 * just the 3D scene (see SignalBackground.tsx) so a WebGL context-creation
 * failure or an unexpected Three.js runtime error degrades to the
 * existing 2D orb instead of taking down the whole Hero page.
 */
export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[SignalBackground] 3D scene failed, falling back to the 2D orb:', error);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
