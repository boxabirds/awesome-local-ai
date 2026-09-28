/** Selection bar showing "N selected" with a Delete button. Shown when 2+ objects are selected. */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  onDelete(): void;
}) {
  const count = props.ids.size;
  if (count < 2) return null;

  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="Selection"
    >
      <span className="selection-bar__count" aria-live="polite">
        {count} selected
      </span>
      <button
        type="button"
        className="selection-bar__delete"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={props.onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
