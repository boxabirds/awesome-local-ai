/** Short messages at the bottom of the screen, announced politely. Renders nothing visible when empty. */
export function Toast({ messages }: { messages: readonly string[] }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {messages.map((m) => <div key={m} className="toast">{m}</div>)}
    </div>
  );
}
