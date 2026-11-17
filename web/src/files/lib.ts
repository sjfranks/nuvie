/**
 * lib.ts - the game's library files: a table of offsets (2 or 4 bytes each) then the items (Nuvie's files/U6Lib_n.cpp).
 * A 4-byte offset's top byte is a flag; 0x01 and 0x20 mark an item packed with LZW.
 */
import { lzwDecompress } from './lzw.ts';

interface Item {
  offset: number;
  flag: number;
  size: number;
}

export class Lib {
  readonly items: Item[] = [];

  /** `skip4`: the file starts with its own length (Martian Dreams and Savage Empire; Ultima 6's do not). */
  constructor(
    private readonly data: Uint8Array,
    private readonly width: 2 | 4,
    skip4 = false,
  ) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const start = skip4 ? 4 : 0;
    const read = (i: number): number => (width === 2 ? v.getUint16(i, true) : v.getUint32(i, true));
    // The table ends where the first item starts.
    let max = Infinity;
    let n = 0;
    for (let i = start; i + width <= data.length; i += width, n++) {
      if (n >= max) break;
      let off = read(i);
      if (width === 4) off &= 0xffffff;
      if (off !== 0) {
        if (skip4) off -= 4;
        max = Math.min(max, Math.floor(off / width));
      }
    }
    if (max === Infinity) n = 0;
    for (let i = 0; i < n; i++) {
      const raw = read(start + i * width);
      this.items.push(width === 2 ? { offset: raw, flag: 0, size: 0 } : { offset: raw & 0xffffff, flag: raw >>> 24, size: 0 });
    }
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      let nextOff = 0;
      for (let o = i + 1; o <= n; o++) {
        const off = o === n ? data.length : this.items[o].offset;
        if (off) {
          nextOff = off;
          break;
        }
      }
      if (it.offset && nextOff > it.offset) it.size = nextOff - it.offset;
    }
  }

  get count(): number {
    return this.items.length;
  }

  private compressed(i: number): boolean {
    for (let j = i; j < this.items.length; j++) {
      const f = this.items[j].flag;
      if (f === 0x01 || f === 0x20) return true;
      if (f !== 0xff) return false;
    }
    return false;
  }

  /** Item `i` as stored (not unpacked), or null where there is none. */
  raw(i: number): Uint8Array | null {
    const it = this.items[i];
    if (!it || it.size === 0 || it.offset === 0) return null;
    return this.data.subarray(it.offset, it.offset + it.size);
  }

  /** Item `i`, unpacked where its flag says it is packed. */
  item(i: number): Uint8Array | null {
    const raw = this.raw(i);
    if (!raw) return null;
    return this.compressed(i) ? lzwDecompress(raw) : raw;
  }
}

/** Build a library (for the demo world and the tests). */
export function buildLib(items: (Uint8Array | null)[], width: 2 | 4): Uint8Array {
  let off = items.length * width;
  const offs = items.map((it) => {
    if (!it || it.length === 0) return 0;
    const o = off;
    off += it.length;
    return o;
  });
  const out = new Uint8Array(off);
  const v = new DataView(out.buffer);
  offs.forEach((o, i) => (width === 2 ? v.setUint16(i * 2, o, true) : v.setUint32(i * 4, o, true)));
  items.forEach((it, i) => it && it.length && out.set(it, offs[i]));
  return out;
}
