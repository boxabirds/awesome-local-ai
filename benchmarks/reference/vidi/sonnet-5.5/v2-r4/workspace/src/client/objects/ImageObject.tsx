import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { deleteObjects } from '../../shared/board-model';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { useUndoController } from '../board/useUndo';
import { useImageInsertContext } from '../images/imageContext';
import type { ObjectProps } from './registry';

const CLOCK_TICK_MS = 30_000;

const box: CSSProperties = {
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: '#e0e0e0',
  color: '#555',
  font: '14px system-ui, sans-serif',
  textAlign: 'center',
  overflow: 'hidden',
  padding: 8,
};
const smallButton: CSSProperties = { border: '1px solid #888', borderRadius: 6, background: '#fff', padding: '4px 10px', cursor: 'pointer', font: '13px system-ui, sans-serif' };

const ImageIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#777" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M3 17l5-5 4 4 3-3 6 6" />
  </svg>
);
const BrokenIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#777" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 15l5-4 3 3 3-5 7 6M9 4l3 5-3 4" />
  </svg>
);

function Unavailable() {
  return (
    <div data-testid="image-unavailable" style={box}>
      <BrokenIcon />
      <span>Image unavailable</span>
    </div>
  );
}

export function ImageObject(props: {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}) {
  const { image, isUploader } = props;
  const status = displayStatus(image, props.now);
  const [loadFailedFor, setLoadFailedFor] = useState<string | null>(null);
  // A new assetKey gets a fresh chance to load.
  const failed = loadFailedFor !== null && loadFailedFor === image.assetKey;
  const stop = (e: ReactPointerEvent) => e.stopPropagation();

  if (status === 'uploading') {
    const pct = Math.round(Math.min(1, Math.max(0, props.progress ?? 0)) * 100);
    return (
      <div data-testid="image-uploading" style={box}>
        {isUploader ? (
          <>
            <ImageIcon />
            <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ width: '70%', maxWidth: 200, height: 6, background: '#bdbdbd', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#1e88e5' }} />
            </div>
            <span data-testid="image-progress">{pct}%</span>
          </>
        ) : (
          <span>Uploading…</span>
        )}
      </div>
    );
  }
  if (status === 'unfinished') {
    return (
      <div data-testid="image-unfinished" style={box}>
        <span>Image upload didn't finish</span>
        <button type="button" onPointerDown={stop} onClick={props.onRemove} style={smallButton}>
          Remove
        </button>
      </div>
    );
  }
  if (status === 'failed') {
    if (!isUploader) return <Unavailable />;
    return (
      <div data-testid="image-failed" style={{ ...box, background: '#fdecea', border: '2px solid #e53935', color: '#b71c1c' }}>
        <span>Upload failed</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {props.canRetry && (
            <button type="button" onPointerDown={stop} onClick={props.onRetry} style={smallButton}>
              Retry
            </button>
          )}
          <button type="button" onPointerDown={stop} onClick={props.onRemove} style={smallButton}>
            Remove
          </button>
        </div>
      </div>
    );
  }
  if (failed || !image.assetKey) return <Unavailable />;
  return (
    <img
      src={`/api/assets/${image.assetKey}`}
      alt="Image"
      draggable={false}
      decoding="async"
      loading="lazy"
      onError={() => setLoadFailedFor(image.assetKey)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none', userSelect: 'none' }}
    />
  );
}

/** Re-renders every 30 s while this mounted image is uploading, so `unfinished` appears without interaction. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, [active]);
  return active ? now : Date.now();
}

/** Registry component: positions the image on the board and wires selection, Retry and Remove. */
export function ImageObjectHost(props: ObjectProps) {
  const image = props.object as ImageSnap;
  const ctx = useImageInsertContext();
  const undo = useUndoController();
  const now = useClock(image.status === 'uploading');
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, image.id);
  };
  const onRemove = () => {
    if (!props.editable) return;
    undo.boundary();
    deleteObjects(props.doc, [image.id]);
    undo.boundary();
  };
  return (
    <div
      role="group"
      aria-label="Image"
      data-object-id={image.id}
      data-image-id={image.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-status={image.status}
      data-z={image.z}
      onPointerDown={onPointerDown}
      style={{ position: 'absolute', left: image.x, top: image.y, width: image.width, height: image.height, zIndex: image.z, cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === ctx.identityId}
        progress={ctx.progress.get(image.id)}
        canRetry={ctx.canRetry(image.id)}
        now={now}
        onRetry={() => ctx.retry(image.id)}
        onRemove={onRemove}
      />
    </div>
  );
}
