// A picture on the board, and the four things the board says about it (story 12).
//
// What is rendered comes from one function — `displayStatus(image, now)` — and never from the
// upload this screen happens to be running. That is the whole of how two people looking at the
// same board can see two different and both-correct sentences about the same object: the record
// says "uploading", this tab has the file in memory and can send it again, the other tab does
// not and says so. Nothing is asked of the network to decide what to draw, which is why a board
// that is reconnecting still shows its pictures.
//
// The states, and who sees which:
//
//   uploading, this tab   a box of the picture's final size, with the percentage in it
//   uploading, another    a grey box, "Uploading…"
//   uploading, five min   "Image upload didn't finish" and Remove, whoever you are
//   ready                 the picture
//   ready, won't load     "Image unavailable" — this screen's own finding, not the board's
//   failed, this tab      "Upload failed", with Retry and Remove
//   failed, another       "Image unavailable"
//
// The last row is the one that looks like a mistake and is not: a failure is not an event that
// happened to the file, it is a fact about the tab that was holding it. Everyone else is looking
// at a picture that is not there and has no way to make it one, so what they are told is what
// they can act on.

import { useEffect, useState } from 'react';
import {
  asImageSnapshot,
  assetUrl,
  displayStatus,
  isUploaderView,
  type DisplayStatus,
  type ImageSnap,
} from '../../shared/objects/image.ts';
import type { ObjectSnapshot } from '../../shared/board-model.ts';
import { hitTestRect, registerObjectType, type ObjectProps } from './registry.tsx';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_PROGRESS_TICK_MS } from '../../shared/config.ts';

/** The words on each box. They are the story's, not the component's invention. */
export const IMAGE_STATE_LABELS: Record<DisplayStatus, string> = {
  uploading: 'Uploading…',
  ready: 'Image',
  failed: 'Upload failed',
  unfinished: "Image upload didn't finish",
};

/** What a person who can do nothing about it is told. */
export const IMAGE_UNAVAILABLE_LABEL = 'Image unavailable';

const BOX_BACKGROUND = '#eef1f5';
const BOX_BORDER = '#d6d9de';
const FAILED_BORDER = '#d93025';
const FAILED_BACKGROUND = '#fdecea';
const TEXT_COLOR = '#5f6368';

export interface ImageObjectProps {
  /** The picture as the board holds it. */
  image: ImageSnap;
  /** Whether the file is in *this* tab's memory, which is what a Retry needs. */
  isUploader: boolean;
  /** 0…1 of the upload this tab is running; absent for a box that is not this tab's. */
  progress?: number;
  /** Whether a Retry would have anything to send. */
  canRetry: boolean;
  /** The board's clock, so a five-minute-old upload reads as abandoned to everyone at once. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /** Selection and gesture props from the board; a standalone render has none. */
  selected?: boolean;
  onObjectPointerDown?(e: React.PointerEvent<HTMLElement>, id: string): void;
}

/** What percentage a fraction is shown as. A number is rounded once, here. */
export function progressLabel(fraction: number | undefined): string {
  if (fraction === undefined || !Number.isFinite(fraction)) return IMAGE_STATE_LABELS.uploading;
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return `${percent}%`;
}

function controlStyle(color: string): React.CSSProperties {
  return {
    font: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: '#ffffff',
    color,
    cursor: 'pointer',
  };
}

/**
 * The small buttons one of the boxes offers.
 *
 * They stop the pointer where it lands: a Remove button that also started a drag would move the
 * object it is standing on, and a click that both deleted a picture and began a marquee would
 * delete the picture twice.
 */
function Controls(props: {
  id: string;
  retry?: string;
  remove?: string;
  onRetry?(): void;
  onRemove?(): void;
}) {
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  return (
    <span
      data-testid={`image-controls-${props.id}`}
      style={{ display: 'flex', gap: 6, marginTop: 6 }}
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      {props.retry !== undefined && props.onRetry ? (
        <button
          type="button"
          aria-label={props.retry}
          data-testid={`image-retry-${props.id}`}
          title={props.retry}
          onClick={props.onRetry}
          style={controlStyle('#2f6fed')}
        >
          {props.retry}
        </button>
      ) : null}
      {props.remove !== undefined && props.onRemove ? (
        <button
          type="button"
          aria-label={props.remove}
          data-testid={`image-remove-${props.id}`}
          title={props.remove}
          onClick={props.onRemove}
          style={controlStyle(TEXT_COLOR)}
        >
          {props.remove}
        </button>
      ) : null}
    </span>
  );
}

