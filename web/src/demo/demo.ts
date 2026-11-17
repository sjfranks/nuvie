/**
 * demo.ts - a small world of this port's own, written out in the game's file formats: an island village with a few
 * people to talk to, doors, a chest, a sign and a cellar. It is here so the engine can be tried, and tested, without
 * anyone's copy of a game - every tile, name and word in it is made for this, and none of it comes from one.
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { buildLib } from '../files/lib.ts';
import { lzwCompress } from '../files/lzw.ts';
import { OBJ } from '../game/u6tables.ts';

// ---- colours ----
const C = {
  black: 0, grass: 1, grass2: 2, water: 3, water2: 4, dirt: 5, dirt2: 6, sand: 7, stone: 8, stone2: 9, wood: 10,
  wood2: 11, leaf: 12, leaf2: 13, trunk: 14, skin: 15, white: 16, red: 17, blue: 18, yellow: 19, purple: 20,
  grey: 21, dark: 22, gold: 23, cream: 24, green: 25, hair: 26, orange: 27,
} as const;
const RGB: [number, number, number][] = [
  [0, 0, 0], [58, 130, 60], [72, 150, 70], [40, 90, 170], [70, 120, 200], [150, 112, 70], [130, 96, 58],
  [220, 200, 140], [140, 140, 150], [110, 110, 122], [150, 100, 55], [120, 78, 40], [34, 100, 44], [50, 124, 56],
  [96, 64, 36], [232, 184, 140], [240, 240, 240], [190, 50, 50], [60, 80, 190], [230, 200, 60], [130, 70, 160],
  [170, 170, 180], [40, 40, 50], [240, 190, 40], [240, 225, 190], [40, 160, 90], [90, 60, 30], [220, 130, 40],
];

type Paint = (x: number, y: number) => number;
const T = 0xff; // see-through
/** A stable scatter for texture. */
const noise = (x: number, y: number, s: number): number => ((x * 73856093) ^ (y * 19349663) ^ (s * 83492791)) >>> 0;

const ground = (a: number, b: number, s: number, every = 7): Paint => (x, y) => (noise(x, y, s) % every === 0 ? b : a);
const wall: Paint = (x, y) => (y % 4 === 3 || (x + (y >> 2) * 4) % 8 === 7 ? C.stone2 : C.stone);
const windowWall: Paint = (x, y) => (x > 3 && x < 12 && y > 3 && y < 11 ? (x === 7 || x === 8 || y === 7 ? C.wood2 : C.water2) : wall(x, y));
const floor: Paint = (x, y) => (y % 8 === 7 || (x + (y >> 3) * 4) % 8 === 0 ? C.wood2 : C.wood);
const tree: Paint = (x, y) => {
  const d = (x - 7.5) ** 2 + (y - 6) ** 2;
  if (d < 30) return noise(x, y, 3) % 3 === 0 ? C.leaf2 : C.leaf;
  if (x >= 7 && x <= 8 && y >= 10) return C.trunk;
  return ground(C.grass, C.grass2, 1)(x, y);
};
const doorOpen: Paint = (x, y) => (x < 3 ? (y % 5 === 0 ? C.dark : C.wood2) : T);
const door = (lock: number): Paint => (x, y) => {
  if (x === 0 || x === 15 || y === 0) return C.wood2;
  if (x === 12 && y >= 7 && y <= 8) return lock;
  return x % 4 === 0 ? C.wood2 : C.wood;
};
const sign: Paint = (x, y) => (y >= 3 && y <= 9 && x >= 2 && x <= 13 ? (y === 5 || y === 7 ? (x > 3 && x < 12 ? C.dark : C.cream) : C.cream) : x >= 7 && x <= 8 && y > 9 ? C.trunk : T);
const book: Paint = (x, y) => (x >= 4 && x <= 11 && y >= 5 && y <= 12 ? (x === 4 ? C.dark : y === 7 && x > 5 && x < 11 ? C.gold : C.purple) : T);
const chest = (open: boolean): Paint => (x, y) => {
  if (x < 2 || x > 13 || y < 4 || y > 13) return T;
  if (open && y < 7) return y === 4 ? C.wood2 : C.dark;
  if (y === 8 || x === 2 || x === 13) return C.wood2;
  return x >= 7 && x <= 8 && y >= 8 && y <= 10 ? C.gold : C.wood;
};
const ladder = (up: boolean): Paint => (x, y) => {
  if (!up && (x < 2 || x > 13 || y < 2 || y > 13)) return T;
  if (x === 5 || x === 10) return C.trunk;
  if (x > 5 && x < 10 && y % 4 === 1) return C.wood;
  return up ? T : C.black;
};
const bread: Paint = (x, y) => ((x - 7.5) ** 2 / 30 + (y - 9) ** 2 / 9 < 1 ? (y === 8 && x % 3 === 0 ? C.cream : C.orange) : T);
const coins: Paint = (x, y) => ((x - 6) ** 2 + (y - 10) ** 2 < 7 || (x - 10) ** 2 + (y - 8) ** 2 < 7 ? (noise(x, y, 5) % 4 === 0 ? C.yellow : C.gold) : T);
const keyPaint: Paint = (x, y) => ((x - 5) ** 2 + (y - 8) ** 2 < 8 && (x - 5) ** 2 + (y - 8) ** 2 > 1.5 ? C.gold : y === 8 && x > 6 && x < 13 ? C.gold : (x === 11 || x === 12) && y === 9 ? C.gold : T);
const barrel: Paint = (x, y) => (x < 4 || x > 11 || y < 3 || y > 13 ? T : y === 5 || y === 11 ? C.grey : x === 4 || x === 11 ? C.wood2 : C.wood);

