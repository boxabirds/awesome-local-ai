/**
 * One picture on the board, and the five things that can be true about it (story 12).
 *
 * `ImageObject` is the only component on this board that has to draw a *lack*. Every other object is fully
 * present in the document — a note's words are there, a shape's label is there — and drawing one is a matter of
 * reading and painting. An image's bytes are in a bucket somewhere, and between the drop and the picture there is
 * a stretch of time in which the board has to say something true about an object whose content has not arrived
 * yet. So there are five states, and what each of them is *for*:
 *
 *  - **uploading** — the bytes are on their way. The person who dropped them sees a percentage, because they are
 *    the only person who can know how far the upload has got: it is their network, their file, and nobody else's
 *    machine is involved in the answer. Everybody else sees "Uploading…" and nothing more, because from where
 *    they are standing the only fact is that there is a picture coming.
 *  - **ready** — there is a key, so there is something to fetch. This is a claim about storage, not about
 *    whether the fetch will work, which is why it is not the same as the next one.
 *  - **unavailable** — the fetch did not work: the bucket has lost the object, the network died, the bytes are
 *    corrupt. This is *discovered by the `<img>`*, not stored anywhere, and it cannot be stored: a board cannot
 *    write "this failed for me" into a document that four other people are looking at, because it may not have
 *    failed for them. So it is a local state, drawn in the object's own place and size, and the rest of the board
 *    does not know it happened.
 *  - **failed** — the upload itself did not make it. The person who tried gets Retry and Remove; everybody else
 *    gets "Image unavailable", because "Upload failed" said to a person who never uploaded anything is a
 *    sentence about somebody else's bad luck and offers them the chance to press Retry on a file they do not
 *    have.
 *  - **unfinished** — the status in the document says uploading, and the clock says it has said it for five
 *    minutes. There is no message that says an uploader went away: the tab that was uploading is gone, and the
 *    only trace it left is a timestamp. So this state is calculated, and what it says is the truth — nobody is
 *    finishing this — instead of a progress bar that has not moved since somebody's laptop closed.
 *
 * The states after `ready` are the same for everybody, which is what makes an image a board object rather than a
 * local widget: `status` and `assetKey` are in the document, so the picture a person uploaded last week is drawn
 * identically by a build that has never seen the file, and by a person who opens the board for the first time.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { ObjectProps } from './objectProps';
import type { ImageSnap } from '../../shared/objects/image';
import { deleteObjects } from '../../shared/board-model';
import {
  IMAGE_ARIA_LABEL,
  assetUrl,
  displayStatus,
  isImageSnapshot,
  readImage,
  type ImageDisplayStatus,
} from '../../shared/objects/image';

/** The mouse button that picks a picture up. */
const PRIMARY_MOUSE_BUTTON = 0;

/** The glyph on a placeholder: a picture, drawn as a mountain and a sun because that is what it is. */
const IMAGE_GLYPH = '🖼';
/** The glyph on a picture that will not load. It is the same picture, with the news in it. */
const BROKEN_GLYPH = '⚠';

/** What each state says, in the words the PRD asks for. Exported so a test can name them. */
export const IMAGE_STATE_MESSAGES: Readonly<Record<Exclude<ImageDisplayStatus, 'ready'> | 'unavailable', string>> = {
  uploading: 'Uploading…',
  failed: 'Upload failed',
  unfinished: "Image upload didn't finish",
  unavailable: 'Image unavailable',
};

/** The name of the two things a person can do about a picture that has gone wrong. */
export const IMAGE_RETRY_LABEL = 'Retry';
export const IMAGE_REMOVE_LABEL = 'Remove';

/* ---------------------------------------------------------------- context -- */

