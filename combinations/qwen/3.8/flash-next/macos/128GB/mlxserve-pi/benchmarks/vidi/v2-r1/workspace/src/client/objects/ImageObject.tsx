// One image on the board, in every state it can be in (`image.object`).
//
// The whole of this component is a switch on `displayStatus` plus one thing the status
// does not carry: whether the stored, `ready` image's bytes actually load. That split
// is deliberate. Everything the *document* knows — `uploading`, `ready`, `failed`, and
// the derived `unfinished` — comes from `displayStatus`, so this file and a Durable
// Object reading the same object agree on what it is; the one thing only a browser can
// know is whether `<img src>` answered, and that is held here, in local state, because
// a stored `ready` image whose bytes went missing is "unavailable" to *this* viewer and
// nobody's document changed.
//
// The four renderings, straight from `image.object`:
//
//   - `uploading` — a grey box, the upload's percentage to the uploader and a plain
//     "Uploading…" to everyone else, who has no percentage to be shown (`image.uploading`);
//   - `ready` — the image itself, at its size, from `/api/assets/<key>`; if that fails
//     to load it becomes the unavailable box (TC-23, `image.unavailable`);
//   - `failed` — to the uploader a red box, "Upload failed", Retry while the file is
//     still in memory and Remove; to everyone else, "Image unavailable" — a failure is
//     the uploader's to act on and nobody else's to be shown (`image.upload_failure`,
//     TC-21);
//   - `unfinished` — to everyone, "Image upload didn't finish" and Remove, instead of a
//     "Uploading…" that would only ever be lying about something in motion (`image.unfinished`).
//
// Everything is laid out in board units and let the world layer's `scale()` make it
// pixels, like every other object, so an image and its boxes are the same size relative
// to the board at any zoom and resizing keeps its proportions for free (the registry
// entry's `aspectLocked`, `image.aspect_resize`). Removing an image is story 7's
// `deleteObjects`; retrying is `useImageInsert.retry`; both come in as callbacks, so
// this component writes nothing to the document itself.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Image object rendering".
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { assetUrl } from '../../shared/image-format';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  /** Whether this tab is the one that uploaded it: progress, Retry and the failed box. */
  isUploader: boolean;
  /** Upload progress 0–1 for the uploader; absent once it is done or for others. */
  progress?: number;
  /** Retry is offered only while the file is still in memory (lost on reload). */
  canRetry: boolean;
  /** A clock in ms, re-rendered while any upload is running, so `unfinished` appears. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  // --- Interaction, supplied by the registry wrapper. Optional so the state-focused
  // component tests can render this on its own, exactly as the contract spells it. ---
  selected?: boolean;
  editable?: boolean;
  onObjectPointerDown?(event: PointerEvent, id: string): void;
}

export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
  selected = false,
  editable = true,
  onObjectPointerDown,
}: ImageObjectProps): ReactNode {
  // Whether the *stored* image's bytes loaded. Local to this viewer, and reset when a
  // new asset key arrives under the same object (a retry that later succeeds), so a
  // box that once failed can come back as an image (`image.unavailable`).
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [image.assetKey]);

  const status = displayStatus(image, now);
  // A `ready` object with no key to fetch is not loadable; the same box as a failed load.
  const showImage = status === 'ready' && image.assetKey !== null && !loadFailed;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable || event.button !== 0 || !onObjectPointerDown) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onObjectPointerDown(event.nativeEvent, image.id);
  };

  const body = ((): ReactNode => {
    if (showImage) {
      return (
        <img
          data-testid="image-object-img"
          src={assetUrl(image.assetKey!)}
          alt="Image"
          // An image is a thing you select on the board, never one you drag out of it,
          // and it decodes and loads off the main thread so the board stays smooth.
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setLoadFailed(true)}
          style={imageStyle}
        />
      );
    }
    if (status === 'uploading') {
      // The percentage is the uploader's own, straight from XHR progress; everyone else
      // gets the plain word, having nothing of their own to measure.
      if (isUploader && typeof progress === 'number') {
        return (
          <>
            <span data-testid="image-object-progress">{`Uploading ${Math.round(progress * 100)}%`}</span>
            <span data-testid="image-object-uploading" style={{ display: 'none' }}>
              Uploading…
            </span>
            <ProgressMeter fraction={progress} />
          </>
        );
      }
      return <span data-testid="image-object-uploading">Uploading…</span>;
    }
    if (status === 'unfinished') {
      return (
        <>
          <span data-testid="image-object-unfinished">Image upload didn't finish</span>
          <button type="button" aria-label="Remove" onClick={onRemove} style={buttonStyle} onPointerDown={stop}>
            Remove
          </button>
        </>
      );
    }
    if (status === 'failed') {
      // `image.upload_failure`: only the uploader is shown a failure they can act on.
      if (isUploader) {
        return (
          <>
            <span data-testid="image-object-failed">Upload failed</span>
            <span style={rowStyle}>
              {canRetry ? (
                <button type="button" aria-label="Retry" onClick={onRetry} style={buttonStyle} onPointerDown={stop}>
                  Retry
                </button>
              ) : null}
              <button type="button" aria-label="Remove" onClick={onRemove} style={buttonStyle} onPointerDown={stop}>
                Remove
              </button>
            </span>
          </>
        );
      }
      return (
        <span data-testid="image-object-unavailable">Image unavailable</span>
      );
    }
    // `ready` but the bytes would not load, or `ready` with no key at all.
    return (
      <>
        <BrokenImageIcon />
        <span data-testid="image-object-unavailable">Image unavailable</span>
      </>
    );
  })();

  return (
    <div
      data-testid="image-object"
      data-id={image.id}
      data-status={status}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Image"
      tabIndex={0}
      style={boxStyle(image, status, loadFailed || (status === 'ready' && image.assetKey === null))}
      onPointerDown={onPointerDown}
    >
      <div style={contentStyle}>{body}</div>
    </div>
  );
}

/** A pointer down on a control belongs to the control, never to a move or a marquee. */
const stop = (event: ReactPointerEvent<HTMLElement>): void => {
  event.stopPropagation();
};

