import * as React from 'react';
import * as Y from 'yjs';
import { snapshot, initDoc } from '../../shared/board-model';

let _doc: Y.Doc | null = null;

export function useBoardDoc(): {
  doc: Y.Doc;
  snapshots: readonly import('../../shared/board-model').StickySnapshot[];
} {
  if (!_doc) {
    _doc = new Y.Doc();
    initDoc(_doc);
  }

  const [snapshots, setSnapshots] = React.useState(() => snapshot(_doc!));

  React.useEffect(() => {
    const objects = _doc!.getMap('objects');
    const handler = () => {
      setSnapshots(snapshot(_doc!));
    };
    // Observe deep changes on the objects map
    objects.observeDeep(handler);
    return () => {
      objects.unobserveDeep(handler);
    };
  }, []);

  return { doc: _doc!, snapshots };
}