/** A small figure: `dir` 0 north, 1 east, 2 south, 3 west; `step` moves the feet. */
const person = (tunic: number, hair: number, hat: number | null, dir: number, step: number): Paint => (x, y) => {
  const head = (x - 7.5) ** 2 + (y - 4) ** 2 < 9;
  if (hat !== null && y <= 2 && x >= 4 && x <= 11) return hat;
  if (head) {
    if (dir === 0) return hair;
    if (y <= 2) return hair;
    if (y === 4) {
      if (dir === 2 && (x === 6 || x === 9)) return C.dark;
      if (dir === 1 && x === 9) return C.dark;
      if (dir === 3 && x === 6) return C.dark;
    }
    if ((dir === 1 && x < 6) || (dir === 3 && x > 9)) return hair;
    return C.skin;
  }
  if (y >= 7 && y <= 11 && x >= 5 && x <= 10) return y === 9 ? C.dark : tunic;
  if (y >= 7 && y <= 10 && (x === 4 || x === 11)) return dir === 0 || dir === 2 ? C.skin : tunic;
  if (y >= 12 && y <= 14) {
    const l = step === 1 ? 1 : 0;
    const r = step === 2 ? 1 : 0;
    if ((x === 6 || x === 5) && y <= 14 - l) return C.dark;
    if ((x === 9 || x === 10) && y <= 14 - r) return C.dark;
  }
  return T;
};

// ---- tiles ----
const MAP = { nothing: 0, grass: 1, flowers: 2, water: 3, path: 4, tree: 5, stone: 6, floor: 7, sand: 8, wall: 200, window: 201, rock: 202 } as const;
const TILE = { door: 512, sign: 540, book: 541, chest: 544, ladder: 550, bread: 552, gold: 553, key: 554, barrel: 555, avatar: 600, villager: 616, merchant: 632, woman: 648, guard: 664 } as const;

interface TileDef {
  paint: Paint;
  f1?: number;
  f2?: number;
  f3?: number;
  name: string;
  article?: number;
}

