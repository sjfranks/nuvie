/** shape.ts - the games' run-length pictures, with a hot spot (Nuvie's files/U6Shape.cpp). */
export interface Shape {
  w: number;
  h: number;
  /** Palette indices; 0xff is see-through. */
  data: Uint8Array;
}

export function readShape(buf: Uint8Array, start = 0): Shape | null {
  const v = new DataView(buf.buffer, buf.byteOffset + start, buf.byteLength - start);
  if (v.byteLength < 8) return null;
  const s16 = (o: number): number => v.getInt16(o, true);
  const u16 = (o: number): number => v.getUint16(o, true);
  const hotx = u16(2);
  const hoty = u16(4);
  const w = u16(0) + hotx + 1;
  const h = hoty + u16(6) + 1;
  if (w <= 0 || h <= 0 || w > 1024 || h > 1024) return null;
  const data = new Uint8Array(w * h).fill(0xff);
  let p = 8;
  while (p + 6 <= v.byteLength) {
    let n = u16(p);
    if (n === 0) break;
    const x = s16(p + 2);
    const y = s16(p + 4);
    p += 6;
    if (hotx + x >= w || hoty + y >= h) break;
    const at = hotx + x + (hoty + y) * w;
    const encoded = n & 1;
    n >>= 1;
    if (!encoded) {
      for (let i = 0; i < n; i++) data[at + i] = v.getUint8(p + i);
      p += n;
      continue;
    }
    for (let j = 0; j < n; ) {
      let n2 = v.getUint8(p++);
      const repeat = n2 & 1;
      n2 >>= 1;
      if (repeat) {
        data.fill(v.getUint8(p++), at + j, at + j + n2);
      } else {
        for (let i = 0; i < n2; i++) data[at + j + i] = v.getUint8(p + i);
        p += n2;
      }
      j += n2;
    }
  }
  return { w, h, data };
}
