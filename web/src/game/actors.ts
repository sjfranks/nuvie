/**
 * actors.ts - everyone in the world: where they are, what they look like, their numbers and their day's schedule
 * (Nuvie's actors/Actor.cpp, ActorManager.cpp and U6Actor.cpp).
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { OFFSETS, type Kind } from './kind.ts';
import { ACTOR_TYPES } from './u6tables.ts';

export const NUM_ACTORS = 256;
export const STATUS_DEAD = 0x10;
export const STATUS_IN_PARTY = 0x80;
export const STATUS_POISONED = 0x08;
export const STATUS_ASLEEP = 0x04;

export const WT = {
  MOTIONLESS: 0x00, IN_PARTY: 0x01, PLAYER: 0x02, ANIMAL_WANDER: 0x0c, IMMOBILE: 0x0e, GUARD_EW: 0x0f, GUARD_NS: 0x10,
  WALK_TO_LOCATION: 0x86, FACE_NORTH: 0x87, FACE_EAST: 0x88, FACE_SOUTH: 0x89, FACE_WEST: 0x8a, WALK_NS: 0x8b,
  WALK_EW: 0x8c, WANDER: 0x8f, WORK: 0x90, SLEEP: 0x91,
} as const;

export interface Schedule {
  hour: number;
  dayOfWeek: number;
  worktype: number;
  x: number;
  y: number;
  z: number;
}

interface ActorType {
  framesPerDir: number;
  tilesPerDir: number;
  tilesPerFrame: number;
  tileStart: number;
}

const TYPES = new Map<number, ActorType>();
for (const r of ACTOR_TYPES) {
  if (!TYPES.has(r[0] as number)) TYPES.set(r[0] as number, { framesPerDir: r[1] as number, tilesPerDir: r[2] as number, tilesPerFrame: r[3] as number, tileStart: r[4] as number });
}
/** Creatures two squares long, their back half a square behind them (U6Actor::init_splitactor). */
export const SPLIT: ReadonlySet<number> = new Set([426, 427, 428, 429, 430, 431]);
export const SHIP = 412;
export const DRAGON = 411;
export const HYDRA = 374;
/** The hydra's tentacles are another kind of object (OBJ_U6_HYDRA_BODY). */
export const HYDRA_BODY = 425;
/** Every kind that fills more than its own square. */
export const SILVER_SERPENT = 413;
export const MANY_SQUARES: ReadonlySet<number> = new Set([...SPLIT, SHIP, DRAGON, HYDRA, SILVER_SERPENT]);

/** init_new_silver_serpent's coil: a body frame and a tail frame, and the step to the next segment. */
const COIL = [[10, 1, 0, 1], [13, 7, 1, 0], [12, 5, 0, -1], [11, 3, -1, 0]] as const;
/** move_silver_serpent_objs_relative's frames for the segment behind the head, and for the tail. */
const SEG_FRAME = [[8, 10, 0, 13, 0], [12, 9, 0, 0, 13], [0, 0, 0, 0, 0], [11, 0, 0, 9, 10], [0, 11, 0, 12, 8]];
const TAIL_FRAME = [[0, 0, 0, 0, 0, 0], [1, 0, 0, 3, 7, 0], [0, 0, 0, 0, 0, 0], [0, 3, 0, 0, 5, 1], [0, 0, 0, 0, 0, 0], [5, 0, 3, 0, 0, 7], [0, 0, 0, 0, 0, 0], [0, 7, 1, 5, 0, 0]];

const DEFAULT_TYPE: ActorType = { framesPerDir: 0, tilesPerDir: 0, tilesPerFrame: 1, tileStart: 0 };

export class Actor {
  x = 0;
  y = 0;
  z = 0;
  objN = 0;
  frameN = 0;
  /** 0 north, 1 east, 2 south, 3 west */
  direction = 0;
  objFlags = 0;
  statusFlags = 0;
  talkFlags = 0;
  movementFlags = 0;
  strength = 0;
  dex = 0;
  intelligence = 0;
  exp = 0;
  hp = 0;
  level = 0;
  magic = 0;
  combatMode = 0;
  worktype = 0;
  moves = 0;
  /** Tries at a scheduled walk that came to nothing. */
  stuck = 0;
  visible = true;
  sched: Schedule[] = [];
  schedPos = -1;
  /** Where the schedule last sent them. */
  dest: { x: number; y: number; z: number } | null = null;
  private walkFrame = 0;
  private walkInc = 1;

