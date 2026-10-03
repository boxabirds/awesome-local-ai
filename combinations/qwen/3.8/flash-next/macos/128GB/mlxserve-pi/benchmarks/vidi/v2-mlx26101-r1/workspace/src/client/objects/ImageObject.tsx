// A picture on the board, and the four things it can say about itself while it is not yet a picture
// (story 12).
//
// This file is a renderer and nothing else. Selecting, moving, nudging, marquee-ing, resizing,
// deleting and undo all arrive through the registry from stories 7 and 8, so a picture behaves like
// every other object there (image.consistent) — including being moved and resized *while it is still
// uploading*, which is why the box is laid out from the stored x/y/width/height and never from the
// file's own size: a placeholder is created at its final size, and the only thing that changes as the
// upload goes through is what is painted inside that box.
//
// The states are read, never remembered. `displayStatus` takes the stored fields plus the clock and
// says which one this is, so a placeholder whose uploader closed the page becomes "didn't finish" on
// its own once the clock passes it — nobody has to notice, and no code has to run
// (image.upload_stalled). What the model does *not* know is who is asking, and that is the whole
// difference between two of its answers: a failure says "Upload failed" and offers Retry to the person
// who still has the file, and says "Image unavailable" to everybody else, who has nothing to retry.
//
//   uploading  → "Uploading 42%" for whoever owns the file, "Uploading…" for everybody else
//   failed     → "Upload failed" + Retry / Remove for the owner, "Image unavailable" for the rest
//   unfinished → "Image upload didn't finish" + Remove, for anyone at all
//   ready      → the picture itself
//   unavailable→ "Image unavailable", when a stored picture cannot be drawn
//
// The last line is the reason for the `onError`. A key can point at an object that is no longer there,
// or at bytes no browser can decode; an `<img>` that cannot draw one would leave a torn icon and say
// nothing. So the image reports it, this picture paints the grey box the PRD asks for in its place, at
// the same size and in the same place, and the rest of the board is untouched (image.unavailable).

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DisplayStatus } from '../../shared/objects/image';
import { displayStatus, imageSourceUrl, type ImageSnap } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

/** What is painted: the model's states, split by who is looking, plus what a failed draw says. */
export type ImageViewState = 'uploading' | 'failed' | 'unfinished' | 'unavailable' | 'ready';

/** The words in the box, per painted state. The PRD's words, including the ellipses. */
const STATE_TEXT: Record<ImageViewState, string> = {
  uploading: 'Uploading…',
  failed: 'Upload failed',
  unfinished: "Image upload didn't finish",
  unavailable: 'Image unavailable',
  ready: '',
};

const BOX: CSSProperties = {
  position: 'absolute',
  // The box this draws *is* the object's area: a placeholder for an 800x500 picture is an 800x500 box,
  // which is what makes "it arrives at the size it will be" true and what keeps a picture from moving
  // the board when it turns into itself. Without `inset` an absolutely positioned box shrink-wraps its
  // own words, which is a caption, not a picture's place.
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  boxSizing: 'border-box',
  overflow: 'hidden',
  borderRadius: 4,
  userSelect: 'none',
  textAlign: 'center',
};

const PLACEHOLDER: CSSProperties = {
  ...BOX,
  border: '1px dashed #b6bac4',
  background: '#eef0f4',
  color: '#5f636e',
  fontSize: 13,
  fontWeight: 600,
};

const FAILED: CSSProperties = {
  ...PLACEHOLDER,
  border: '1px solid #c0392b',
  background: '#fdeceb',
  color: '#8e2f24',
};

const BUTTON: CSSProperties = {
  border: '1px solid #b6bac4',
  borderRadius: 6,
  background: '#fff',
  color: '#2c2f36',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  padding: '4px 10px',
};

/**
 * The two glyphs the PRD puts in a box that is not a picture yet: a picture glyph while one is on its
 * way, a broken one when there never will be. They are world-sized, like the words next to them and
 * like a note's text — a placeholder is a drawing of a thing on the board, and it shrinks with the
 * board. The buttons under them are the opposite case, and are compensated for the zoom above.
 */
