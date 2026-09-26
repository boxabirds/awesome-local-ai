import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { type ShortcutGroup, type ShortcutInfo, listShortcuts } from '@/lib/shortcuts';

const GROUPS: ShortcutGroup[] = ['General', 'Tasks', 'Navigation'];

export type ShortcutsPanelProps = { open: boolean; onOpenChange: (open: boolean) => void };

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.map((key) => (
        <kbd key={key} className="min-w-7 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
          {key}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Every keyboard shortcut, grouped (General, Tasks, Navigation), keys shown as <kbd>. Escape closes it
 * and focus goes back to the element that had it when the panel opened. Loaded lazily.
 */
export default function ShortcutsPanel({ open, onOpenChange }: ShortcutsPanelProps) {
  // The element focused before opening; the panel has no Radix trigger to return to.
  const returnTo = useRef<Element | null>(null);
  if (open && returnTo.current === null) returnTo.current = document.activeElement;
  // A snapshot per open: the registry is not reactive, and nothing registers while the panel is up.
  const shortcuts: ShortcutInfo[] = open ? listShortcuts() : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          const target = returnTo.current;
          returnTo.current = null;
          if (target instanceof HTMLElement && target.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogTitle className="text-lg font-semibold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Shortcuts work when you are not typing in a field.</DialogDescription>
        {GROUPS.map((group) => {
          const items = shortcuts.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`shortcuts-${group}`} className="flex flex-col gap-2">
              <h3 id={`shortcuts-${group}`} className="text-sm font-semibold">
                {group}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {items.map((item) => (
                  <li key={`${item.keys.join('+')}:${item.description}`} className="flex items-center justify-between gap-4 text-sm">
                    <span>{item.description}</span>
                    <Keys keys={item.keys} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