  constructor(
    readonly id: number,
    readonly kind: Kind = 'u6',
  ) {}

  get alive(): boolean {
    return !(this.statusFlags & STATUS_DEAD);
  }
  get inParty(): boolean {
    return !!(this.statusFlags & STATUS_IN_PARTY);
  }
  get met(): boolean {
    return !!(this.talkFlags & 1);
  }
  get maxHp(): number {
    const v = this.kind === 'md' ? this.level * 24 + this.strength * 2 : this.kind === 'se' ? this.level * 4 + this.strength * 2 : this.level * 30;
    return Math.min(255, v);
  }
  /** Stones they can carry. */
  get maxWeight(): number {
    return this.strength * 2;
  }

  /** Turn to face `d`, taking the next step of the walk. */
  setDirection(d: number): void {
    if (d < 0 || d > 3 || !this.alive) return;
    if (this.kind !== 'u6') {
      this.wouDirection(d);
      return;
    }
    const t = TYPES.get(this.objN) ?? DEFAULT_TYPE;
    const frames = t.framesPerDir || 4;
    if (this.walkFrame === 0) this.walkInc = 1;
    else if (this.walkFrame === frames - 1) this.walkInc = -1;
    this.walkFrame = (this.walkFrame + this.walkInc + frames) % frames;
    this.direction = d;
    this.frameN = t.tileStart + d * t.tilesPerDir + this.walkFrame * t.tilesPerFrame + t.tilesPerFrame - 1;
  }

  /** What the actor was before mounting a horse. */
  baseObjN = 0;
  /** The frame they had before lying down to sleep. */
  oldFrame = 0;

  /**
   * The squares an actor fills beyond its own, with the frame drawn on each: a two-square creature's back half
   * (U6Actor::init_splitactor), a ship's bow and stern (set_direction_of_surrounding_ship_objs).
   */
  /** A silver serpent's body, head to tail, and where the head was when it was last laid out. */
  body: { x: number; y: number; frame: number }[] = [];
  private bodyAt: [number, number, number] | null = null;

  /**
   * The serpent's body follows its head (U6Actor::move_silver_serpent_objs_relative): each segment takes the place of
   * the one before. A new serpent, or one moved other than by a step, is laid out afresh (init_new_silver_serpent).
   */
  private serpent(): { x: number; y: number; frame: number }[] {
    const w = this.z === 0 ? 1023 : 255;
    const at = this.bodyAt;
    const rx = at ? ((this.x - at[0] + w + 1 + (w + 1) / 2) & w) - (w + 1) / 2 : 0;
    const ry = at ? ((this.y - at[1] + w + 1 + (w + 1) / 2) & w) - (w + 1) / 2 : 0;
    if (!at || at[2] !== this.z || !this.body.length || Math.abs(rx) + Math.abs(ry) > 1) {
      this.body = [];
      let [x, y] = [this.x, this.y];
      const length = 4 + (this.id % 5);
      // Straight out behind the head (Nuvie's coil, `j = (j + 1) % 4`, folds back over the head).
      for (let i = 0; i < length; i++) {
        const c = COIL[0];
        x = (x + c[2]) & w;
        y = (y + c[3]) & w;
        this.body.push({ x, y, frame: i === length - 1 ? c[1] : 8 });
      }
      this.setDirection(0);
    } else if (rx || ry) {
      const first = this.body[0];
      let [ox, oy, of] = [first.x, first.y, first.frame];
      first.x = (this.x - rx) & w;
      first.y = (this.y - ry) & w;
      const newPos = 2 + rx + ry * 2;
      const oldPos = 2 + (first.x - ox) + (first.y - oy) * 2;
      first.frame = SEG_FRAME[newPos]?.[oldPos] ?? of;
      for (const seg of this.body.slice(1)) {
        const [tx, ty, tf] = [seg.x, seg.y, seg.frame];
        [seg.x, seg.y] = [ox, oy];
        seg.frame = tf < 8 ? TAIL_FRAME[tf]?.[of - 8] ?? tf : of;
        [ox, oy, of] = [tx, ty, tf];
      }
      // The tail points away from the segment before it.
      const tail = this.body[this.body.length - 1];
      const prev = this.body[this.body.length - 2] ?? { x: this.x, y: this.y };
      const tx = Math.sign(((tail.x - prev.x + w + 1 + (w + 1) / 2) & w) - (w + 1) / 2);
      const ty = Math.sign(((tail.y - prev.y + w + 1 + (w + 1) / 2) & w) - (w + 1) / 2);
      tail.frame = ty > 0 ? 1 : ty < 0 ? 5 : tx > 0 ? 7 : 3;
    }
    this.bodyAt = [this.x, this.y, this.z];
    return this.body;
  }