function PlaceholderIcon({ broken }: { broken: boolean }) {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      // It says the same thing the sentence under it says, and a screen reader would otherwise hear it
      // twice.
      aria-hidden={true}
      data-testid="image-placeholder-icon"
      data-broken={broken ? 'true' : 'false'}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {broken ? (
        // A picture with a crack through it: the same frame, so the box does not change shape between
        // "it went wrong" and "it is fine now".
        <>
          <path d="M9 4.5 7.5 9l3.5 1.5L9.5 14l3 2.5-1 3" />
          <path d="M16.5 4.5 15 9l3 1.5" />
        </>
      ) : (
        <>
          <circle cx="9" cy="9.5" r="1.6" />
          <path d="M4 17.5 9 13l3.5 3L16 13l4 4" />
        </>
      )}
    </svg>
  );
}

/**
 * Which box to paint.
 *
 * The split is one `if`: a failed upload is a fact about the file, and only the person holding the
 * file can do anything about it. Everyone else is being told that a picture is missing, which is true
 * from their side and is the same sentence they would read if the bucket had lost it
 * (image.upload_failure, image.unavailable).
 */
export function imageViewState(
  image: ImageSnap,
  isUploader: boolean,
  now: number,
  broken: boolean,
): ImageViewState {
  const state: DisplayStatus = displayStatus(image, now);
  if (state === 'failed') return isUploader ? 'failed' : 'unavailable';
  // 'ready' with no key is a document that says a picture is there and cannot say which one. That is
  // the same sentence the person is entitled to read as "unavailable", and it is why the box never
  // asks for `/api/assets/null`.
  if (state === 'ready') return broken || image.assetKey === null ? 'unavailable' : 'ready';
  return state;
}

export interface ImageObjectProps {
  /** The picture, as the document holds it. */
  image: ImageSnap;
  /** The board's zoom, for the screen-sized parts inside a world-sized box. */
  zoom: number;
  /** Whether the person looking is the one whose file this is. */
  isUploader: boolean;
  /** The upload's fraction, for the uploader alone: nobody else owns this progress bar. */
  progress?: number | undefined;
  /** Retry is offered only while this tab still has the file to send (image.upload_failure). */
  canRetry: boolean;
  /** The clock the unfinished state is judged against — the one the board ticks every 30 s. */
  now: number;
  onRetry(): void;
  onRemove(): void;
}

/**
 * The picture, in whichever of its states the document says it is.
 *
 * Presentational on purpose: it takes the snapshot and four callbacks, and no document, no camera and
 * no upload. That is what lets a test put a failed placeholder on screen as the uploader and as
 * somebody else without building a board around it (TC-22) — the one distinction in this story that is
 * easy to get wrong and impossible to see from a screenshot taken by the person who caused it.
 */
