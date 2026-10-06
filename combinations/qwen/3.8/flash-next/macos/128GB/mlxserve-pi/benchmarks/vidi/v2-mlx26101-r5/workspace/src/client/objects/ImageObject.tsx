/**
 * A picture, and the four things it can be while it is on its way.
 *
 * This component draws one object and knows nothing about uploads. That separation is the reason it is
 * short: everything it shows comes out of `displayStatus(image, now)`, which is a pure sentence about the
 * document, and the act of uploading happens in a hook that never touches the DOM. So there is no component
 * state machine here, no "is it loading or loaded" flag to keep in step with a request — the document says
 * what it says, this draws it, and the two cannot drift because there is only one of them.
 *
 * What it draws is the PRD's list, and the split down the middle of that list is *who is looking*. The
 * person who dropped the file has the bytes in their hand and is watching a transfer: they get a progress
 * bar with a number in it, and when it fails they get Retry, because they are the only person in the world
 * who can retry it. Everyone else has a grey box of the right size and no powers: they get "Uploading…",
 * and when it fails they get "Image unavailable", which is the truth from where they are standing — the
 * image is not there, and it is not their upload to fix. The one control offered to everybody is Remove,
 * because a box that will never become a picture is a thing anybody on the board should be able to clear
 * away (PRD `image.upload_failure`, `image.unfinished`).
 *
 * The fifth state, *unavailable*, is the one that has nothing to do with uploads at all. An `<img>` whose
 * address has stopped answering — a bucket that lost the object, a network that refused the request, bytes
 * that turned out to be corrupt — fires `error` and is handled here, locally, and the object stays exactly
 * the size and place it was. That is the whole of `image.unavailable`: a board with one unreadable picture
 * on it is a board that still works, and a picture that quietly disappeared would be a picture somebody
 * thinks somebody else deleted.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { IMAGE_MIN_SIZE_WORLD, IMAGE_STALE_TICK_MS } from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import { rectContainsPoint } from '../../shared/geometry';
import {
  displayStatus,
  IMAGE_OBJECT_TYPE,
  type DisplayStatus,
  type ImageSnap,
} from '../../shared/objects/image';
import { assetUrl } from '../images/uploadImage';
import { boardIdentity } from '../board/identity';
import type { ObjectTypeSpec, ObjectProps } from './registry';

// The object type's name lives with the model, which is the one place the wire format is written down; it
// is handed on from here so that this module is the whole of what the board needs to know about pictures,
// the same way every other object module is.
export { IMAGE_OBJECT_TYPE };

/** What a picture is called out loud, and what its `alt` says (PRD: images are announced as "Image"). */
export const IMAGE_ALT = 'Image';
/** What everybody but the uploader is told while the bytes are on their way. */
export const UPLOADING_LABEL = 'Uploading…';
/** What the uploader is told when the transfer gave up. */
export const UPLOAD_FAILED_LABEL = 'Upload failed';
/** What the transfer is called when it is the picture that is missing, not the transfer. */
export const IMAGE_UNAVAILABLE_LABEL = 'Image unavailable';
/** What an upload that nobody is going to finish is called, in front of everybody. */
export const UPLOAD_UNFINISHED_LABEL = "Image upload didn't finish";
/** The two controls a placeholder offers. */
export const RETRY_LABEL = 'Retry';
export const REMOVE_LABEL = 'Remove';

export interface ImageObjectProps {
  /** The picture's object, as the document holds it. */
  image: ImageSnap;
  /** Whether this person is the one whose browser is holding the file. */
  isUploader: boolean;
  /** How far the upload has got, 0…1 — only this person has it, and only while it is going. */
  progress?: number;
  /** Whether the file is still in this tab's memory, which is all Retry can ever do anything about. */
  canRetry: boolean;
  /** The clock, from outside: `unfinished` is a statement about time and has to be testable at its edge. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /**
   * The object is in the selection. Given by the board, and left out by a test that renders one object on
   * its own — the attribute is what the e2e helpers count selected objects with.
   */
  selected?: boolean;
  /**
   * A press on this object, handed to the board.
   *
   * An optional prop rather than a piece of state the component owns, because an object has never decided
   * for itself what a press means: story 7's gesture decides, for as many objects as the selection holds.
   * The one thing done here is that the press does not also pan the board underneath the picture.
   */
  onPointerDown?(event: ReactPointerEvent<HTMLElement>): void;
}