  parts(): { x: number; y: number; frame: number; objN?: number }[] {
    if (this.kind !== 'u6') return [];
    if (this.objN === SILVER_SERPENT) return this.serpent();
    const w = this.z === 0 ? 1023 : 255;
    const t = TYPES.get(this.objN) ?? DEFAULT_TYPE;
    const [fx, fy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][this.direction & 3];
    const step = this.direction * t.tilesPerDir + t.tilesPerFrame - 1;
    if (this.objN === SHIP) {
      return [
        { x: (this.x + fx) & w, y: (this.y + fy) & w, frame: step },
        { x: (this.x - fx) & w, y: (this.y - fy) & w, frame: 16 + step },
      ];
    }
    if (this.objN === DRAGON) {
      // Head before, tail behind, a wing to each side (set_direction_of_surrounding_dragon_objs).
      const [lx, ly] = [fy, -fx];
      return [
        { x: (this.x + fx) & w, y: (this.y + fy) & w, frame: 8 + step },
        { x: (this.x - fx) & w, y: (this.y - fy) & w, frame: 16 + step },
        { x: (this.x + lx) & w, y: (this.y + ly) & w, frame: 24 + step },
        { x: (this.x - lx) & w, y: (this.y - ly) & w, frame: 32 + step },
      ];
    }
    if (this.objN === HYDRA) {
      // Eight tentacles round the body, from the north clockwise (U6Actor::init_hydra).
      const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
      return ring.map(([dx, dy], i) => ({ x: (this.x + dx) & w, y: (this.y + dy) & w, frame: i * 4, objN: HYDRA_BODY }));
    }
    if (!SPLIT.has(this.objN)) return [];
    // A "mutant" (the Pushme Pullyu) has a second front where the back would be.
    const frame = this.objFlags & 0x40 ? ((this.direction + 2) & 3) * t.tilesPerDir + t.tilesPerFrame - 1 : 8 + step;
    return [{ x: (this.x - fx) & w, y: (this.y - fy) & w, frame }];
  }

  /** Martian Dreams' and Savage Empire's walk (MDActor::set_direction, Actor::set_direction). */
  private wouDirection(d: number): void {
    this.direction = d;
    if (this.kind === 'md' && this.objN === 391) {
      this.frameN = this.frameN ? 0 : 1;
      return;
    }
    const n = this.kind === 'md' ? (this.objN >= 342 && this.objN <= 358 ? 4 : 2) : 4;
    this.walkFrame = (this.walkFrame + 1) % n;
    this.frameN = d * n + [0, 1, 2, 1][this.walkFrame];
  }

  /** Which of the day's schedule entries holds at `hour`. */
  schedulePos(hour: number): number {
    const s = this.sched;
    if (s.length === 0) return -1;
    let i = 0;
    for (; i < s.length; i++) {
      if (s[i].hour > hour) return i !== 0 ? i - 1 : s.length - 1;
    }
    return i - 1;
  }
}

export class Actors {
  readonly list: Actor[] = [];

  constructor(
    files: GameFiles,
    objlist: Uint8Array,
    readonly kind: Kind = 'u6',
  ) {
    for (let i = 0; i < NUM_ACTORS; i++) this.list.push(new Actor(i, kind));
    this.load(objlist);
    const sched = files.get('schedule');
    if (sched) this.loadSchedules(sched);
  }

  get(n: number): Actor | undefined {
    return this.list[n];
  }

