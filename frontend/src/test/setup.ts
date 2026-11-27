import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './server';

// Lazy routes import their chunk on first render, which can be slow under parallel test load.
configure({ asyncUtilTimeout: 5000 });

// ---- browser APIs jsdom does not implement ----

/** matchMedia that evaluates `(min-width: Npx)` against window.innerWidth, so tests can pick desktop or 360 px. */
function mediaMatches(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const w = window.innerWidth;
  if (min && w < Number(min[1])) return false;
  if (max && w > Number(max[1])) return false;
  return true;
}
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: mediaMatches(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
}

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);

// ---- MSW ----
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // Node's Request rejects jsdom's AbortSignal ("Expected signal to be an instance of AbortSignal").
  // Drop the signal in tests; real browsers keep abort behaviour.
  const intercepted = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) {
      const rest: RequestInit = { ...init };
      delete rest.signal;
      return intercepted(input, rest);
    }
    return intercepted(input, init);
  };
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  sessionStorage.clear();
  window.innerWidth = 1280;
});
afterAll(() => server.close());
