/**
 * tiles.ts - the game's 2048 tiles: their pixels, flags, animation and names (Nuvie's TileManager.cpp and Look.cpp).
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { Lib } from '../files/lib.ts';
import { lzwFile } from '../files/lzw.ts';
import type { Kind } from './kind.ts';

export const NUM_TILES = 2048;

// flags1
export const F1_WALL_NORTH = 0x80;
export const F1_WALL_EAST = 0x40;
export const F1_WALL_SOUTH = 0x20;
export const F1_WALL_WEST = 0x10;
export const F1_WALL_MASK = 0xf0;
export const F1_DAMAGING = 0x08;
export const F1_WALL = 0x04;
export const F1_BLOCKING = 0x02;
export const F1_WATER = 0x01;
// flags2
export const F2_DOUBLE_WIDTH = 0x80;
export const F2_DOUBLE_HEIGHT = 0x40;
export const F2_MISSILE_BOUNDARY = 0x20;
export const F2_TOPTILE = 0x10;
export const F2_WINDOW = 0x08;
export const F2_BOUNDARY = 0x04;
// flags3
export const F3_IGNORE = 0x10;
export const F3_FORCED_PASSABLE = 0x04;
export const F3_CAN_PLACE_ONTOP = 0x02;

const MASK_PLAIN = 0x0;
const MASK_TRANS = 0x5;
const MASK_PBLCK = 0xa;

/** The map tile each of the 32 animated shore tiles (16 to 47) is drawn over. */
const ANIM_SRC_TILE = [
  0x16, 0x16, 0x1a, 0x1a, 0x1e, 0x1e, 0x12, 0x12, 0x1a, 0x1e, 0x16, 0x12, 0x16, 0x1a, 0x1e, 0x12, 0x1a, 0x1e, 0x1e,
  0x12, 0x12, 0x16, 0x16, 0x1a, 0x12, 0x16, 0x1e, 0x1a, 0x1a, 0x1e, 0x12, 0x16,
];

const ARTICLES = ['', 'a ', 'an ', 'the '];

export interface Tile {
  num: number;
  /** 256 palette indices; 0xff is see-through where `transparent`. */
  data: Uint8Array;
  transparent: boolean;
  passable: boolean;
  water: boolean;
  damages: boolean;
  toptile: boolean;
  boundary: boolean;
  dblWidth: boolean;
  dblHeight: boolean;
  flags1: number;
  flags2: number;
  flags3: number;
  article: number;
}

export class Tiles {
  readonly tile: Tile[] = [];
  /** Which tile is shown for each tile number just now (animation swaps these). */
  readonly index = new Uint16Array(NUM_TILES);
  private animCount = 0;
  private readonly animTile = new Uint16Array(32);
  private readonly animFirst = new Uint16Array(32);
  private readonly animMask = new Uint8Array(32);
  private readonly animShift = new Uint8Array(32);
  private readonly animLoop = new Int8Array(32);
  private counter = 0;
  private readonly lookTbl: string[] = [];

  constructor(files: GameFiles, readonly kind: Kind = 'u6') {
    const need = (n: string): Uint8Array => {
      const f = files.get(n);
      if (!f) throw new Error(`missing game file: ${n}`);
      return f;
    };
    // Ultima 6 packs these whole; the other two keep each in a library of one.
    const unpack = (n: string): Uint8Array => (kind === 'u6' ? lzwFile(need(n)) : new Lib(need(n), 4, true).item(0) ?? new Uint8Array(0));
    const maptiles = unpack('maptiles.vga');
    const masktype = unpack('masktype.vga');
    const objtiles = need('objtiles.vga');
    const data = new Uint8Array(maptiles.length + objtiles.length);
    data.set(maptiles);
    data.set(objtiles, maptiles.length);
    const indx = need('tileindx.vga');
    for (let i = 0; i < NUM_TILES; i++) {
      const off = (indx[i * 2] | (indx[i * 2 + 1] << 8)) * 16;
      const t: Tile = {
        num: i, data: new Uint8Array(256), transparent: false, passable: true, water: false, damages: false,
        toptile: false, boundary: false, dblWidth: false, dblHeight: false, flags1: 0, flags2: 0, flags3: 0, article: 0,
      };
      switch (masktype[i]) {
        case MASK_TRANS:
          t.transparent = true;
          t.data.set(data.subarray(off, off + 256));
          break;
        case MASK_PLAIN:
          t.data.set(data.subarray(off, off + 256));
          break;
        case MASK_PBLCK:
          t.transparent = true;
          decodePixelBlock(data, off, t.data);
          break;
      }
      this.tile.push(t);
      this.index[i] = i;
    }
    this.loadAnimData(need('animdata'));
    this.loadFlags(need('tileflag'));
    this.loadLook(kind === 'u6' ? lzwFile(need('look.lzd')) : new Lib(need('look.lzc'), 4, true).item(0) ?? new Uint8Array(0));
    const mask = files.get('animmask.vga');
    if (mask && kind === 'u6') this.loadAnimMask(lzwFile(mask));
  }

  /** The tile shown for `n` just now. */
  get(n: number): Tile {
    return this.tile[this.index[n & 0x7ff]];
  }

  /** The tile `n` itself, whatever is animating. */
  original(n: number): Tile {
    return this.tile[n & 0x7ff];
  }

  /** The water a shore tile (16 to 47) is drawn over. */
  animBase(n: number): Tile {
    return this.tile[this.index[ANIM_SRC_TILE[n - 16] >> 1]];
  }

