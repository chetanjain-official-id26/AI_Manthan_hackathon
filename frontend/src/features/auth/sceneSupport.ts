/**
 * The 3D login backdrop runs only where it is cheap and welcome:
 * desktop width, no reduced-motion preference, and WebGL available. Otherwise the static gradient stays.
 */
export function canRunLoginScene(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (!window.matchMedia('(min-width: 1024px)').matches) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
