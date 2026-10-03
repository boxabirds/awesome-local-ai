import zlib from 'node:zlib';

/**
 * Minimal PNG reader for Playwright screenshots (8-bit, non-interlaced), so
 * e2e tests can assert on rendered pixels — the dot grid is drawn by a CSS
 * gradient, so the only way to prove a dot moved is to look at it.
 */
export interface Image {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

export function decodePng(buffer: Buffer): Image {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (buffer[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8] ?? 0;
      colorType = chunk[9] ?? 0;
      interlace = chunk[12] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(chunk));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth} interlace=${interlace})`);
  }
  const channels = { 0: 1, 4: 2, 2: 3, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos] ?? 0;
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const current = data.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? (current[x - channels] ?? 0) : 0;
      const b = previous ? (previous[x] ?? 0) : 0;
      const c = previous && x >= channels ? (previous[x - channels] ?? 0) : 0;
      const value = line[x] ?? 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + a;
          break;
        case 2:
          restored = value + b;
          break;
        case 3:
          restored = value + Math.floor((a + b) / 2);
          break;
        case 4:
          restored = value + paeth(a, b, c);
          break;
        default:
          throw new Error(`unsupported PNG filter ${filter}`);
      }
      current[x] = restored & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** Mean absolute per-channel difference between two same-size images. */
export function meanDifference(a: Image, b: Image): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let total = 0;
  const pixels = a.width * a.height;
  for (let p = 0; p < pixels; p += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      total += Math.abs((a.data[p * a.channels + channel] ?? 0) - (b.data[p * b.channels + channel] ?? 0));
    }
  }
  return total / (pixels * 3);
}

/** How dark an image is on average (0 = black, 255 = white): dots are dark. */
export function meanLightness(image: Image): number {
  let total = 0;
  const pixels = image.width * image.height;
  for (let p = 0; p < pixels; p += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      total += image.data[p * image.channels + channel] ?? 0;
    }
  }
  return total / (pixels * 3);
}
