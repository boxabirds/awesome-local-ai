import { createContext, useContext, useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { deleteObjects, objectBounds } from '../../shared/board-model';
import { IMAGE_CLOCK_TICK_MS } from '../../shared/config';
import { displayStatus } from '../../shared/objects/image';
import type { ImageSnap } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

/** What the board gives image objects beyond the generic props: who I am, upload progress and Retry. */
export interface ImageActions {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}
export const ImageActionsContext = createContext<ImageActions | null>(null);

const PERCENT = 100;

function ImageIcon({ broken }: { broken?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" data-testid={broken ? 'broken-image-icon' : 'image-icon'}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {broken ? <path d="M3 16l5-4 3 3M14 12l7 6M10 8h.01" /> : <path d="M3 17l5-5 4 4 3-3 6 6M9 9h.01" />}
    </svg>
  );
}

const stop = (e: ReactPointerEvent) => e.stopPropagation();

export function ImageObject(props: {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  selected?: boolean;
  onPointerDown?(e: ReactPointerEvent): void;
}) {
  const { image, isUploader } = props;
  const { width, height } = objectBounds(image);
  const status = displayStatus(image, props.now);
  const [loadFailedFor, setLoadFailedFor] = useState<string | null>(null);
  const unavailable = status === 'ready' && loadFailedFor !== null && loadFailedFor === image.assetKey;
  const remove = (
    <button type="button" onPointerDown={stop} onClick={props.onRemove}>
      Remove
    </button>
  );

  let body;
  let variant: string = status;
  if (status === 'ready' && !unavailable && image.assetKey) {
    body = (
      <img
        src={`/api/assets/${image.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        className="image-object-img"
        onError={() => setLoadFailedFor(image.assetKey)}
      />
    );
  } else if (status === 'uploading') {
    const pct = Math.round((props.progress ?? 0) * PERCENT);
    body = isUploader ? (
      <>
        <ImageIcon />
        <div className="image-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={pct}>
          <div className="image-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <span>{pct}%</span>
      </>
    ) : (
      <span>Uploading…</span>
    );
  } else if (status === 'failed' && isUploader) {
    body = (
      <>
        <span>Upload failed</span>
        <div className="image-actions">
          {props.canRetry && (
            <button type="button" onPointerDown={stop} onClick={props.onRetry}>
              Retry
            </button>
          )}
          {remove}
        </div>
      </>
    );
  } else if (status === 'unfinished') {
    body = (
      <>
        <span>Image upload didn&apos;t finish</span>
        <div className="image-actions">{remove}</div>
      </>
    );
  } else {
    variant = 'unavailable';
    body = (
      <>
        <ImageIcon broken />
        <span>Image unavailable</span>
      </>
    );
  }

  return (
    <div
      role="group"
      aria-label="Image"
      data-image-object=""
      data-image-status={variant}
      data-note-id={image.id}
      data-selected={props.selected ? 'true' : 'false'}
      className={`image-object image-object--${variant}${props.selected ? ' image-object--selected' : ''}`}
      style={{ left: image.x, top: image.y, width, height, zIndex: image.z }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button === 0) props.onPointerDown?.(e);
      }}
    >
      {body}
    </div>
  );
}

/** Registry component: reads identity/progress/retry from context, removes through story 7's deleteObjects. */
export function ImageObjectView(props: ObjectProps) {
  const image = props.object as ImageSnap;
  const actions = useContext(ImageActionsContext);
  const [now, setNow] = useState(() => Date.now());
  const uploading = image.status === 'uploading';
  useEffect(() => {
    if (!uploading) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), IMAGE_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [uploading]);
  return (
    <ImageObject
      image={image}
      isUploader={actions !== null && actions.identityId === image.uploaderId}
      progress={actions?.progress.get(image.id)}
      canRetry={actions?.canRetry(image.id) ?? false}
      now={uploading ? now : Date.now()}
      selected={props.selected}
      onRetry={() => actions?.retry(image.id)}
      onRemove={() => {
        if (!props.readOnly) deleteObjects(props.doc, [image.id]);
      }}
      onPointerDown={(e) => props.onObjectPointerDown(e, image.id)}
    />
  );
}
