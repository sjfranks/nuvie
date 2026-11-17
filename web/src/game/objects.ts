/**
 * objects.ts - the things lying about the world and what holds them (Nuvie's Obj.cpp and ObjManager.cpp).
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { F2_BOUNDARY, F3_FORCED_PASSABLE, F3_IGNORE, type Tile, type Tiles } from './tiles.ts';
import { EGG, MD_CONTAINERS, MD_DOORS, STACKABLE, type Kind } from './kind.ts';
import { OBJ } from './u6tables.ts';

export const STATUS_OK_TO_TAKE = 0x01;
export const STATUS_INVISIBLE = 0x02;
export const STATUS_TEMPORARY = 0x20;
const STATUS_LOC_MASK = 0x18;
const STATUS_IN_CONTAINER = 0x08;
const STATUS_IN_INVENTORY = 0x10;
const STATUS_READIED = 0x18;

export type Loc = 'map' | 'cont' | 'inv' | 'readied' | 'none';

export class Obj {
  objN = 0;
  frameN = 0;
  status = 0;
  x = 0;
  y = 0;
  z = 0;
  qty = 0;
  quality = 0;
  loc: Loc = 'none';
  /** What it holds, where it is a container. */
  container: Obj[] | null = null;
  /** The container it is in, or the actor carrying it. */
  parentObj: Obj | null = null;
  holder = -1;
}

const U6_STACKABLE: ReadonlySet<number> = new Set([
  OBJ.LOCK_PICK, OBJ.GEM, OBJ.ARROW, OBJ.BOLT, OBJ.BLACK_PEARL, OBJ.BLOOD_MOSS, OBJ.GARLIC, OBJ.GINSENG,
  OBJ.MANDRAKE_ROOT, OBJ.NIGHTSHADE, OBJ.SPIDER_SILK, OBJ.SULFUROUS_ASH, OBJ.EFFECT, OBJ.BREAD, OBJ.MEAT_PORTION,
  OBJ.FLASK_OF_OIL, OBJ.EGG, OBJ.GOLD_NUGGET, OBJ.ZU_YLEM, OBJ.SNAKE_VENOM, OBJ.GOLD,
]);

const CONTAINERS: ReadonlySet<number> = new Set([
  OBJ.CRATE, OBJ.BARREL, OBJ.CHEST, OBJ.BAG, OBJ.BACKPACK, OBJ.BASKET, OBJ.DRAWER, OBJ.DESK, OBJ.DEAD_BODY,
  OBJ.DEAD_ANIMAL, OBJ.DEAD_CYCLOPS, OBJ.DEAD_GARGOYLE, OBJ.REMAINS, OBJ.EGG,
]);

export const PASS_NO_OBJ = 0;
export const PASS_NOT = 1;
export const PASS_OK = 2;

const width = (z: number): number => (z === 0 ? 1024 : 256);
const key = (x: number, y: number, z: number): number => (z << 20) | (y << 10) | x;

export class Objects {
  /** tile number of each object type's first frame */
  readonly objToTile = new Uint16Array(1024);
  private readonly weight = new Uint8Array(1024);
  /** Everything on the map, by square: lowest first. */
  private readonly at = new Map<number, Obj[]>();
  /** What each actor carries. */
  readonly inventories: Obj[][] = [];

  constructor(
    files: GameFiles,
    readonly tiles: Tiles,
    readonly kind: Kind = 'u6',
  ) {
    const basetile = files.get('basetile');
    if (!basetile) throw new Error('missing game file: basetile');
    for (let i = 0; i < 1024; i++) this.objToTile[i] = basetile[i * 2] | (basetile[i * 2 + 1] << 8);
    const flags = files.get('tileflag')!;
    this.weight.set(flags.subarray(0x1000, 0x1400));
    for (let i = 0; i < 256; i++) this.inventories.push([]);
  }

  isStackable(o: Obj): boolean {
    if (o.loc === 'readied') return false;
    if (this.kind !== 'u6') return STACKABLE[this.kind].has(o.objN);
    if (o.objN === OBJ.TORCH) return o.frameN !== 1;
    return U6_STACKABLE.has(o.objN);
  }

  isContainer(objN: number): boolean {
    if (this.kind === 'md') return MD_CONTAINERS.has(objN);
    if (this.kind === 'se') return false;
    return CONTAINERS.has(objN);
  }

