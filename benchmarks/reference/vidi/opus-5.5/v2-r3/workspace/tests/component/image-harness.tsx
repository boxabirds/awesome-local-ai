// Story 12 test harness: the insert hook, a viewport that takes drops, the
// board's image objects and the toast, over a real Y.Doc (no Board, so the
// connection state can be set directly).
import { useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { deleteObjects, getObjectsMap, initDoc, objectsSnapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { ImageInsertContext, type ImageInsertContextValue } from '../../src/client/images/ImageInsertContext';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { DropHighlight } from '../../src/client/images/DropHighlight';
import { RegisteredImageObject } from '../../src/client/objects/ImageObject';
import { Toast } from '../../src/client/ui/Toast';
import type { UndoController } from '../../src/client/board/undo';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import '../../src/client/objects/registry';

export const HARNESS_BOARD = 'AbCdEfGhIjKlMnOpQr_-09';
export const HARNESS_VIEW = { width: 1000, height: 800 };
export const ME = 'c_me';

/** jsdom has no DragEvent; without it drop events carry no coordinates. */
export class TestDragEvent extends MouseEvent {}

export function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function useObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const store = useMemo(() => {
    let current = objectsSnapshot(doc);
    return {
      subscribe(cb: () => void) {
        const h = () => {
          current = objectsSnapshot(doc);
          cb();
        };
        getObjectsMap(doc).observeDeep(h);
        return () => getObjectsMap(doc).unobserveDeep(h);
      },
      get: () => current,
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.get);
}

export function ImageHarness(props: {
  doc: Y.Doc;
  connection: ConnectionState;
  undo?: UndoController;
  now?: number;
  identityId?: string;
  withEditor?: boolean;
}) {
  const { doc } = props;
  const identityId = props.identityId ?? ME;
  const insert = useImageInsert({
    doc,
    boardId: HARNESS_BOARD,
    camera: { x: 0, y: 0, zoom: 1 },
    connection: props.connection,
    identityId,
    viewport: HARNESS_VIEW,
    undo: props.undo,
  });
  const objects = useObjects(doc);
  const ctx: ImageInsertContextValue = {
    identityId,
    progress: insert.progress,
    canRetry: insert.canRetry,
    retry: insert.retry,
    remove: (id) => deleteObjects(doc, [id]),
    now: props.now ?? Date.now(),
  };
  return (
    <ImageInsertContext.Provider value={ctx}>
      <div data-testid="viewport" tabIndex={0} {...{ onDragEnter: insert.onDragEnter, onDragOver: insert.onDragOver, onDragLeave: insert.onDragLeave, onDrop: insert.onDrop }}>
        {objects.map((o) => (
          <RegisteredImageObject
            key={o.id}
            object={o}
            doc={doc}
            zIndex={1}
            selected={false}
            editing={false}
            readOnly={false}
            gesture="idle"
            onPointerDown={() => {}}
            onStartEdit={() => {}}
            onEndEdit={() => {}}
          />
        ))}
      </div>
      {props.withEditor && <textarea aria-label="Note text" />}
      <button type="button" onClick={insert.openPicker}>
        Pick
      </button>
      {insert.pickerInput}
      <DropHighlight active={insert.dragActive} />
      <Toast toast={insert.toast} onDismiss={insert.dismissToast} />
    </ImageInsertContext.Provider>
  );
}
