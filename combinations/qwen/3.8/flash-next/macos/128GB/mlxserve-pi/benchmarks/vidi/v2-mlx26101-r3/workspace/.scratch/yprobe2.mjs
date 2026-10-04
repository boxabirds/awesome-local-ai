import * as Y from 'yjs';
const a = new Y.Doc();
const b = new Y.Doc();
a.on('update', (update) => { Y.applyUpdate(b, update); });
a.transact(() => {
  const m = new Y.Map();
  m.set('type', 'image');
  m.set('id', 'obj1');
  a.getMap('objects').set('obj1', m);
}, 'local');
console.log('a size', a.getMap('objects').size, 'b size', b.getMap('objects').size);
console.log('b keys', [...b.getMap('objects').keys()]);
console.log('yjs version', (await import('yjs/package.json', { with: { type: 'json' } })).default.version);