/**
 * One picture's box.
 *
 * It is placed and sized in board units, like every other object, so it moves, selects, resizes
 * (proportionally) and deletes with the code the board already has. Only what is *inside* the
 * box is this story's business.
 */
export function ImageObject(props: ImageObjectProps) {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  // Whether *this screen* managed to fetch the bytes. Deliberately not stored in the document:
  // another person's screen may load the same file happily, and a board where one broken link
  // told everyone it was broken would be a board that destroys its own pictures by looking at
  // them (image.unavailable).
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [image.assetKey]);

  const shown: DisplayStatus = displayStatus(image, now) ?? 'failed';
  const noPicture = broken || (shown === 'ready' && image.assetKey === null);
  const isFailedHere = shown === 'failed' && isUploader;
  const isUnfinished = shown === 'unfinished';

  // A failure is a fact about the tab that was holding the file. This screen is not that tab, so
  // it is not told that something is "uploading" when nothing is: it is told what it is looking
  // at, which is a picture that is not there (image.upload_failure).
  const label =
    noPicture || (shown === 'failed' && !isUploader)
      ? IMAGE_UNAVAILABLE_LABEL
      : shown === 'ready'
      ? IMAGE_STATE_LABELS.ready
      : isFailedHere
        ? IMAGE_STATE_LABELS.failed
        : isUnfinished
          ? IMAGE_STATE_LABELS.unfinished
          : isUploader
            ? progressLabel(progress)
            : IMAGE_STATE_LABELS.uploading;

  const boxStyle: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    userSelect: 'none',
    // The zoomed layer asks to be passed through, so that a drag on empty board pans instead of
    // pressing a picture; every object opts back in. Without this the box is click-through — no
    // selection, no move, no resize, and no Retry button anyone could press.
    pointerEvents: 'auto',
    outline: props.selected ? '2px solid #2f6fed' : undefined,
    outlineOffset: 2,
    background: isFailedHere ? FAILED_BACKGROUND : BOX_BACKGROUND,
    border: isFailedHere ? `2px solid ${FAILED_BORDER}` : `1px solid ${BOX_BORDER}`,
    color: TEXT_COLOR,
    fontSize: 13,
    textAlign: 'center',
    padding: 8,
  };

  const box = (testid: string, body: React.ReactNode) => (
    <div
      data-testid={testid}
      data-image-id={image.id}
      data-image-status={shown}
      data-broken={broken ? 'true' : 'false'}
      role="img"
      aria-label={label}
      style={boxStyle}
      onPointerDown={(e) => props.onObjectPointerDown?.(e, image.id)}
      onDragStart={(e) => e.preventDefault()}
    >
      {body}
    </div>
  );

  // The picture itself.
  if (shown === 'ready' && image.assetKey !== null && !broken) {
    return box(
      'image-object',
      <img
        data-testid="image-element"
        data-image-id={image.id}
        src={assetUrl(image.assetKey)}
        alt="Image"
        width={image.width}
        height={image.height}
        draggable={false}
        decoding="async"
        // Eager, on purpose. A board is panned by moving a layer, not by scrolling a document, so
        // the browser's notion of "near the viewport" is not the person's notion of "where the
        // board is looking" — a lazily loaded picture sitting just off the first screen is a
        // picture that stays unloaded in some browsers however far the person pans. The promise
        // here is that a picture on the board is a picture on the screen.
        onError={() => setBroken(true)}
        onDragStart={(e) => e.preventDefault()}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          // The board's gesture, not the browser's: an <img> that takes the pointer starts a
          // native image drag instead of a move of the object it is standing in.
          pointerEvents: 'none',
        }}
      />,
    );
  }

  // A box that says why there is no picture.
  const testid = noPicture || shown === 'failed' || isUnfinished ? 'image-unavailable' : 'image-uploading';
  return box(
    testid,
    <>
      {noPicture || (shown === 'failed' && !isUploader) ? (
        <span data-testid="image-broken-glyph" aria-hidden="true" style={{ fontSize: 22, lineHeight: '22px' }}>
          &#128247;
        </span>
      ) : null}
      <span data-testid="image-state-label">{label}</span>
      {/* The bar is drawn only for the tab that is doing the uploading, because it is the only
          one that knows how far it has got: a colleague's screen has no progress to show and
          says "Uploading…" instead (image.uploading). */}
      {shown === 'uploading' && !isUnfinished && isUploader && progress !== undefined ? (
        <span
          data-testid="image-progress"
          role="presentation"
          style={{
            display: 'block',
            width: '70%',
            maxWidth: 220,
            height: 6,
            marginTop: 6,
            borderRadius: 3,
            background: '#cfd4da',
            overflow: 'hidden',
          }}
        >
          <span
            data-testid="image-progress-bar"
            data-progress={Math.max(0, Math.min(1, progress))}
            style={{
              display: 'block',
              height: '100%',
              width: `${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`,
              background: '#2f6fed',
            }}
          />
        </span>
      ) : null}
      {isFailedHere ? (
        <Controls
          id={image.id}
          retry={canRetry ? 'Retry' : undefined}
          remove="Remove"
          onRetry={onRetry}
          onRemove={onRemove}
        />
      ) : null}
      {isUnfinished ? <Controls id={image.id} remove="Remove" onRemove={onRemove} /> : null}
    </>,
  );
}

