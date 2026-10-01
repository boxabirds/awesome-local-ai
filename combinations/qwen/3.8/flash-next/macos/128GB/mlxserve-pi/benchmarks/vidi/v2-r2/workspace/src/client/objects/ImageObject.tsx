// One picture on the board (story 12).
//
// What makes an image different from every other object here is that its bytes are not in the
// document. The document holds a box, a status and a key - which is what lets the placeholder
// exist before the picture does, at the size and in the place the finished image will have. So
// this component is a switch over `displayStatus`, and the interesting part of it is not the
// drawing but the honesty: the difference between "mine, still going", "someone else's, going",
// "mine, and it stopped" and "nobody's, and it never finished" is all in who is reading and how
// long ago the upload started.
//
// Two of those states carry buttons, and the rule about them is one rule: a control is shown
// where it can do something. Retry belongs to the person holding the file, and disappears for
// everyone - including that person, after a reload took the file out of memory. Remove is shown
// wherever it works, because a placeholder that is going nowhere is somebody's clutter and the
// first person who notices it is the one who should be able to clear it.
//
// A load error is caught here and goes no further: the rest of the board is not this picture's
// business, and an `<img>` that failed is a grey box, not an exception.

import {
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { deleteObjects } from '../../shared/board-model';
import { displayStatus, imageUrl, type ImageSnapshot } from '../../shared/objects/image';
import { useUndoControllerContext } from '../board/useUndo';
import type { StickyNoteProps } from './StickyNote';

/**
 * An image takes the props every object takes and names its own snapshot in `note`, as the text
 * object, the shape and the drawing each name theirs. It edits no text, so it asks for none of
 * the edit callbacks; what it needs beyond the shared props is who is reading (`isUploader`),
 * how far *this* client's upload has got (`progress`, absent for anyone who is not the
 * uploader), whether the file is still in hand (`canRetry`) and the clock the board renders with
 * (`now`), because `unfinished` is a matter of time and a component cannot ask the time of
 * itself without going stale between renders.
 */
export type ImageObjectProps = Omit<
  StickyNoteProps,
  'note' | 'editing' | 'onStartEdit' | 'onEndEdit'
> & {
  note: ImageSnapshot;
  /**
   * Whether the person reading this board is the one whose upload it is. No number means no
   * opinion, and a box with no opinion shows what a reader shows: the words, and no buttons.
   */
  isUploader?: boolean;
  /** 0 to 1, while *this client* is uploading it. Everyone else has no number to show. */
  progress?: number | undefined;
  /**
   * Whether a retry would achieve anything, which is the hook's question, not this one's. Given
   * by the board, which is where the file is kept.
   */
  canRetry?: boolean;
  /**
   * The board's render clock, for `displayStatus`. Without one the box is never stale: the clock
   * is the only evidence a box has that time has passed, and a box with no evidence is not going
   * to accuse an upload of being abandoned. The real board always has one (`useImageInsert`
   * starts and stops it).
   */
  now?: number;
  /** Send the same file again. Given by the board, which is where the file is kept. */
  onRetry?(id: string): void;
  /**
   * Delete this placeholder. Absent, the component deletes it through the board model itself -
   * the same call the selection bar makes, undo boundary and all - which is what lets a picture
   * be removed from a board rendered without the full wiring.
   */
  onRemove?(id: string): void;
};

/** The Retry and Remove buttons own their own clicks; a press on them is not a grab. */
function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.image-object-controls') !== null;
}

