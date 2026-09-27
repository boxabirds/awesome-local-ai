import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'border border-border bg-background text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  link: 'text-foreground underline-offset-4 hover:underline',
};

const SIZES: Record<ButtonSize, string> = {
  default: 'h-10 px-4',
  sm: 'h-9 px-3 text-sm',
  lg: 'h-12 px-6 text-base',
};

/** Shared class list so links styled as buttons (mailto) look identical. */
export function buttonClasses(variant: ButtonVariant = 'default', size: ButtonSize = 'default', className?: string) {
  return cn(
    'inline-flex touch-target items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}