/** The props the board hands an image object, beyond the ones every object gets. */
export interface ImageObjectViewProps extends ObjectProps {
  /** This tab's upload progress for this object, 0…1. */
  imageProgress?: number;
  /** This tab's identity, which is what decides "mine" from "someone else's". */
  imageIdentityId?: string;
  /** Whether this tab still holds the file a Retry would send. */
  imageCanRetry?: boolean;
  /** The board's clock, shared by every image on the screen. */
  imageNow?: number;
  onImageRetry?(id: string): void;
  onImageRemove?(id: string): void;
}

/**
 * The registry's component for `type: 'image'`: the board's generic props in, a picture's box
 * out. Everything image-specific arrives as one of the optional props above, which is why no
 * other object type notices any of it.
 */
export function ImageObjectView(props: ImageObjectViewProps) {
  const image = asImageSnapshot(props.obj);
  if (!image) {
    // An image whose own record cannot be read is still an object on the board: it can be
    // selected and deleted, and it says that there is no picture here rather than drawing
    // nothing at all and being impossible to find.
    return (
      <div
        data-testid="image-unavailable"
        data-image-id={props.obj.id}
        role="img"
        aria-label={IMAGE_UNAVAILABLE_LABEL}
        style={{
          position: 'absolute',
          left: props.obj.x,
          top: props.obj.y,
          width: props.obj.width,
          height: props.obj.height,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BOX_BACKGROUND,
          border: `1px solid ${BOX_BORDER}`,
          color: TEXT_COLOR,
          fontSize: 13,
          pointerEvents: 'auto',
        }}
        onPointerDown={(e) => props.onObjectPointerDown(e, props.obj.id)}
        onDragStart={(e) => e.preventDefault()}
      >
        {IMAGE_UNAVAILABLE_LABEL}
      </div>
    );
  }
  return (
    <ImageObject
      image={image}
      isUploader={isUploaderView(image, props.imageIdentityId ?? '')}
      progress={props.imageProgress}
      canRetry={props.imageCanRetry === true}
      now={props.imageNow ?? Date.now()}
      selected={props.selected}
      onRetry={() => props.onImageRetry?.(image.id)}
      onRemove={() => props.onImageRemove?.(image.id)}
      onObjectPointerDown={props.onObjectPointerDown}
    />
  );
}

// The registration. `aspectLocked` is the whole of image.aspect_resize: story 7's resize gesture
// already keeps proportions when a type asks for it, and a picture is the type that must.
// `minSize` is what stops a proportional drag from shrinking a photograph down to a dot.
registerObjectType('image', {
  Component: ImageObjectView,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: hitTestRect,
});

/**
 * The board's clock, as the pictures need it.
 *
 * It ticks only while something on this board is still uploading, because that is the only
 * thing on the board whose meaning changes with time: an upload that has been going five
 * minutes is an abandoned one, and a screen that rendered it once and never looked again would
 * go on showing a progress bar for a file that stopped existing. Every thirty seconds the board
 * is asked again what each box should say, and the answer for the abandoned one is different
 * (image.unfinished) — for everybody looking, at the same moment, because the clock they are all
 * reading is in the document and not on their keyboards.
 */
export function useImageClock(objects: readonly ObjectSnapshot[]): number {
  const uploading = objects.some(
    (obj) => obj.type === 'image' && obj.status === 'uploading',
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!uploading) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), IMAGE_PROGRESS_TICK_MS);
    // A timer that only exists to re-read a clock must not be a reason for a hidden tab to be
    // kept awake (and in a test, must not be a reason for it to hang).
    (timer as unknown as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
  }, [uploading]);
  return now;
}

export default ImageObjectView;
