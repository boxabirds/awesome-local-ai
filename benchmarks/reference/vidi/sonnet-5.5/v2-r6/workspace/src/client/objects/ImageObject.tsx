import { createContext, useContext, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { deleteObjects } from '../../shared/board-model';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';

const CLOCK_TICK_MS = 30_000;
const PERCENT = 100;

/** What the board hands to image objects: this tab's uploads and the retry hooks of `useImageInsert`. */
export interface ImageEnv {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
}
export const ImageEnvContext = createContext<ImageEnv>({
  identityId: '', progress: new Map(), canRetry: () => false, retry: () => false,
});

// One shared interval re-renders every uploading image so "didn't finish" appears without interaction.
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;
function subscribeClock(cb: () => void): () => void {
  listeners.add(cb);
  interval ??= setInterval(() => listeners.forEach((l) => l()), CLOCK_TICK_MS);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    return subscribeClock(() => setNow(Date.now()));
  }, [active]);
  return now;
}

const BrokenIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" data-testid="broken-image-icon">
    <path d="M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
const ImageIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
    <path d="M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

/** Renders one image object per display status; moving, selecting and resizing stay with the board. */
export function ImageObject(props: {
  image: ImageSnap; isUploader: boolean; progress?: number; canRetry: boolean; now: number;
  onRetry(): void; onRemove(): void;
}) {
  const { image, isUploader, progress, canRetry, now } = props;
  const status = displayStatus(image, now);
  const [loadFailedFor, setLoadFailedFor] = useState<string | null>(null);
  // A different assetKey gets a fresh chance to load.
  useEffect(() => setLoadFailedFor(null), [image.assetKey]);
  const stop = (e: ReactPointerEvent) => e.stopPropagation();

  if (status === 'ready' && image.assetKey !== null && loadFailedFor !== image.assetKey) {
    return (
      <img
        className="image-content"
        src={`/api/assets/${image.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setLoadFailedFor(image.assetKey)}
      />
    );
  }
  if (status === 'uploading') {
    if (!isUploader) return <div className="image-box" data-status="uploading"><span>Uploading…</span></div>;
    const pct = Math.round((progress ?? 0) * PERCENT);
    return (
      <div className="image-box" data-status="uploading">
        <ImageIcon />
        <div className="image-progress" role="progressbar" aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={pct}>
          <div className="image-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span data-testid="image-progress">{pct}%</span>
      </div>
    );
  }
  if (status === 'failed' && isUploader) {
    return (
      <div className="image-box image-box--failed" data-status="failed">
        <span>Upload failed</span>
        <div className="image-actions" onPointerDown={stop}>
          {canRetry && <button type="button" onClick={props.onRetry}>Retry</button>}
          <button type="button" onClick={props.onRemove}>Remove</button>
        </div>
      </div>
    );
  }
  if (status === 'unfinished') {
    return (
      <div className="image-box" data-status="unfinished">
        <span>Image upload didn't finish</span>
        <div className="image-actions" onPointerDown={stop}>
          <button type="button" onClick={props.onRemove}>Remove</button>
        </div>
      </div>
    );
  }
  return (
    <div className="image-box" data-status="unavailable">
      <BrokenIcon />
      <span>Image unavailable</span>
    </div>
  );
}

/** The registry component: positions the image and wires identity, progress, clock, Retry and Remove. */
export function ImageNode(props: ObjectProps) {
  const image = props.object as ImageSnap;
  const env = useContext(ImageEnvContext);
  const undo = useUndoController();
  const now = useNow(image.status === 'uploading');
  const remove = () => {
    undo?.boundary();
    deleteObjects(props.doc, [image.id]);
    undo?.boundary();
  };
  return (
    <div
      className="image-object"
      data-image-object=""
      data-object-id={image.id}
      data-note-id={image.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-dragging={props.dragging ? 'true' : 'false'}
      style={{
        left: image.x, top: image.y, width: image.width, height: image.height, zIndex: image.z,
        cursor: props.dragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={(e) => props.onObjectPointerDown(e, image.id)}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === env.identityId}
        progress={env.progress.get(image.id)}
        canRetry={env.canRetry(image.id)}
        now={now}
        onRetry={() => env.retry(image.id)}
        onRemove={remove}
      />
    </div>
  );
}
