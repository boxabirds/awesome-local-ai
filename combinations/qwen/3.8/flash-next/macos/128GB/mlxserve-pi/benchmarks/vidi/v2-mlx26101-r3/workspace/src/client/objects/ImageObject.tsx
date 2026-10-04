/**
 * What one image looks like at each moment of its life on the board.
 *
 * An image spends most of its existence in a state that is not "a picture": it is on its way, or it failed,
 * or whoever uploaded it went away. Every one of those states is drawn in the *same box* - the object's own
 * size and position, decided before a byte was sent - because the alternative is a board that moves things
 * around as they arrive, and a placeholder that turns into a picture of a different size is a board that
 * rearranged itself for no reason anybody could see.
 *
 * Two things decide what is drawn, and both are read rather than remembered:
 *
 * - **the status, as the document holds it** - which is the same on every screen, and is why a colleague can
 *   watch a picture arrive without being asked what they think is happening;
 * - **whether this person is the one who uploaded it** - which is the only question whose answer differs
 *   between two people looking at the same object, and the only one that earns a different picture. The
 *   uploader gets a percentage and a Retry button because the uploader is the only one with the file and
 *   the only one with a progress bar to fill. Everyone else is told what it means for *them*: not "failed",
 *   which is somebody else's news about their own upload, but "unavailable", which is the truth about the
 *   picture they were promised.
 *
 * Nothing in here asks a question of the network, and nothing in here writes to the document except through
 * the two callbacks the board hands in.
 */
