// Per-icon imports (`lucide-react/icons/<name>`) are aliased to the package's ESM files in vite.config.ts.
declare module 'lucide-react/icons/*' {
  import type { LucideIcon } from 'lucide-react';
  const icon: LucideIcon;
  export default icon;
}