function tileDefs(): Map<number, TileDef> {
  const t = new Map<number, TileDef>();
  t.set(MAP.nothing, { paint: () => C.black, name: 'nothing' });
  t.set(MAP.grass, { paint: ground(C.grass, C.grass2, 1), name: 'grass' });
  t.set(MAP.flowers, { paint: (x, y) => (noise(x, y, 9) % 23 === 0 ? C.yellow : noise(x, y, 4) % 29 === 0 ? C.red : ground(C.grass, C.grass2, 1)(x, y)), name: 'flowers' });
  t.set(MAP.water, { paint: (x, y) => ((y + (x >> 2)) % 5 === 0 && noise(x >> 2, y, 2) % 2 === 0 ? C.water2 : C.water), f1: 0x03, name: 'water' });
  t.set(MAP.path, { paint: ground(C.dirt, C.dirt2, 6, 5), name: 'path', article: 1 });
  t.set(MAP.tree, { paint: tree, f1: 0x02, name: 'tree', article: 1 });
  t.set(MAP.stone, { paint: ground(C.stone, C.stone2, 8, 6), name: 'stone floor', article: 1 });
  t.set(MAP.floor, { paint: floor, name: 'wooden floor', article: 1 });
  t.set(MAP.sand, { paint: ground(C.sand, C.cream, 10, 9), name: 'sand' });
  t.set(MAP.wall, { paint: wall, f1: 0x02, f2: 0x04, name: 'stone wall', article: 1 });
  t.set(MAP.window, { paint: windowWall, f1: 0x02, f2: 0x08, name: 'window', article: 1 });
  t.set(MAP.rock, { paint: ground(C.stone2, C.dark, 12, 4), f1: 0x02, f2: 0x04, name: 'solid rock' });
  for (let f = 0; f < 16; f++) {
    const open = f < 4;
    t.set(TILE.door + f, {
      paint: open ? doorOpen : door(f >= 12 ? C.purple : f >= 8 ? C.gold : C.dark),
      f1: open ? 0 : 0x02, f2: open ? 0 : 0x04, name: 'door', article: 1,
    });
  }
  t.set(TILE.sign, { paint: sign, f1: 0x02, name: 'sign', article: 1 });
  t.set(TILE.book, { paint: book, name: 'book', article: 1 });
  t.set(TILE.chest, { paint: chest(true), f1: 0x02, name: 'chest', article: 1 });
  for (let f = 1; f < 4; f++) t.set(TILE.chest + f, { paint: chest(false), f1: 0x02, name: 'chest', article: 1 });
  t.set(TILE.ladder, { paint: ladder(false), name: 'ladder', article: 1 });
  t.set(TILE.ladder + 1, { paint: ladder(true), name: 'ladder', article: 1 });
  t.set(TILE.bread, { paint: bread, name: 'loa/f\\ves of bread', article: 1 });
  t.set(TILE.gold, { paint: coins, name: 'gold coin\\s', article: 1 });
  t.set(TILE.key, { paint: keyPaint, name: 'key', article: 1 });
  t.set(TILE.barrel, { paint: barrel, f1: 0x02, name: 'barrel', article: 1 });
  const folk: [number, number, number, number | null, string, number][] = [
    [TILE.avatar, C.blue, C.hair, null, 'traveller', 1],
    [TILE.villager, C.green, C.orange, null, 'fisherman', 1],
    [TILE.merchant, C.white, C.hair, C.white, 'baker', 1],
    [TILE.woman, C.purple, C.grey, null, 'old woman', 2],
    [TILE.guard, C.red, C.dark, C.grey, 'watchman', 1],
  ];
  for (const [base, tunic, hair, hat, name, article] of folk) {
    for (let d = 0; d < 4; d++) for (let s = 0; s < 4; s++) t.set(base + d * 4 + s, { paint: person(tunic, hair, hat, d, s % 3), name, article });
  }
  return t;
}

