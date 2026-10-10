import {
  createContext,
  useContext,
  useEffect,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type * as Y from 'yjs';
import { deleteObjects, objectBounds } from '../../shared/board-model';
import {
  collectImageSnapshots,
  displayStatus,
  getImageFields,
  type ImageSnap
} from '../../shared/objects/image';
import { identity } from '../identity';
import type { ObjectProps } from './registry';

// Controls the board injects for image objects: uploader-only progress and
// Retry, plus the shared clock tick that turns stale uploads into
// "unfinished". Without a provider (isolated tests) sensible inert defaults
// apply.
export interface ImageControls {
  identityId: string;
  progress(id: string): number | undefined;
  canRetry(id: string): boolean;
  retry(id: string): void;
  now: number;
}

const DEFAULT_CONTROLS: ImageControls = {
  identityId: '',
  progress: () => undefined,
  canRetry: () => false,
  retry: () => undefined,
  now: 0
};

const ImageControlsContext = createContext<ImageControls>(DEFAULT_CONTROLS);

export interface ImageControlsProviderProps {
  doc: Y.Doc;
  controls: Omit<ImageControls, 'now'>;
  children: React.ReactNode;
}

const STALE_CHECK_INTERVAL_MS = 30_000;

// Re-renders every 30 s while any image is uploading so `unfinished`
// appears without user interaction (image.unfinished).
export function ImageControlsProvider({
  doc,
  controls,
  children
}: ImageControlsProviderProps): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      const hasUploading = collectImageSnapshots(doc).some((s) => s.status === 'uploading');
      if (hasUploading) setNow(Date.now());
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [doc]);
  const value: ImageControls = { ...controls, now };
  return <ImageControlsContext.Provider value={value}>{children}</ImageControlsContext.Provider>;
}

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

function BrokenImageIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="#94a3b8" strokeWidth="2" />
      <path d="M3 16l5-5 4 4M14 13l2-2 5 5" fill="none" stroke="#94a3b8" strokeWidth="2" />
      <path d="M4 4l16 16" stroke="#ef4444" strokeWidth="2" />
    </svg>
  );
}

function UploadIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 16V5m0 0l-4 4m4-4l4 4" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// One rendering per displayStatus: uploading (progress for the uploader,
// "Uploading…" for everyone else), failed (Retry/Remove for the uploader,
// "Image unavailable" for others), unfinished ("Image upload didn't finish"
// with Remove for anyone) and the ready image itself. A failing <img> load
// swaps in the unavailable box at the same size; the error never escapes.
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove
}: ImageObjectProps): JSX.Element {
  const status = displayStatus(image, now);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [image.assetKey]);

  const style = { width: image.width, height: image.height };

  if (status === 'ready' && image.assetKey !== null && !loadFailed) {
    return (
      <div className="image-object image-object--ready" style={style} data-testid="image-object">
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          className="image-object-img"
          onError={() => setLoadFailed(true)}
        />
      </div>
    );
  }

  if (status === 'uploading') {
    if (isUploader) {
      const percent = Math.round((progress ?? 0) * 100);
      return (
        <div
          className="image-object image-object--uploading"
          style={style}
          data-testid="image-object"
        >
          <UploadIcon />
          <div className="image-progress-track" role="presentation">
            <div className="image-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="image-progress-label">{percent}%</span>
        </div>
      );
    }
    return (
      <div className="image-object image-object--uploading" style={style} data-testid="image-object">
        <span className="image-status-label">Uploading…</span>
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div className="image-object image-object--unfinished" style={style} data-testid="image-object">
        <span className="image-status-label">Image upload didn't finish</span>
        <button type="button" className="image-remove-button" onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  // failed, or ready with an unloadable asset.
  if (status === 'failed' && isUploader) {
    return (
      <div className="image-object image-object--failed" style={style} data-testid="image-object">
        <span className="image-status-label">Upload failed</span>
        <div className="image-actions">
          {canRetry && (
            <button type="button" className="image-retry-button" onClick={onRetry}>
              Retry
            </button>
          )}
          <button type="button" className="image-remove-button" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="image-object image-object--unavailable"
      style={style}
      data-testid="image-object"
    >
      <BrokenImageIcon />
      <span className="image-status-label">Image unavailable</span>
    </div>
  );
}

// Registry adapter: reads the image fields from the doc, wires the shared
// controls (progress, Retry, Remove) and the generic pointer handlers.
export function ImageObjectView(props: ObjectProps): JSX.Element | null {
  const { obj, doc, selected, editable, onObjectPointerDown } = props;
  const fields = getImageFields(doc, obj.id);
  const controls = useContext(ImageControlsContext);
  const bounds = objectBounds(obj);
  if (fields === undefined) return null;
  const image: ImageSnap = {
    ...obj,
    type: 'image',
    width: bounds.width,
    height: bounds.height,
    ...fields
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editable) return;
    onObjectPointerDown(e, obj.id);
  };

  const onRemove = () => {
    props.undo?.boundary();
    deleteObjects(doc, [obj.id]);
    props.undo?.boundary();
  };

  return (
    <div
      data-testid="image-object-view"
      data-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Image"
      className="image-object-anchor"
      style={{ left: bounds.x, top: bounds.y }}
      onPointerDown={onPointerDown}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === (controls.identityId || identity.id)}
        progress={controls.progress(obj.id)}
        canRetry={controls.canRetry(obj.id)}
        now={controls.now || Date.now()}
        onRetry={() => controls.retry(obj.id)}
        onRemove={onRemove}
      />
    </div>
  );
}
