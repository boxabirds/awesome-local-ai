// Hoisted: the illustration never re-renders.
const illustration = (
  <svg aria-hidden="true" viewBox="0 0 120 80" className="h-20 w-32 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 45 L30 15 H90 L110 45 V70 H10 Z" strokeLinejoin="round" />
    <path d="M10 45 H40 L46 55 H74 L80 45 H110" strokeLinejoin="round" />
    <path d="M52 32 L58 38 L70 26" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The empty Inbox: says how to add a task (Q on keyboards, the + button on phones and touch screens). */
export function EmptyInbox({ touch }: { touch: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      {illustration}
      <p className="text-muted-foreground">
        {touch ? 'Your Inbox is clear. Tap + to add a task.' : 'Your Inbox is clear. Press Q to add a task.'}
      </p>
    </div>
  );
}
