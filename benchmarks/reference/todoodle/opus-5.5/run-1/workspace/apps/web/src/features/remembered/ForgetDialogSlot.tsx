import { Suspense, useState } from 'react';
import type { ForgetDialogProps } from './ForgetDialog';
import { LazyForgetDialog } from './forgetDialogLoader';

/** Mounts the lazy forget dialog the first time it opens, then keeps it mounted so it can animate closed. */
export function ForgetDialogSlot(props: ForgetDialogProps) {
  const [mounted, setMounted] = useState(props.open);
  if (props.open && !mounted) setMounted(true);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <LazyForgetDialog {...props} />
    </Suspense>
  );
}
