/**
 * lzw.ts - the LZW variant the game's files are packed with (ported from Nuvie's files/U6Lzw.cpp).
 *
 * A packed buffer is a 4-byte length (little-endian) then 9 to 12-bit codewords, least significant bit first;
 * 0x100 resets the dictionary, 0x101 ends the stream.
 */

/** Whether `buf` looks like a packed buffer: a length under 16MB, then a first codeword of 0x100. */
export function isLzw(buf: Uint8Array): boolean {
  return buf.length >= 6 && buf[3] === 0 && buf[4] === 0 && (buf[5] & 1) === 1;
}

/** The unpacked length a packed buffer declares, or -1. */
export function lzwSize(buf: Uint8Array): number {
  return isLzw(buf) ? buf[0] | (buf[1] << 8) | (buf[2] << 16) : -1;
}

export function lzwDecompress(src: Uint8Array): Uint8Array {
  const size = lzwSize(src);
  if (size < 0) throw new Error('not an LZW buffer');
  const dest = new Uint8Array(size);
  const dictRoot = new Uint8Array(0x1000);
  const dictCode = new Uint16Array(0x1000);
  const stack = new Uint8Array(0x1000);
  let codeSize = 9;
  let nextFree = 0x102;
  let dictSize = 0x200;
  let bits = 0;
  let written = 0;
  let pW = 0;
  const data = src.subarray(4);
  const next = (): number => {
    const i = bits >> 3;
    const b = (data[i] ?? 0) | ((data[i + 1] ?? 0) << 8) | ((data[i + 2] ?? 0) << 16);
    const cw = (b >> (bits & 7)) & ((1 << codeSize) - 1);
    bits += codeSize;
    return cw;
  };
  /** Push `cw`'s string onto the stack (last byte first); return how many bytes. */
  const getString = (cw: number): number => {
    let n = 0;
    while (cw > 0xff) {
      stack[n++] = dictRoot[cw];
      cw = dictCode[cw];
    }
    stack[n++] = cw;
    return n;
  };
  const add = (root: number, code: number): void => {
    if (nextFree < 0x1000) {
      dictRoot[nextFree] = root;
      dictCode[nextFree] = code;
    }
    nextFree++;
    if (nextFree >= dictSize && codeSize < 12) {
      codeSize++;
      dictSize *= 2;
    }
  };
  for (;;) {
    if (bits >> 3 >= data.length) break; // a stream cut short: keep what there is
    let cW = next();
    if (cW === 0x101) break;
    if (cW === 0x100) {
      codeSize = 9;
      nextFree = 0x102;
      dictSize = 0x200;
      cW = next();
      if (written < size) dest[written++] = cW;
    } else if (cW < nextFree) {
      let n = getString(cW);
      const c = stack[n - 1];
      while (n > 0 && written < size) dest[written++] = stack[--n];
      add(c, pW);
    } else {
      if (cW !== nextFree) throw new Error('corrupt LZW stream');
      let n = getString(pW);
      const c = stack[n - 1];
      while (n > 0 && written < size) dest[written++] = stack[--n];
      if (written < size) dest[written++] = c;
      add(c, pW);
    }
    pW = cW;
  }
  return dest;
}

/** A whole file as the engine reads it: unpacked where packed, else its bytes after an 8-byte header (as U6Lzw::decompress_file). */
export function lzwFile(buf: Uint8Array): Uint8Array {
  return isLzw(buf) ? lzwDecompress(buf) : buf.subarray(8);
}

/**
 * Pack `src` (for the demo world and the tests): every byte as its own 9-bit literal, the dictionary reset before it
 * can grow the codeword. Valid for the reader above and for the original's, though it saves nothing.
 */
export function lzwCompress(src: Uint8Array): Uint8Array {
  const codes: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (i % 200 === 0) codes.push(0x100);
    codes.push(src[i]);
  }
  if (src.length === 0) codes.push(0x100);
  codes.push(0x101);
  const out = new Uint8Array(4 + Math.ceil((codes.length * 9) / 8) + 2);
  out[0] = src.length & 0xff;
  out[1] = (src.length >> 8) & 0xff;
  out[2] = (src.length >> 16) & 0xff;
  let bit = 0;
  for (const c of codes) {
    const i = 4 + (bit >> 3);
    const v = c << (bit & 7);
    out[i] |= v & 0xff;
    out[i + 1] |= (v >> 8) & 0xff;
    out[i + 2] |= (v >> 16) & 0xff;
    bit += 9;
  }
  return out;
}