import { useEffect, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { deleteObjects, IMAGE_TYPE, type ImageSnapshot } from '../../shared/board-model';
import { isBoardUi } from '../tools/boardPointer';
import { asImageSnapshot, displayStatus } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

/** What everybody is told while the bytes are on their way. */
export const IMAGE_UPLOADING_TEXT = 'Uploading\u2026';
/** What the uploader is told about an upload that did not make it. */
export const IMAGE_FAILED_TEXT = 'Upload failed';
/** What everybody is told about an upload that stopped being anybody's business. */
export const IMAGE_UNFINISHED_TEXT = "Image upload didn't finish";
/** What everybody is told about a picture that is not there. */
export const IMAGE_UNAVAILABLE_TEXT = 'Image unavailable';

/**
 * How long an upload may go on before it is called off, in this component's own reading of the clock.
 *
 * The *rule* is {@link IMAGE_UPLOAD_STALE_MS} and lives in the shared model, where a test and a board can
 * both read it. This is the other half of it, which is not a rule about uploads at all but about how often
 * to look: an object that is still uploading at five minutes needs to change its face without anybody
 * clicking, so something has to wake it up before then, and thirty seconds is often enough that nobody
 * notices the delay and rare enough that nobody notices the wake-up either.
 */
const IMAGE_CLOCK_MS = 30_000;

export interface ImageObjectProps {
  /** The image, as the document holds it. */
  image: ImageSnapshot;
  /** Whether the bytes are on their way from *this* person, which is what earns a percentage and a Retry. */
  isUploader: boolean;
  /** How far this person's upload has got, `0` to `1`. Only ever given to the uploader. */
  progress?: number;
  /** Whether Retry has a file to send. It is in this browser's memory or it is nowhere. */
  canRetry: boolean;
  /** Whether the person in front of it may take it off the board. False on a board that cannot be written. */
  canRemove?: boolean;
  /** The clock the stale upload is measured against, in epoch ms. */
  now: number;
  retry(): void;
  remove(): void;
}

/**
 * The box an image is drawn in, whatever state it is in.
 *
 * The box is the object: same size, same place, from the moment it is created. What changes is only what is
 * inside it, and that is the whole design of this component - a person who dropped three pictures watches
 * three boxes that never move, and the pictures arrive inside them.
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now } = props;
  const canRemove = props.canRemove !== false;
  const status = displayStatus(image, now);
  // A picture that the browser could not draw. Held against the asset key rather than as a plain true, so
  // that an object which gets new bytes - a retry that finally arrived, an upload that was still to come -
  // is drawn again from the beginning, without this component having to be told to forget what it learned.
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const broken = image.assetKey !== null && brokenKey === image.assetKey;

  if (status === 'ready' && image.assetKey !== null && !broken) {
    return (
      <img
        className="image-object__picture"
        data-testid="image-picture"
        data-asset-key={image.assetKey}
        src={assetUrl(image.assetKey)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => {
          setBrokenKey(image.assetKey);
        }}
      />
    );
  }

  if (status === 'failed' && isUploader) {
    return (
      <div className="image-object__panel image-object__panel--failed" data-testid="image-failed">
        <span className="image-object__text">{IMAGE_FAILED_TEXT}</span>
        <span className="image-object__actions">
          {canRetry ? (
            <button
              type="button"
              className="image-object__button"
              data-testid="image-retry"
              data-board-ui=""
              onClick={props.retry}
            >
              Retry
            </button>
          ) : null}
          <RemoveButton hidden={!canRemove} onClick={props.remove} />
        </span>
      </div>
    );
  }

  if (status === 'failed' || broken) {
    // Everyone but the uploader, and everyone after the uploader has gone: the picture is not there, and
    // whose upload failed is not information anybody else asked for.
    //
    // The same box answers for a picture that arrived and would not draw - the address answered with
    // something the browser could not turn into an image, or answered with nothing at all. From in front of
    // the board those two are one fact: there are no pixels here, and there is a box where they were meant
    // to be. It is drawn at the object's own size for the same reason the placeholder is: the box is the
    // object, and a box that collapsed when its picture failed would move everything near it, which is a
    // second wrong thing about an accident that needed only one.
    return (
      <div className="image-object__panel" data-testid="image-unavailable">
        <BrokenImageIcon />
        <span className="image-object__text">{IMAGE_UNAVAILABLE_TEXT}</span>
        <RemoveButton hidden={!canRemove} onClick={props.remove} />
      </div>
    );
  }

  if (status === 'unfinished') {
    // Nobody's upload any more, and everybody's problem: the box stays, the Remove is for whoever is
    // standing in front of it.
    return (
      <div className="image-object__panel" data-testid="image-unfinished">
        <span className="image-object__text">{IMAGE_UNFINISHED_TEXT}</span>
        <RemoveButton hidden={!canRemove} onClick={props.remove} />
      </div>
    );
  }

  if (isUploader) {
    const fraction = clampFraction(progress ?? 0);
    return (
      <div className="image-object__panel" data-testid="image-progress">
        <ImageIcon />
        <span className="image-object__bar" data-testid="image-progress-bar">
          <span className="image-object__bar-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
        <span className="image-object__percent">{`${Math.round(fraction * 100)}%`}</span>
      </div>
    );
  }

  return (
    <div className="image-object__panel" data-testid="image-uploading">
      <ImageIcon />
      <span className="image-object__text">{IMAGE_UPLOADING_TEXT}</span>
    </div>
  );
}

/**
 * The image as the board draws it: a box on the board, in world units, that asks {@link ImageObject} what
 * ought to be inside it.
 *
 * This is the half that knows about the board and the half that knows about pictures, kept apart on purpose:
 * {@link ImageObject} can be shown any state at any size without a document, a network or a second browser,
 * and this half is the reading of a snapshot and the answering for the things only the board knows - who
 * this person is, how far their upload has got, where the box goes, and what a press on it means.
 */
export function ImageBoardObject(props: ObjectProps): JSX.Element | null {
  const { doc, object } = props;
  const image = object.type === IMAGE_TYPE ? asImageSnapshot(object) : null;
  // An image whose box has no ratio in it cannot be drawn at all, and a box that is drawn at a guessed size
  // is a box that will have to move when the real one turns up.
  const identityId = props.identityId ?? String(doc.clientID);
  // The clock is started only for an upload that is still going, and only when the test is not the one
  // holding the clock: a component test that pins `now` has said what time it is, and a timer that changed
  // the answer afterwards would be a timer that undid the thing being tested.
  const now = useImageClock(image !== null && props.now === undefined && image.status === 'uploading');
  if (image === null) {
    return null;
  }

  const remove = (): void => {
    if (!props.canEdit) {
      return;
    }
    // One step, and the same one Ctrl+Z would take: a person who removes a picture and then presses undo
    // once gets the picture back, not a half-deleted object with its status written back.
    props.undo?.boundary();
    deleteObjects(doc, [image.id]);
    props.undo?.boundary();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // An image is not the board: pressing it must never start a pan or a marquee.
    event.stopPropagation();
    // But a press on one of the box's own buttons is not a press on the box either, and that distinction is
    // the whole of why the Retry button works with a mouse. Passing the press on asks the board to select
    // the picture and take the pointer into its own hands for the length of the drag - and a pointer that
    // the box is holding delivers its click to the box, never to the button under the finger. In jsdom a
    // click is placed exactly where the test put it, so the button appeared to work; the browser is the one
    // that reads the capture and decides who gets told. The same `data-board-ui` that keeps a pen stroke
    // from starting under a colour swatch keeps a click from being eaten here.
    if (isBoardUi(event.target)) {
      return;
    }
    props.onObjectPointerDown(event, image.id);
  };

  return (
    <div
      className="image-object"
      data-image-object=""
      data-testid="image-object"
      data-object-id={image.id}
      data-object-type={image.type}
      data-x={image.x}
      data-y={image.y}
      data-width={image.width}
      data-height={image.height}
      data-z={image.z}
      data-status={displayStatus(image, props.now ?? now)}
      data-uploader={image.uploaderId ?? ''}
      data-selected={props.selected ? 'true' : 'false'}
      data-dragging={props.transforming ? 'true' : 'false'}
      role="group"
      aria-label="Image"
      tabIndex={0}
      style={{
        left: `${image.x}px`,
        top: `${image.y}px`,
        width: `${image.width}px`,
        height: `${image.height}px`,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        // A double-click on a picture is not a request for a sticky note on top of it. An image holds no
        // words, so there is nothing for the second click to open.
        event.stopPropagation();
      }}
      onLostPointerCapture={(event) => {
        event.stopPropagation();
        props.onObjectLostPointerCapture(event, image.id);
      }}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === identityId}
        progress={props.progress}
        canRetry={props.canRetry === true && props.canEdit}
        canRemove={props.canEdit}
        now={props.now ?? now}
        retry={() => {
          props.onRetry?.(image.id);
        }}
        remove={remove}
      />
    </div>
  );
}

