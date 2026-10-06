/**
 * An image on the board (story 12): the picture, or the reason it is not there yet.
 *
 * One box, and one of five things inside it. Which one comes from `displayStatus` - the stored status
 * plus the clock - and the box is the same size, in the same place, in every one of them, because the
 * placeholder was written at the image's final size before a byte was sent. A person watching a board
 * they are not uploading to sees a space fill in, not a layout jump.
 *
 *   uploading   a grey box, an image icon, and progress. The screen carrying the bytes has a bar and a
 *               percentage; every other screen has "Uploading…", because progress belongs to whoever
 *               is sending.
 *   ready       the image, fitted into the box.
 *   failed      the uploader is told "Upload failed" and offered Retry and Remove; everyone else sees
 *               "Image unavailable", which is precisely what it is to them.
 *   unfinished  an upload whose screen went away. Nobody stored that - a browser closed mid-transfer
 *               cannot report it - so it is derived from the clock, everybody sees the same thing, and
 *               everybody can clear it away with Remove.
 *   unavailable the bytes are stored and this screen could not get them, or could not make a picture
 *               out of them: a grey box with a broken-image icon, at the size the image would have
 *               been. A 404 on one person's network is not written into the document, because it is
 *               not a fact about the image.
 *
 * That last state is the only one held in the component, and it is the reason the error handling is
 * local: an image that will not load says so in its own box and changes nothing else on the board.
 */
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type JSX,
} from 'react';
import { displayStatus, type DisplayStatus, type ImageSnap } from '../../shared/objects/image';
import { assetServeUrl } from '../images/uploadImage';
import type { ImageInsertActions } from '../images/useImageInsert';
import type { ObjectProps } from './ObjectProps';

/** How often a screen with an upload on it re-measures its clock. */
const IMAGE_CLOCK_TICK_MS = 30_000;

/**
 * One clock for every image a screen is showing.
 *
 * An image that has been uploading for five minutes changes state with nobody touching it, so a screen
 * showing one has to wake up and look. There is one interval for all of them - and it exists only
 * while at least one image is still uploading - so that the change appears by itself rather than on
 * the next click, and so that a board of finished images sets no timer at all.
 */
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function useImageClock(watching: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!watching) return;
    const listener = (): void => setNow(Date.now());
    // Look straight away: an image that has just arrived on this screen may already be stale.
    listener();
    clockListeners.add(listener);
    if (clockTimer === null) {
      clockTimer = setInterval(() => {
        for (const notify of [...clockListeners]) notify();
      }, IMAGE_CLOCK_TICK_MS);
    }
    return () => {
      clockListeners.delete(listener);
      if (clockListeners.size === 0 && clockTimer !== null) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  }, [watching]);
  return now;
}

export interface ImageObjectProps {
  /** The image as stored, at its current box. */
  image: ImageSnap;
  /** Whether this screen is the one that started this upload. */
  isUploader: boolean;
  /** How far the transfer has got, 0 to 1, when this screen is making it. */
  progress?: number;
  /** Whether the bytes are still here to send again - false after a reload. */
  canRetry: boolean;
  /** The clock this render was measured against, so `unfinished` can be derived. */
  now: number;
  onRetry(): void;
  onRemove(): void;
}

/** The percentage a transfer's fraction stands for, or null when there is no transfer to measure. */
function percentOf(progress: number | undefined): number | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null;
  const percent = Math.round(progress * 100);
  return percent < 0 ? 0 : percent > 100 ? 100 : percent;
}

/** The picture icon: what the box is going to be, and what it was when it could not be loaded. */
function ImageGlyph(): JSX.Element {
  return (
    <svg
      className="image-object__glyph"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.4" cy="9.6" r="1.7" fill="currentColor" />
      <path d="M4.5 17.5 9.8 11.8l3.4 3.6 2.6-2.4 4.2 4.5z" fill="currentColor" />
    </svg>
  );
}

function ButtonRow(props: {
  retry: boolean;
  canRetry: boolean;
  onRetry(): void;
  onRemove(): void;
}): JSX.Element {
  return (
    <div className="image-object__actions">
      {props.retry && props.canRetry ? (
        <button
          type="button"
          className="image-object__button"
          data-testid="image-retry"
          onClick={props.onRetry}
          // The buttons answer their own clicks: a press on Retry must not start dragging the box.
          onPointerDown={(event) => event.stopPropagation()}
        >
          Retry
        </button>
      ) : null}
      <button
        type="button"
        className="image-object__button"
        data-testid="image-remove"
        onClick={props.onRemove}
        onPointerDown={(event) => event.stopPropagation()}
      >
        Remove
      </button>
    </div>
  );
}

