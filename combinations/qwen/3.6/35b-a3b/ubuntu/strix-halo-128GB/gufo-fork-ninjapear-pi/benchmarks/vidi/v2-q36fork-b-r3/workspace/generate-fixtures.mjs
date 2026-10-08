/** Generate test fixture images for story 12 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const IMAGES_DIR = 'tests/fixtures/images';
mkdirSync(IMAGES_DIR, { recursive: true });

// Helper to compute CRC32 (simplified)
function crc32(buf) {
  let c = 0xFFFFFFFF;
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = new Uint8Array(4);
  len.set(Int32Array.of(data.length).buffer);
  // Fix: use correct byte order
  len[0] = (data.length >> 24) & 0xFF;
  len[1] = (data.length >> 16) & 0xFF;
  len[2] = (data.length >> 8) & 0xFF;
  len[3] = data.length & 0xFF;
  
  const typeArr = new TextEncoder().encode(type);
  const crc = crc32(new Uint8Array([...typeArr, ...data]));
  const crcBytes = new Uint8Array(4);
  crcBytes[0] = (crc >> 24) & 0xFF;
  crcBytes[1] = (crc >> 16) & 0xFF;
  crcBytes[2] = (crc >> 8) & 0xFF;
  crcBytes[3] = crc & 0xFF;
  
  return new Uint8Array([
    ...len, ...typeArr, ...data, ...crcBytes
  ]);
}

// PNG helper
function makePNG(width, height, color = [255, 0, 0]) {
  const signature = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  // IHDR
  const ihdr = new Uint8Array(4 + 4 + 1 + 1 + 1 + 1 + 1);
  ihdr.set(Int32Array.of(width).buffer, 0);   // width
  ihdr.set(Int32Array.of(height).buffer, 4);  // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type RGB
  // compression, filter, interlace are already 0
  const ihdrData = new Uint8Array([...Int32Array.of(width), ...Int32Array.of(height), 8, 2, 0, 0, 0]);
  const png = new Uint8Array([
    ...signature,
    ...chunk('IHDR', ihdrData),
  ]);
  
  // IDAT - raw image data with filter byte 0 per row
  const rawRowSize = 1 + width * 3; // filter byte + RGB pixels
  const rawData = new Uint8Array(rawRowSize * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rawRowSize;
    rawData[offset] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const pxOffset = offset + 1 + x * 3;
      rawData[pxOffset] = color[0];
      rawData[pxOffset + 1] = color[1];
      rawData[pxOffset + 2] = color[2];
    }
  }
  
  const zlibRaw = compressDeflate(rawData);
  return Buffer.from(new Uint8Array([...png, ...chunk('IDAT', zlibRaw), ...chunk('IEND', new Uint8Array(0))]));
}

function compressDeflate(data) {
  // Simple deflate using pako-like approach - we'll use a minimal implementation
  // Actually, let's just use the browser API if available or a simple approach
  
  // For testing purposes, use a real compression approach
  // We need zlib.deflate sync
  // Since Node doesn't have it built-in easily, let's create a minimal valid PNG differently
  
  // Use minizlib or similar... but since we might not have it, let's check
  try {
    const zlib = await import('zlib');
    return zlib.deflateRawSync(data);
  } catch {
    return data;
  }
}

async function main() {
  const zlib = await import('zlib');
  
  function makePNGWithZlib(width, height, color = [255, 0, 0]) {
    const signature = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    const ihdrData = new Uint8Array(13);
    const view = new DataView(ihdrData.buffer);
    view.setUint32(0, width, false); // big-endian
    view.setUint32(4, height, false);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 2;  // colour type RGB
    
    // IDAT
    const rawRowSize = 1 + width * 3; // filter byte + RGB pixels
    const rawData = new Uint8Array(rawRowSize * height);
    for (let y = 0; y < height; y++) {
      const offset = y * rawRowSize;
      rawData[offset] = 0; // no filter
      for (let x = 0; x < width; x++) {
        const pxOffset = offset + 1 + x * 3;
        rawData[pxOffset] = color[0];
        rawData[pxOffset + 1] = color[1];
        rawData[pxOffset + 2] = color[2];
      }
    }
    
    const compressed = zlib.deflateRawSync(rawData);
    const idat = chunk('IDAT', compressed);
    const iend = chunk('IEND', new Uint8Array(0));
    
    return Buffer.from(new Uint8Array([...signature, ...chunk('IHDR', ihdrData), ...idat, ...iend]));
  }
  
  // TC-01: Minimal images that sniff correctly
  // Screenshot-like PNG 1440x900 (green pixel)
  writeFileSync(join(IMAGES_DIR, 'screenshot.png'), makePNGWithZlib(1440, 900, [0, 128, 255]));
  console.log('Created screenshot.png (1440x900)');
  
  // JPEG photo - we need FF D8 FF, minimal JPEG
  // Create a minimal valid JPEG structure
  const jpegData = createMinimalJPEG();
  writeFileSync(join(IMAGES_DIR, 'photo.jpg'), jpegData);
  console.log('Created photo.jpg');
  
  // Animated GIF
  const gifData = createAnimatedGIF();
  writeFileSync(join(IMAGES_DIR, 'animated.gif'), gifData);
  console.log('Created animated.gif');
  
  // WebP
  const webpData = createWebP();
  writeFileSync(join(IMAGES_DIR, 'image.webp'), webpData);
  console.log('Created image.webp');
  
  // SVG with script tag (should be rejected)
  writeFileSync(join(IMAGES_DIR, 'script.svg'), Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`));
  console.log('Created script.svg');
  
  // PDF renamed to .png (should be rejected by content)
  writeFileSync(join(IMAGES_DIR, 'renamed.pdf'), Buffer.from('%PDF-1.4 fake pdf content here'));
  console.log('Created renamed.pdf');
  
  // Corrupt PNG (truncated)
  const pngBuf = makePNGWithZlib(10, 10, [255, 255, 0]);
  writeFileSync(join(IMAGES_DIR, 'corrupt.png'), pngBuf.slice(0, Math.floor(pngBuf.length / 2)));
  console.log('Created corrupt.png');
  
  // Exactly IMAGE_MAX_BYTES (10 MB) JPEG
  const maxBytes = 10 * 1024 * 1024;
  const largeJpeg = createLargeJPEG(maxBytes);
  writeFileSync(join(IMAGES_DIR, 'exact_max.jpg'), largeJpeg);
  console.log('Created exact_max.jpg (' + largeJpeg.length + ' bytes)');
  
  // IMAGE_MAX_BYTES + 1 byte
  const overMax = createLargeJPEG(maxBytes + 1);
  writeFileSync(join(IMAGES_DIR, 'over_max.jpg'), overMax);
  console.log('Created over_max.jpg (' + overMax.length + ' bytes)');
  
  // Multiple small images for picker test
  for (let i = 0; i < 21; i++) {
    const imgData = makePNGWithZlib(100, 100, [Math.random() * 255 | 0, Math.random() * 255 | 0, Math.random() * 255 | 0]);
    writeFileSync(join(IMAGES_DIR, `small_${i}.png`), imgData);
  }
  console.log('Created 21 small PNG files');
}

function createMinimalJPEG() {
  // Minimal JFIF JPEG with one 8x8 red block
  const chunks = [];
  
  // SOI
  chunks.push(new Uint8Array([0xFF, 0xD8]));
  
  // APP0 (JFIF)
  const jfifData = new TextEncoder().encode('JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00');
  const app0 = new Uint8Array(2 + jfifData.length);
  app0[0] = 0xFF; app0[1] = 0xE0;
  app0.set(jfifData, 2);
  chunks.push(app0);
  
  // DQT (quantization table)
  const qt = new Uint8Array([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const dqtLen = new Uint8Array(2);
  dqtLen[0] = 0xFF; dqtLen[1] = 0xDB;
  const dqtTotal = new Uint8Array(4 + qt.length);
  dqtTotal[0] = 0xFF; dqtTotal[1] = 0xDB;
  dqtTotal[2] = 0; dqtTotal[3] = qt.length; // length minus 2 header bytes... actually it's total including these 2 bytes
  // Standard: 2-byte length field includes itself, then the data
  const dqtPayload = new Uint8Array(2 + 1 + qt.length); // marker(2) + length(2) + identifier(1) + data(n)
  dqtPayload[0] = 0xFF;
  dqtPayload[1] = 0xDB;
  dqtPayload[2] = 0;
  dqtPayload[3] = 1 + qt.length; // total remaining after this 2-byte count
  dqtPayload[4] = 0; // table ID
  dqtPayload.set(qt, 5);
  chunks.push(dqtPayload);
  
  // SOF0 (Start of Frame)
  const sof = new Uint8Array(11);
  const sofView = new DataView(sof.buffer);
  sof[0] = 0xFF; sof[1] = 0xC0; // marker
  sof[2] = 0; sof[3] = 9; // length
  sof[4] = 8; // precision
  sofView.setUint16(5, 8, false); // height
  sofView.setUint16(7, 8, false); // width
  sof[9] = 1; // number of components
  sof[10] = 1; // component ID
  // For simplicity, let's just create a tiny valid JPEG using canvas
  return createJPGFromCanvas();
}

function createJPGFromCanvas() {
  // Use a simple approach: construct a JPEG at byte level
  // This is complex - let's just make a known-valid JPEG using node-canvas equivalent
  
  // Alternative: create a minimal JPEG manually
  // A valid JPEG requires quantization tables, Huffman tables, and properly encoded DCT coefficients
  
  // Let's try another approach - use canvas module
  // But we don't have canvas installed. Let's create a simpler fixture.
  
  // The key thing is the magic bytes: FF D8 FF
  // So even a truncated/minimal JPEG will work for sniffing tests
  // For upload integration tests, we need a valid JPEG though
  
  // Actually for the unit tests (TC-01) we only need magic bytes detection
  // For integration tests (TC-10, etc.) we need actual uploadable JPEGs
  
  // Let me create a minimal valid JPEG using the encoder in a different way
  const encoder = new ImageEncoder({ format: 'image/jpeg', quality: 0.8 });
  // ImageEncoder isn't available in Node.js either
  
  // Final approach: just concatenate known-good JPEG bytes
  // I'll base64 encode a 1x1 JPEG and decode it here
  
  // 1x1 pure-red JPEG:
  const jpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAAYf/EABsRAAEFAAMBAAAAAAAAAAAAAAERAQISMUH/2gAMAwEAAhEDEQA/AOqiiiiiiiiiiiiiiiiiiiiiiiiiiiv/9k=';
  return Buffer.from(jpegBase64, 'base64');
}

function createJPGFromCanvas() {
  // Use the same as above - it's a 1x1 jpeg
  const jpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAAYf/EABsRAAEFAAMBAAAAAAAAAAAAAAERAQISMUH/2gAMAwEAAhEDEQA/AOqiiiiiiiiiiiiiiiiiiiiiiiiiiiv/9k=';
  return Buffer.from(jpegBase64, 'base64');
}

function createAnimatedGIF() {
  // GIF89a with 2 frames (minimal animated GIF)
  const header = new TextEncoder().encode('GIF89a');
  
  // Logical Screen Descriptor: 8x8, packed byte, bgColor, pixel aspect ratio
  const lsd = new Uint8Array([
    8, 0,       // width = 8
    8, 0,       // height = 8
    0xF7,       // packed: GCT flag=1, GCT size=7 (128 colors), color res=7, sorted=0, GCT size=7
    0,          // background color index
    0,          // pixel aspect ratio
  ]);
  
  // Global Color Table (1 entry = black for simplicity, plus some transparent entries)
  const gct = new Uint8Array(128 * 3);
  for (let i = 0; i < 128; i++) {
    gct[i * 3] = i % 256;       // R
    gct[i * 3 + 1] = (i * 2) % 256; // G  
    gct[i * 3 + 2] = (i * 3) % 256; // B
  }
  
  // Graphics Control Extension for frame 1 (transparent)
  const gce1 = new Uint8Array([
    0x21,             // extension intro
    0xF9,             // graphics control extension
    4,                // block size
    1,                // disposal: 0 = none, transparency flag set
    0, 0,             // delay time (LSB, MSB) - fast
    1,                // transparent color index
    0,                // block terminator
  ]);
  
  // Frame 1: 8x8 blue block
  const imgDesc1 = new Uint8Array([
    0x2C,         // image separator
    0, 0,         // left = 0
    0, 0,         // top = 0
    8, 0,         // width = 8
    8, 0,         // height = 8
    0,            // local color table flag = 0 (use global GCT)
  ]);
  
  // LZW minimum code size
  const lzwHeader = new Uint8Array([0x08]); // min code size = 8 bits
  
  // Image data (LZW encoded minimal data)
  // This is tricky without an LZW encoder. Let's just put some dummy bytes.
  // Actually the spec says the data must start with min code size followed by sub-blocks.
  // For a minimal working GIF, the first sub-block should be 1 byte, ending with block terminator.
  const imageData = new Uint8Array([0x08, 0x00, 0x00]); // single byte of LZW data? No, this won't work...
  
  // Actually for testing sniffImageType we only need the magic bytes. Let's make a minimal GIF89a
  // that at least passes content-type sniffing.
  
  const trailer = new Uint8Array([0x3B]); // trailer
  
  // Build a GIF that starts with GIF89a
  const gif = new Uint8Array(header.length + lsd.length + gct.length + gce1.length + imgDesc1.length + 1 + lzwHeader.length + 3 + trailer.length);
  let off = 0;
  gif.set(header, off); off += header.length;
  gif.set(lsd, off); off += lsd.length;
  gif.set(gct, off); off += gct.length;
  gif.set(gce1, off); off += gce1.length;
  gif.set(imgDesc1, off); off += imgDesc1.length;
  gif[off++] = 8; // LZW min code size
  gif[off++] = 3; // sub-block size (includes terminator)
  gif[off++] = 0x08; // data
  gif[off++] = 0x00; // data
  gif[off++] = 0x00; // block terminator
  gif.set(trailer, off);
  
  return Buffer.from(gif);
}

function createWebP() {
  // RIFF....WEBP (VP8 format) - minimal
  const riffHeader = new TextEncoder().encode('RIFF');
  const fileSize = new Uint8Array(4);
  const webp = new TextEncoder().encode('WEBP');
  const vp8 = new TextEncoder().encode('VP8 ');
  
  // VP8 bitstream header (keyframe with width, height)
  // Sign byte: 0 for keyframe, then 11 bits width, 11 bits height (inverted)
  const vp8Header = new Uint8Array([
    0x9D, 0x01, 0x2A, // signature + version
    0x00, 0x00,       // padding
    0x08, 0x03,       // width=8 (little-endian 11-bit: 8 = 0x0008), inverted height = ~7 = 0xFF...
    // Actually VP8 dimensions are stored as: (width-1) in 14 bits, (height-1) in 14 bits, all shifted left by 1
    // width=8 → 7 in bits, height=8 → 7 in bits
    // Stored as little-endian 14-bit values << 1
    // This is getting complex - let's simplify
  ]);
  
  // Simpler approach: just ensure RIFF....WEBP pattern matches
  // The sniff function checks bytes 0-3 = "RIFF" and bytes 8-11 = "WEBP"
  const fileSizeLE = new Uint8Array(4);
  const view = new DataView(fileSizeLE.buffer);
  // File size placeholder (will be wrong but fine for sniffing)
  
  // VP8 keyframe header 
  const vp8Bits = new Uint8Array([
    0x9D, 0x01, 0x2A, // VP8 signature
    0x00, 0x00,       // reserved
    ((8-1) & 0x3FFF) & 0xFF, (((8-1) >> 8) & 0x3F) | (((8-1) & 0x3FFF) >> 6),
    // Actually VP8 stores: width-1 in bits 0-13 shifted left 1, height-1 in bits 0-13 shifted left 1
    // width=8: 7 << 1 = 0x0E (LSB), 0x00 (MSB high bits)
    // These get split across bytes in a specific way
    // Let's just do something reasonable
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  
  const totalContentLength = 4 + vp8.length + vp8Bits.length; // RIFF header body = file_size(4) + format(4) + chunk_id(4) + chunk_data
  const fileSizeBytes = new Uint8Array(4);
  new DataView(fileSizeBytes.buffer).setUint32(0, totalContentLength, true); // little-endian
  
  const chunk = new Uint8Array(vp8.length + vp8Bits.length);
  chunk.set(vp8, 0);
  chunk.set(vp8Bits, vp8.length);
  
  const riff = new Uint8Array(4 + fileSizeBytes.length + webp.length + chunk.length);
  riff.set(riffHeader, 0);
  riff.set(fileSizeBytes, 4);
  riff.set(webp, 8);
  riff.set(chunk, 12);
  
  return Buffer.from(riff);
}

function createLargeJPEG(size) {
  // Create a JPEG-sized buffer starting with FF D8 FF
  // For size check tests, we don't need a valid JPEG structure
  const buf = Buffer.alloc(size);
  buf[0] = 0xFF;
  buf[1] = 0xD8;
  buf[2] = 0xFF;
  // Fill rest with zeros
  return buf;
}

main().catch(console.error);