/**
 * The clock that knows when an upload has taken too long.
 *
 * A stale image is not a state that anything *happens* to: nobody writes to it, no update arrives, and the
 * object would say "Uploading…" forever in a document that has long since stopped meaning it. So somebody
 * has to look at the clock, and the only place that can be done is in front of the object that is waiting.
 * Thirty seconds, and only while an upload is in progress - a board of finished pictures asks its own clock
 * nothing at all, and holds no timer open to do it.
 */
export function useImageClock(uploading: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!uploading) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, IMAGE_CLOCK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [uploading]);
  return now;
}

/** Where in the bucket these bytes are, as an address this browser can ask for. */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}

function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    return 0;
  }
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/** The picture that is not there yet: the same outline the picture itself will fill. */
function ImageIcon(): JSX.Element {
  return (
    <svg className="image-object__icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 5h16v14H4V5Zm1.5 1.5v11h13v-11h-13ZM7 7.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2ZM6 17h12l-4.2-5.6-3 3.6-2-2.2L6 17Z"
      />
    </svg>
  );
}

/** The picture that is not coming: a torn frame, which is the icon every file browser uses for the same news. */
function BrokenImageIcon(): JSX.Element {
  return (
    <svg className="image-object__icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 5h7v2H5.5v11H9v2H4V5Zm11 0h5v14h-5v-2h3.5V7H15V5Zm-4.2 4.6 2.2 2.9-1.6 2-2.1-2.4-2.6 3.4h10l-4-5.3-1.9-1.6Z"
      />
    </svg>
  );
}

/**
 * The button that takes the box off the board.
 *
 * It is offered in every state that has no picture in it, to whoever the board may be written to - which is
 * not the same question as who uploaded it. The person who dropped a file that failed can send it again;
 * anybody at all can decide they no longer want the box that is standing in the middle of their board.
 */
function RemoveButton(props: { hidden: boolean; onClick(): void }): JSX.Element | null {
  if (props.hidden) {
    return null;
  }
  return (
    <button
      type="button"
      className="image-object__button image-object__button--remove"
      data-testid="image-remove"
      data-board-ui=""
      onClick={props.onClick}
    >
      Remove
    </button>
  );
}
