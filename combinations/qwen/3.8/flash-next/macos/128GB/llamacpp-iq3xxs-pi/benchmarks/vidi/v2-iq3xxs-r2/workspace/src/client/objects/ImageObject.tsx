/**
 * Story 12: an image on the board, and the five things it can look like while it is getting
 * there (`image.object`).
 *
 * An image is the first object type whose appearance is not simply what it is. The same
 * object is a grey box with a percentage in it, a grey box that says "Uploading…", a red box
 * with two buttons, a sentence about an upload that never finished, and a picture — and which
 * of those a given person sees depends on whose upload it was and on what their own clock
 * says. So the component takes the snapshot plus the viewer's position relative to it, and
 * `displayStatus` (in the model) does the judging: this file is deliberately not in the
 * business of deciding anything, only of drawing what was decided.
 *
 * Two things are handled inside the component and never let out:
 *
 * - **An `<img>` that will not load.** A stored key can 404 — the bucket lost the object, an
 *   old board points at bytes that are gone. The board's answer is a box saying so, at the
 *   size and place the image has (`image.unavailable`), because a hole where an image used to
 *   be is indistinguishable from somebody having deleted it, which is the one thing the PRD
 *   says people misread.
 * - **The buttons.** Retry and Remove are inside the box, so a press on them must not start a
 *   move: they stop the pointer before it reaches the gesture.
 */
import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { deleteObjects } from '../../shared/board-model';
import { displayStatus, readImage, type ImageSnap } from '../../shared/objects/image';
import { SELECTION_OUTLINE, SELECTED_STACK_ABOVE } from './StickyNote';
import type { ObjectProps } from './registry';
import { assetUrl } from '../images/uploadImage';

/** Exact UI text (PRD: "Uploading…", "Upload failed", "Image unavailable", "Retry", "Remove"). */
export const UPLOADING_LABEL = 'Uploading…';
export const UPLOAD_FAILED_LABEL = 'Upload failed';
export const IMAGE_UNAVAILABLE_LABEL = 'Image unavailable';
export const UPLOAD_UNFINISHED_LABEL = "Image upload didn't finish";
export const RETRY_LABEL = 'Retry';
export const REMOVE_LABEL = 'Remove';
/** What an image is announced as while it is a picture (PRD: images have an alt of "Image"). */
export const IMAGE_ARIA_LABEL = 'Image';
/**
 * The uploader's version of the placeholder, which has a number in it: "Uploading 42%".
 *
 * `fraction` is what the upload reports — 0 to 1 — because that is the unit the transport
 * speaks; the percentage is only ever how it is shown.
 */
export function uploadingLabel(fraction: number): string {
  return `${UPLOADING_LABEL.replace('…', '')} ${Math.round(fraction * 100)}%`;
}

/**
 * How often the board re-renders its images while one is uploading, so that a viewer who left
 * the tab open sees "Uploading…" become "Image upload didn't finish" without doing anything.
 *
 * It is a tenth of the five minutes that decide the change (`IMAGE_UPLOAD_STALE_MS`): long
 * enough that nobody watches a clock tick, short enough that the change is not discovered a
 * week later. There is no timer at all while no image is uploading.
 */
export const IMAGE_CLOCK_TICK_MS = 30_000;

