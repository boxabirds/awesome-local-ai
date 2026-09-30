import { useContext, useState, type PointerEvent, type ReactNode } from 'react';
import { deleteObjects } from '../../shared/board-model';
import { PERCENT } from '../../shared/config';
import { assetUrl } from '../../shared/image-format';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { ImageInsertContext } from '../images/ImageInsertContext';
import type { ObjectGesturePhase, ObjectProps } from './registry';

function ImageIcon() {
  return (
    <svg className="image-state-icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="9.5" r="1.6" fill="currentColor" />
      <path d="M4 17l5-5 4 4 2.5-2.5L20 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function BrokenImageIcon() {
  return (
    <svg className="image-state-icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3.5 6a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 6v5l-3 2-3-2.5-3 3-3-2.5-4.5 3V6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M3.5 17.5l4.5-3 3 2.5 3-3 3 2.5 3-2v4a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19v-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Buttons inside an image never start a drag or selection of the object. */
const stop = (e: PointerEvent) => e.stopPropagation();

/**
 * One image (story 12, image.object), per `displayStatus`:
 * uploading (progress for the uploader, "Uploading…" for others), ready (the
 * stored image), failed ("Upload failed" with Retry/Remove for the uploader,
 * "Image unavailable" for others), unfinished ("Image upload didn't finish"
 * with Remove for anyone). A stored image that cannot be loaded shows
 * "Image unavailable" at the same size; the error stays inside this object.
 */
export function ImageObject(props: {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  zIndex?: number;
  selected?: boolean;
  readOnly?: boolean;
  gesture?: ObjectGesturePhase;
  onPointerDown?(e: PointerEvent<Element>, id: string): void;
}) {
  const { image } = props;
  const status = displayStatus(image, props.now);
  // The asset key a load error was seen for: a new key (retried upload) loads again.
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const unavailable = status === 'ready' && (image.assetKey === null || brokenKey === image.assetKey);
  const controls = !props.readOnly;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the board must not pan
    props.onPointerDown?.(e, image.id);
  };

  const removeButton = controls && (
    <button type="button" className="image-button" onPointerDown={stop} onClick={props.onRemove}>
      Remove
    </button>
  );

  let content: ReactNode;
  let state: string = status;
  if (status === 'ready' && !unavailable) {
    content = (
      <img
        className="image-content"
        src={assetUrl(image.assetKey!)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setBrokenKey(image.assetKey)}
      />
    );
  } else if (status === 'uploading') {
    const pct = props.progress === undefined ? undefined : Math.round(props.progress * PERCENT);
    content =
      props.isUploader && pct !== undefined ? (
        <>
          <ImageIcon />
          <div
            className="image-progress"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={PERCENT}
            aria-valuenow={pct}
          >
            <div className="image-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="image-state-text">{pct}%</span>
        </>
      ) : (
        <span className="image-state-text">Uploading…</span>
      );
  } else if (status === 'failed' && props.isUploader) {
    content = (
      <>
        <span className="image-state-text">Upload failed</span>
        <div className="image-actions">
          {controls && props.canRetry && (
            <button type="button" className="image-button" onPointerDown={stop} onClick={props.onRetry}>
              Retry
            </button>
          )}
          {removeButton}
        </div>
      </>
    );
  } else if (status === 'unfinished') {
    content = (
      <>
        <span className="image-state-text">Image upload didn&apos;t finish</span>
        <div className="image-actions">{removeButton}</div>
      </>
    );
  } else {
    state = 'unavailable';
    content = (
      <>
        <BrokenImageIcon />
        <span className="image-state-text">Image unavailable</span>
      </>
    );
  }
  const failedForMe = status === 'failed' && props.isUploader;

  return (
    <div
      className={`image-object board-object is-${state}${failedForMe ? ' is-upload-failed' : ''}${
        props.gesture === 'dragging' ? ' is-dragging' : ''
      }`}
      role="group"
      aria-roledescription="image"
      aria-label="Image"
      tabIndex={0}
      data-image-id={image.id}
      data-object-id={image.id}
      data-status={state}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={props.gesture ?? 'idle'}
      data-x={image.x}
      data-y={image.y}
      data-width={image.width}
      data-height={image.height}
      data-z={image.z}
      style={{ left: image.x, top: image.y, width: image.width, height: image.height, zIndex: props.zIndex }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {state === 'ready' ? content : <div className="image-state">{content}</div>}
    </div>
  );
}

/** The registry's component: fills ImageObject's inputs from the board (ImageInsertContext). */
export function RegisteredImageObject(props: ObjectProps) {
  const ctx = useContext(ImageInsertContext);
  const image = props.object as ImageSnap;
  const [fallbackNow] = useState(() => Date.now());
  const remove = () => {
    if (ctx) ctx.remove(image.id);
    else deleteObjects(props.doc, [image.id]);
  };
  return (
    <ImageObject
      image={image}
      isUploader={!!ctx && image.uploaderId === ctx.identityId}
      progress={ctx?.progress.get(image.id)}
      canRetry={!!ctx && ctx.canRetry(image.id)}
      now={ctx?.now ?? fallbackNow}
      onRetry={() => ctx?.retry(image.id)}
      onRemove={remove}
      zIndex={props.zIndex}
      selected={props.selected}
      readOnly={props.readOnly}
      gesture={props.gesture}
      onPointerDown={props.onPointerDown}
    />
  );
}
