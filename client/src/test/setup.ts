import '@testing-library/jest-dom/vitest';

// Radix UI primitives (Popover, used by CitationBadge/DocumentScopeBar/etc.)
// call these browser APIs, which jsdom doesn't implement. Minimal
// polyfills so component tests can render them without crashing - the
// tests care about content/behavior, not real layout measurement.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
