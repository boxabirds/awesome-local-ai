import * as Y from 'yjs'
const doc = new Y.Doc()
const seen = []
doc.on('update', (u, origin) => seen.push({ len: u.byteLength, origin, err: null }))
// seed valid content
const a = new Y.Doc()
a.getMap('objects').set('one', {x:1})
Y.applyUpdate(doc, Y.encodeStateAsUpdate(a))
console.log('after valid apply, events:', seen.length, 'size', doc.getMap('objects').size)

seen.length = 0
const garbage = new Uint8Array(200)
for (let i=0;i<200;i++) garbage[i] = (i*37)%256
try { Y.applyUpdate(doc, garbage, 'ws') } catch (e) { console.log('threw:', e.message) }
console.log('after garbage apply, events:', seen.length, 'size', doc.getMap('objects').size)

seen.length = 0
// a legit update arriving AFTER the garbage
const b = new Y.Doc()
b.getMap('objects').set('two', {x:2})
try { Y.applyUpdate(doc, Y.encodeStateAsUpdate(b), 'ws') } catch (e) { console.log('second threw:', e.message) }
console.log('after legit-after-garbage, events:', seen.length, 'size', doc.getMap('objects').size)