/** The percentage the uploader sees, from the same fraction that drives the bar. */
const percentOf = (progress: number | undefined): number | null => {
  if (progress === undefined || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
};

/** Every state's box: the object's own size, wherever the document says that is. */
const boxStyle = (image: ImageSnap): CSSProperties => ({
  position: 'absolute',
  left: image.x,
  top: image.y,
  width: Math.max(image.width ?? 0, 0),
  height: Math.max(image.height ?? 0, 0),
});

/** The attributes every object carries so that the board, the selection and the tests can find it. */
const objectAttributes = (image: ImageSnap, selected: boolean | undefined): Record<string, string | number> => ({
  'data-object-id': image.id,
  'data-x': image.x,
  'data-y': image.y,
  'data-width': image.width ?? 0,
  'data-height': image.height ?? 0,
  'data-z': image.z,
  ...(selected === true ? { 'data-selected': 'true' } : {}),
});

/**
 * One picture on the board, in whichever of the five states it is in.
 *
 * Rendered from props alone — no fetching, no timers, no knowledge of who is uploading — so that the same
 * component is the uploader's view and the stranger's view, and the only difference between the two is the
 * `isUploader` prop that came from comparing the object against this person's name.
 */
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
  selected,
  onPointerDown,
}: ImageObjectProps): React.JSX.Element {
  const status: DisplayStatus = displayStatus(image, now);
  // The load error is remembered *by key*, which is what makes it reset itself: a new assetKey is a
  // different picture at this address, and it gets the chance to load before anything is said about it.
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const percent = percentOf(progress);
  const press = onPointerDown === undefined ? undefined : (event: ReactPointerEvent<HTMLElement>): void => onPointerDown(event);

  /** The box every state is drawn in, with the state's own class and the board's own attributes. */
  const frame = (state: string, children: ReactNode, aria?: Record<string, string>): React.JSX.Element => (
    <div
      className={`image-object image-object--${state}`}
      data-status={state}
      data-testid="image-object"
      style={boxStyle(image)}
      {...objectAttributes(image, selected)}
      {...(aria ?? {})}
      onPointerDown={press}
    >
      {children}
    </div>
  );

  if (status === 'ready' && image.assetKey !== null) {
    if (brokenKey === image.assetKey) {
      // Same box, same place, same size: only the picture in it is missing. A placeholder that resized
      // itself to fit its message would move the board's whole layout to report one broken file.
      return frame(
        'unavailable',
        <>
          <span aria-hidden="true" className="image-object__icon">
            {'🖼'}
          </span>
          <span className="image-object__label">{IMAGE_UNAVAILABLE_LABEL}</span>
        </>,
        { role: 'img', 'aria-label': IMAGE_UNAVAILABLE_LABEL },
      );
    }
    return frame(
      'ready',
      <img
        alt={IMAGE_ALT}
        className="image-object__img"
        decoding="async"
        draggable={false}
        // `loading="lazy"` because a board of forty screenshots should not ask for thirty-nine of them
        // before it has drawn the one this person is looking at.
        loading="lazy"
        src={assetUrl(image.assetKey)}
        onError={() => setBrokenKey(image.assetKey)}
      />,
      { role: 'img', 'aria-label': IMAGE_ALT },
    );
  }

  if (status === 'unfinished') {
    // Everybody sees this, and everybody may clear it. The words are careful: nobody knows that the upload
    // failed, only that nobody has said it finished in five minutes — which is what "didn't finish" means.
    // Remove is here for everyone because this box is never going to become a picture: the browser that held
    // the bytes is gone, and a placeholder that can only be looked at is a hole in the board with a label on
    // it. Retry is not, for the same reason — there is no file anywhere to send.
    return frame(
      'unfinished',
      <>
        <span aria-hidden="true" className="image-object__icon">
          {'🖼'}
        </span>
        <Label text={UPLOAD_UNFINISHED_LABEL} />
        <div className="image-object__actions">
          <button
            className="image-object__button"
            data-testid="image-remove"
            type="button"
            onPointerDown={stopPress}
            onClick={onRemove}
          >
            {REMOVE_LABEL}
          </button>
        </div>
      </>,
    );
  }

  if (status === 'failed') {
    if (isUploader) {
      return frame(
        'failed',
        <>
          <span aria-hidden="true" className="image-object__icon">
            {'⚠'}
          </span>
          <Label text={UPLOAD_FAILED_LABEL} />
          <div className="image-object__actions">
            {/* Retry is shown only while the file is in this tab's memory. A button that can only ever
                answer "no" is worse than no button: it is a promise with nothing behind it. */}
            {canRetry ? (
              <button
                className="image-object__button"
                data-testid="image-retry"
                type="button"
                onPointerDown={stopPress}
                onClick={onRetry}
              >
                {RETRY_LABEL}
              </button>
            ) : null}
            <button
              className="image-object__button"
              data-testid="image-remove"
              type="button"
              onPointerDown={stopPress}
              onClick={onRemove}
            >
              {REMOVE_LABEL}
            </button>
          </div>
        </>,
      );
    }
    // Not this person's upload and not this person's problem, and said in the words that are true for the
    // person reading them.
    return frame(
      'unavailable',
      <>
        <span aria-hidden="true" className="image-object__icon">
          {'🖼'}
        </span>
        <Label text={IMAGE_UNAVAILABLE_LABEL} />
      </>,
      { role: 'img', 'aria-label': IMAGE_UNAVAILABLE_LABEL },
    );
  }

  // Uploading. The uploader sees the transfer; everyone else sees a box that says a picture is coming.
  if (isUploader) {
    return frame(
      'uploading',
      <>
        <span aria-hidden="true" className="image-object__icon">
          {'🖼'}
        </span>
        {percent === null ? (
          <Label text={UPLOADING_LABEL} />
        ) : (
          <>
            <span
              aria-label={`${UPLOADING_LABEL} ${percent}%`}
              aria-valuenow={percent}
              className="image-object__bar"
              data-testid="image-progress-bar"
              role="progressbar"
            >
              <span className="image-object__bar-fill" style={{ width: `${percent}%` }} />
            </span>
            {/* The number as words as well as a bar: a progress bar is a colour that moves, and on a screen
                reader's timeline a colour that moves is nothing at all. */}
            <span className="image-object__label" data-testid="image-progress-text">
              {`${UPLOADING_LABEL} ${percent}%`}
            </span>
          </>
        )}
      </>,
    );
  }
  return frame('uploading-other', <Label text={UPLOADING_LABEL} />);
}