/**
 * One image's box, in one of its states.
 *
 * Given the snapshot, the clock and the two callbacks, it draws. Why an image is in the state it is in
 * stayed in `useImageInsert` and in the transfer itself.
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  /** This screen's own verdict on these bytes, and nothing anybody else's. */
  const [broken, setBroken] = useState(false);
  // A different address is a different picture, so whatever was learned about the last one is dropped.
  useEffect(() => {
    setBroken(false);
  }, [image.assetKey]);

  const status: DisplayStatus = displayStatus(image, now);
  const percent = isUploader ? percentOf(progress) : null;
  const state: DisplayStatus | 'unavailable' =
    status === 'ready' && broken ? 'unavailable' : status;

  let body: JSX.Element;
  if (status === 'ready' && image.assetKey !== null && !broken) {
    // `contain`, so the picture keeps its proportions inside a box that someone may have resized;
    // `draggable={false}`, so dragging the board's own picture out of it cannot start; `loading="lazy"`,
    // because a board can hold more images than will fit on a screen.
    body = (
      <img
        className="image-object__picture"
        data-testid="image-picture"
        src={assetServeUrl(image.assetKey)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  } else if (status === 'uploading') {
    body = (
      <div className="image-object__panel image-object__panel--uploading" data-testid="image-uploading">
        <ImageGlyph />
        {percent === null ? (
          <span className="image-object__message">Uploading…</span>
        ) : (
          <>
            <span className="image-object__message">
              Uploading <span data-testid="image-progress">{percent}%</span>
            </span>
            <span
              className="image-object__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span className="image-object__bar-fill" style={{ width: `${percent}%` }} />
            </span>
          </>
        )}
      </div>
    );
  } else if (status === 'failed' && isUploader) {
    body = (
      <div className="image-object__panel image-object__panel--failed" data-testid="image-failed">
        <span className="image-object__message">Upload failed</span>
        <ButtonRow retry canRetry={canRetry} onRetry={onRetry} onRemove={onRemove} />
      </div>
    );
  } else if (status === 'unfinished') {
    body = (
      <div
        className="image-object__panel image-object__panel--unfinished"
        data-testid="image-unfinished"
      >
        <span className="image-object__message">Image upload didn&apos;t finish</span>
        {/* Anyone can clear away an upload nobody is running, and there is nothing to retry: the
            bytes left this screen when the screen did. */}
        <ButtonRow retry={false} canRetry={false} onRetry={onRetry} onRemove={onRemove} />
      </div>
    );
  } else {
    body = (
      <div
        className="image-object__panel image-object__panel--unavailable"
        data-testid="image-unavailable"
      >
        <ImageGlyph />
        <span className="image-object__message">Image unavailable</span>
      </div>
    );
  }

  return (
    <div className={`image-object__inner image-object__inner--${state}`} data-image-state={state}>
      {body}
    </div>
  );
}

/**
 * The registry's image: the same box, hung on the board.
 *
 * Everything the presentational component is told comes from here - whose screen this is, how far the
 * transfer has got, what the clock says, what the two buttons do - because the board is the only place
 * that knows all of it at once.
 */
export interface ImageBoardObjectProps extends ObjectProps {
  note: ImageSnap;
}

/** Provided by `Board` from its `useImageInsert`, and read by every image on the screen. */
export const ImageInsertContext = createContext<ImageInsertActions | null>(null);

function ImageBoardObjectBase({
  note,
  zoom,
  selected,
  dragging,
  canEdit = true,
  onObjectPointerDown,
}: ImageBoardObjectProps): JSX.Element {
  const insert = useContext(ImageInsertContext);
  // The clock is only needed by an upload that might have stopped coming.
  const now = useImageClock(note.status === 'uploading');

  const style = {
    left: note.x,
    top: note.y,
    width: note.width,
    height: note.height,
    zIndex: note.z,
    // The panel's icon, text and buttons are counter-scaled, so they stay the same size on screen at
    // any zoom - a placeholder is a message, and a message is not drawn in board units.
    '--image-inverse-zoom': zoom > 0 ? String(1 / zoom) : '1',
  } as CSSProperties;

  return (
    <div
      className="image-object"
      data-board-object
      data-image-object
      data-image-id={note.id}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-testid="image-object"
      role="group"
      aria-label="Image"
      tabIndex={0}
      style={style}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        // The buttons of a failed or abandoned image answer their own clicks.
        if ((event.target as HTMLElement | null)?.closest('button')) return;
        event.stopPropagation();
        onObjectPointerDown(event, note.id);
      }}
    >
      <ImageObject
        image={note}
        isUploader={insert !== null && insert.identityId === note.uploaderId}
        progress={insert?.progress.get(note.id)}
        canRetry={insert?.canRetry(note.id) ?? false}
        now={now}
        onRetry={() => {
          insert?.retry(note.id);
        }}
        onRemove={() => {
          // A board that could not be loaded cannot have an object deleted from it; the message
          // stays, because it is true, and the button that would lie about it goes.
          if (canEdit) insert?.remove(note.id);
        }}
      />
    </div>
  );
}

export const ImageBoardObject = memo(ImageBoardObjectBase);
