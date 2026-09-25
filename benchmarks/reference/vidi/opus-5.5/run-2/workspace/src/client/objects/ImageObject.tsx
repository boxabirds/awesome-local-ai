/**
 * One image in the world layer (anchors: image.object, image.uploading, image.shared,
 * image.upload_failure, image.unfinished, image.unavailable).
 *
 * Renders by `displayStatus(image, now)`:
 *  - uploading: grey box of the final size; the uploader sees an image icon and a progress
 *    bar with the percentage, everyone else "Uploading…";
 *  - ready: the stored image (`/api/assets/<assetKey>`) filling the box; if it cannot be
 *    loaded, an "Image unavailable" box of the same size instead (retried when the address
 *    changes); the rest of the board is never affected;
 *  - failed: the uploader sees "Upload failed" with Retry (while the file is still in this
 *    tab's memory) and Remove; everyone else "Image unavailable";
 *  - unfinished: "Image upload didn't finish" with Remove, for everyone.
 * Like every type it has no move or resize code: its pointerdown goes to the generic
 * transform gesture, and the registry makes its resize aspect-locked with a minimum size.
 */
import { createContext, memo, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { displayStatus, isImageSnap, type ImageSnap } from '../../shared/objects/image';
import type { ObjectSnapshot } from '../../shared/board-model';
import { IMAGE_CLOCK_TICK_MS } from '../../shared/config';
import { assetUrl } from '../../shared/image-format';
import type { ObjectProps } from './registry';

export const IMAGE_LABEL = 'Image';
export const UPLOADING_TEXT = 'Uploading…';
export const UPLOAD_FAILED_TEXT = 'Upload failed';
export const UNAVAILABLE_TEXT = 'Image unavailable';
export const UNFINISHED_TEXT = "Image upload didn't finish";
const PERCENT = 100;

/** What image objects need from the board beyond ObjectProps (provided by App). */
export interface ImageBoardContext {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
  remove(id: string): void;
  /** Clock for `unfinished`; ticks every IMAGE_CLOCK_TICK_MS while an image is uploading. */
  now: number;
}

export const ImageContext = createContext<ImageBoardContext>({
  identityId: '',
  progress: new Map(),
  canRetry: () => false,
  retry: () => false,
  remove: () => undefined,
  now: 0,
});

export interface ImageObjectProps extends Partial<Omit<ObjectProps, 'object' | 'selected'>> {
  image: ImageSnap;
  isUploader: boolean;
  /** Upload progress 0..1 (uploader only). */
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  selected?: boolean;
}

function ImageIcon(props: { broken?: boolean }): React.JSX.Element {
  return (
    <svg className="image-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="10" r="1.8" fill="currentColor" />
      <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      {props.broken === true && <path d="M3 21L21 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function ImageObjectImpl(props: ImageObjectProps): React.JSX.Element {
  const { image, isUploader, selected = false } = props;
  const pointerActive = useRef(false);
  const [loadFailedFor, setLoadFailedFor] = useState<string | null>(null);
  const status = displayStatus(image, props.now);
  const loadFailed = image.assetKey !== null && loadFailedFor === image.assetKey;

  // A new address (e.g. a remote retry) gets a fresh chance to load.
  useEffect(() => {
    if (loadFailedFor !== null && loadFailedFor !== image.assetKey) setLoadFailedFor(null);
  }, [image.assetKey, loadFailedFor]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    pointerActive.current = true;
    props.onPointerDown?.(e, image.id);
  };
  const onPointerEnd = () => {
    pointerActive.current = false;
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || pointerActive.current || selected) return;
    props.onSelect?.(image.id);
  };
  // Buttons inside the box never start a move of the image.
  const stop = (e: PointerEvent) => e.stopPropagation();

  const shown = status === 'ready' && loadFailed ? 'unavailable' : status === 'failed' && !isUploader ? 'unavailable' : status;
  const percent = Math.round((props.progress ?? 0) * PERCENT);

  let body: React.JSX.Element;
  if (shown === 'ready') {
    body = (
      <img
        className="image-img"
        src={assetUrl(image.assetKey!)}
        alt={IMAGE_LABEL}
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setLoadFailedFor(image.assetKey)}
      />
    );
  } else if (shown === 'uploading') {
    body = isUploader ? (
      <div className="image-placeholder">
        <ImageIcon />
        <div
          className="image-progress"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={PERCENT}
          aria-valuenow={percent}
        >
          <div className="image-progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <span className="image-progress-text" data-testid="image-progress">{`${percent}%`}</span>
      </div>
    ) : (
      <div className="image-placeholder">
        <span className="image-status-text">{UPLOADING_TEXT}</span>
      </div>
    );
  } else if (shown === 'failed') {
    body = (
      <div className="image-placeholder image-placeholder-failed">
        <span className="image-status-text">{UPLOAD_FAILED_TEXT}</span>
        <div className="image-actions">
          {props.canRetry && (
            <button type="button" onPointerDown={stop} onClick={props.onRetry}>
              Retry
            </button>
          )}
          <button type="button" onPointerDown={stop} onClick={props.onRemove}>
            Remove
          </button>
        </div>
      </div>
    );
  } else if (shown === 'unfinished') {
    body = (
      <div className="image-placeholder">
        <span className="image-status-text">{UNFINISHED_TEXT}</span>
        <div className="image-actions">
          <button type="button" onPointerDown={stop} onClick={props.onRemove}>
            Remove
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="image-placeholder">
        <ImageIcon broken />
        <span className="image-status-text">{UNAVAILABLE_TEXT}</span>
      </div>
    );
  }

  const style = {
    left: `${image.x}px`,
    top: `${image.y}px`,
    width: `${image.width}px`,
    height: `${image.height}px`,
    zIndex: image.z,
    '--zoom': String(props.zoom ?? 1),
  } as CSSProperties;
  const state = props.transforming === true ? 'dragging' : selected ? 'selected' : 'unselected';

  return (
    <div
      className="image-object"
      role="group"
      aria-roledescription="image"
      aria-label={IMAGE_LABEL}
      tabIndex={0}
      data-id={image.id}
      data-type="image"
      data-status={shown}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onFocus={onFocus}
    >
      {body}
    </div>
  );
}

export const ImageObject = memo(ImageObjectImpl);

/**
 * The clock image objects render `unfinished` against: re-read every IMAGE_CLOCK_TICK_MS
 * while any image is uploading, so the state appears without interaction.
 */
export function useImageClock(objects: readonly ObjectSnapshot[]): number {
  const uploading = objects.some((o) => isImageSnap(o) && o.status === 'uploading');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!uploading) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), IMAGE_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [uploading]);
  return now;
}