/** The one line of words every placeholder says. */
function Label({ text }: { text: string }): React.JSX.Element {
  return <span className="image-object__label">{text}</span>;
}

/** A press on a button inside a placeholder presses the button, and does not also drag the placeholder. */
function stopPress(event: ReactPointerEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

/** What the object needs from the board that is not in the document: progress, retry, and a clock. */
export interface ImageRuntime {
  /** This person's upload of this picture, 0…1, or nothing if they are not the one uploading it. */
  progressOf(id: string): number | undefined;
  /** Whether this tab still holds the file behind this placeholder. */
  canRetry(id: string): boolean;
  /** Sends it again. False when there is nothing here to send. */
  retry(id: string): boolean;
  /** Takes the placeholder off the board. */
  remove(id: string): void;
}

/**
 * The runtime, in a context rather than in props.
 *
 * The board's object renderer hands every object the same {@link ObjectProps} — that is what lets one
 * gesture act on a selection of six mixed types — and a picture needs three things that no other object
 * needs, all of which come from a hook mounted at the board rather than from the board's render. Passing
 * them through `ObjectProps` would put upload state on the interface of a sticky note, so they come round
 * the back: the board provides them once and only the picture looks for them. Absent, a picture still draws
 * whatever state its document is in and simply has no Retry to offer, which is the right degradation for a
 * component test that renders one object on its own.
 */
export const ImageRuntimeContext = createContext<ImageRuntime | null>(null);

/** The board's upload runtime, or null on a board that has none (a component test, a preview). */
export function useImageRuntime(): ImageRuntime | null {
  return useContext(ImageRuntimeContext);
}

/**
 * The listeners that re-render the pictures that are waiting, so that `unfinished` arrives by itself.
 *
 * `displayStatus` needs a clock, and a component that called `Date.now()` once while rendering would be
 * correct for one frame and then never wrong again: a placeholder that had been uploading for four minutes
 * and fifty seconds would say "Uploading…" and go on saying it for ever, because nothing would ever ask it
 * the question again. So while a picture here is still uploading, this object signs up for a tick every
 * {@link IMAGE_STALE_TICK_MS} and asks again.
 *
 * One interval for the whole board, shared between whatever pictures are waiting, and cleared when the last
 * one stops waiting: thirty seconds is long enough that the cost is nothing, and a board whose every object
 * kept its own timer would be a board with forty timers running to notice one thing.
 */
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeToTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === null) tickTimer = setInterval(notifyTicks, IMAGE_STALE_TICK_MS);
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