// ---- conversations ----
class Script {
  private readonly b: number[] = [];
  private readonly fix: [number, string][] = [];
  private readonly labels = new Map<string, number>();
  constructor(n: number, name: string, desc: string) {
    this.b.push(0xff, n);
    this.t(name);
    this.b.push(0xf1);
    this.t(desc);
    this.b.push(0xf2);
  }
  t(s: string): this {
    for (const c of s) this.b.push(c.charCodeAt(0));
    return this;
  }
  op(...bytes: number[]): this {
    this.b.push(...bytes);
    return this;
  }
  /** A number as an argument, worked out. */
  static n(v: number): number[] {
    return [0xd3, v & 0xff, 0xa7];
  }
  label(name: string): this {
    this.labels.set(name, this.b.length);
    return this;
  }
  jump(name: string): this {
    this.b.push(0xb0);
    this.fix.push([this.b.length, name]);
    this.b.push(0, 0, 0, 0);
    return this;
  }
  ask(): this {
    return this.op(0xf7);
  }
  on(keys: string): this {
    this.b.push(0xef);
    this.t(keys);
    this.b.push(0xf6);
    return this;
  }
  /** if flag `f` of the speaker is set */
  ifFlag(f: number): this {
    return this.op(0xa1, 0xd3, 0xeb, 0xd3, f, 0xab, 0xa7);
  }
  setFlag(f: number): this {
    return this.op(0xa4, 0xd3, 0xeb, 0xa7, 0xd3, f, 0xa7);
  }
  give(obj: number, qty: number, quality = 0): this {
    return this.op(0xb9, ...Script.n(1), 0xd4, obj & 0xff, obj >> 8, 0xa7, ...Script.n(quality), ...Script.n(qty));
  }
  bytes(packed: boolean): Uint8Array {
    const out = Uint8Array.from(this.b);
    for (const [at, name] of this.fix) new DataView(out.buffer).setUint32(at, this.labels.get(name)!, true);
    if (packed) return lzwCompress(out);
    const raw = new Uint8Array(out.length + 4);
    raw.set(out, 4);
    return raw;
  }
}

const NPC = { baker: 2, fisher: 3, elder: 4, watch: 5 } as const;

function scripts(): (Uint8Array | null)[] {
  const items: (Uint8Array | null)[] = new Array(8).fill(null);
  const main = (s: Script): Script => s.label('main').ask();
  const end = (s: Script, other: string): Script => s.on('bye').t('"Fair winds to thee."\n').op(0xb6).on('*').t(other + '\n').op(0xee).jump('main');

  let s = new Script(NPC.baker, 'Tobble', 'a round man dusted with flour.');
  s.ifFlag(0).t('"Back again, $P! The oven is hot."\n').op(0xa3).t('"Welcome to Saltmere, stranger. I am Tobble."\n').setFlag(0).op(0xa2);
  main(s).on('name').t('"Tobble. I @bake for the whole island."\n')
    .on('job').t('"I @bake! Up before the sun, every day. Wouldst thou like a @loaf?"\n')
    .on('bake,oven').t('"The secret is sea salt and patience.*Mostly patience. The @elder says my crusts could shingle a roof."\n')
    .on('elde,mira').t('"Old Mira, in the house with the windows. She keeps the island\'s @stories."\n')
    .on('stor').t('"Ask her thyself. I only know dough."\n')
    .on('loaf,brea').t('"Fresh this morning. Art thou hungry?"\n').jump('hungry');
  end(s, '"I know naught of that. Ask me of my @job."');
  s.label('hungry').ask()
    .on('y').ifFlag(1).t('"One a day is charity; two is a business."\n').op(0xa3).t('"Here, then. No charge for a new face."\n').give(OBJ.BREAD, 1).setFlag(1).op(0xa2)
    .on('n').t('"Thy loss!"\n').on('*').t('"A simple yes or no will do."\n').op(0xee).jump('main');
  items[NPC.baker] = s.bytes(false);

  s = new Script(NPC.fisher, 'Corwen', 'a wiry fisherman mending a net.');
  s.t('"Mind the net."\n');
  main(s).on('name').t('"Corwen."\n')
    .on('job').t('"I @fish. When the @cellar is not flooding."\n')
    .on('fish').t('"Herring, mostly. They bite at dawn."\n')
    .on('cell').t('"Under the stone shed, north of here. The @watchman keeps it locked."\n')
    .on('watc,key').t('"Brann lost his own key years ago. They say the @elder has the spare, in her chest."\n')
    .on('elde').t('"East house. Knock first."\n');
  end(s, '"Hm?"');
  items[NPC.fisher] = s.bytes(true);

  s = new Script(NPC.elder, 'Mira', 'an old woman with sharp grey eyes.');
  s.ifFlag(0).t('"Sit, $P."\n').op(0xa3).t('"A traveller! It has been long since Saltmere had one. I am Mira."\n').setFlag(0).op(0xa2);
  main(s).on('name').t('"Mira. I have been @elder here longer than the lighthouse has stood."\n')
    .on('job,elde').t('"I remember things, so that the island need not. Its @stories, its debts."\n')
    .on('stor').t('"They say the first settlers hid something in the @cellar before the great storm.*I say they hid turnips. But go and look, if thou wilt."\n')
    .on('cell,key,ches').t('"The spare key is in my chest. Take it; the watchman will not mind what he does not notice."\n')
    .on('stor').t('"Thou hast heard it."\n');
  end(s, '"Speak up, child."');
  items[NPC.elder] = s.bytes(false);

  s = new Script(NPC.watch, 'Brann', 'a watchman leaning on his spear.');
  s.t('"Halt. Well, carry on."\n');
  main(s).on('name').t('"Brann."\n').on('job').t('"I watch the @shed. Nobody goes in. Not that anyone tries."\n')
    .on('shed,cell').t('"Locked. I had a @key once."\n').on('key').t('"...I would rather not speak of it."\n');
  end(s, '"Not my concern."');
  items[NPC.watch] = s.bytes(true);
  return items;
}

