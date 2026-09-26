import { cn } from '@/lib/utils';

/**
 * A project's colour dot. Decorative (aria-hidden): the name is always shown beside it, so colour never
 * carries meaning alone. The colour is the theme's --project-<key> token (light and dark values, each at
 * least 3:1 against the backgrounds), set through CSSOM (allowed by the CSP, unlike a style attribute).
 */
export function ProjectDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-project-dot={color}
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: `var(--project-${color})` }}
    />
  );
}