/** Whole percentage of an upload in flight. */
function percentOf(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

/** The grey box every "not here" state shares, with the words that say which one it is. */
function Unavailable({ words }: { words: string }): JSX.Element {
  return (
    <div className="image-object-placeholder" data-testid="image-unavailable">
      {/* A torn picture: the universal "the picture is not here" mark, drawn rather than a
          glyph so it is the same in every browser and needs no font. */}
      <svg
        className="image-object-icon"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 3h18v18H3z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 16l5-5 4 4 3-3 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="image-object-words" data-testid="image-status">
        {words}
      </span>
    </div>
  );
}

export function ImageObject({
  note,
  doc,
  selected,
  editable,
  dragging: draggingByBoard = false,
  onGesturePointerDown,
  onSelect,
  onFocusNote,
  isUploader = false,
  progress,
  canRetry = false,
  now = 0,
  onRetry,
  onRemove,
}: ImageObjectProps): JSX.Element {
  // The key this component gave up on. Compared against the snapshot's own key rather than kept
  // in a boolean, so a picture that arrives later - a retry that worked, a peer's upload that
  // finished - is tried again without an effect to reset anything.
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const undo = useUndoControllerContext();

  const status = displayStatus(note, now);
  const src = imageUrl(note);
  // Like for like: what `onError` remembers is the key, and what identifies the bytes under this
  // box is the key. Comparing a key against a URL would be a broken picture that never admits it.
  const broken = note.assetKey !== null && brokenKey === note.assetKey;

  // A board the room could not be read is shown read-only, like every other object on it:
  // nothing on it can be moved, and a Remove button that deletes nothing would be a lie.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isOwnUi(event.target)) return;
    // The board must never start panning from a picture.
    event.stopPropagation();
    if (onGesturePointerDown !== undefined) {
      onGesturePointerDown(event as unknown as ReactPointerEvent<HTMLDivElement>);
      return;
    }
    onSelect(note.id);
  };

  /** A double-click on a picture is the picture's: the board drops no sticky note on top of it. */
  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  const remove = (): void => {
    if (onRemove !== undefined) {
      onRemove(note.id);
      return;
    }
    // One undo step, the same boundary a delete from the keyboard or the selection bar makes.
    undo?.boundary();
    deleteObjects(doc, [note.id]);
    undo?.boundary();
  };

  // Whether the box's own frame says "this one went wrong" is a matter of state, not of the
  // picture: an image whose bytes arrived and then would not decode is grey like any other
  // missing picture, because what a person needs from it is the size of the hole it left.
  const showing = broken ? 'unavailable' : status;

  return (
    <div
      className={`image-object is-${showing}${draggingByBoard ? ' is-dragging' : ''}${
        editable ? '' : ' is-locked'
      }`}
      data-testid="image-object"
      data-image-id={note.id}
      data-image-status={showing}
      data-image-x={note.x}
      data-image-y={note.y}
      data-image-width={note.width}
      data-image-height={note.height}
      data-image-z={note.z}
      data-natural-width={note.naturalWidth}
      data-natural-height={note.naturalHeight}
      data-asset-key={note.assetKey ?? ''}
      data-uploader={isUploader ? 'true' : 'false'}
      data-selected={selected}
      data-editable={editable}
      data-dragging={draggingByBoard}
      role="group"
      aria-label="Image"
      tabIndex={0}
      style={
        {
          left: `${note.x}px`,
          top: `${note.y}px`,
          width: `${note.width}px`,
          height: `${note.height}px`,
          // Stacking is each object's own business, the note's and the shape's rule: the
          // element a drag has captured is never moved out from under the pointer.
          zIndex: note.z,
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={(event) => {
        if (event.target !== event.currentTarget) return;
        (onFocusNote ?? onSelect)(note.id);
      }}
    >
      {showing === 'ready' && src !== null ? (
        <img
          className="image-object-picture"
          data-testid="image-picture"
          src={src}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          // The picture fills the box it was placed in, which is its own proportions: a resize
          // that kept the ratio (the registry says `aspectLocked`) cannot distort it, and a box
          // a peer wrote is drawn at the ratio its bytes have.
          style={{ width: `${note.width}px`, height: `${note.height}px` }}
          onError={() => setBrokenKey(note.assetKey)}
        />
      ) : null}

      {showing === 'uploading' ? (
        <div className="image-object-placeholder" data-testid="image-uploading">
          {isUploader && progress !== undefined ? (
            <>
              <progress
                className="image-object-bar"
                data-testid="image-progress-bar"
                value={percentOf(progress)}
                max={100}
              />
              <span className="image-object-words" data-testid="image-progress">
                {percentOf(progress)}%
              </span>
            </>
          ) : (
            // Everyone who is not uploading it sees the words and no number: the number belongs
            // to the person whose link it is going up, and a percentage copied from someone
            // else's screen would be a guess about a connection they cannot see.
            <span className="image-object-words" data-testid="image-status">
              Uploading…
            </span>
          )}
        </div>
      ) : null}

      {showing === 'failed' ? (
        // The words follow what happened, and who is reading it: this is the person whose upload
        // it was, so they are told it failed - not that the picture is merely unavailable, which
        // would leave them looking for a picture that was never theirs to lose.
        isUploader ? (
          <div className="image-object-placeholder" data-testid="image-failed">
            <span className="image-object-words" data-testid="image-status">
              Upload failed
            </span>
            {/* The buttons follow what can be done. A board the room could not be read cannot be
                deleted from and cannot be uploaded to, so on it there is nothing to press - the
                fact stays, the controls go. */}
            {editable ? (
              <div className="image-object-controls">
                {canRetry ? (
                  <button
                    type="button"
                    className="image-object-button is-retry"
                    data-testid="image-retry"
                    onClick={() => {
                      onRetry?.(note.id);
                    }}
                  >
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  className="image-object-button"
                  data-testid="image-remove"
                  onClick={remove}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          // Whose upload it was, and that it was the one that failed, is not something a person
          // who is not the uploader can do anything about - so they are told the fact and not
          // the story.
          <Unavailable words="Image unavailable" />
        )
      ) : null}

      {showing === 'unfinished' ? (
        <div className="image-object-placeholder" data-testid="image-unfinished">
          <span className="image-object-words" data-testid="image-status">
            Image upload didn't finish
          </span>
          {/* The box is everyone's to see and the writer's to clear: on a board that takes no
              changes the Remove is left out, because deleting from a board you cannot write to is
              a button that unappears until the next reload. */}
          {editable ? (
            <div className="image-object-controls">
              <button
                type="button"
                className="image-object-button"
                data-testid="image-remove"
                onClick={remove}
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showing === 'unavailable' ? <Unavailable words="Image unavailable" /> : null}
    </div>
  );
}
