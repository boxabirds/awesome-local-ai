import { useEffect, useState, useSyncExternalStore } from 'react';
import { IMAGE_STATUS_TICK_MS } from '../../shared/config';
import { assetUrl } from '../../shared/image-format';
import { type ImageSnap, displayStatus } from '../../shared/objects/image';
import { useImageInsertInfo } from '../images/ImageInsertContext';
import type { ObjectProps } from './types';

const PRIMARY_BUTTON = 0;
const PERCENT = 100;

// One shared clock for every image waiting on an upload, so "unfinished" appears
// without interaction; it only ticks while some image subscribes.
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockNow = Date.now();
function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  clockNow = Date.now();
  clockTimer ??= setInterval(() => {
    clockNow = Date.now();
    for (const l of [...clockListeners]) l();
  }, IMAGE_STATUS_TICK_MS);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const noSubscription = () => () => {};

/** The current time, re-read every IMAGE_STATUS_TICK_MS while `active`. */
function useImageClock(active: boolean): number {
  const ticked = useSyncExternalStore(
    active ? subscribeClock : noSubscription,
    () => clockNow,
  );
  return active ? Math.max(ticked, Date.now()) : ticked;
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

function ImageIcon(props: { broken?: boolean }): React.JSX.Element {
  return (
    <svg className="image-object-icon" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="9.5" r="1.8" fill="currentColor" />
      <path d="M4 18l5-5 3.5 3.5L15 14l5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      {props.broken && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" />}
    </svg>
  );
}

function Controls(props: { retry?: () => void; remove?: () => void }): React.JSX.Element | null {
  if (!props.retry && !props.remove) return null;
  return (
    <div className="image-object-actions" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {props.retry && (
        <button type="button" onClick={props.retry}>
          Retry
        </button>
      )}
      {props.remove && (
        <button type="button" onClick={props.remove}>
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * What an image object shows (image.object), filling its box:
 * uploading → progress % (uploader) or "Uploading…" (others); ready → the image
 * ("Image unavailable" if it cannot be loaded); failed → "Upload failed" with
 * Retry/Remove (uploader) or "Image unavailable" (others); unfinished → "Image
 * upload didn't finish" with Remove for anyone. Remove/Retry are hidden when
 * `editable` is false.
 */
export function ImageObject(props: {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  editable?: boolean;
}): React.JSX.Element {
  const { image } = props;
  const editable = props.editable ?? true;
  const status = displayStatus(image, props.now);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  // A different stored image gets a fresh load attempt.
  useEffect(() => setFailedKey(null), [image.assetKey]);

  const box = (state: string, content: React.ReactNode, extra = '') => (
    <div className={`image-object-box is-${state} ${extra}`.trim()} data-status={state}>
      {content}
    </div>
  );

  if (status === 'ready' && image.assetKey && failedKey !== image.assetKey) {
    const key = image.assetKey;
    return (
      <img
        className="image-object-img"
        data-status="ready"
        src={assetUrl(key)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setFailedKey(key)}
      />
    );
  }
  if (status === 'uploading') {
    if (props.isUploader && props.progress !== undefined) {
      const pct = Math.round(Math.max(0, Math.min(1, props.progress)) * PERCENT);
      return box(
        'uploading',
        <>
          <ImageIcon />
          <div
            className="image-object-progress"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={PERCENT}
            aria-valuenow={pct}
          >
            <div className="image-object-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="image-object-text">{pct}%</span>
        </>,
      );
    }
    return box('uploading', <span className="image-object-text">Uploading…</span>);
  }
  if (status === 'failed' && props.isUploader) {
    return box(
      'failed',
      <>
        <span className="image-object-text">Upload failed</span>
        {editable && <Controls retry={props.canRetry ? props.onRetry : undefined} remove={props.onRemove} />}
      </>,
      'is-error',
    );
  }
  if (status === 'unfinished') {
    return box(
      'unfinished',
      <>
        <span className="image-object-text">Image upload didn't finish</span>
        {editable && <Controls remove={props.onRemove} />}
      </>,
    );
  }
  // Failed (seen by others), a ready image without an address, or one that could not be loaded.
  return box(
    'unavailable',
    <>
      <ImageIcon broken />
      <span className="image-object-text">Image unavailable</span>
    </>,
  );
}

/** The registered `image` object: positioned box, selection and move/resize via the generic gesture. */
export function RegisteredImageObject(props: ObjectProps): React.JSX.Element {
  const image = props.object as ImageSnap;
  const id = image.id;
  const info = useImageInsertInfo();
  const now = useImageClock(image.status === 'uploading');
  return (
    <div
      className={['image-object', props.selected && 'is-selected', props.transforming && 'is-dragging']
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label="Image"
      tabIndex={0}
      data-image-object=""
      data-id={id}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={props.transforming ? 'dragging' : 'idle'}
      style={{ left: image.x, top: image.y, width: image.width, height: image.height, zIndex: image.z }}
      onPointerDown={(e) => {
        // The board must never pan (or clear the selection) from a press on an image.
        e.stopPropagation();
        if (e.button !== PRIMARY_BUTTON) return;
        props.onPointerDown(e, id);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !props.selected && isFocusVisible(e.currentTarget)) props.onSelect(id);
      }}
    >
      <ImageObject
        image={image}
        isUploader={info.identityId !== '' && image.uploaderId === info.identityId}
        progress={info.progress.get(id)}
        canRetry={info.canRetry(id)}
        now={now}
        onRetry={() => info.retry(id)}
        onRemove={() => info.remove(id)}
        editable={props.editable}
      />
    </div>
  );
}
