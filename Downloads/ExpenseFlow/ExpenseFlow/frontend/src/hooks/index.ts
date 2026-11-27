import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { requestBlob } from '@/api/client';
import { isTypingTarget } from '@/utils/misc';

export function useDebounce<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useIsTabletUp = () => useMediaQuery('(min-width: 768px)');

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

/**
 * Single-key shortcuts (case-insensitive) that ignore typing in form fields,
 * modified keys and keys pressed while a modal dialog is open.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // Let Enter/Space activate the focused control instead of a page-level shortcut.
      if (
        (key === 'Enter' || key === ' ') &&
        e.target instanceof HTMLElement &&
        e.target.closest('a,button,summary,[role="tab"],[role="option"],[role="radio"],[role="checkbox"]')
      ) {
        return;
      }
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export interface AuthedBlobState {
  url: string | null;
  contentType: string | null;
  fileName: string | null;
  loading: boolean;
  error: unknown;
  blob: Blob | null;
}

/** Fetches a protected binary (receipt) with the bearer token and exposes an object URL. */
export function useAuthedBlob(path: string | null): AuthedBlobState & { reload: () => void } {
  const [state, setState] = useState<AuthedBlobState>({
    url: null,
    contentType: null,
    fileName: null,
    loading: false,
    error: null,
    blob: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ url: null, contentType: null, fileName: null, loading: false, error: null, blob: null });
      return;
    }
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    setState((s) => ({ ...s, loading: true, error: null }));
    requestBlob(path, { signal: ctrl.signal })
      .then(({ blob, fileName }) => {
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, contentType: blob.type || null, fileName, loading: false, error: null, blob });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ url: null, contentType: null, fileName: null, loading: false, error, blob: null });
      });
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Re-renders every `intervalMs` so age badges stay current. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
