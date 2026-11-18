/**
 * cutscene.ts - the pictures of the games' cutscenes (ScriptCutscene.cpp): image libraries (.lzc: a library of
 * libraries of shapes; .shp: an LZW-packed library of shapes) and the palettes they are shown in (.lbm Deluxe Paint
 * files, .pal libraries, the packed 6-bit palettes of palettes.int).
 */
import type { GameFiles } from './gamefiles.ts';
import { Lib } from './lib.ts';
import { lzwFile } from './lzw.ts';
import { readShape, type Shape } from './shape.ts';

/** image_load_all: every picture of a library, by group. */
export function loadImages(files: GameFiles, name: string): Shape[][] {
  const data = files.get(name);
  if (!data) return [];
  const out: Shape[][] = [];
  if (name.endsWith('.lzc')) {
    const lib = new Lib(data, 4, true);
    for (let i = 0; i < 64; i++) {
      const item = lib.item(i);
      if (!item) break;
      const sub = new Lib(item, 4, true);
      const group: Shape[] = [];
      for (let j = 0; j < 64; j++) {
        const s = sub.item(j);
        if (!s) break;
        const shape = readShape(s, 0);
        if (shape) group.push(shape);
      }
      out.push(group);
    }
    return out;
  }
  const lib = new Lib(lzwFile(data), 4, true);
  for (let i = 0; i < 128; i++) {
    const s = lib.item(i);
    if (!s) break;
    const shape = readShape(s, 0);
    if (shape) out.push([shape]);
  }
  return out;
}

/** load_palette: 256 colours, 8 bits each of red, green and blue. */
export function loadPalette(files: GameFiles, name: string, idx = 0): Uint8Array | null {
  const data = files.get(name);
  if (!data) return null;
  if (name.endsWith('.lbm') || (data[0] === 0x46 && data[1] === 0x4f && data[2] === 0x52 && data[3] === 0x4d)) return data.slice(0x30, 0x330);
  if (name.endsWith('.pal')) return new Lib(data, 4, true).item(0)?.slice(idx * 0x300, idx * 0x300 + 0x300) ?? null;
  const buf = data.subarray(idx * 0x240, idx * 0x240 + 0x241);
  const out = new Uint8Array(0x300);
  for (let i = 0; i < 0x100; i++) {
    for (let j = 0; j < 3; j++) {
      const bit = i * 18 + j * 6;
      const b = bit >> 3;
      out[i * 3 + j] = ((((buf[b] ?? 0) | ((buf[b + 1] ?? 0) << 8)) >> (bit & 7)) & 0x3f) << 2;
    }
  }
  return out;
}

/** A picture as RGBA (transparent where the shape has no pixel). */
export function shapeRgba(s: Shape, pal: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(s.w * s.h * 4);
  for (let i = 0; i < s.w * s.h; i++) {
    const c = s.data[i];
    if (c === 0xff) continue;
    out[i * 4] = pal[c * 3];
    out[i * 4 + 1] = pal[c * 3 + 1];
    out[i * 4 + 2] = pal[c * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}
