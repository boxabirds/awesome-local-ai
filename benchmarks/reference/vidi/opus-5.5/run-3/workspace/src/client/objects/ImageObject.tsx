import { memo, useContext, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { assetUrl } from '../../shared/image-format';
import { displayStatus, isImage, type ImageSnap } from '../../shared/objects/image';
import { ImageContext } from '../images/ImageContext';
import type { ObjectProps } from './registry';

const stop = (e: SyntheticEvent) => e.stopPropagation();

function ImageIcon() {
  return (
    <svg className="image-object__icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17.5l5-5 4 4 2.5-2.5 4.5 4.5" />
    </svg>
  );
}

function BrokenImageIcon() {
  return (
    <svg className="image-object__icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M3 6a1.5 1.5 0 011.5-1.5H11l-2 5 3 3-2 7H4.5A1.5 1.5 0 013 18z" />
      <path d="M14 4.5h5.5A1.5 1.5 0 0121 6v12a1.5 1.5 0 01-1.5 1.5H13l2-6-3-3z" />
    </svg>
  );
}

function RemoveButton(props: { onRemove(): void; disabled?: boolean }) {
  return (
    <button type="button" className="image-object__button" disabled={props.disabled} onPointerDown={stop} onDoubleClick={stop} onClick={props.onRemove}>
      Remove
    </button>
  );
}

/**
 * An image's content by state (image.object): uploading → grey box with progress (uploader) or "Uploading…"
 * (others); ready → the stored image, or "Image unavailable" if it cannot be loaded; failed → "Upload failed" with
 * Retry/Remove (uploader) or "Image unavailable" (others); unfinished → "Image upload didn't finish" with Remove.
 * Fills its parent box.
 */
export function ImageObject(props: {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  /** False while the board cannot be edited: Retry and Remove are disabled. */
  editable?: boolean;
}) {
  const { image, isUploader } = props;
  const editable = props.editable ?? true;
  // The load error belongs to one asset key: a new key (or a later successful load) shows the image again.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  // The uploader's own upload that is still running is never shown as unfinished, however slow it is.
  const running = isUploader && image.status === 'uploading' && props.progress !== undefined;
  const status = running ? 'uploading' : displayStatus(image, props.now);

  if (status === 'ready' && image.assetKey && failedKey !== image.assetKey) {
    const key = image.assetKey;
    return (
      <img
        className="image-object__img"
        src={assetUrl(key)}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setFailedKey(key)}
        onLoad={() => setFailedKey((k) => (k === key ? null : k))}
      />
    );
  }

  if (status === 'uploading') {
    if (!isUploader) {
      return (
        <div className="image-object__box" data-testid="image-uploading">
          <ImageIcon />
          <span className="image-object__text">Uploading…</span>
        </div>
      );
    }
    const pct = Math.round((props.progress ?? 0) * 100);
    return (
      <div className="image-object__box" data-testid="image-uploading">
        <ImageIcon />
        <div className="image-object__progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="image-object__progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <span className="image-object__text">{pct}%</span>
      </div>
    );
  }

  if (status === 'failed' && isUploader) {
    return (
      <div className="image-object__box image-object__box--failed" data-testid="image-failed">
        <span className="image-object__text">Upload failed</span>
        <div className="image-object__actions">
          {props.canRetry && (
            <button type="button" className="image-object__button" disabled={!editable} onPointerDown={stop} onDoubleClick={stop} onClick={props.onRetry}>
              Retry
            </button>
          )}
          <RemoveButton onRemove={props.onRemove} disabled={!editable} />
        </div>
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div className="image-object__box" data-testid="image-unfinished">
        <ImageIcon />
        <span className="image-object__text">Image upload didn't finish</span>
        <RemoveButton onRemove={props.onRemove} disabled={!editable} />
      </div>
    );
  }

  // Failed (seen by others), or a stored image that cannot be loaded.
  return (
    <div className="image-object__box" data-testid="image-unavailable">
      <BrokenImageIcon />
      <span className="image-object__text">Image unavailable</span>
    </div>
  );
}

function ImageObjectAdapter(props: ObjectProps) {
  const { object, zoom, selected, gesture } = props;
  const ctx = useContext(ImageContext);
  // A pointer is down on this image: its focus event must not change the selection (the gesture does that).
  const pointerDownRef = useRef(false);
  if (!isImage(object)) return null;
  const image = object;

  const className = ['image-object'];
  if (selected) className.push('image-object--selected');
  if (gesture === 'dragging') className.push('image-object--dragging');
  const style = {
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    zIndex: props.stackIndex,
    '--zoom': zoom,
  } as CSSProperties;
  const releasePointer = () => {
    pointerDownRef.current = false;
  };

  return (
    <div
      className={className.join(' ')}
      role="group"
      aria-roledescription="image"
      aria-label="Image"
      data-object-id={image.id}
      data-image-id={image.id}
      data-status={displayStatus(image, ctx.now)}
      data-selected={selected}
      data-state={gesture}
      tabIndex={0}
      style={style}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !selected && !pointerDownRef.current) props.onSelect(image.id);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        pointerDownRef.current = true;
        window.addEventListener('pointerup', releasePointer, { once: true, capture: true });
        window.addEventListener('pointercancel', releasePointer, { once: true, capture: true });
        props.onObjectPointerDown(e, image.id);
      }}
      onDoubleClick={stop}
      onDragStart={(e) => e.preventDefault()}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId !== '' && image.uploaderId === ctx.identityId}
        progress={ctx.progress.get(image.id)}
        canRetry={ctx.canRetry(image.id)}
        now={ctx.now}
        editable={ctx.editable}
        onRetry={() => ctx.retry(image.id)}
        onRemove={() => ctx.remove(image.id)}
      />
    </div>
  );
}

/** The registry's component for images. */
export const ImageObjectView = memo(ImageObjectAdapter);

/** Re-renders every `intervalMs` while `active`, returning the current time (the 'unfinished' state appears on time). */
export function useClock(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return now;
}
