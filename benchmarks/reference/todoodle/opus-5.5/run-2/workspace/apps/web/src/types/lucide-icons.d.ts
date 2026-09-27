// Per-icon imports (`lucide-react/icons/<name>`) keep the bundle to the icons actually used.
// lucide-react ships no subpath exports, so Vite aliases these to dist/esm/icons/<name>.mjs.
declare module 'lucide-react/icons/*' {
  import type { LucideIcon } from 'lucide-react';
  const Icon: LucideIcon;
  export default Icon;
}
