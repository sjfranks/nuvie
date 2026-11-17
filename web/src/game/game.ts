/**
 * game.ts - the game itself: the world loaded from the player's files, the party, the clock, and what the player can
 * do in it - walk, look, talk, use, get and drop (drawn from Nuvie's Game.cpp, Event.cpp, Player.cpp, Party.cpp,
 * SaveGame.cpp and usecode/U6UseCode.cpp).
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { Lib } from '../files/lib.ts';
import { lzwDecompress, lzwFile } from '../files/lzw.ts';
import { Actor, Actors, STATUS_IN_PARTY, WT } from './actors.ts';
import { Converse, ConverseLib, checkKeywords, type ConvAsk, type ConvWorld } from './converse.ts';
import { invCount, invDelete, invFind, invNew, invWeight } from './inventory.ts';
import { Journal, type JournalData } from './journal.ts';
import { GameMap, mapWidth, wrap } from './map.ts';
import { Obj, Objects, STATUS_OK_TO_TAKE, type Loc } from './objects.ts';
import { Tiles } from './tiles.ts';
import { OBJ } from './u6tables.ts';

export type LogKind = 'sys' | 'npc' | 'you' | 'read';

export interface LogLine {
  kind: LogKind;
  text: string;
}

export interface PartyMember {
  actor: Actor;
  name: string;
}

export interface Clock {
  minute: number;
  hour: number;
  day: number;
  month: number;
  year: number;
}

/** A choice offered for what to say. */
export interface SayOption {
  label: string;
  say: string;
}

/** What a saved game holds (kept in this browser). */
export interface SaveState {
  version: 1;
  clock: Clock;
  turns: number;
  party: { id: number; name: string }[];
  flags: { karma: number; quest: number; garg: number; gender: number };
  actors: number[][];
  /** [objN, frameN, status, x, y, z, qty, quality, loc (0 map, 1 container, 2 carried, 3 readied), parent index or holder] */
  objs: number[][];
  journal: JournalData;
  log: LogLine[];
}

const DIRS = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
] as const;
const MAX_LOG = 300;
const READABLE: ReadonlySet<number> = new Set([
  OBJ.SIGN, OBJ.SIGN_ARROW, OBJ.BOOK, OBJ.SCROLL, OBJ.GRAVE, OBJ.CROSS, OBJ.PICTURE,
]);
const FOOD: ReadonlySet<number> = new Set([OBJ.BREAD, OBJ.MEAT_PORTION]);
const LOCS: Loc[] = ['map', 'cont', 'inv', 'readied'];

