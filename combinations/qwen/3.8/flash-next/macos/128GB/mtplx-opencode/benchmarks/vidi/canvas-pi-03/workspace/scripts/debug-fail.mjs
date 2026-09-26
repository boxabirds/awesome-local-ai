// Probe: what happens after an injected write failure?
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const ORIGIN = 'http://127.0.0.1:8791';
const B = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = async () => (await (await fetch(`${ORIGIN}/__test/rooms/${B}/state`)).json()).state;

const a = new Y.Doc();
const pa = new WebsocketProvider(`${ORIGIN}/api/rooms`, B, a, { disableBc: true });
const b = new Y.Doc();
const pb = new WebsocketProvider(`${ORIGIN}/api/rooms`, B, b, { disableBc: true });
await sleep(2500);
console.log('connected', pa.wsconnected, pb.wsconnected, 'state', await st());

function note(doc, x) {
  const m = new Y.Map();
  m.set('x', x);
  m.set('text', new Y.Text('hi'));
  doc.getMap('objects').set(`n${x}`, m);
}
note(a, 1);
await sleep(400);
console.log('after first note: state', await st(), 'b has', b.getMap('objects').size);

await fetch(`${ORIGIN}/__test/rooms/${B}/inject-failure`, {
  method: 'POST',
  body: JSON.stringify({ writes: 1 }),
});
note(a, 2);
await sleep(2500);
console.log(
  'after injected failure: state',
  await st(),
  'b size',
  b.getMap('objects').size,
  'a size',
  a.getMap('objects').size,
  'sockets',
  pa.wsconnected,
  pb.wsconnected,
);
process.exit(0);