/** The grey fill a placeholder, a failure or an unavailable image is shown on. */
const boxStyle = (image: ImageSnap, status: string, unavailable: boolean): CSSProperties => {
  const failedBorder = status === 'failed';
  return {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    boxSizing: 'border-box',
    // The world layer takes objects out of the pointer's way; an image puts itself back.
    pointerEvents: 'auto',
    cursor: 'grab',
    userSelect: 'none',
    touchAction: 'none',
    backgroundColor: unavailable || status !== 'ready' ? '#eceef1' : 'transparent',
    border: failedBorder ? '2px solid #e53935' : '1px solid rgba(0, 0, 0, 0.08)',
    borderRadius: 4,
    color: '#5f6b76',
    fontSize: 13,
    lineHeight: 1.3,
  };
};

/** Centres the placeholder's words and buttons inside the world-scaled box. */
const contentStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  textAlign: 'center',
  overflow: 'hidden',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
};

const imageStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  // The box already carries the image's proportions, so filling it is undistorted;
  // `contain` only matters if a stored ratio and the box ever disagreed by rounding.
  objectFit: 'fill',
  display: 'block',
  borderRadius: 4,
  userSelect: 'none',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
};

const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  padding: '2px 10px',
  borderRadius: 4,
  border: '1px solid #b7bec6',
  backgroundColor: '#ffffff',
  color: '#1f2328',
  cursor: 'pointer',
};

/** The uploader's thin progress bar under the percentage. */
function ProgressMeter({ fraction }: { fraction: number }): ReactNode {
  return (
    <span
      data-testid="image-object-meter"
      aria-hidden="true"
      style={{ width: '70%', height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)' }}
    >
      <span
        style={{
          display: 'block',
          height: '100%',
          width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`,
          borderRadius: 2,
          backgroundColor: '#3b82f6',
        }}
      />
    </span>
  );
}

/** A broken-image mark for the unavailable box; decoration, not content. */
function BrokenImageIcon(): ReactNode {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="20" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