function notifyTicks(): void {
  for (const listener of [...tickListeners]) listener();
}

/** The clock this object renders with, ticking while `waiting` is true. */
function useUploadClock(waiting: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!waiting) return undefined;
    // Asked again on the way in, so an object that starts waiting mid-render is not drawn with a clock read
    // some time before it started.
    setNow(Date.now());
    return subscribeToTick(() => setNow(Date.now()));
  }, [waiting]);
  return now;
}

/**
 * The registered component: the same picture, wired to the board.
 *
 * Reads the object's facts out of the snapshot, the person's facts out of the runtime and their own name,
 * and hands the rest to {@link ImageObject}, which is where the states are drawn. Keeping this thin is what
 * lets the states be tested without a board, a room or an upload in the test at all.
 */
export function ImageObjectView(props: ObjectProps<ImageSnap>): React.JSX.Element {
  const { obj: image, selected, onObjectPointerDown, onDeleted } = props;
  const runtime = useImageRuntime();
  const now = useUploadClock(image.status === 'uploading');

  const remove = useCallback((): void => {
    // The board is told first, so the selection lets go of the object on this render rather than the next
    // one — the same path a delete by anybody else takes.
    if (runtime !== null) runtime.remove(image.id);
    else onDeleted(image.id);
  }, [runtime, image.id, onDeleted]);

  const retry = useCallback((): void => {
    runtime?.retry(image.id);
  }, [runtime, image.id]);

  const press = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      // Stopped here, so the board does not read a press on a picture as a press on the air over the board:
      // a pan, and a selection dropped.
      event.stopPropagation();
      if (event.button !== 0) return;
      // A board that cannot be written to still lets a picture be *pointed at* — selecting writes nothing.
      onObjectPointerDown(event, image.id);
    },
    [onObjectPointerDown, image.id],
  );

  return (
    <ImageObject
      canRetry={runtime !== null && runtime.canRetry(image.id)}
      image={image}
      isUploader={image.uploaderId === boardIdentity().name}
      now={now}
      onPointerDown={press}
      onRemove={remove}
      onRetry={retry}
      progress={runtime?.progressOf(image.id)}
      selected={selected}
    />
  );
}

/**
 * What an image tells the board about itself, registered by `registry.tsx`.
 *
 * Exported rather than registered here: the registry imports this module to draw one, and a module that
 * registered itself into the thing that imports it is an import cycle whose behaviour depends on which of
 * the two was loaded first — which is a bug that shows up in the test runner and not in the browser, or the
 * other way round. Story 9's arrow has the same shape for the same reason.
 *
 * This is the one entry in the registry whose whole purpose is a *proportion*: a text object has a width it
 * owns and a height that follows it, a shape has no proportion at all, and an image has exactly one, made by
 * whatever it is a picture of. `aspectLocked` is that proportion written down, and `minSize` is where
 * dragging it smaller stops (PRD `image.aspect_resize`).
 */
export const imageObjectType: ObjectTypeSpec<ImageSnap> = {
  Component: ImageObjectView,
  // A picture has a box and a handle can change it — even while it is still a placeholder, whose box is
  // already the box the picture will arrive in, so a person who decides the picture is too big two seconds
  // after dropping it is not made to wait for the bytes to find that out.
  resizable: true,
  aspectLocked: true,
  // Sixteen board units: the shortest side below which a picture is a smudge whatever the bytes behind it
  // happen to be. Read from here by the gesture, so a handle and a hit test cannot disagree about it.
  minSize: IMAGE_MIN_SIZE_WORLD,
  // There is nothing to type into. A caption would be a text object standing beside it, which is why
  // captions are out of this story's scope rather than a field on this object.
  editableText: false,
  // A picture is exactly where its box is — including while it is a placeholder, whose box is the box the
  // picture will arrive in.
  hitTest: (obj, worldPoint) => rectContainsPoint(objectBounds(obj), worldPoint),
};