// ---- the world ----
const CX = 320;
const CY = 320;

export function buildDemo(): GameFiles {
  const files: GameFiles = new Map();
  const defs = tileDefs();

  // palette (6 bits a channel)
  const pal = new Uint8Array(768);
  RGB.forEach(([r, g, b], i) => pal.set([r >> 2, g >> 2, b >> 2], i * 3));
  files.set('u6pal', pal);

  // tiles
  const nums = [...defs.keys()].sort((a, b) => a - b);
  const pixels = new Uint8Array(nums.length * 256);
  const indx = new Uint8Array(4096);
  const masktype = new Uint8Array(2048);
  const flags = new Uint8Array(0x1c00);
  const look: number[] = [];
  nums.forEach((n, i) => {
    const d = defs.get(n)!;
    let trans = false;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const c = d.paint(x, y);
        if (c === T) trans = true;
        pixels[i * 256 + y * 16 + x] = c;
      }
    }
    indx[n * 2] = (i * 16) & 0xff;
    indx[n * 2 + 1] = (i * 16) >> 8;
    masktype[n] = trans ? 5 : 0;
    flags[n] = d.f1 ?? 0;
    flags[2048 + n] = d.f2 ?? 0;
    flags[0x1400 + n] = (d.f3 ?? 0) | ((d.article ?? 0) << 6);
    // Names are given for the last tile of a run that shares one.
    const nextName = defs.get(nums[i + 1])?.name;
    if (nextName !== d.name || nums[i + 1] !== n + 1) look.push(n & 0xff, n >> 8, ...[...d.name].map((c) => c.charCodeAt(0)), 0);
  });
  look.push(0xff, 0xff, 0);
  files.set('maptiles.vga', lzwCompress(pixels));
  files.set('objtiles.vga', new Uint8Array(16));
  files.set('masktype.vga', lzwCompress(masktype));
  files.set('tileindx.vga', indx);
  files.set('look.lzd', lzwCompress(Uint8Array.from(look)));
  files.set('animdata', new Uint8Array(194));
  files.set('animmask.vga', lzwCompress(new Uint8Array(2048)));

  // which tile each kind of object starts at, and what it weighs (tenths of a stone)
  const basetile = new Uint8Array(2048);
  const objTile: [number, number, number][] = [
    [OBJ.OAKEN_DOOR, TILE.door, 255], [OBJ.SIGN, TILE.sign, 255], [OBJ.BOOK, TILE.book, 10], [OBJ.CHEST, TILE.chest, 200],
    [OBJ.LADDER, TILE.ladder, 255], [OBJ.BREAD, TILE.bread, 2], [OBJ.GOLD, TILE.gold, 1], [OBJ.KEY, TILE.key, 1],
    [OBJ.BARREL, TILE.barrel, 255], [OBJ.AVATAR, TILE.avatar, 0], [OBJ.VILLAGER, TILE.villager, 0],
    [OBJ.MERCHANT, TILE.merchant, 0], [OBJ.WOMAN, TILE.woman, 0], [OBJ.GUARD, TILE.guard, 0],
  ];
  for (const [o, t, w] of objTile) {
    basetile[o * 2] = t & 0xff;
    basetile[o * 2 + 1] = t >> 8;
    flags[0x1000 + o] = w;
  }
  files.set('basetile', basetile);
  files.set('tileflag', flags);

  // the surface: sea, an island, a village
  const surf = new Uint8Array(1024 * 1024).fill(MAP.water);
  const set = (x: number, y: number, t: number): void => void (surf[y * 1024 + x] = t);
  for (let y = CY - 30; y <= CY + 30; y++) {
    for (let x = CX - 30; x <= CX + 30; x++) {
      const d = Math.hypot((x - CX) / 1.2, y - CY) + (noise(x >> 1, y >> 1, 7) % 3);
      if (d < 20) set(x, y, noise(x, y, 11) % 17 === 0 ? MAP.flowers : noise(x, y, 13) % 13 === 0 && d > 9 ? MAP.tree : MAP.grass);
      else if (d < 23) set(x, y, MAP.sand);
    }
  }
  const objs: number[][] = []; // [status, x, y, z, objN, frame, qty, quality, parent index]
  const obj = (x: number, y: number, z: number, objN: number, frame = 0, qty = 0, quality = 0, status = 0): number => objs.push([status, x, y, z, objN, frame, qty, quality, -1]) - 1;
  const inside = (parent: number, objN: number, qty = 0, quality = 0): void => void objs.push([0x09, 0, 0, 0, objN, 0, qty, quality, parent]);
  /** A house: walls round a floor, a door in the south wall, windows either side of it. */
  const house = (x0: number, y0: number, w: number, h: number, floorTile: number, doorFrame: number, quality = 0): void => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const edge = x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1;
        set(x, y, edge ? MAP.wall : floorTile);
      }
    }
    const dx = x0 + (w >> 1);
    set(dx, y0 + h - 1, floorTile);
    obj(dx, y0 + h - 1, 0, OBJ.OAKEN_DOOR, doorFrame, 0, quality);
    if (w >= 7) {
      set(dx - 2, y0 + h - 1, MAP.window);
      set(dx + 2, y0 + h - 1, MAP.window);
    }
    for (let y = y0 + h; y <= CY + 2; y++) set(dx, y, MAP.path);
  };
  for (let x = CX - 14; x <= CX + 14; x++) set(x, CY + 2, MAP.path);
  for (let y = CY + 2; y <= CY + 12; y++) set(CX, y, MAP.path);
  house(CX - 13, CY - 7, 7, 6, MAP.floor, 5); // the bakery
  house(CX + 6, CY - 7, 9, 6, MAP.floor, 5); // the elder's
  house(CX - 2, CY - 12, 5, 5, MAP.stone, 9, 7); // the shed, locked: key 7
  obj(CX - 11, CY - 5, 0, OBJ.BARREL);
  obj(CX - 8, CY - 5, 0, OBJ.BREAD, 0, 3, 0);
  const chestI = obj(CX + 12, CY - 5, 0, OBJ.CHEST, 1);
  inside(chestI, OBJ.KEY, 0, 7);
  inside(chestI, OBJ.GOLD, 25, 0);
  obj(CX + 8, CY - 5, 0, OBJ.BOOK, 0, 0, 2);
  obj(CX + 1, CY + 5, 0, OBJ.SIGN, 0, 0, 1);
  obj(CX + 3, CY + 9, 0, OBJ.GOLD, 0, 5, 0, 0x01);
  // the cellar, under the shed
  const LX = CX;
  const LY = CY - 10;
  const dx0 = (LX & 7) | ((LX >> 2) & 0xf8);
  const dy0 = (LY & 7) | ((LY >> 2) & 0xf8);
  obj(LX, LY, 0, OBJ.LADDER, 0);
  const dng = new Uint8Array(256 * 256).fill(MAP.rock);
  for (let y = dy0 - 3; y <= dy0 + 4; y++) for (let x = dx0 - 4; x <= dx0 + 4; x++) dng[(y & 255) * 256 + (x & 255)] = MAP.stone;
  obj(dx0, dy0, 1, OBJ.LADDER, 1, 0, ((LX >> 3) & 3) | (((LY >> 3) & 3) << 2));
  const hoard = obj(dx0 + 3, dy0 + 3, 1, OBJ.CHEST, 1);
  inside(hoard, OBJ.GOLD, 120, 0);
  inside(hoard, OBJ.BOOK, 0, 3);
  obj(dx0 - 3, dy0 - 2, 1, OBJ.BARREL);
  obj(dx0 - 2, dy0 - 2, 1, OBJ.BARREL);

  // chunks and the map of them
  const chunkOf = new Map<string, number>();
  const chunkData: number[] = [];
  const chunkNum = (src: Uint8Array, pitch: number, x: number, y: number): number => {
    const bytes: number[] = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) bytes.push(src[(y + j) * pitch + x + i]);
    const k = bytes.join(',');
    let n = chunkOf.get(k);
    if (n === undefined) {
      n = chunkOf.size;
      chunkOf.set(k, n);
      chunkData.push(...bytes);
    }
    return n;
  };
  const mapBytes: number[] = [];
  const pack = (src: Uint8Array, pitch: number, wx: number, wy: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j += 2) {
        const c1 = chunkNum(src, pitch, wx + j * 8, wy + i * 8);
        const c2 = chunkNum(src, pitch, wx + (j + 1) * 8, wy + i * 8);
        mapBytes.push(c1 & 0xff, (c1 >> 8) | ((c2 & 0xf) << 4), c2 >> 4);
      }
    }
  };
  for (let sc = 0; sc < 64; sc++) pack(surf, 1024, (sc % 8) * 128, (sc >> 3) * 128, 16);
  pack(dng, 256, 0, 0, 32);
  const solid = new Uint8Array(256 * 256).fill(MAP.rock);
  for (let l = 1; l < 5; l++) pack(solid, 256, 0, 0, 32);
  files.set('map', Uint8Array.from(mapBytes));
  files.set('chunks', Uint8Array.from(chunkData));

  // objects, a block for each superchunk of the surface and each level below
  const blockOf = (o: number[]): number => (o[3] === 0 ? (o[2] >> 7) * 8 + (o[1] >> 7) : 63 + o[3]);
  const blocks: number[][][] = Array.from({ length: 69 }, () => []);
  const placeIn = new Map<number, [number, number]>();
  objs.forEach((o, i) => {
    const b = o[8] >= 0 ? placeIn.get(o[8])![0] : blockOf(o);
    placeIn.set(i, [b, blocks[b].length]);
    blocks[b].push(o);
  });
  const enc = (o: number[]): number[] => {
    let [, x, y] = o;
    if (o[8] >= 0) {
      const at = placeIn.get(o[8])![1];
      x = at & 0x3ff;
      y = at >> 10;
    }
    return [o[0], x & 0xff, ((x >> 8) & 3) | ((y & 0x3f) << 2), ((y >> 6) & 0xf) | (o[3] << 4), o[4] & 0xff, ((o[4] >> 8) & 3) | (o[5] << 2), o[6] & 0xff, o[7]];
  };
  const blockBytes = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let b = from; b < to; b++) {
      out.push(blocks[b].length & 0xff, blocks[b].length >> 8);
      for (const o of blocks[b]) out.push(...enc(o));
    }
    return out;
  };

  // the objlist: everyone's place and numbers, the party and the clock
  const ol = new Uint8Array(0x1c80);
  const who: [number, number, number, number, number, number][] = [
    // id, x, y, objN, direction, worktype
    [1, CX, CY + 6, OBJ.AVATAR, 0, 0x02],
    [NPC.baker, CX - 10, CY - 4, OBJ.MERCHANT, 2, 0x8f],
    [NPC.fisher, CX - 6, CY + 10, OBJ.VILLAGER, 2, 0x8f],
    [NPC.elder, CX + 10, CY - 4, OBJ.WOMAN, 2, 0x89],
    [NPC.watch, CX + 1, CY - 7, OBJ.GUARD, 2, 0x89],
  ];
  for (const [id, x, y, objN, dir, wt] of who) {
    ol.set([x & 0xff, ((x >> 8) & 3) | ((y & 0x3f) << 2), (y >> 6) & 0xf], 0x100 + id * 3);
    ol.set([objN & 0xff, ((objN >> 8) & 3) | ((dir * 4) << 2)], 0x400 + id * 2);
    ol[0x900 + id] = 16;
    ol[0xa00 + id] = 15;
    ol[0xb00 + id] = 14;
    ol[0xe00 + id] = 60;
    ol[0xff1 + id] = 2;
    ol[0x11f1 + id] = wt;
    ol[0x13f1 + id] = 10;
  }
  [...'Wanderer'].forEach((c, i) => (ol[0xf00 + i] = c.charCodeAt(0)));
  ol[0xfe0] = 1;
  ol[0xff0] = 1;
  ol[0x1bf3] = 30; // 9:30
  ol[0x1bf4] = 9;
  ol[0x1bf5] = 4;
  ol[0x1bf6] = 7;
  ol[0x1bf7] = 161;
  ol[0x1bf9] = 75;
  ol[0x1c6a] = 0xff;
  files.set('lzobjblk', lzwCompress(Uint8Array.from(blockBytes(0, 64))));
  files.set('lzdngblk', lzwCompress(Uint8Array.from([...blockBytes(64, 69), ...ol])));

  // the day's round: the baker goes home at night, the fisherman to the shore at dawn
  const sched: [number, [number, number, number, number][]][] = [
    [NPC.baker, [[6, 0x8f, CX - 10, CY - 4], [20, 0x89, CX - 8, CY - 3]]],
    [NPC.fisher, [[5, 0x8f, CX - 6, CY + 12], [19, 0x8f, CX - 4, CY + 4]]],
  ];
  const offs = new Uint8Array(514);
  const entries: number[] = [];
  let count = 0;
  for (let i = 0; i < 256; i++) {
    offs[i * 2] = count & 0xff;
    offs[i * 2 + 1] = count >> 8;
    for (const [hour, wt, x, y] of sched.find((s) => s[0] === i)?.[1] ?? []) {
      entries.push(hour, wt, x & 0xff, ((x >> 8) & 3) | ((y & 0x3f) << 2), (y >> 6) & 0xf);
      count++;
    }
  }
  offs[512] = count;
  files.set('schedule', Uint8Array.from([...offs, ...entries]));

  files.set('converse.a', buildLib(scripts(), 4));
  files.set('converse.b', buildLib([null], 4));
  const text = (s: string): Uint8Array => Uint8Array.from([...[...s].map((c) => c.charCodeAt(0)), 0]);
  files.set('book.dat', buildLib([
    text('SALTMERE\nBakery west, elder east.\nThe shed is not for visitors.'),
    text('A Ledger of Saltmere\n\nOwed to the baker: nine herring.\nOwed to the sea: everything else.'),
    text('To whoever finds this: the turnips were a joke. The coin is real. Spend it on bread.'),
  ], 2));
  return files;
}
