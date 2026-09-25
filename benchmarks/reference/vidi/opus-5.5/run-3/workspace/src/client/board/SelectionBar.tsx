import { useContext, type CSSProperties, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import { isSticky, setStickyColor, type ObjectSnapshot } from '../../shared/board-model';
import { WorldOverlayContext } from '../canvas/worldOverlay';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { defaultMeasurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import { isText, setTextSize } from '../../shared/objects/text';
import { selectionBounds } from './SelectionOverlay';
import { asStep, UndoContext } from './useUndo';

// Keep pointer and double-click events away from the objects (drag, edit) and the board (deselect, create).
const stop = (e: SyntheticEvent) => e.stopPropagation();

export function selectedLabel(n: number): string {
  return `${n} selected`;
}

function BinIcon() {
  return (
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
  );
}

/**
 * Above the selection: "N selected" and a Delete button when two or more objects are selected, story 2's
 * note toolbar when exactly one sticky note is, or the text toolbar (story 9) when exactly one text object is. Always renders a polite live region announcing the count.
 * Drawn in the world overlay layer (above every object) and scaled by 1 / zoom to keep its screen size.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  doc?: Y.Doc;
  zoom?: number;
  /** False while the board cannot be edited: no note toolbar, Delete disabled. Default true. */
  editable?: boolean;
  /** Hidden while editing text or during a move or resize. */
  hidden?: boolean;
}) {
  const { ids, snapshot } = props;
  const overlay = useContext(WorldOverlayContext);
  const undo = useContext(UndoContext);
  const editable = props.editable ?? true;
  const selected = snapshot.filter((o) => ids.has(o.id));
  const count = selected.length;
  const box = selectionBounds(ids, snapshot);
  const single = count === 1 && isSticky(selected[0]) ? selected[0] : null;
  const singleText = count === 1 && isText(selected[0]) ? selected[0] : null;

  let bar = null;
  if (box && !props.hidden) {
    if (single && editable) {
      const doc = props.doc;
      bar = (
        <NoteToolbar
          color={single.color}
          onColor={(c) => doc && asStep(undo, () => setStickyColor(doc, single.id, c))}
          onDelete={props.onDelete}
        />
      );
    } else if (singleText && editable) {
      const doc = props.doc;
      bar = (
        <TextToolbar
          size={singleText.size}
          // The size and the re-measured box are one undo step; the top-left stays put.
          onSize={(size) =>
            doc &&
            asStep(undo, () => {
              if (setTextSize(doc, singleText.id, size)) remeasureText(doc, singleText.id, defaultMeasurer());
            })
          }
          onDelete={props.onDelete}
        />
      );
    } else if (count >= 2) {
      bar = (
        <div
          className="note-toolbar selection-bar"
          role="toolbar"
          aria-label="Selection"
          onPointerDown={stop}
          onPointerUp={stop}
          onPointerMove={stop}
          onClick={stop}
          onDoubleClick={stop}
        >
          <span className="selection-bar__count">{selectedLabel(count)}</span>
          <span className="note-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="note-toolbar__delete"
            aria-label="Delete selection"
            title="Delete selection"
            disabled={!editable}
            onClick={props.onDelete}
          >
            <BinIcon />
          </button>
        </div>
      );
    }
  }
  const anchored =
    bar && box ? (
      <div
        className="note-toolbar-anchor"
        style={{ left: box.x + box.width / 2, top: box.y, '--zoom': props.zoom ?? 1 } as CSSProperties}
      >
        {bar}
      </div>
    ) : null;

  return (
    <>
      <div className="visually-hidden" aria-live="polite" data-testid="selection-announcer">
        {count > 0 ? selectedLabel(count) : ''}
      </div>
      {anchored && (overlay ? createPortal(anchored, overlay) : anchored)}
    </>
  );
}
