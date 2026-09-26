// Module-level constant (rendering-hoist-jsx): a calm tray with a tick, decorative only.
const illustration = (
  <svg aria-hidden="true" viewBox="0 0 120 80" className="h-20 w-30 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M14 44 30 14h60l16 30v22a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6Z" strokeLinejoin="round" />
    <path d="M14 44h26l6 10h28l6-10h26" strokeLinejoin="round" />
    <path d="m48 30 8 8 16-16" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The Inbox has no open tasks. The hint depends on the device: the Q key where there is a hover-capable
 * pointer (keyboards), the + button on touch screens. Switched with CSS only.
 */
export function EmptyInbox() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      {illustration}
      <p className="text-muted-foreground touch:hidden">Your Inbox is clear. Press Q to add a task.</p>
      <p className="hidden text-muted-foreground touch:block">Your Inbox is clear. Tap + to add a task.</p>
    </div>
  );
}
