import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { displayKey, listShortcuts, type ShortcutGroup, type ShortcutInfo } from '@/lib/shortcuts';

const GROUP_ORDER: ShortcutGroup[] = ['General', 'Tasks', 'Navigation'];

function grouped(shortcuts: ShortcutInfo[]): Array<[ShortcutGroup, ShortcutInfo[]]> {
  return GROUP_ORDER.map((group) => [group, shortcuts.filter((s) => s.group === group)] as [ShortcutGroup, ShortcutInfo[]]).filter(
    ([, items]) => items.length > 0,
  );
}

/** Splits a combined key label ('↑/↓') into one <kbd> per key. */
function Keys({ label }: { label: string }) {
  const parts = label.length > 1 && label.includes('/') ? label.split('/') : [label];
  return (
    <span className="flex items-center gap-1">
      {parts.map((part, i) => (
        <span key={part} className="flex items-center gap-1">
          {i > 0 ? <span aria-hidden="true" className="text-muted-foreground">/</span> : null}
          <kbd className="min-w-7 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">{displayKey(part)}</kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * Lists every registered keyboard shortcut, grouped. Loaded lazily (React.lazy) and preloaded when
 * the browser is idle. Focus goes back to whatever had it when the panel opened.
 */
export default function ShortcutsPanel({
  open,
  onOpenChange,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  returnFocusTo: HTMLElement | null;
}) {
  // Read while open: the panel shows exactly what is registered at that moment.
  const groups = open ? grouped(listShortcuts()) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusTo?.isConnected) {
            event.preventDefault();
            returnFocusTo.focus();
          }
        }}
      >
        <DialogTitle className="text-lg font-semibold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Shortcuts work when you are not typing in a field.</DialogDescription>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {groups.map(([group, items]) => (
            <section key={group} aria-labelledby={`shortcuts-${group}`}>
              <h3 id={`shortcuts-${group}`} className="mb-2 text-sm font-semibold">
                {group}
              </h3>
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <li key={`${item.key}:${item.description}`} className="flex items-center justify-between gap-4 text-sm">
                    <span>{item.description}</span>
                    <Keys label={item.key} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