/** The direction (0 north, 1 east, 2 south, 3 west) a step faces. */
export function facing(dx: number, dy: number): number {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

export class Game implements ConvWorld {
  readonly tiles: Tiles;
  readonly objects: Objects;
  readonly map: GameMap;
  readonly actors: Actors;
  readonly lib: ConverseLib;
  readonly journal = new Journal();
  readonly clock: Clock;
  party: PartyMember[] = [];
  log: LogLine[] = [];
  /** Called whenever the log, the party or the world changes. */
  onChange: () => void = () => {};
  converse: Converse | null = null;
  /** The face shown while talking. */
  speaker: { actor: number; name: string } | null = null;
  /** The speaker has stopped; the player goes on. */
  paused = false;
  gender = 0;
  karma = 0;
  questFlag = 0;
  gargFlag = 0;
  turns = 0;
  /** A container opened to look in. */
  openContainer: Obj | null = null;
  private readonly books: Lib | null;
  private readonly portraits: (Lib | null)[];
  private avatarPortrait = 0;
  private asked = '';
  private said = '';
  private pending: Converse['events'] = [];

  constructor(
    readonly files: GameFiles,
    saved?: SaveState,
  ) {
    this.tiles = new Tiles(files);
    this.objects = new Objects(files, this.tiles);
    this.map = new GameMap(files, this.tiles, this.objects);
    const objlist = this.loadObjects();
    this.actors = new Actors(files, objlist);
    this.lib = new ConverseLib(files);
    const lib = (n: string, w: 2 | 4): Lib | null => (files.has(n) ? new Lib(files.get(n)!, w) : null);
    this.books = lib('book.dat', 2);
    this.portraits = [lib('portrait.a', 4), lib('portrait.b', 4), lib('portrait.z', 4)];
    const r1 = (o: number): number => objlist[o] ?? 0;
    this.clock = { minute: r1(0x1bf3), hour: r1(0x1bf4) % 24, day: r1(0x1bf5), month: r1(0x1bf6), year: r1(0x1bf7) | (r1(0x1bf8) << 8) };
    this.questFlag = r1(0x1bf1);
    this.karma = r1(0x1bf9);
    this.gargFlag = r1(0x1c5f);
    this.gender = r1(0x1c71);
    this.avatarPortrait = Math.max(0, r1(0x1c72) - 1);
    const n = Math.min(16, r1(0xff0));
    for (let i = 0; i < n; i++) {
      const a = this.actors.get(r1(0xfe0 + i));
      if (!a) continue;
      let name = '';
      for (let c = 0; c < 14 && r1(0xf00 + i * 14 + c) !== 0; c++) name += String.fromCharCode(r1(0xf00 + i * 14 + c));
      a.statusFlags |= STATUS_IN_PARTY;
      this.party.push({ actor: a, name });
    }
    if (this.party.length === 0) {
      const a = this.actors.get(1)!;
      a.statusFlags |= STATUS_IN_PARTY;
      this.party.push({ actor: a, name: 'Avatar' });
    }
    for (const a of this.actors.list) a.schedPos = a.schedulePos(this.clock.hour);
    if (saved) this.restore(saved);
    else this.say('sys', 'The world is loaded. Tap the map to walk.');
  }

  /** Read every object, and return the objlist: a new game's packed files, else a saved game's. */
  private loadObjects(): Uint8Array {
    const f = this.files;
    if (f.has('lzobjblk') && f.has('lzdngblk')) {
      const surf = lzwFile(f.get('lzobjblk')!);
      let p = 0;
      for (let i = 0; i < 64; i++) p += this.objects.loadBlock(surf, p);
      const dng = lzwFile(f.get('lzdngblk')!);
      p = 0;
      for (let i = 0; i < 5; i++) p += this.objects.loadBlock(dng, p);
      const objlist = dng.slice(p);
      // A new game's hero, as Nuvie sets them up, where the files leave them blank.
      if (objlist[0xf00] === 0) {
        const name = 'Avatar';
        for (let i = 0; i <= name.length; i++) objlist[0xf00 + i] = name.charCodeAt(i) || 0;
        objlist[0x1c72] = 1;
        objlist[0x901] = objlist[0xa01] = objlist[0xb01] = 0xf;
        objlist[0xc02] = 0x72;
        objlist[0xc03] = 0x01;
        objlist[0x13f2] = 0x1e;
        objlist[0xff2] = 3;
      }
      return objlist;
    }
    const letters = 'abcdefgh';
    for (const y of letters) {
      for (const x of letters) {
        const blk = f.get(`objblk${x}${y}`);
        if (!blk) throw new Error(`missing game file: objblk${x}${y} (or lzobjblk and lzdngblk)`);
        this.objects.loadBlock(blk);
      }
    }
    for (const x of 'abcde') {
      const blk = f.get(`objblk${x}i`);
      if (blk) this.objects.loadBlock(blk);
    }
    const objlist = f.get('objlist');
    if (!objlist) throw new Error('missing game file: objlist');
    return objlist;
  }

  // ---- the party ----

  get player(): Actor {
    return this.party[0].actor;
  }
  playerActor(): Actor {
    return this.player;
  }
  playerName(): string {
    return this.party[0].name;
  }
  actor(n: number): Actor | undefined {
    return this.actors.get(n);
  }
  hour(): number {
    return this.clock.hour;
  }
  partySize(): number {
    return this.party.length;
  }
  partyMax(): number {
    return 8;
  }
  partyContains(n: number): boolean {
    return this.party.some((m) => m.actor.id === n);
  }
  partyMember(i: number): Actor | undefined {
    return this.party[i]?.actor;
  }
  partyMemberName(n: number): string {
    return this.party.find((m) => m.actor.id === n)?.name ?? '';
  }
  partyAdd(a: Actor): void {
    if (this.partyContains(a.id)) return;
    a.statusFlags |= STATUS_IN_PARTY;
    a.worktype = WT.IN_PARTY;
    this.party.push({ actor: a, name: this.lib.name(this.lib.scriptNum(a)).slice(0, 13) || this.lookActor(a) });
  }
  partyRemove(a: Actor): void {
    const i = this.party.findIndex((m) => m.actor === a);
    if (i <= 0) return;
    this.party.splice(i, 1);
    a.statusFlags &= ~STATUS_IN_PARTY;
    a.worktype = WT.MOTIONLESS;
  }
  lookActor(a: Actor): string {
    return this.tiles.look(this.objects.objToTile[a.objN], 0, false);
  }
  invHas(actor: number, objN: number, quality: number, matchQuality: boolean): boolean {
    return !!invFind(this.objects, actor, objN, quality, matchQuality);
  }
  invCount(actor: number, objN: number): number {
    return invCount(this.objects, actor, objN);
  }
  invNew(actor: number, objN: number, qty: number, quality: number): void {
    invNew(this.objects, actor, objN, qty, quality);
  }
  invDelete(actor: number, objN: number, qty: number, quality: number): void {
    invDelete(this.objects, actor, objN, qty, quality);
  }
  invRoom(actor: number): number {
    const a = this.actors.get(actor);
    return a ? a.maxWeight - invWeight(this.objects, actor) : 0;
  }
  objWeight(objN: number): number {
    return this.objects.weightOf(this.objects.create(objN, 1, 0)) * 10;
  }
  setWorktype(a: Actor, wt: number): void {
    a.worktype = wt;
  }
  heal(a: Actor): void {
    a.hp = a.maxHp;
  }
  sleep(): void {
    // Until sunrise.
    do this.advance(60 - this.clock.minute);
    while (this.clock.hour !== 5);
    for (const m of this.party) m.actor.hp = Math.max(m.actor.hp, m.actor.maxHp);
  }
  random(n: number): number {
    return Math.floor(Math.random() * n);
  }
  /** Gold the party carries. */
  gold(): number {
    return this.party.reduce((g, m) => g + this.invCount(m.actor.id, OBJ.GOLD), 0);
  }

  // ---- the log and the clock ----

  say(kind: LogKind, text: string): void {
    if (!text) return;
    const last = this.log[this.log.length - 1];
    if (last && last.kind === kind && kind === 'npc') last.text += text;
    else this.log.push({ kind, text });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  date(): string {
    const c = this.clock;
    return `${c.month}-${c.day}-${c.year}`;
  }

  time(): string {
    const c = this.clock;
    const h = c.hour % 12 === 0 ? 12 : c.hour % 12;
    return `${h}:${String(c.minute).padStart(2, '0')} ${c.hour < 12 ? 'am' : 'pm'}`;
  }

  private advance(minutes: number): void {
    const c = this.clock;
    c.minute += minutes;
    while (c.minute >= 60) {
      c.minute -= 60;
      if (++c.hour >= 24) {
        c.hour = 0;
        if (++c.day > 28) {
          c.day = 1;
          if (++c.month > 12) {
            c.month = 1;
            c.year++;
          }
        }
      }
      this.updateSchedules();
    }
  }

  /** Where the party is, for the journal: a rough bearing, the world having no place names in its files. */
  where(): string {
    const p = this.player;
    if (p.z !== 0) return `underground, level ${p.z}`;
    const lat = Math.round((p.y - 512) / 8);
    const lon = Math.round((p.x - 512) / 8);
    return `${Math.abs(lat)}°${lat < 0 ? 'N' : 'S'} ${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`;
  }

  // ---- moving ----

  /** Whether an actor could stand on a square now. */
  canStand(x: number, y: number, z: number): boolean {
    return this.map.isPassable(x, y, z) && !this.actors.at(wrap(x, z), wrap(y, z), z);
  }

  private closedDoorAt(x: number, y: number, z: number): Obj | null {
    const l = this.objects.list(x, y, z);
    return l?.find((o) => this.objects.isDoor(o) && o.frameN > 3) ?? null;
  }

  /** Step the party one square. Returns whether a turn passed. */
  move(dx: number, dy: number): boolean {
    if (this.converse) return false;
    const p = this.player;
    const nx = wrap(p.x + dx, p.z);
    const ny = wrap(p.y + dy, p.z);
    this.openContainer = null;
    const other = this.actors.at(nx, ny, p.z);
    if (other && other.inParty) {
      // Change places with a companion.
      other.x = p.x;
      other.y = p.y;
      other.setDirection(facing(-dx, -dy));
    } else if (other || !this.map.isPassable(nx, ny, p.z)) {
      const door = this.closedDoorAt(nx, ny, p.z);
      if (door && !other) {
        this.useDoor(door);
        this.endTurn();
        return true;
      }
      p.setDirection(facing(dx, dy));
      this.say('sys', 'Blocked!');
      this.onChange();
      return false;
    }
    const trail = this.party.map((m) => ({ x: m.actor.x, y: m.actor.y }));
    p.x = nx;
    p.y = ny;
    p.setDirection(facing(dx, dy));
    // Each companion takes the square the one ahead has left.
    for (let i = 1; i < this.party.length; i++) {
      const a = this.party[i].actor;
      if (a === other || a.z !== p.z) continue;
      const t = trail[i - 1];
      if (t.x === a.x && t.y === a.y) continue;
      if (Math.abs(t.x - a.x) > 2 || Math.abs(t.y - a.y) > 2 || !this.actors.at(t.x, t.y, p.z)) {
        a.setDirection(facing(t.x - a.x, t.y - a.y));
        a.x = t.x;
        a.y = t.y;
      }
    }
    this.endTurn();
    return true;
  }

  /** Let a turn go by. */
  pass(): void {
    if (this.converse) return;
    this.say('sys', 'Pass.');
    this.endTurn();
  }

  private endTurn(): void {
    this.turns++;
    if (this.turns % 2 === 0) this.advance(1);
    this.moveNpcs();
    this.onChange();
  }

  /** Put the whole party at a place (ladders, dungeon mouths). */
  private teleport(x: number, y: number, z: number): void {
    for (const m of this.party) {
      m.actor.x = x;
      m.actor.y = y;
      m.actor.z = z;
    }
    // Spread the companions over free squares round the leader.
    let n = 1;
    for (let r = 1; r <= 2 && n < this.party.length; r++) {
      for (let dy = -r; dy <= r && n < this.party.length; dy++) {
        for (let dx = -r; dx <= r && n < this.party.length; dx++) {
          if (this.canStand(x + dx, y + dy, z)) {
            this.party[n].actor.x = wrap(x + dx, z);
            this.party[n].actor.y = wrap(y + dy, z);
            n++;
          }
        }
      }
    }
  }

  /**
   * The steps from the party to a square (or to beside it, `beside`), round what is in the way; null where there is
   * no way within reach. Shut doors that are not locked count as open: walking into one opens it.
   */
  pathTo(tx: number, ty: number, beside = false): [number, number][] | null {
    const p = this.player;
    const R = 20;
    const W = R * 2 + 1;
    const prev = new Int16Array(W * W).fill(-1);
    const idx = (x: number, y: number): number => (y - p.y + R) * W + (x - p.x + R);
    const ok = (x: number, y: number): boolean => {
      if (this.map.isPassable(x, y, p.z)) {
        const a = this.actors.at(wrap(x, p.z), wrap(y, p.z), p.z);
        return !a || a.inParty;
      }
      const d = this.closedDoorAt(wrap(x, p.z), wrap(y, p.z), p.z);
      return !!d && d.frameN !== 9 && d.frameN !== 11 && d.frameN !== 13 && d.frameN !== 15;
    };
    const goal = (x: number, y: number): boolean =>
      beside ? Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1 && !(x === tx && y === ty) : x === tx && y === ty;
    if (Math.abs(tx - p.x) > R || Math.abs(ty - p.y) > R) return null;
    if (goal(p.x, p.y)) return [];
    const queue: number[] = [p.x, p.y];
    prev[idx(p.x, p.y)] = idx(p.x, p.y);
    for (let q = 0; q < queue.length; q += 2) {
      const x = queue[q];
      const y = queue[q + 1];
      // Straight steps before diagonal ones, so the way reads naturally.
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (Math.abs(nx - p.x) > R || Math.abs(ny - p.y) > R) continue;
        const i = idx(nx, ny);
        if (prev[i] !== -1 || !ok(nx, ny)) continue;
        prev[i] = idx(x, y);
        if (goal(nx, ny)) {
          const steps: [number, number][] = [];
          let cx = nx;
          let cy = ny;
          while (cx !== p.x || cy !== p.y) {
            const pi = prev[idx(cx, cy)];
            const px = (pi % W) - R + p.x;
            const py = Math.floor(pi / W) - R + p.y;
            steps.unshift([cx - px, cy - py]);
            cx = px;
            cy = py;
          }
          return steps;
        }
        queue.push(nx, ny);
      }
    }
    return null;
  }

  // ---- everyone else ----

  private updateSchedules(): void {
    const p = this.player;
    for (const a of this.actors.list) {
      if (a.inParty || !a.alive || a.sched.length === 0 || (a.id >= 188 && a.id <= 200)) continue;
      const pos = a.schedulePos(this.clock.hour);
      if (pos === a.schedPos || pos < 0) continue;
      a.schedPos = pos;
      const s = a.sched[pos];
      a.worktype = s.worktype;
      a.dest = { x: s.x, y: s.y, z: s.z };
      const near = (x: number, y: number, z: number): boolean => z === p.z && Math.abs(x - p.x) <= 10 && Math.abs(y - p.y) <= 10;
      // Out of sight at both ends, they are simply there.
      if (!near(a.x, a.y, a.z) && !near(s.x, s.y, s.z)) {
        a.x = s.x;
        a.y = s.y;
        a.z = s.z;
        a.dest = null;
      }
    }
  }

  private stepActor(a: Actor, dx: number, dy: number): boolean {
    const nx = wrap(a.x + dx, a.z);
    const ny = wrap(a.y + dy, a.z);
    if (!this.canStand(nx, ny, a.z)) return false;
    a.x = nx;
    a.y = ny;
    a.setDirection(facing(dx, dy));
    return true;
  }

  private moveNpcs(): void {
    const p = this.player;
    for (const a of this.actors.list) {
      if (a.inParty || !a.alive || !a.visible || a.objN === 0 || a.z !== p.z) continue;
      if (Math.abs(a.x - p.x) > 24 || Math.abs(a.y - p.y) > 24) {
        if (a.dest && a.dest.z === a.z) {
          a.x = a.dest.x;
          a.y = a.dest.y;
          a.dest = null;
        }
        continue;
      }
      if (a.dest) {
        if (a.dest.z !== a.z || (a.dest.x === a.x && a.dest.y === a.y)) {
          if (a.dest.z !== a.z) Object.assign(a, a.dest);
          a.dest = null;
          continue;
        }
        const dx = Math.sign(a.dest.x - a.x);
        const dy = Math.sign(a.dest.y - a.y);
        // Straight for it, else sidle; a few tries, then give up and be there.
        if (!(this.stepActor(a, dx, dy) || (dx !== 0 && this.stepActor(a, dx, 0)) || (dy !== 0 && this.stepActor(a, 0, dy)))) {
          const [rx, ry] = DIRS[this.random(4)];
          this.stepActor(a, rx, ry);
          if (++a.moves > 40) {
            a.moves = 0;
            if (!this.actors.at(a.dest.x, a.dest.y, a.dest.z)) Object.assign(a, a.dest);
            a.dest = null;
          }
        }
        continue;
      }
      switch (a.worktype) {
        case WT.WANDER:
        case WT.ANIMAL_WANDER:
          if (this.random(4) === 0) {
            const [dx, dy] = DIRS[this.random(4)];
            const home = a.sched[a.schedPos];
            if (!home || (Math.abs(a.x + dx - home.x) <= 4 && Math.abs(a.y + dy - home.y) <= 4)) this.stepActor(a, dx, dy);
          }
          break;
        case WT.WALK_NS:
        case WT.GUARD_NS:
        case WT.WALK_EW:
        case WT.GUARD_EW: {
          const ns = a.worktype === WT.WALK_NS || a.worktype === WT.GUARD_NS;
          let d = a.direction;
          if (ns !== (d === 0 || d === 2)) d = ns ? 0 : 1;
          if (!this.stepActor(a, DIRS[d][0], DIRS[d][1])) a.setDirection((d + 2) % 4);
          break;
        }
        case WT.FACE_NORTH:
        case WT.FACE_EAST:
        case WT.FACE_SOUTH:
        case WT.FACE_WEST:
          if (a.direction !== a.worktype - WT.FACE_NORTH) a.setDirection(a.worktype - WT.FACE_NORTH);
          break;
      }
    }
  }

  // ---- looking ----

  look(x: number, y: number): void {
    const p = this.player;
    const a = this.actors.at(x, y, p.z);
    const o = this.objects.get(x, y, p.z);
    let text: string;
    if (a) {
      const m = this.party.find((m) => m.actor === a);
      text = m ? m.name : a.met ? this.lib.name(this.lib.scriptNum(a)) || this.tiles.look(this.objects.objToTile[a.objN], 0) : this.tiles.look(this.objects.objToTile[a.objN], 0);
    } else if (o && !(o.status & 0x02)) text = this.objects.look(o);
    else text = this.tiles.look(this.map.tileNum(x, y, p.z), 0);
    this.say('sys', `Thou dost see ${text}.`);
    if (o && !a && READABLE.has(o.objN)) this.read(o);
    this.onChange();
  }

  private read(o: Obj): void {
    if (o.quality === 0 && o.objN !== OBJ.BOOK) return;
    const data = this.books?.item(o.quality === 0 ? 126 : o.quality - 1);
    if (!data) return;
    let text = '';
    for (const c of data) {
      if (c === 0) break;
      text += String.fromCharCode(c);
    }
    // Text in another script is wrapped in < >; its translation, in & &, follows.
    text = text.replace(/[<>]/g, '').replace(/&/g, '').replace(/\*/g, '\n').trim();
    if (!text) return;
    this.say('read', text);
    this.journal.read(this.objects.name(o), this.where(), text, this.date());
  }

  // ---- talking ----

  talk(x: number, y: number): void {
    const a = this.actors.at(x, y, this.player.z);
    if (!a || a === this.player) {
      this.say('sys', 'Nobody is there to talk to.');
      this.onChange();
      return;
    }
    this.talkTo(a);
  }

  talkTo(a: Actor): void {
    if (this.converse) return;
    const c = a.statusFlags & 0x04 ? null : Converse.start(this, this.lib, a);
    if (!c) {
      this.say('sys', a.statusFlags & 0x04 ? 'No response.' : 'Funny, no response.');
      this.onChange();
      return;
    }
    this.converse = c;
    this.asked = 'met';
    this.said = '';
    this.player.setDirection(facing(a.x - this.player.x, a.y - this.player.y));
    this.pump();
  }

  /** Show what the conversation has said so far, up to where the speaker stops. */
  private pump(): void {
    const c = this.converse;
    if (!c) return;
    this.pending.push(...c.events.splice(0));
    this.paused = false;
    while (this.pending.length) {
      const e = this.pending.shift()!;
      if (e.type === 'text') {
        this.say('npc', e.text);
        this.said += e.text;
        this.learn(c, e.text);
      } else if (e.type === 'portrait') this.speaker = { actor: e.actor, name: e.name };
      else if (e.type === 'pause') {
        // A stop with nothing after it but the question needs no tap.
        if (this.pending.some((n) => n.type === 'text' && n.text.trim())) {
          this.paused = true;
          break;
        }
      } else if (e.type === 'end') {
        this.keepNote(c);
        this.converse = null;
        this.speaker = null;
        this.pending = [];
        this.endTurn();
        return;
      }
    }
    if (!this.paused && c.ask) this.keepNote(c);
    this.onChange();
  }

  private keepNote(c: Converse): void {
    const a = c.npc;
    const name = a.met || this.partyContains(a.id) ? c.name.replace(/_/g, '.') : '';
    this.journal.meet(a.id, name, c.desc, this.where(), this.date());
    if (this.asked) this.journal.note(a.id, this.asked === 'met' ? 'On meeting' : this.asked, this.said, this.date());
    this.said = '';
    this.asked = '';
  }

  /** Remember the words a speaker drops that they answer to: those marked in what they say, and any that fit a keyword. */
  private learn(c: Converse, text: string): void {
    const keys = this.lib.keywords(this.lib.scriptNum(c.npc));
    for (const m of text.matchAll(/(@?)([A-Za-z']+)/g)) {
      const word = m[2].toLowerCase();
      if (word.length < 3) continue;
      const fits = keys.some((k) => k.length >= Math.min(4, word.length) && checkKeywords(k, word));
      if (fits || (m[1] && keys.length === 0)) this.journal.addTopic(c.npc.id, word);
    }
  }

  /** The player taps to hear the rest. */
  continueTalk(): void {
    if (this.converse && this.paused) this.pump();
  }

  reply(s: string): void {
    const c = this.converse;
    if (!c || !c.ask || this.paused) return;
    this.say('you', s || 'bye');
    this.asked = s || 'bye';
    this.said = '';
    c.reply(s);
    this.pump();
  }

  /** What the conversation waits on. */
  asking(): ConvAsk | null {
    return this.converse && !this.paused ? this.converse.ask : null;
  }

  /**
   * What can be said to the question now asked: yes and no where it is that kind of question; else name and job, the
   * words this person has dropped, and bye.
   */
  sayOptions(): SayOption[] {
    const c = this.converse;
    if (!c || !c.ask) return [];
    if (c.ask.type === 'char') {
      return [...c.ask.allowed].map((ch) => ({ label: ch === 'y' ? 'Yes' : ch === 'n' ? 'No' : ch.toUpperCase(), say: ch }));
    }
    if (c.ask.type !== 'keyword') return [];
    const keys = c.currentKeywords();
    const has = (w: string): boolean => keys.some((k) => k !== '*' && checkKeywords(k, w));
    const out: SayOption[] = [];
    const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
    const yn = keys.some((k) => k === 'y' || k === 'yes') && keys.some((k) => k === 'n' || k === 'no');
    if (yn && keys.filter((k) => k !== '*').length <= 6) {
      out.push({ label: 'Yes', say: 'yes' }, { label: 'No', say: 'no' });
      return out;
    }
    for (const w of ['name', 'job']) if (has(w)) out.push({ label: cap(w), say: w });
    const seen = new Set<string>(['name', 'job', 'bye']);
    for (const t of this.journal.person(c.npc.id)?.topics ?? []) {
      // One entry for each keyword, however many words heard fit it.
      const k = keys.find((k) => k !== '*' && checkKeywords(k, t));
      if (!k || seen.has(k) || seen.has(t)) continue;
      seen.add(k);
      seen.add(t);
      out.push({ label: cap(t), say: t });
    }
    for (const w of ['join', 'leave']) {
      if (has(w) && !seen.has(w) && this.partyContains(c.npc.id) === (w === 'leave')) out.push({ label: cap(w), say: w });
    }
    out.push({ label: 'Bye', say: 'bye' });
    return out;
  }

  // ---- using ----

  private useDoor(o: Obj): void {
    if (o.frameN === 13 || o.frameN === 15) this.say('sys', 'Magically locked.');
    else if (o.frameN === 9 || o.frameN === 11) {
      const holder = o.quality !== 0 ? this.party.find((m) => invFind(this.objects, m.actor.id, OBJ.KEY, o.quality, true)) : undefined;
      if (holder) {
        o.frameN -= 4;
        this.say('sys', 'Unlocked.');
      } else this.say('sys', 'Locked.');
    } else if (o.frameN <= 3) {
      // Shut it, unless someone stands in it.
      if (this.actors.at(o.x, o.y, o.z)) this.say('sys', 'Not now!');
      else {
        o.frameN += 4;
        this.say('sys', 'Closed.');
      }
    } else {
      o.frameN -= 4;
      this.say('sys', 'Opened.');
    }
  }

  private useLadder(o: Obj, down: boolean): void {
    let x = o.x;
    let y = o.y;
    let z: number;
    if (down) {
      if (o.z === 0) {
        x = (o.x & 0x07) | ((o.x >> 2) & 0xf8);
        y = (o.y & 0x07) | ((o.y >> 2) & 0xf8);
      }
      z = o.z + 1;
    } else {
      if (o.z === 1) {
        // The quality says which of the surface's sixteen chunks this one comes up in.
        x = (o.x >> 3) * 32 + (o.quality & 0x03) * 8 + (o.x & 7);
        y = (o.y >> 3) * 32 + ((o.quality >> 2) & 0x03) * 8 + (o.y & 7);
      }
      z = o.z - 1;
    }
    if (z < 0 || z > 5) return;
    this.teleport(x, y, z);
    this.say('sys', down ? 'Down the party goes.' : 'Up the party goes.');
  }

  /** Use what is at a square (beside the party), or an object carried. */
  use(x: number, y: number): void {
    const p = this.player;
    const l = this.objects.list(x, y, p.z);
    const door = l?.find((o) => this.objects.isDoor(o));
    const o = door ?? this.objects.get(x, y, p.z);
    if (!o || o.status & 0x02) {
      this.say('sys', 'Nothing to use there.');
      this.onChange();
      return;
    }
    this.useObj(o);
  }

  useObj(o: Obj): void {
    const name = this.objects.name(o);
    if (this.objects.isDoor(o)) this.useDoor(o);
    else if (o.objN === OBJ.LADDER) this.useLadder(o, o.frameN === 0);
    else if (o.objN === OBJ.CAVE || o.objN === OBJ.HOLE) this.useLadder(o, true);
    else if (o.objN === OBJ.SECRET_DOOR) {
      o.frameN += o.frameN === 1 || o.frameN === 3 ? -1 : 1;
      this.say('sys', 'A secret door!');
    } else if (o.objN === OBJ.V_PASSTHROUGH || o.objN === OBJ.H_PASSTHROUGH) {
      const open = o.frameN < 2;
      const v = o.objN === OBJ.V_PASSTHROUGH;
      const nx = o.x + (v ? 0 : open ? -1 : 1);
      const ny = o.y + (v ? (open ? -1 : 1) : 0);
      if (this.actors.at(nx, ny, o.z)) this.say('sys', 'Not now!');
      else {
        this.objects.move(o, nx, ny, o.z);
        o.frameN = open ? 2 : 0;
        this.say('sys', `${open ? 'Open' : 'Close'} the passthrough.`);
      }
    } else if (READABLE.has(o.objN)) {
      this.say('sys', `Reading ${this.objects.look(o)}:`);
      this.read(o);
    } else if (o.container && o.objN !== OBJ.EGG) {
      if (o.objN === OBJ.CHEST && o.frameN >= 2) this.say('sys', o.frameN === 3 ? 'Magically locked.' : 'Locked.');
      else {
        if (o.objN === OBJ.CHEST) o.frameN = 0;
        this.openContainer = o;
        this.say('sys', o.container.length ? `Searching the ${name}: ${o.container.map((c) => this.objects.look(c)).join(', ')}.` : `The ${name} is empty.`);
      }
    } else if (FOOD.has(o.objN)) {
      if (o.qty > 1) o.qty--;
      else this.objects.unlink(o);
      this.say('sys', 'You eat the food.');
    } else this.say('sys', `Using the ${name} is beyond this port so far.`);
    this.endTurn();
  }

  // ---- getting and dropping ----

  /** Pick up what is on a square, or take `o` from an opened container; it goes to whoever has room. */
  get(x: number, y: number, o: Obj | null = null): void {
    const p = this.player;
    o ??= this.objects.get(x, y, p.z);
    if (!o || o.status & 0x02) {
      this.say('sys', 'Nothing to get there.');
      this.onChange();
      return;
    }
    const w = this.objects.weightOf(o);
    const t = this.objects.tileOf(o);
    if (this.objects.isDoor(o) || w >= 25.5 || (!t.passable && !(o.status & STATUS_OK_TO_TAKE) && !o.container)) {
      this.say('sys', `Get ${this.objects.look(o)}: not possible.`);
      this.onChange();
      return;
    }
    const taker = this.party.find((m) => this.invRoom(m.actor.id) >= w);
    if (!taker) {
      this.say('sys', `Get ${this.objects.look(o)}: too heavy for anyone to carry.`);
      this.onChange();
      return;
    }
    const what = this.objects.look(o);
    if (!(o.status & STATUS_OK_TO_TAKE)) {
      // Taking what is not yours costs karma.
      this.karma = Math.max(0, this.karma - 1);
      o.status |= STATUS_OK_TO_TAKE;
      this.say('sys', `Get ${what}. Stealing!`);
    } else this.say('sys', `Get ${what}.`);
    this.objects.toInventory(o, taker.actor.id);
    this.endTurn();
  }

  /** Put down something carried, at the feet of whoever carries it. */
  drop(o: Obj): void {
    const holder = this.holderOf(o);
    if (!holder) return;
    const what = this.objects.look(o);
    this.objects.unlink(o);
    o.x = holder.x;
    o.y = holder.y;
    o.z = holder.z;
    o.status |= STATUS_OK_TO_TAKE;
    this.objects.add(o);
    this.say('sys', `Drop ${what}.`);
    this.endTurn();
  }

  /** Hand something to another member of the party. */
  give(o: Obj, to: Actor): void {
    if (this.invRoom(to.id) < this.objects.weightOf(o)) {
      this.say('sys', 'Too heavy for them.');
      this.onChange();
      return;
    }
    this.objects.toInventory(o, to.id);
    this.onChange();
  }

  private holderOf(o: Obj): Actor | undefined {
    let top = o;
    while (top.parentObj) top = top.parentObj;
    return this.actors.get(top.holder);
  }

  /** A face for an actor: 56 by 64 palette indices, or null. */
  portrait(a: Actor): Uint8Array | null {
    let lib: Lib | null;
    let num: number;
    if (a === this.actors.get(1)) {
      lib = this.portraits[2];
      num = this.avatarPortrait;
    } else {
      num = a.id !== 0 ? a.id - 1 : 0;
      if (num === 187) num = 190;
      else if (num >= 191 && num <= 199) return null;
      else if (num > 194) {
        if (a.objN === OBJ.GUARD) num = 192;
        else if (a.objN === OBJ.WISP) num = 191;
        else if (a.objN === OBJ.GARGOYLE) num = 193;
        else return null;
      }
      lib = num < 98 ? this.portraits[0] : this.portraits[1];
      if (num >= 98) num -= 98;
    }
    const raw = lib?.raw(num);
    if (!raw) return null;
    try {
      const d = lzwDecompress(raw);
      return d.length >= 56 * 64 ? d : null;
    } catch {
      return null;
    }
  }

  // ---- saving ----

  save(): SaveState {
    const objs: number[][] = [];
    const put = (o: Obj, loc: number, ref: number): void => {
      const i = objs.push([o.objN, o.frameN, o.status, o.x, o.y, o.z, o.qty, o.quality, loc, ref]) - 1;
      if (o.container) for (const c of o.container) put(c, 1, i);
    };
    for (const o of this.objects.all()) put(o, 0, 0);
    this.objects.inventories.forEach((inv, n) => inv.forEach((o) => put(o, o.loc === 'readied' ? 3 : 2, n)));
    return {
      version: 1,
      clock: { ...this.clock },
      turns: this.turns,
      party: this.party.map((m) => ({ id: m.actor.id, name: m.name })),
      flags: { karma: this.karma, quest: this.questFlag, garg: this.gargFlag, gender: this.gender },
      actors: this.actors.list.map((a) => [
        a.x, a.y, a.z, a.objN, a.frameN, a.direction, a.objFlags, a.statusFlags, a.talkFlags, a.movementFlags,
        a.strength, a.dex, a.intelligence, a.exp, a.hp, a.level, a.magic, a.combatMode, a.worktype, a.visible ? 1 : 0,
      ]),
      objs,
      journal: this.journal.data,
      log: this.log.slice(-80),
    };
  }

  private restore(s: SaveState): void {
    Object.assign(this.clock, s.clock);
    this.turns = s.turns;
    this.karma = s.flags.karma;
    this.questFlag = s.flags.quest;
    this.gargFlag = s.flags.garg;
    this.gender = s.flags.gender;
    s.actors.forEach((v, i) => {
      const a = this.actors.list[i];
      if (!a) return;
      [a.x, a.y, a.z, a.objN, a.frameN, a.direction, a.objFlags, a.statusFlags, a.talkFlags, a.movementFlags, a.strength,
        a.dex, a.intelligence, a.exp, a.hp, a.level, a.magic, a.combatMode, a.worktype] = v;
      a.visible = v[19] === 1;
      a.schedPos = a.schedulePos(this.clock.hour);
    });
    this.party = s.party.flatMap((m) => {
      const a = this.actors.get(m.id);
      return a ? [{ actor: a, name: m.name }] : [];
    });
    this.objects.clearMap();
    const made: Obj[] = [];
    for (const v of s.objs) {
      const o = new Obj();
      [o.objN, o.frameN, o.status, o.x, o.y, o.z, o.qty, o.quality] = v;
      if (this.objects.isContainer(o.objN)) o.container = [];
      made.push(o);
      const loc = LOCS[v[8]];
      if (loc === 'map') this.objects.add(o);
      else if (loc === 'cont') {
        const parent = made[v[9]];
        (parent.container ??= []).push(o);
        o.loc = 'cont';
        o.parentObj = parent;
      } else {
        this.objects.inventories[v[9]].push(o);
        o.loc = loc;
        o.holder = v[9];
      }
    }
    this.journal.data = s.journal;
    this.log = s.log;
  }

  /** The squares across the map a level has. */
  width(): number {
    return mapWidth(this.player.z);
  }
}
