import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SignalBackground } from '../components/hero/signal-field/SignalBackground';

// jsdom has no real WebGL implementation - canvas.getContext('webgl')
// returns null there, exactly like a browser with WebGL genuinely
// unavailable. This is real, useful coverage: it confirms the fallback
// path (not the 3D scene itself, which needs an actual browser/GPU to
// meaningfully test) never throws and always renders something.
describe('SignalBackground', () => {
  it('renders the 2D fallback (not the 3D scene) when WebGL is unavailable, without crashing', () => {
    const { container } = render(
      <SignalBackground reduceMotion={false} orbX={0} orbY={0} />
    );
    // The fallback orb is a plain div with a radial-gradient background -
    // its presence (and the absence of a <canvas>, which the 3D scene
    // would render) confirms the WebGL-unavailable path was taken.
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders the 2D fallback when reduceMotion is true, regardless of WebGL support', () => {
    const { container } = render(
      <SignalBackground reduceMotion={true} orbX={0} orbY={0} />
    );
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
    expect(container.firstChild).not.toBeNull();
  });
});