export interface ImageObjectProps {
  image: ImageSnap;
  /** Is this the tab that uploaded it? Only that tab is told an upload failed (PRD). */
  isUploader: boolean;
  /** This tab's own upload progress, 0 to 1. Absent for anybody else's uploads. */
  progress?: number;
  /** Is Retry worth showing, i.e. is the file still in this browser's memory? */
  canRetry: boolean;
  /** This object is part of what this client has selected: the box is drawn outlined. */
  selected?: boolean;
  /** The viewer's clock, which is what turns a stale `uploading` into `unfinished`. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /**
   * A press that lands on a picture has landed on an object: it selects it and can begin a
   * move of it, exactly as it does on a shape or a note. Absent only in a test that draws the
   * box on its own, with no board to tell.
   */
  onObjectPointerDown?(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** A board that could not be loaded refuses edits but still allows selecting. */
  readOnly?: boolean;
}

/** The box every state is drawn in: the image's own size and place, and its own stacking. */
function boxStyle(image: ImageSnap, selected = false): CSSProperties {
  return {
    position: 'absolute',
    left: `${image.x}px`,
    top: `${image.y}px`,
    width: `${Math.max(0, image.width)}px`,
    height: `${Math.max(0, image.height)}px`,
    // A selected object is drawn above the others for the same reason every other type draws
    // itself there: the outline of a box two pixels inside another box is not an outline.
    zIndex: selected ? SELECTED_STACK_ABOVE : image.z,
    outlineWidth: selected ? '2px' : '0',
    outlineColor: SELECTION_OUTLINE,
  };
}

/**
 * One image, in whichever of its states it is in.
 *
 * `status` comes from `displayStatus`, so the stale-upload judgement is the model's and this
 * component cannot disagree with the code that decided it.
 */
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  selected = false,
  now,
  onRetry,
  onRemove,
  onObjectPointerDown,
}: ImageObjectProps): JSX.Element {
  const [unloaded, setUnloaded] = useState(false);
  const status = displayStatus(image, now);
  /*
   * The press/focus dance every type here has, in one pair of handlers used by all five
   * states: a press selects the object and must not start a pan of the board under it (a
   * picture is the widest thing on most boards, so panning over it would be impossible
   * otherwise). A double click is swallowed for the same reason a shape swallows it — the
   * viewport would otherwise put a sticky note exactly where the picture is.
   */
  const press: PressHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
      // A touch is a pan or a pinch of the board, not a press on this object.
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      event.stopPropagation();
      onObjectPointerDown?.(event, image.id);
    },
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>): void => {
      event.stopPropagation();
    },
  };
  // A picture whose bytes will not load is the same box as an upload nobody finished, with
  // the other words on it: both mean "there is nothing here to look at", and only the person
  // who could have uploaded it is told about an upload (`image.unavailable`).
  if (unloaded) {
    return (
      <div
        className="vidi6-image-box vidi6-image-box--unavailable"
        data-note-id={image.id}
        data-testid="image-state"
        data-status="unavailable"
        data-selected={selected ? 'true' : 'false'}
        {...press}
        style={boxStyle(image, selected)}
      >
        <span className="vidi6-image-label">{IMAGE_UNAVAILABLE_LABEL}</span>
      </div>
    );
  }

  if (status === 'ready') {
    const src = image.assetKey === null ? null : assetUrl(image.assetKey);
    if (src !== null) {
      return (
        <img
          className="vidi6-image"
          data-note-id={image.id}
          data-testid="image-object"
          data-selected={selected ? 'true' : 'false'}
          src={src}
          alt={IMAGE_ARIA_LABEL}
          // Draggable for two reasons: the browser's own image drag would compete with the
          // board's move gesture, and dragging an image out of the board suggests it can be
          // taken somewhere the board does not go.
          draggable={false}
          decoding="async"
          loading="lazy"
          {...press}
          style={boxStyle(image, selected)}
          onError={() => {
            // Handled here, and nowhere else: one broken picture must leave the rest of the
            // board alone (`image.unavailable`).
            setUnloaded(true);
          }}
        />
      );
    }
    // A ready image with no address it could be fetched from is the same hole.
    return (
      <UnavailableBox
        image={image}
        selected={selected}
        showRemove={false}
        onRemove={onRemove}
        press={press}
      />
    );
  }

  if (status === 'failed') {
    // "Upload failed", with the two things to do about it, is said to the one person who can
    // do something about it; everybody else is told the simpler truth.
    return (
      <div
        className="vidi6-image-box vidi6-image-box--failed"
        data-note-id={image.id}
        data-testid="image-state"
        data-status="failed"
        data-selected={selected ? 'true' : 'false'}
        {...press}
        style={boxStyle(image, selected)}
      >
        <span className="vidi6-image-label">{isUploader ? UPLOAD_FAILED_LABEL : IMAGE_UNAVAILABLE_LABEL}</span>
        {isUploader ? (
          // Retry is only offered while this browser still holds the file — after a reload it
          // does not — but Remove is offered whatever the reason, because a box around nothing
          // is one thing the uploader can always do away with.
          <span className="vidi6-image-actions">
            {canRetry ? <ActionButton testId="image-retry" label={RETRY_LABEL} onClick={onRetry} /> : null}
            <ActionButton testId="image-remove" label={REMOVE_LABEL} onClick={onRemove} />
          </span>
        ) : null}
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <UnavailableBox
        image={image}
        selected={selected}
        showRemove
        onRemove={onRemove}
        label={UPLOAD_UNFINISHED_LABEL}
        press={press}
      />
    );
  }

  return (
    <div
      className="vidi6-image-box vidi6-image-box--uploading"
      data-note-id={image.id}
      data-testid="image-state"
      data-status="uploading"
      data-selected={selected ? 'true' : 'false'}
      {...press}
      style={boxStyle(image, selected)}
    >
      {isUploader && progress !== undefined ? (
        <span className="vidi6-image-progress" data-testid="image-progress">
          <span
            className="vidi6-image-progress-bar"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      ) : null}
      <span className="vidi6-image-label" data-testid="image-uploading">
        {isUploader && progress !== undefined ? uploadingLabel(progress) : UPLOADING_LABEL}
      </span>
    </div>
  );
}