  /** Read one block of objects (a superchunk of the surface, or a dungeon level); returns the bytes read. */
  loadBlock(buf: Uint8Array, start = 0): number {
    let p = start;
    const n = buf[p] | (buf[p + 1] << 8);
    p += 2;
    const list: Obj[] = [];
    for (let i = 0; i < n; i++, p += 8) {
      const o = new Obj();
      o.status = buf[p];
      o.x = buf[p + 1] | ((buf[p + 2] & 0x3) << 8);
      o.y = (buf[p + 2] >> 2) | ((buf[p + 3] & 0xf) << 6);
      o.z = buf[p + 3] >> 4;
      o.objN = buf[p + 4] | ((buf[p + 5] & 0x3) << 8);
      o.frameN = buf[p + 5] >> 2;
      o.qty = buf[p + 6];
      o.quality = buf[p + 7];
      const where = o.status & STATUS_LOC_MASK;
      o.loc = where === STATUS_IN_CONTAINER ? 'cont' : where === STATUS_IN_INVENTORY ? 'inv' : where === STATUS_READIED ? 'readied' : 'map';
      if (this.isStackable(o)) o.qty |= o.quality << 8;
      list.push(o);
      if (o.objN === EGG[this.kind]) o.status |= STATUS_INVISIBLE;
      if (this.isContainer(o.objN)) o.container = [];
      if (o.loc === 'inv' || o.loc === 'readied') {
        o.holder = o.x & 0xff;
        this.inventories[o.holder].push(o);
      } else if (o.loc === 'cont') {
        // Its place is the index, in this block, of what holds it.
        const parent = list[((o.y & 0x3f) << 10) + o.x];
        if (parent) {
          (parent.container ??= []).unshift(o);
          o.parentObj = parent;
        }
      } else this.add(o);
    }
    return p - start;
  }

  list(x: number, y: number, z: number): Obj[] | undefined {
    const w = width(z) - 1;
    return this.at.get(key(x & w, y & w, z));
  }

  /** Put an object on the map at its own x, y, z (on top of what is there, unless `under`). */
  add(o: Obj, under = false): void {
    const k = key(o.x, o.y, o.z);
    let l = this.at.get(k);
    if (!l) this.at.set(k, (l = []));
    if (under) l.unshift(o);
    else l.push(o);
    o.loc = 'map';
    o.parentObj = null;
    o.holder = -1;
  }

  /** Take an object out of wherever it is: the map, a container or an inventory. */
  unlink(o: Obj): void {
    if (o.loc === 'map') {
      const k = key(o.x, o.y, o.z);
      const l = this.at.get(k);
      if (l) {
        const i = l.indexOf(o);
        if (i >= 0) l.splice(i, 1);
        if (l.length === 0) this.at.delete(k);
      }
    } else if (o.loc === 'cont' && o.parentObj?.container) {
      const i = o.parentObj.container.indexOf(o);
      if (i >= 0) o.parentObj.container.splice(i, 1);
    } else if ((o.loc === 'inv' || o.loc === 'readied') && o.holder >= 0) {
      const inv = this.inventories[o.holder];
      const i = inv.indexOf(o);
      if (i >= 0) inv.splice(i, 1);
    }
    o.loc = 'none';
    o.parentObj = null;
    o.holder = -1;
  }

  move(o: Obj, x: number, y: number, z: number): void {
    this.unlink(o);
    o.x = x;
    o.y = y;
    o.z = z;
    this.add(o);
  }

  /** Add to a list, joining a stack of the same thing where there is one. */
  private stackInto(l: Obj[], o: Obj): Obj {
    if (this.isStackable(o)) {
      const same = l.find((s) => s.objN === o.objN && s.frameN === o.frameN && s.quality === o.quality && this.isStackable(s));
      if (same) {
        same.qty += o.qty;
        return same;
      }
    }
    l.unshift(o);
    return o;
  }

  toInventory(o: Obj, actor: number): Obj {
    this.unlink(o);
    const kept = this.stackInto(this.inventories[actor], o);
    if (kept === o) {
      o.loc = 'inv';
      o.holder = actor;
    }
    return kept;
  }

  toContainer(o: Obj, c: Obj): void {
    this.unlink(o);
    const kept = this.stackInto((c.container ??= []), o);
    if (kept === o) {
      o.loc = 'cont';
      o.parentObj = c;
    }
  }

  tileNum(o: Obj): number {
    return this.objToTile[o.objN] + o.frameN;
  }

  tileOf(o: Obj): Tile {
    return this.tiles.original(this.tileNum(o));
  }

  private basedAt(x: number, y: number, z: number, top: boolean): Obj | null {
    const l = this.list(x, y, z);
    if (!l) return null;
    for (let i = 0; i < l.length; i++) {
      const o = l[top ? l.length - 1 - i : i];
      if ((this.tiles.get(this.tileNum(o)).flags3 & F3_IGNORE) !== F3_IGNORE) return o;
    }
    return null;
  }

