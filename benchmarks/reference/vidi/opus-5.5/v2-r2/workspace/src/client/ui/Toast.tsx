/**
 * Short status messages at the bottom of the screen (refused files, offline).
 * The polite live region is always rendered so screen readers announce each
 * new message; the visible toast itself has `role=status`.
 */
export function Toast(props: { messages: readonly string[] }): React.JSX.Element {
  return (
    <div className="toast-region" aria-live="polite">
      {props.messages.length > 0 && (
        <div className="toast" role="status" data-testid="toast">
          {props.messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
    </div>
  );
}