export function ImageObject({
  image,
  zoom,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: ImageObjectProps) {
  // A picture that fails to draw is a fact about *this* key, so the answer is remembered per key: a
  // Retry that finally works puts the picture back without anybody reloading the page.
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const painted = imageViewState(image, isUploader, now, brokenKey === image.assetKey);
  // Only ever used when `painted` is 'ready', which is the one state where the key is a key.
  const assetKey = image.assetKey ?? '';

  // The words and buttons inside a picture are screen-sized, like a note's toolbar: the box is
  // world-sized, so whatever has to stay readable is divided by the zoom (image.consistent).
  const screenScale = zoom > 0 ? 1 / zoom : 1;
  // Only the person who owns the file is told a number. Everyone else is told it is coming
  // (image.uploading, image.placeholder_other).
  const percent =
    painted === 'uploading' && isUploader && progress !== undefined
      ? Math.round(progress * 100)
      : null;
  const label = percent === null ? STATE_TEXT[painted] : `Uploading ${percent}%`;
  const stop = (event: { stopPropagation(): void }): void => event.stopPropagation();

  return (
    <div
      data-object-id={image.id}
      data-object-type="image"
      data-image-status={painted}
      data-image-uploader={isUploader ? 'self' : 'other'}
      data-testid={`image-object-${image.id}`}
      aria-label={painted === 'ready' ? 'Image' : label}
      className={`board-object image-object image-object--${painted}`}
      style={{
        position: 'absolute',
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        zIndex: image.z,
        // This box is the picture's *description*: where it is and how big it is. The presses belong
        // to the hit layer the registry's component draws underneath it, so a placeholder never has to
        // decide whether it is also a drag target.
        pointerEvents: 'none',
      }}
    >
      {painted === 'ready' ? (
        <img
          src={imageSourceUrl(assetKey)}
          alt="Image"
          data-testid={`image-${image.id}`}
          draggable={false}
          // Both of these are the PRD's ask, and both are about not blocking the board: a picture that
          // decodes away from the main thread, and one that is only fetched when it is near the screen.
          decoding="async"
          loading="lazy"
          onError={() => setBrokenKey(image.assetKey)}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            // The picture keeps its own shape inside the box it is given. In the ordinary case the two
            // agree exactly — the box is made from the picture — and this is about the case where they
            // do not: a stored box that disagrees with the bytes in it is a thing that can arrive from
            // an older document or a group resize, and the sentence "a picture is never stretched" is
            // cheaper to honour here than to guarantee in every writer.
            objectFit: 'contain',
          }}
        />
      ) : (
        <div
          data-testid={`image-placeholder-${image.id}`}
          data-image-status={painted}
          className="image-placeholder"
          style={painted === 'failed' ? FAILED : PLACEHOLDER}
        >
          {/* The glyph comes first, in every state that has one, so the box reads as a picture that is
              not there rather than as a message that happens to be sitting in a rectangle. */}
          {painted === 'unfinished' ? null : <PlaceholderIcon broken={painted !== 'uploading'} />}
          {percent !== null ? (
            <span
              data-testid={`image-progress-${image.id}`}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                display: 'block',
                width: '60%',
                height: 4,
                borderRadius: 2,
                background: 'rgba(0,0,0,0.12)',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${percent}%`,
                  height: '100%',
                  background: '#3b5bdb',
                }}
              />
            </span>
          ) : null}
          {/* The one thing every state says, in the same place, so the box does not change shape as it
              goes from one to another. */}
          <span data-testid={`image-state-${image.id}`}>{label}</span>
        </div>
      )}
      {/* The way out of a box that is not a picture: drawn here, as a sibling of the box rather than a
          child of it, because the box clips what it contains and these have to stay pressable. A
          Remove button that a low zoom has clipped to nothing is a word about a button; the object's
          own area is not clipped, and takes no presses either, so a control placed here is reachable at
          every zoom without the picture having to be readable. */}
      {painted === 'failed' || painted === 'unfinished' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 4,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              display: 'flex',
              gap: 6,
              // Screen-sized, like a note's toolbar: the box they hang in is world-sized, so whatever
              // has to be read and pressed is divided by the zoom. Anchored by its bottom edge, so
              // growing bigger on the screen does not walk it off the picture.
              transform: `scale(${screenScale})`,
              transformOrigin: 'center bottom',
              // The box around them takes no presses, so anything inside it that expects one has to
              // say so: a Remove button that inherits `pointer-events: none` is a word, not a button.
              pointerEvents: 'auto',
            }}
            // The controls are on the board but are not the board: a press on Retry must never start
            // a drag of the object behind it.
            onPointerDown={stop}
            onDoubleClick={stop}
          >
            {painted === 'failed' && canRetry ? (
              <button
                type="button"
                aria-label="Upload the same file again"
                data-testid={`image-retry-${image.id}`}
                style={BUTTON}
                onClick={(event) => {
                  stop(event);
                  onRetry();
                }}
              >
                Retry
              </button>
            ) : null}
            {/* Remove is for anyone, in both states: the file is not theirs, but the space it is
                taking up is (image.upload_failure, image.upload_stalled). */}
            <button
              type="button"
              aria-label="Remove this image from the board"
              data-testid={`image-remove-${image.id}`}
              style={BUTTON}
              onClick={(event) => {
                stop(event);
                onRemove();
              }}
            >
              Remove
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the board has to hand a picture beyond what every object gets. Everything in here is local to
 * this tab (which file is mine, what time is it) or local to this person (the file behind a Retry),
 * which is exactly why none of it is in the document.
 */
export interface ImageControls {
  /** This tab's id, checked against the placeholder's `uploaderId`. */
  selfId: string;
  /** The board's clock, re-measured while any picture on it is still uploading (useUploadClock). */
  now: number;
  /** This tab's own progress for `id`, if it is the tab sending it. */
  progressOf(id: string): number | undefined;
  /** Whether this tab still holds the file that a Retry would re-send. */
  canRetry(id: string): boolean;
  /** Send the same file again (image.upload_failure). */
  retry(id: string): void;
}

/** How the board reaches a picture's upload controls. */
export const ImageControlsContext = createContext<ImageControls | null>(null);

/** A board with no image support: the states still read correctly, the controls just do nothing. */
const NO_CONTROLS: ImageControls = {
  selfId: '',
  now: 0,
  progressOf: () => undefined,
  canRetry: () => false,
  retry: () => {},
};

/**
 * The registry's component for `type: 'image'` — a translation layer, because the board hands every
 * object the same props and a picture needs five more than that. They come from the context the board
 * provides rather than from another argument on the components that never need them.
 *
 * `Remove` is deliberately *not* in that context: a picture being removed is an object being deleted,
 * and story 7's delete — with its undo step and its already-gone check — is the only way anything
 * should leave the board.
 */
export function ImageObjectView({
  obj,
  zoom,
  selected,
  onObjectPointerDown,
  onDelete,
}: ObjectProps) {
  const controls = useContext(ImageControlsContext) ?? NO_CONTROLS;
  const image = obj as unknown as ImageSnap;
  const isUploader = image.uploaderId === controls.selfId;

  const onRetry = useCallback(() => controls.retry(image.id), [controls, image.id]);
  // Remove is the board's own delete, so it goes the way the Delete key goes: one undo step, and a
  // picture that somebody else has already deleted stays deleted.
  const onRemove = useCallback(() => onDelete(image.id), [onDelete, image.id]);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => onObjectPointerDown(e, image.id),
    [onObjectPointerDown, image.id],
  );

  return (
    <>
      <div
        // The press target, and the only thing in here that takes a press: a picture is a box, so a
        // press inside it is a press on it (image.consistent).
        data-object-id={image.id}
        data-object-type="image"
        data-selected={selected}
        data-testid={`image-hit-${image.id}`}
        className="board-object image-hit"
        onPointerDown={onPointerDown}
        // A picture has no text to edit, and a double-click that reached the board would otherwise put
        // a sticky note on top of it.
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        style={{
          position: 'absolute',
          left: image.x,
          top: image.y,
          width: image.width,
          height: image.height,
          zIndex: image.z,
          // The layer this sits in takes no presses, so a target that wants one has to say so: a hit
          // area that inherits `pointer-events: none` is a rectangle nobody can click, which is what
          // the shapes and the strokes already do about it and for the same reason.
          pointerEvents: 'auto',
        }}
      />
      <ImageObject
        image={image}
        zoom={zoom}
        isUploader={isUploader}
        progress={controls.progressOf(image.id)}
        canRetry={controls.canRetry(image.id)}
        now={controls.now}
        onRetry={onRetry}
        onRemove={onRemove}
      />
      {selected ? (
        <div
          data-testid={`image-selection-${image.id}`}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: image.x,
            top: image.y,
            width: image.width,
            height: image.height,
            zIndex: image.z + 1,
            // A translucent sheet, so the words inside a placeholder stay readable while it is
            // selected: a selection outline that hides the thing it selected has learned the wrong
            // lesson from story 7.
            outline: `${Math.max(1.5 / zoom, 0.5)}px solid #4c6ef5`,
            outlineOffset: 1,
            background: 'rgba(76, 110, 245, 0.08)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </>
  );
}