interface UnavailableBoxProps {
  image: ImageSnap;
  label?: string;
  selected?: boolean;
  showRemove: boolean;
  onRemove(): void;
  /** The press handlers, from whoever drew the box and knows whether there is a board. */
  press?: PressHandlers;
}

/** A press on any of the boxes an image can be drawn as is a press on the image. */
interface PressHandlers {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onDoubleClick(event: ReactMouseEvent<HTMLElement>): void;
}

/**
 * The grey box for an image that is not there: the abandoned upload (`image.unfinished`),
 * which is the one state with an explanation of why, and the stored image that will not load
 * (`image.unavailable`), which has no explanation to offer and gets no button either — a
 * person who did not upload it cannot fix it, and the ones who did are told to try again.
 */
function UnavailableBox({
  image,
  label = IMAGE_UNAVAILABLE_LABEL,
  selected = false,
  showRemove,
  onRemove,
  press,
}: UnavailableBoxProps): JSX.Element {
  return (
    <div
      className="vidi6-image-box vidi6-image-box--unavailable"
      data-note-id={image.id}
      data-testid="image-state"
      data-status="unavailable"
      data-selected={selected ? 'true' : 'false'}
      style={boxStyle(image, selected)}
      {...press}
    >
      <span className="vidi6-image-label">{label}</span>
      {showRemove ? (
        <span className="vidi6-image-actions">
          <ActionButton testId="image-remove" label={REMOVE_LABEL} onClick={onRemove} />
        </span>
      ) : null}
    </div>
  );
}

interface ActionButtonProps {
  testId: string;
  label: string;
  onClick(): void;
}

/** A button inside an object's box. */
function ActionButton({ testId, label, onClick }: ActionButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="vidi6-image-button"
      data-testid={testId}
      onClick={onClick}
      // A press on a button is a press on a button: it must not begin a move of the box it
      // happens to sit inside.
      onPointerDown={(event: ReactPointerEvent<HTMLElement>) => event.stopPropagation()}
    >
      {label}
    </button>
  );
}

/**
 * What an image object needs from the board that is not in the document: this tab's upload
 * progress, its identity, its clock, and the way to retry.
 *
 * A context rather than props, because the board's object rendering is generic — it hands
 * every object the same `ObjectProps` and knows nothing about images (sel.all_types) — and
 * threading four image-only values through the generic layer would put story 12 back inside
 * story 7's code.
 */
export interface ImageBoardContext {
  readonly progress: ReadonlyMap<string, number>;
  /** This tab's identity, which decides whether "Upload failed" or "Image unavailable". */
  readonly identityId: string;
  /** The board's clock, which moves while anything is uploading (IMAGE_CLOCK_TICK_MS). */
  readonly now: number;
  /** Re-upload this image's file; false when this tab no longer has it. */
  retry(id: string): boolean;
  /** Could this image be retried here, i.e. is its file still in this browser's memory? */
  canRetry(id: string): boolean;
}

const IMAGE_CONTEXT = createContext<ImageBoardContext | null>(null);

export function ImageBoardContextProvider({
  value,
  children,
}: {
  value: ImageBoardContext;
  children: ReactNode;
}): JSX.Element {
  return <IMAGE_CONTEXT.Provider value={value}>{children}</IMAGE_CONTEXT.Provider>;
}

/**
 * The registered component: the object the generic board layer hands over, read as an image
 * and drawn as one.
 *
 * Like a text object, an image has fields the base snapshot does not carry, so it reads them
 * itself rather than asking the board to know about them.
 */
export function BoardImageObject(props: ObjectProps): JSX.Element | null {
  const context = useContext(IMAGE_CONTEXT);
  const image = readImage(props.doc, props.object.id);
  if (image === null) return null;
  return (
    <ImageObject
      image={image}
      isUploader={image.uploaderId === (context?.identityId ?? '')}
      selected={props.selected}
      progress={context?.progress.get(image.id)}
      canRetry={context?.canRetry(image.id) === true}
      now={context?.now ?? image.uploadStartedAt}
      onObjectPointerDown={props.onObjectPointerDown}
      onRetry={() => {
        context?.retry(image.id);
      }}
      onRemove={() => {
        // Story 7's delete: one object, one transaction, one undo step like any other removal.
        deleteObjects(props.doc, [image.id]);
      }}
    />
  );
}

// The registry entry for this type — its resizing, its minimum size and its hit test — is
// declared in `./registry` with every other object type, so that there is one place to look
// to know what a type on this board can do.
