import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Recharts measures its container; jsdom reports 0x0 so every chart renders "empty".
// A fixed non-zero box keeps responsive containers from collapsing in tests.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  value: 800,
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  value: 400,
});
/**
 * Recharts' ResponsiveContainer measures its parent and renders nothing at
 * 0x0. jsdom performs no layout, so the observer is faked to report a fixed
 * box the moment an element is observed; otherwise every chart would be empty
 * and chart assertions would be vacuous.
 */
class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            width: 800,
            height: 300,
            bottom: 300,
            right: 800,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// Recharts also reads offsetWidth/offsetHeight for its initial measurement.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return 800;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 300;
  },
});