  load(ol: Uint8Array): void {
    const r1 = (o: number): number => ol[o] ?? 0;
    for (let i = 0; i < NUM_ACTORS; i++) {
      const a = this.list[i];
      const p = 0x100 + i * 3;
      a.x = r1(p) | ((r1(p + 1) & 0x3) << 8);
      a.y = (r1(p + 1) >> 2) | ((r1(p + 2) & 0xf) << 6);
      a.z = r1(p + 2) >> 4;
      const q = 0x400 + i * 2;
      a.objN = r1(q) | ((r1(q + 1) & 0x3) << 8);
      a.frameN = r1(q + 1) >> 2;
      // Which way they face, from their frame (U6Actor::discover_direction).
      const t = TYPES.get(a.objN);
      a.direction = this.kind === 'u6' && t && t.tilesPerDir ? Math.floor((a.frameN - t.tileStart) / t.tilesPerDir) & 3 : (a.frameN >> 2) & 3;
      a.visible = a.objN !== 0;
      a.baseObjN = a.objN;
      if (a.objN === 0) a.x = a.y = a.z = 0;
      a.objFlags = r1(i);
      a.statusFlags = r1(0x800 + i);
      a.strength = r1(0x900 + i);
      a.dex = r1(0xa00 + i);
      a.intelligence = r1(0xb00 + i);
      a.exp = r1(0xc00 + i * 2) | (r1(0xc01 + i * 2) << 8);
      a.hp = r1(0xe00 + i);
      a.level = r1(0xff1 + i);
      const o = OFFSETS[this.kind];
      a.worktype = r1(0x11f1 + i);
      a.combatMode = r1(o.combatMode + i);
      a.magic = r1(o.magic + i);
      a.moves = r1(o.movementPoints + i);
      a.talkFlags = r1(o.talkFlags + i);
      a.movementFlags = r1(o.movementFlags + i);
      // What they are when not asleep, on a horse or the like, and the frame they had (ActorManager's base_obj_n).
      const b1 = r1(o.oldObj + i * 2);
      const b2 = r1(o.oldObj + i * 2 + 1);
      const base = b1 | ((b2 & 0x3) << 8);
      if (base !== 0) {
        a.baseObjN = base;
        a.oldFrame = b2 >> 2;
      } else a.oldFrame = a.frameN;
    }
    // Actor 0 is the party's vehicle, and nothing unless the party is aboard one.
    const v = this.list[0];
    if (v.worktype !== WT.PLAYER) {
      v.objN = 0;
      v.x = v.y = v.z = 0;
      v.visible = false;
    }
  }

  private loadSchedules(f: Uint8Array): void {
    const r2 = (o: number): number => f[o] | (f[o + 1] << 8);
    const total = r2(NUM_ACTORS * 2);
    const base = NUM_ACTORS * 2 + 2;
    for (let i = 0; i < NUM_ACTORS; i++) {
      const off = r2(i * 2);
      let n = 0;
      if (off <= total - 1) {
        const nextOff = i === NUM_ACTORS - 1 ? total : r2(i * 2 + 2);
        n = (nextOff > total - 1 ? total : nextOff) - off;
      }
      const a = this.list[i];
      a.sched = [];
      for (let k = 0; k < n; k++) {
        const p = base + (off + k) * 5;
        if (p + 5 > f.length) break;
        a.sched.push({
          hour: f[p] & 0x1f,
          dayOfWeek: f[p] >> 5,
          worktype: f[p + 1],
          x: f[p + 2] | ((f[p + 3] & 0x3) << 8),
          y: (f[p + 3] >> 2) | ((f[p + 4] & 0xf) << 6),
          z: f[p + 4] >> 4,
        });
      }
    }
  }

  /** The living, visible actor standing on a square - either half of a two-square one. */
  at(x: number, y: number, z: number): Actor | null {
    let behind: Actor | null = null;
    for (const a of this.list) {
      if (a.z !== z || !a.visible || !a.alive || a.objN === 0) continue;
      if (a.x === x && a.y === y) return a;
      if (!behind && MANY_SQUARES.has(a.objN)) {
        if (a.parts().some((b) => b.x === x && b.y === y)) behind = a;
      }
    }
    return behind;
  }
}
