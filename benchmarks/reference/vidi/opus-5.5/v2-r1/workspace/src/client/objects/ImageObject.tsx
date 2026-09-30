import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { deleteObjects } from '../../shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../shared/config';
import { assetUrl } from '../../shared/image-format';
import { type ImageSnap, displayStatus } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

/** What image objects need from the board beyond the generic object props (story 12). */
export interface ImageBoardContext {
  /** This tab's identity: the uploader sees progress, Retry and Remove. */
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): void;
  /** Deletes the image as one undo step. */
  remove(id: string): void;
}

export const ImageContext = createContext<ImageBoardContext | null>(null);

function ImageIcon(props: { broken?: boolean }) {
  return (
    <svg className="image-state-icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="9.5" r="1.6" fill="currentColor" />
      <path d="M4 18l5-5 3.5 3.5L15 14l5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      {props.broken && <path d="M3 21L21 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

/** The image is ready: its asset, or "Image unavailable" when it cannot be loaded. */
function StoredImage(props: { image: ImageSnap; placeholder(children: ReactNode): ReactNode }) {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = props.image.assetKey;
  // A later load (another key) is tried again.
  if (key === null || failedKey === key) {
    return props.placeholder(
      <>
        <ImageIcon broken />
        <span className="image-state-text">Image unavailable</span>
      </>,
    );
  }
  return (
    <img
      className="image-content"
      src={assetUrl(key)}
      alt="Image"
      draggable={false}
      decoding="async"
      loading="lazy"
      onError={() => setFailedKey(key)}
    />
  );
}

/**
 * An image (story 12) in one of its states: uploading (progress for the uploader, "Uploading…"
 * for others), ready, failed (Retry/Remove for the uploader, "Image unavailable" for others),
 * unfinished (Remove for anyone) or unavailable (the stored image cannot be loaded). Selecting,
 * moving, resizing (aspect-locked) and deleting are generic (story 7).
 */
export function ImageObject(
  props: {
    image: ImageSnap;
    isUploader: boolean;
    progress?: number;
    canRetry: boolean;
    now: number;
    onRetry(): void;
    onRemove(): void;
  } & Partial<Omit<ObjectProps, 'object'>>,
) {
  const { image } = props;
  const editable = props.editable ?? true;
  const pressingRef = useRef(false);
  const status = displayStatus(image, props.now);
  const style = {
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    zIndex: props.layer,
  } as CSSProperties;

  const classes = ['image-object', `is-${status}`];
  if (props.selected && props.transforming) classes.push('is-dragging');
  if (status === 'failed' && props.isUploader) classes.push('is-upload-failed');

  // Buttons act on their own; a press on them never selects or drags the image.
  const control = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="image-state-button"
      disabled={!editable}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
  const placeholder = (children: ReactNode) => (
    <div className="image-placeholder" style={{ fontSize: `${Math.max(1, 14 / (props.zoom ?? 1))}px` }}>
      {children}
    </div>
  );

  let content: ReactNode;
  if (status === 'ready') {
    content = <StoredImage image={image} placeholder={placeholder} />;
  } else if (status === 'uploading') {
    const percent = Math.round((props.progress ?? 0) * 100);
    content = placeholder(
      props.isUploader && props.progress !== undefined ? (
        <>
          <ImageIcon />
          <div
            className="image-progress"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="image-progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <span className="image-state-text">{percent}%</span>
        </>
      ) : (
        <span className="image-state-text">Uploading…</span>
      ),
    );
  } else if (status === 'failed' && props.isUploader) {
    content = placeholder(
      <>
        <span className="image-state-text">Upload failed</span>
        <div className="image-state-actions">
          {props.canRetry && control('Retry', props.onRetry)}
          {control('Remove', props.onRemove)}
        </div>
      </>,
    );
  } else if (status === 'failed') {
    content = placeholder(
      <>
        <ImageIcon broken />
        <span className="image-state-text">Image unavailable</span>
      </>,
    );
  } else {
    content = placeholder(
      <>
        <span className="image-state-text">Image upload didn't finish</span>
        <div className="image-state-actions">{control('Remove', props.onRemove)}</div>
      </>,
    );
  }

  return (
    <div
      className={classes.join(' ')}
      role="group"
      aria-label="Image"
      tabIndex={0}
      data-object-id={image.id}
      data-image-id={image.id}
      data-status={status}
      data-selected={props.selected ?? false}
      style={style}
      onPointerDown={(e) => {
        pressingRef.current = true;
        props.onPointerDown?.(e, image.id);
      }}
      onPointerUp={() => {
        pressingRef.current = false;
      }}
      onPointerCancel={() => {
        pressingRef.current = false;
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !pressingRef.current && !props.selected) props.onSelect?.(image.id);
      }}
    >
      {content}
    </div>
  );
}

/**
 * The current time, re-read when an uploading image turns unfinished (IMAGE_UPLOAD_STALE_MS after
 * its upload started), so the state changes without any interaction.
 */
function useUploadClock(image: ImageSnap): number {
  const [now, setNow] = useState(() => Date.now());
  const current = Date.now();
  useEffect(() => {
    if (image.status !== 'uploading') return;
    const due = image.uploadStartedAt + IMAGE_UPLOAD_STALE_MS + 1 - Date.now();
    if (due < 0) return;
    const timer = setTimeout(() => setNow(Date.now()), due);
    return () => clearTimeout(timer);
  }, [image.status, image.uploadStartedAt]);
  return Math.max(now, current);
}

/** Registry adapter: the board's generic object props and ImageContext to ImageObject. */
export function ImageEntry(props: ObjectProps) {
  const { object, ...rest } = props;
  const image = object as ImageSnap;
  const ctx = useContext(ImageContext);
  const now = useUploadClock(image);
  return (
    <ImageObject
      {...rest}
      image={image}
      isUploader={ctx !== null && image.uploaderId === ctx.identityId}
      progress={ctx?.progress.get(image.id)}
      canRetry={ctx?.canRetry(image.id) ?? false}
      now={now}
      onRetry={() => ctx?.retry(image.id)}
      onRemove={() => (ctx ? ctx.remove(image.id) : deleteObjects(props.doc, [image.id]))}
    />
  );
}
