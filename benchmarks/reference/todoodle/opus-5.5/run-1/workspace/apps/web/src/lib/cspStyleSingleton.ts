/**
 * Drop-in replacement for `react-style-singleton` (aliased in vite.config.ts). The original injects
 * runtime <style> tags, which the CSP (default-src 'self', no inline styles) blocks and reports.
 * Radix's scroll lock only needs the rules for `body[data-scroll-locked]`; those ship statically in
 * src/styles/scroll-lock.css. Every export here is a no-op with the original's shape.
 */
export function stylesheetSingleton() {
  return { add: (_style: string) => {}, remove: () => {} };
}

export function styleHookSingleton() {
  return (_styles: string, _isDynamic?: boolean) => {};
}

export function styleSingleton() {
  return (_props: { styles: string; dynamic?: boolean }) => null;
}