  /** The object at a square, counting those two squares wide or tall based to its right or below. */
  get(x: number, y: number, z: number, top = true): Obj | null {
    let o = this.basedAt(x, y, z, top);
    if (o) return o;
    o = this.basedAt(x + 1, y + 1, z, top);
    if (o) {
      const t = this.tiles.get(this.tileNum(o));
      if (t.dblWidth && t.dblHeight) return o;
    }
    o = this.basedAt(x, y + 1, z, top);
    if (o && this.tiles.get(this.tileNum(o)).dblHeight) return o;
    o = this.basedAt(x + 1, y, z, top);
    if (o && this.tiles.get(this.tileNum(o)).dblWidth) return o;
    return null;
  }

  /** Each object covering a square, with the tile it shows there. */
  private *covering(x: number, y: number, z: number): Generator<[Obj, number]> {
    const w = width(z) - 1;
    const x2 = (x + 1) & w;
    const y2 = (y + 1) & w;
    for (const [i, j] of [[x, y], [x2, y], [x, y2], [x2, y2]]) {
      const l = this.list(i, j, z);
      if (!l) continue;
      for (let n = l.length - 1; n >= 0; n--) {
        const o = l[n];
        let tn = this.tileNum(o);
        const t = this.tiles.original(tn);
        if (i === x && j === y) yield [o, tn];
        else if (i === x2 && j === y && t.dblWidth) yield [o, tn - 1];
        else if (i === x && j === y2 && t.dblHeight) yield [o, (tn -= t.dblWidth ? 2 : 1)];
        else if (i === x2 && j === y2 && t.dblWidth && t.dblHeight) yield [o, tn - 3];
      }
    }
  }

  isPassable(x: number, y: number, z: number): number {
    let any = false;
    for (const [o, tn] of this.covering(x, y, z)) {
      if (!this.tiles.original(tn).passable) return PASS_NOT;
      if (o.x === x && o.y === y) any = true;
    }
    return any ? PASS_OK : PASS_NO_OBJ;
  }

  isForcedPassable(x: number, y: number, z: number): boolean {
    const l = this.list(x, y, z);
    return !!l && l.some((o) => this.tiles.get(this.tileNum(o)).flags3 & F3_FORCED_PASSABLE);
  }

  isBoundary(x: number, y: number, z: number, flag = F2_BOUNDARY): boolean {
    for (const [, tn] of this.covering(x, y, z)) if (this.tiles.get(tn).flags2 & flag) return true;
    return false;
  }

  /** The tile of the lowest (or top) object showing at a square. */
  tileAt(x: number, y: number, z: number, top: boolean): Tile | null {
    const o = this.get(x, y, z, top);
    if (!o) return null;
    let tn = this.tileNum(o);
    const t = this.tiles.get(tn);
    if (t.dblWidth && o.x === x + 1 && o.y === y) tn--;
    if (t.dblHeight && o.x === x && o.y === y + 1) tn--;
    if (o.x === x + 1 && o.y === y + 1 && t.dblWidth && t.dblHeight) tn -= 2;
    return this.tiles.original(tn);
  }

  isDoor(o: Obj): boolean {
    if (this.kind === 'md') return MD_DOORS.has(o.objN);
    if (this.kind === 'se') return false;
    return o.objN >= OBJ.OAKEN_DOOR && o.objN <= OBJ.STEEL_DOOR;
  }

  /** Whether a door is shut (each game marks it its own way). */
  isShut(o: Obj): boolean {
    return this.kind === 'md' ? !!(o.frameN & 2) : o.frameN > 3;
  }

  look(o: Obj): string {
    return this.tiles.look(this.tileNum(o), this.isStackable(o) ? o.qty : 0);
  }

  name(o: Obj): string {
    return this.tiles.look(this.tileNum(o), this.isStackable(o) ? o.qty : 0, false);
  }

  /** Weight in stones, with what it holds. */
  weightOf(o: Obj): number {
    let w = this.weight[o.objN];
    if (this.isStackable(o)) w = (w * Math.max(1, o.qty)) / 10;
    if (o.container) for (const c of o.container) w += this.weightOf(c) * 10;
    return w / 10;
  }

  create(objN: number, qty: number, quality: number): Obj {
    const o = new Obj();
    o.objN = objN;
    o.qty = qty;
    o.quality = quality;
    o.status = STATUS_OK_TO_TAKE;
    if (this.isContainer(objN)) o.container = [];
    return o;
  }

  /** Every object on the map (for saving). */
  all(): Obj[] {
    const out: Obj[] = [];
    for (const l of this.at.values()) out.push(...l);
    return out;
  }

  clearMap(): void {
    this.at.clear();
    for (const inv of this.inventories) inv.length = 0;
  }
}
