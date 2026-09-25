/**
 * Service worker registration (story 13, offline.app_shell).
 *
 * Registers the service worker if available. In dev mode
 * (vite dev server), registration is skipped.
 */
export function registerSw(): void {
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const base = import.meta.env.BASE_URL ?? '/';
  const swUrl = base + 'sw.js';

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope: base }).catch(() => {
      // Registration failed — the app still works online;
      // shell caching is a progressive enhancement.
    });
  });
}