/**
 * What an image needs from the tab that is uploading it, and from the clock.
 *
 * It is a context rather than props because the board draws objects through the registry, and the registry hands
 * a component what every object gets — a snapshot, a document, a zoom. Progress is not something every object
 * has: it belongs to one upload, in one tab, and the only reason it reaches the object at all is that the
 * component drawing that object can ask for it. Everything in here is a fact about *this tab*: another person's
 * browser has its own, and holds nothing at all for an image it is not uploading.
 *
 * `now` is in here rather than read from `Date.now()` inside each object so that every image on a board ages at
 * the same moment, on one interval, instead of on one interval per picture.
 */
export interface ImageContextValue {
  readonly now: number;
  readonly progress: ReadonlyMap<string, number>;
  /** Upload the file this image came from again. False when this tab is not holding that file. */
  retry(id: string): boolean;
  /** Take the image off the board, and stop anything still being uploaded for it. */
  remove(id: string): void;
  /** Whether Retry would find a file. False for every image this tab did not upload. */
  canRetry(id: string): boolean;
}

export const ImageContext = createContext<ImageContextValue | null>(null);

/* ----------------------------------------------------------------- render -- */

export interface ImageObjectProps {
  /** The image, as the board holds it. */
  image: ImageSnap;
  /** Whether *this tab* is the one uploading it, which decides who is offered Retry. */
  isUploader: boolean;
  /** How far the upload has got, 0 to 1. Only ever present for this tab's own uploads. */
  progress?: number;
  /** Whether Retry would have anything to upload. False after a reload: see the file's header. */
  canRetry: boolean;
  /** The time this is drawn at, for the one state that is measured rather than stored. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /** Whether the object is selected, and whether a pointer is holding it. Furniture, and nothing more. */
  selected?: boolean;
  readOnly?: boolean;
  /** Whether a pointer is holding this object. Says so on the element, as every other object type does. */
  interaction?: string;
  /** Where the object is pressed. Left out, a picture cannot be picked up — which is how it is drawn on its own. */
  onPointerDown?(event: ReactPointerEvent<HTMLElement>): void;
}

