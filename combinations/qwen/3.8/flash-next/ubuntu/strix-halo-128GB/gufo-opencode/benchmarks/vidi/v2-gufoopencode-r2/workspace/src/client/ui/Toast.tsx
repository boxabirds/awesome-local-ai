// Story 12: the bottom toast for refused files and offline adds. A single
// polite live region (accessibility: "status messages announced politely").

export function Toast({ message }: { message: string | null }): React.JSX.Element | null {
  if (message === null) return null;
  return (
    <div className="board-toast" data-testid="board-toast" role="status">
      {message}
    </div>
  );
}
