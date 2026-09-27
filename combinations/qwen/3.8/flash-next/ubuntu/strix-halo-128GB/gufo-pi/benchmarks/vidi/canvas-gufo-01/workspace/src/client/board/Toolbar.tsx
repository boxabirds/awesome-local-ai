// Left-side vertical toolbar (story 2): the Sticky note tool. Creating a note
// is the only tool; selection and dragging are direct manipulation.

export function Toolbar({ onAddSticky }: { onAddSticky: () => void }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Board tools">
      <button
        type="button"
        className="tool-sticky"
        title="Sticky note – or double-click the board"
        aria-label="Sticky note"
        onClick={onAddSticky}
      >
        Sticky note
      </button>
    </div>
  );
}