/**
 * The picture, in whichever of its five states it is in.
 *
 * The box it draws is always the object's box, in every state — the same left, top, width and height the
 * document holds for it. That is the single most important thing this component does and the least visible: a
 * placeholder that was a different size from the picture that replaced it would make the board jump, and a
 * placeholder that was drawn at nothing would mean a person on the other side of the world could not see where
 * the incoming image was going to land, which is the entire point of showing them a placeholder at all.
 */
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
  selected = false,
  readOnly = false,
  interaction,
  onPointerDown,
}: ImageObjectProps): JSX.Element {
  // Whether the *fetch* of a stored picture has failed, for this person, in this browser. It is keyed on the key
  // rather than being a plain flag so that the picture is asked for again when the key changes — a retry that
  // stored the file under a new key is a new picture, and holding on to the old failure would keep a working
  // image off the board for the rest of the session.
  const [unavailableFor, setUnavailableFor] = useState<string | null>(null);
  const status = displayStatus(image, now);
  const key = image.assetKey;
  const unavailable = status === 'ready' && unavailableFor !== null && unavailableFor === key;
  const url = assetUrl(key);

  const press = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    event.stopPropagation();
    onPointerDown?.(event);
  };

  const box = { left: image.x, top: image.y, width: image.width, height: image.height, zIndex: image.z };

  //                                   there is a picture, and it is being fetched right now
  if (status === 'ready' && url !== null && !unavailable) {
    return (
      <div
        className="image-object image-object--ready"
        data-testid="image-object"
        data-image-id={image.id}
        data-image-status="ready"
        data-selected={selected ? 'true' : 'false'}
        data-interaction={interaction}
        style={box}
        onPointerDown={press}
      >
        <img
          className="image-object__img"
          data-testid="image-object-img"
          src={url}
          // The name of the thing, not a description of it: nobody has alt text for a screenshot they dropped
          // four seconds ago, and an empty alt would hide the image from the people who most need to know it is
          // there.
          alt={IMAGE_ARIA_LABEL}
          // Dragging an `<img>` out of the board would be a file drag over the board, which is the one gesture
          // this story puts a highlight on — and a copy-out of a picture is not a thing the board offers.
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => {
            setUnavailableFor(key);
          }}
        />
      </div>
    );
  }

  //                             What to say, and what to draw beside it, for every state but that one. The state a
  // person is shown is not always the state the document is in, and the one place they differ is the important
  // one: an upload that failed is *the uploader's* news — it happened to their network, and they are the one
  // person who can do something about it — and for everybody else it is simply a picture that is not there. So
  // the same record is drawn two ways, and this is where the two readings are decided, once.
  const shown: Exclude<ImageDisplayStatus, 'ready'> | 'unavailable' =
    // The bytes are gone, this browser cannot reach them, or what came back is not a picture. Everyone's news,
    // whoever caused it.
    unavailable || (status === 'failed' && !isUploader)
      ? 'unavailable'
      : status === 'failed'
        ? 'failed'
        : status === 'unfinished'
          ? 'unfinished'
          : // The uploader, and only the uploader: they are the one person who can be told how far it has got.
            'uploading';

  const message = IMAGE_STATE_MESSAGES[shown];

  const showProgress = status === 'uploading' && isUploader && progress !== undefined;
  const percentage = Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100);
  // The controls are offered where they can do something. Retry needs the file, which only this tab ever had.
  // Remove is offered on a failed upload to the tab that made it — the state for everybody else is *unavailable*,
  // and the way they take a picture that never arrived off the board is the way they take anything else off it —
  // and on an unfinished one to everybody, because there is nobody left who uploaded it. On a board that cannot be
  // written to neither is offered at all, because a button that deletes nothing is a lie.
  const showRetry = shown === 'failed' && isUploader && canRetry && !readOnly;
  const showRemove = (shown === 'failed' || shown === 'unfinished') && !readOnly;

  return (
    <div
      className={
        // A red border is the failed state's, and the only one: it is the one state that is about something a
        // person can still act on. An unfinished upload and an unavailable picture are both grey, because there
        // is nothing to fix and a red box would say there is.
        `image-object image-object--${shown}` +
        (shown === 'failed' && isUploader ? ' image-object--mine' : '')
      }
      // A group, and not an image: `role="img"` would make everything inside it presentational to a screen
      // reader, which is exactly right for a picture and exactly wrong for a box whose whole content is a message
      // and two buttons. The ready state is the one that is an image, and there the `<img>` says so itself.
      // Sticky notes are grouped the same way, for the same reason.
      role="group"
      aria-label={IMAGE_ARIA_LABEL}
      data-testid="image-object"
      data-image-id={image.id}
      data-image-status={shown}
      data-uploader={isUploader ? 'me' : 'other'}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      style={box}
      onPointerDown={press}
    >
      <span className="image-object__glyph" aria-hidden="true">
        {shown === 'unavailable' || shown === 'failed' ? BROKEN_GLYPH : IMAGE_GLYPH}
      </span>
      <span className="image-object__message" data-testid="image-object-message">
        {message}
      </span>
      {showProgress ? (
        // A progress bar a screen reader can read: the role and the value, so the percentage is announced in
        // words as well as drawn as a width. `aria-valuetext` says it the way it is said on the bar, because the
        // default is a bare number.
        <span
          className="image-object__progress"
          data-testid="image-object-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
          aria-valuetext={`${percentage}%`}
        >
          <span
            className="image-object__progress-fill"
            style={{ width: `${percentage}%` }}
            data-testid="image-object-progress-fill"
          />
        </span>
      ) : null}
      {showProgress ? (
        <span className="image-object__percent" data-testid="image-object-percent">
          {percentage}%
        </span>
      ) : null}
      {showRetry || showRemove ? (
        <span
          className="image-object__actions"
          // The buttons are on top of an object that is itself pressed to be picked up: a press on Remove must
          // not also start a drag of the picture it is about to delete.
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          {showRetry ? (
            <button
              type="button"
              className="image-object__button"
              data-testid="image-object-retry"
              onClick={onRetry}
            >
              {IMAGE_RETRY_LABEL}
            </button>
          ) : null}
          {showRemove ? (
            <button
              type="button"
              className="image-object__button image-object__button--remove"
              data-testid="image-object-remove"
              onClick={onRemove}
            >
              {IMAGE_REMOVE_LABEL}
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- the board's object -- */

/**
 * How often the board looks at the clock while a picture is on its way.
 *
 * Thirty seconds against a five minute deadline: the unfinished state is allowed to be up to half a minute late,
 * and is not allowed to be missing. The interval only runs while something is uploading, because a board whose
 * pictures have all arrived has no state that ages and no reason to re-render anything ever again.
 */
export const IMAGE_CLOCK_TICK_MS = 30_000;

/**
 * The time it is now, kept up to date while any image is still uploading.
 *
 * One clock for the whole board rather than one per image, for the reason the states above give: the images on a
 * board are expected to say the same thing about the same moment. Five uploads that each re-rendered themselves
 * on their own timer would be five pictures reaching the same conclusion at five different times, which looks
 * exactly like a board that cannot make up its mind.
 */
export function useImageClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // The value, and not `Date.now()` read during a render: a render has no business asking what time it is, and
    // a component that does has no way to be told the time has moved on.
    const timer = setInterval(() => {
      setNow(Date.now());
    }, IMAGE_CLOCK_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

/**
 * The image, as the board draws it.
 *
 * This is the component the registry knows about, and it exists because the two sets of things a picture needs
 * are asked for in two different ways. The board hands every object the same generic props — a snapshot, a
 * document, a zoom, what to do when it is pressed — and `ImageObject` wants to be told which of its five states
 * to draw, whether this tab is the one that is uploading it, and how far along that upload is. The adapter is
 * where one is turned into the other, and it decides exactly three things and nothing else:
 *
 *  - **the image**, from the snapshot the board already read (and only if that snapshot cannot be read as an
 *    image, from the document — the same fallback every other object type uses, for a record this build can hold
 *    but not understand);
 *  - **who is uploading it**, which is `String(doc.clientID)`, the same name the pen signs a drawing with: a
 *    number the document gave to this tab, which every other tab can see and none of them can claim;
 *  - **the clock, the progress and the two buttons**, from the context — which is absent entirely on a board that
 *    is not uploading anything, and means `canRetry` false and `remove` falling back to the board's own delete.
 */
export function ImageBoardObject(props: ObjectProps): JSX.Element {
  const { object, doc, selected, readOnly, interaction, onPointerDown } = props;
  const actions = useContext(ImageContext);
  const image = isImageSnapshot(object) ? object : readImage(doc, object.id);
  const now = actions?.now ?? Date.now();

  if (image === null) {
    // A record that says it is a picture and cannot be read as one is drawn as nothing, in its own place in the
    // stacking order, so it still exists and can still be deleted. It is not drawn as a broken image, because
    // nothing is unavailable — this build is simply not able to say what it is, which is what every other object
    // type does with a record from a later build.
    return (
      <div
        className="image-object"
        data-testid="image-object"
        data-image-id={object.id}
        data-image-status="unreadable"
        style={{ left: object.x, top: object.y, width: 0, height: 0, zIndex: object.z }}
      />
    );
  }

  return (
    <ImageObject
      image={image}
      isUploader={image.uploaderId === String(doc.clientID)}
      progress={actions?.progress.get(image.id)}
      canRetry={actions?.canRetry(image.id) ?? false}
      now={now}
      selected={selected}
      readOnly={readOnly}
      interaction={interaction}
      onRetry={() => {
        actions?.retry(image.id);
      }}
      onRemove={() => {
        if (actions !== null) actions.remove(image.id);
        else deleteObjects(doc, [image.id]);
      }}
      onPointerDown={(event) => {
        onPointerDown(event, image.id);
      }}
    />
  );
}
