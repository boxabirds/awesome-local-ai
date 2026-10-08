import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { isAssetKey } from '../../shared/image-format';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { assetUrl } from '../images/uploadImage';

/**
 * One image on the board, in whichever of its five states it is in.
 *
 * The box is drawn at the object's size before a single byte has arrived, and stays
 * exactly that size when the picture appears, so a board does not jump about when an
 * upload finishes (PRD `image.uploading`, `image.shared`). Which of the states to show is
 * `displayStatus`'s job — including the one that is not stored anywhere, the
 * "upload didn't finish" case a reload leaves behind (PRD `image.unfinished`).
 *
 * The controls are only ever for the person who can see the bytes: Retry needs the file
 * itself, which lived in the tab that picked it. Everyone else reads the same object as
 * less information ("Image unavailable") and is offered Remove, because a placeholder
 * that cannot become a picture is still something they should be able to clear away
 * (PRD `image.upload_failure`, `image.unfinished`).
 */

/** The words in the box. The PRD's sentences, in one place, so a test can name them. */
export const IMAGE_STATUS_TEXT = {
  uploading: 'Uploading…',
  failed: 'Upload failed',
  unfinished: "Image upload didn't finish",
  unavailable: 'Image unavailable',
} as const;

export interface ImageObjectProps {
  image: ImageSnap;
  selected: boolean;
  /** This tab picked the file, so this tab is the one that can retry it. */
  isUploader: boolean;
  /** Fraction uploaded (0 to 1) while this tab is uploading it; nobody else has one. */
  progress?: number | null;
  /** The bytes are still in memory here, so Retry would have something to send. */
  canRetry: boolean;
  /** A clock at render time, so `unfinished` can appear without anything arriving. */
  now: number;
  onRetry(): void;
  /** Absent when the board cannot be edited: a viewer is never offered Remove. */
  onRemove?(): void;
  /** Story 7's move/resize gesture, started the way every other object starts it. */
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  onSelect(id: string): void;
}

/** 0 to 1 as a whole percentage, which is what a person reads. */
function percentOf(progress: number | null | undefined): number | null {
  if (progress === null || progress === undefined) return null;
  if (!Number.isFinite(progress)) return null;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

export function ImageObject({
  image,
  selected,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
  onObjectPointerDown,
  onSelect,
}: ImageObjectProps): JSX.Element {
  // A picture that would not fetch is not shown as a broken icon: the box stays its
  // size and says what it now means, "Image unavailable" (PRD image.unavailable).
  const [pictureFailed, setPictureFailed] = useState(false);
  useEffect(() => {
    setPictureFailed(false);
  }, [image.assetKey]);

  const status = displayStatus(image, now);
  // The key comes out of the shared document, which anyone with the link can write. Only
  // a key that is shaped like one of our own asset keys becomes a URL; anything else is
  // read as the gap in the board it is, rather than pointed the browser at.
  const pictureKey = image.assetKey && isAssetKey(image.assetKey) ? image.assetKey : null;
  /*
   * One word for what the box is doing, decided once. Two of its cases are not what the
   * object says it is: a `ready` image that would not fetch says "Image unavailable", and
   * a `failed` one says that to everyone except the person who has the file (they get
   * "Upload failed" with Retry) — PRD image.upload_failure, image.unavailable.
   */
  const shown: 'picture' | 'uploading' | 'failed' | 'unfinished' | 'unavailable' =
    status === 'ready'
      ? pictureKey !== null && !pictureFailed
        ? 'picture'
        : 'unavailable'
      : status === 'failed'
        ? isUploader
          ? 'failed'
          : 'unavailable'
        : status;
  const label = shown === 'picture' ? null : IMAGE_STATUS_TEXT[shown];
  // Everything but a placeholder that is still filling in is something a person with
  // edit rights can clear away (PRD image.upload_failure, image.unfinished).
  const showRemove = !!onRemove && shown !== 'picture' && shown !== 'uploading';
  const showRetry = shown === 'failed' && canRetry;
  const percent = shown === 'uploading' ? percentOf(progress) : null;

  const box: CSSProperties = {
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    outline: selected ? '2px solid #1a73e8' : 'none',
  };

  return (
    <div
      className="image-object"
      data-testid="image-object"
      data-image-id={image.id}
      data-status={shown === 'picture' ? 'ready' : shown}
      data-selected={selected ? 'true' : 'false'}
      data-uploader={isUploader ? 'true' : 'false'}
      role="group"
      aria-label="Image"
      tabIndex={0}
      style={box}
      onPointerDown={(e) => onObjectPointerDown?.(e.nativeEvent, image.id)}
      onMouseDown={() => onSelect(image.id)}
    >
      {shown === 'picture' ? (
        <img
          className="image-picture"
          data-testid="image-picture"
          src={assetUrl(pictureKey!)}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setPictureFailed(true)}
        />
      ) : (
        <div className="image-placeholder" data-testid="image-placeholder">
          <p className="image-status" data-testid="image-status">
            {label}
            {shown === 'uploading' && percent !== null ? ` ${percent}%` : ''}
          </p>
          {shown === 'uploading' && percent !== null ? (
            <div
              className="image-progress"
              data-testid="image-progress"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="image-progress-bar" style={{ width: `${percent}%` }} />
            </div>
          ) : null}
          {/* A press on a button is a press on a button, never the start of a move: the
              buttons sit inside the object's box, and the box answers pointerdown. */}
          <div className="image-controls" onPointerDown={(e) => e.stopPropagation()}>
            {showRetry ? (
              <button
                type="button"
                className="image-button"
                data-testid="image-retry"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
              >
                Retry
              </button>
            ) : null}
            {showRemove ? (
              <button
                type="button"
                className="image-button"
                data-testid="image-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove?.();
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