  private loadFlags(f: Uint8Array): void {
    for (let i = 0; i < NUM_TILES; i++) {
      const t = this.tile[i];
      t.flags1 = f[i];
      t.passable = !(t.flags1 & F1_BLOCKING);
      t.water = !!(t.flags1 & F1_WATER);
      t.damages = !!(t.flags1 & F1_DAMAGING);
      t.flags2 = f[NUM_TILES + i];
      t.toptile = !!(t.flags2 & F2_TOPTILE);
      t.boundary = !!(t.flags2 & (F2_BOUNDARY | F2_WINDOW));
      t.dblHeight = !!(t.flags2 & F2_DOUBLE_HEIGHT);
      t.dblWidth = !!(t.flags2 & F2_DOUBLE_WIDTH);
      t.flags3 = f[0x1400 + i] ?? 0;
      t.article = t.flags3 >> 6;
    }
  }

  private loadAnimData(f: Uint8Array): void {
    if (f.length !== 194) return;
    const r2 = (o: number): number => f[o] | (f[o + 1] << 8);
    this.animCount = Math.min(32, r2(0));
    for (let i = 0; i < 32; i++) {
      this.animTile[i] = r2(2 + i * 2);
      this.animFirst[i] = r2(66 + i * 2);
      this.animMask[i] = f[130 + i];
      this.animShift[i] = f[162 + i];
      // Cranks and chains (862, 1009, 1020) stand still until used.
      const t = this.animTile[i];
      const still =
        this.kind === 'u6'
          ? t === 862 || t === 1009 || t === 1020
          : this.kind === 'md' && ((t >= 1 && t <= 4) || (t >= 16 && t <= 23) || (t >= 616 && t <= 627) || t === 1992 || t === 1993 || t === 1980 || t === 1981);
      this.animLoop[i] = still ? 0 : -1;
    }
  }

  /** The 32 shore tiles from 16 are see-through where animmask.vga says. */
  private loadAnimMask(mask: Uint8Array): void {
    for (let i = 0; i < 32; i++) {
      const t = this.tile[16 + i];
      t.transparent = true;
      let m = i * 64;
      let p = 0;
      let clear = mask[m++];
      t.data.fill(0xff, p, Math.min(256, p + clear));
      p += clear;
      let disp = mask[m];
      clear = mask[m + 1];
      m += 2;
      for (; disp !== 0 && clear !== 0 && p < 256; m += 2) {
        p += disp;
        t.data.fill(0xff, p, Math.min(256, p + clear));
        p += clear;
        disp = mask[m];
        clear = mask[m + 1];
      }
    }
  }

  private loadLook(d: Uint8Array): void {
    let p = 0;
    let j = 0;
    while (p + 2 <= d.length) {
      const i = d[p] | (d[p + 1] << 8);
      if (i >= NUM_TILES) break;
      let e = p + 2;
      while (e < d.length && d[e] !== 0) e++;
      const s = String.fromCharCode(...d.subarray(p + 2, e));
      p = e + 1;
      for (; j <= i; j++) this.lookTbl[j] = s;
    }
    for (; j < NUM_TILES; j++) this.lookTbl[j] = this.lookTbl[0] ?? 'nothing';
  }

  /** One step of the tile animation; `hour` turns the sundial. */
  update(hour: number): void {
    for (let i = 0; i < this.animCount; i++) {
      const t = this.animTile[i];
      if (this.animLoop[i] !== 0) {
        const frame = (this.counter & this.animMask[i]) >> this.animShift[i];
        this.index[t] = this.index[(this.animFirst[i] + frame) & 0x7ff];
      } else this.index[t] = this.index[this.animFirst[i] & 0x7ff];
    }
    this.counter = (this.counter + 1) & 0xffff;
    if (this.kind === 'u6') this.index[861] = hour >= 5 && hour <= 20 ? 328 + ((hour - 5) >> 1) : 861;
  }

  /** A tile's name; `plural` picks between "loaf/loaves" forms ("\" plural, "/" singular in the file). */
  describe(tileNum: number, plural: boolean): { text: string; hasPlural: boolean } {
    const desc = this.lookTbl[tileNum & 0x7ff] ?? '';
    let out = '';
    let hasPlural = false;
    for (let i = 0; i < desc.length; ) {
      const c = desc[i];
      if (c === '\\' || c === '/') {
        hasPlural = true;
        for (i++; i < desc.length && /[a-zA-Z]/.test(desc[i]); i++) {
          if ((plural && c === '\\') || (!plural && c === '/')) out += desc[i];
        }
      } else {
        out += c;
        i++;
      }
    }
    return { text: out, hasPlural };
  }

  /** "a loaf of bread", "3 loaves of bread", "the sextant". */
  look(tileNum: number, qty: number, prefix = true): string {
    const { text, hasPlural } = this.describe(tileNum, qty > 1);
    if (!prefix) return text;
    if (qty > 0 && (hasPlural || this.kind === 'se')) return `${qty} ${text}`;
    return ARTICLES[this.original(tileNum).article] + text;
  }
}

/** A tile stored as runs of pixels with gaps between (masktype 0xA). */
function decodePixelBlock(src: Uint8Array, off: number, out: Uint8Array): void {
  out.fill(0xff);
  let p = off + 1;
  let o = 0;
  for (;;) {
    const disp = src[p] | (src[p + 1] << 8);
    const x = (disp % 160) + (disp >= 1760 ? 160 : 0);
    const len = src[p + 2];
    if (len === 0 || len === undefined) break;
    o += x;
    for (let k = 0; k < len && o + k < 256; k++) out[o + k] = src[p + 3 + k];
    o += len;
    p += 3 + len;
  }
}
