/**
 * game.ts - the game itself: the world loaded from the player's files, the party, the clock, and what the player can
 * do in it - walk, look, talk, use, get and drop (drawn from Nuvie's Game.cpp, Event.cpp, Player.cpp, Party.cpp,
 * SaveGame.cpp and usecode/U6UseCode.cpp).
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { Lib } from '../files/lib.ts';
import { lzwDecompress, lzwFile } from '../files/lzw.ts';
import { Actor, Actors, HYDRA, HYDRA_BODY, MANY_SQUARES, SHIP, STATUS_IN_PARTY, WT } from './actors.ts';
import { Converse, ConverseLib, checkKeywords, type ConvAsk, type ConvWorld } from './converse.ts';
import { Combat } from './combat.ts';
import { FOODS, UseCode, USED_IN_PLACE } from './usecode.ts';
import { Magic, type Spell } from './magic.ts';
import type { SfxId } from '../audio/sfx.ts';
import { invCount, invDelete, invFind, invNew, invWeight } from './inventory.ts';
import { Journal, type JournalData } from './journal.ts';
import { detectKind, mdPortrait, OFFSETS, PALETTE, type Kind } from './kind.ts';
import { readShape, type Shape } from '../files/shape.ts';
import { GameMap, wrap } from './map.ts';
import { Obj, Objects, STATUS_OK_TO_TAKE, STATUS_TEMPORARY, type Loc } from './objects.ts';
import { Tiles } from './tiles.ts';
import { READY_BY_TILE } from './mdse.ts';
import { MdUseCode } from './mdusecode.ts';
import { SeUseCode } from './seusecode.ts';
import { OBJ, READY_SLOT } from './u6tables.ts';

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
  /** Already asked: this, or a word that gives the same answer. */
  heard?: boolean;
}

/** What a saved game holds (kept in this browser). */
export interface SaveState {
  version: 1;
  clock: Clock;
  turns: number;
  light?: number;
  rest?: number;
  keg?: number;
  wind?: [number, number];
  heard?: string[];
  /** Martian Dreams: the Avatar is dreaming, the party waiting. */
  dream?: unknown;
  moonstones?: [number, number, number][];
  party: { id: number; name: string }[];
  flags: { karma: number; quest: number; garg: number; gender: number; face?: number };
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
/** Where a red moongate goes, by its place round the one who opened it (U6UseCode.cpp red_moongate_tbl). */
const RED_GATES: readonly [number, number, number][] = [
  [0, 0, 0], [0x383, 0x1f3, 0], [0x3a7, 0x106, 0], [0x1b3, 0x18b, 0], [0x1f7, 0x166, 0], [0x93, 0x373, 0],
  [0x397, 0x3a6, 0], [0x44, 0x2d, 5], [0x133, 0x160, 0], [0xbc, 0x2d, 5], [0x9f, 0x3ae, 0], [0x2e3, 0x2bb, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0xe3, 0x83, 0], [0x17, 0x16, 1], [0x80, 0x56, 5], [0x6c, 0xdd, 5],
  [0x39b, 0x36c, 0], [0x127, 0x26, 0], [0x4b, 0x1fb, 0], [0x147, 0x336, 0], [0x183, 0x313, 0], [0x33f, 0xa6, 0],
  [0x29b, 0x43, 0],
];
const LORD_BRITISH = 5;
const MOONGATE = 85;
const TRAMMEL_PHASE = 1.75;
const FELUCCA_PHASE = 1.1666666666666667;
const SKIFF = 414;
const RAFT = 415;
const BOATS: ReadonlySet<number> = new Set([SHIP, SKIFF, RAFT]);
const BALLOON = 420;
const INFLATED_BALLOON = 423;
/** What the party can be aboard: boats, and the inflated balloon. */
const VEHICLES: ReadonlySet<number> = new Set([SHIP, SKIFF, RAFT, INFLATED_BALLOON]);
/** Nuvie's directions as the wind gives them (N, NE, E, SE, S, SW, W, NW): the way it blows from. */
const WIND_FROM: readonly [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const WIND_NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const HORSE = 430;
const HORSE_WITH_RIDER = 431;
const SHIP_DEED = 149;
const ORB_FLAG = 0x20;

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
  readonly kind: Kind;
  readonly tiles: Tiles;
  readonly objects: Objects;
  readonly map: GameMap;
  readonly actors: Actors;
  readonly lib: ConverseLib;
  readonly journal = new Journal();
  readonly combat: Combat;
  readonly magic: Magic;
  readonly usecode: UseCode;
  /** Turns left of a Light spell's glow round the party. */
  lightTurns = 0;
  /** Turns left of Infravision: everyone is seen, even in the dark. */
  infraTurns = 0;
  /** Until when (performance.now()) X-ray shows through walls. */
  xrayUntil = 0;
  /** What Vanish took, for Reappear. */
  vanished: { objN: number; frameN: number } | null = null;
  /** Where the eight moonstones lie, by phase (objlist 0x1c1b); a blue moongate stands at each while a moon is up. */
  moonstones: [number, number, number][] = [];
  /** Where the game's sounds go (the interface plays them): a sound's name, and for casting its circle. */
  sfx: (id: SfxId, circle?: number) => void = () => {};
  /** Something wants words typed (a rune's mantra, the crystal ball's bearings): what to ask, and what to do with them. */
  askText: { label: string; then: (text: string) => void } | null = null;
  /** The game asks the player to choose one of a list (a spell, a thing carried, a phase of the moons). */
  askChoice: { label: string; options: string[]; then: (i: number) => void } | null = null;
  /** Turns while no spell will take (Negate Magic; TIMER_STORM). */
  stormTurns = 0;
  /** Turns while the sun is darkened (Eclipse). */
  eclipseTurns = 0;
  /** Where the wind blows to, a step a turn; [0, 0] is calm (Weather.cpp). */
  wind: [number, number] = [0, 0];
  /** Minutes before the wind changes. */
  private windMinutes = 10;
  /** Hours before resting heals again (the clock's rest counter). */
  restCounter = 0;
  /** Turns until a lit powder keg goes off. */
  kegTurns = 0;
  /** The Codex has gone into the void, and the game is won. */
  won = false;
  /** Where the crystal ball looks: the land seen from above, about this place. */
  scry: { x: number; y: number; z: number } | null = null;
  /** The spellbook asks to be opened. */
  openBook = false;
  /** The Peer spell asks for the map seen from above. */
  peer = false;
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
  /** The conversation is over, its last words still showing until the player goes on. */
  talkOver = false;
  gender = 0;
  karma = 0;
  questFlag = 0;
  gargFlag = 0;
  turns = 0;
  /** Something wants a square chosen on the map (the orb's gate): what to say, and what to do with it. */
  askWhere: { label: string; then: (x: number, y: number) => void } | null = null;
  /** A container opened to look in. */
  openContainer: Obj | null = null;
  private readonly books: Lib | null;
  private readonly portraits: (Lib | null)[];
  private avatarPortrait = 0;
  private asked = '';
  private said = '';
  private pending: Converse['events'] = [];

  /** A mid-game scene to show (Martian Dreams' midgameN.lzc), or null. */
  cutscene: number | null = null;

  /** Martian Dreams' usecode (usecode.lua). */
  readonly mdUse = new MdUseCode(this);
  /** Savage Empire's usecode (usecode.lua). */
  readonly seUse = new SeUseCode(this);

  /** A new game, not a saved one: the Avatar may be made anew (the intro's character creation). */
  readonly fresh: boolean;

  constructor(
    readonly files: GameFiles,
    saved?: SaveState,
  ) {
    this.kind = detectKind(files);
    this.fresh = !saved && files.has('lzobjblk');
    this.tiles = new Tiles(files, this.kind);
    this.objects = new Objects(files, this.tiles, this.kind);
    this.map = new GameMap(files, this.tiles, this.objects);
    const objlist = this.loadObjects();
    this.actors = new Actors(files, objlist, this.kind);
    this.lib = new ConverseLib(files, this.kind);
    const lib = (n: string, w: 2 | 4): Lib | null => (files.has(n) ? new Lib(files.get(n)!, w) : null);
    this.books = lib('book.dat', 2);
    const wou = (n: string): Lib | null => (files.has(n) ? new Lib(files.get(n)!, 4, true) : null);
    this.portraits = this.kind === 'u6' ? [lib('portrait.a', 4), lib('portrait.b', 4), lib('portrait.z', 4)] : [wou(this.kind === 'md' ? 'mdfaces.lzc' : 'faces.lzc')];
    const r1 = (o: number): number => objlist[o] ?? 0;
    const t = OFFSETS[this.kind].gametime;
    this.clock = { minute: r1(t) % 60, hour: r1(t + 1) % 24, day: Math.max(1, r1(t + 2)), month: Math.max(1, r1(t + 3)), year: r1(t + 4) | (r1(t + 5) << 8) };
    this.questFlag = r1(0x1bf1);
    const w = r1(0x1bfa);
    this.wind = w < 8 ? [-WIND_FROM[w][0], -WIND_FROM[w][1]] : [0, 0];
    if (this.kind === 'u6') {
      const r2 = (o: number): number => r1(o) | (r1(o + 1) << 8);
      for (let i = 0; i < 8; i++) this.moonstones.push([r2(0x1c1b + i * 6), r2(0x1c1d + i * 6), r2(0x1c1f + i * 6)]);
    }
    this.karma = r1(0x1bf9);
    this.gargFlag = r1(0x1c5f);
    this.gender = this.kind === 'se' ? 0 : r1(OFFSETS[this.kind].gender);
    this.avatarPortrait = Math.max(0, r1(0x1c72) - 1);
    const n = Math.min(16, r1(0xff0));
    for (let i = 0; i < n; i++) {
      const a = this.actors.get(r1(0xfe0 + i));
      if (!a) continue;
      let name = '';
      for (let c = 0; c < 14 && r1(0xf00 + i * 14 + c) !== 0; c++) name += String.fromCharCode(r1(0xf00 + i * 14 + c));
      a.statusFlags |= STATUS_IN_PARTY;
      this.party.push({ actor: a, name: this.cleanName(name) });
    }
    if (this.party.length === 0) {
      const a = this.actors.get(1)!;
      a.statusFlags |= STATUS_IN_PARTY;
      this.party.push({ actor: a, name: 'Avatar' });
    }
    for (const a of this.actors.list) a.schedPos = a.schedulePos(this.clock.hour);
    if (this.kind === 'u6' && !saved) this.gatherBackHalves();
    this.combat = new Combat(this);
    this.magic = new Magic(this);
    this.usecode = new UseCode(this);
    if (saved) this.restore(saved);
    else this.say('sys', 'The world is loaded. Tap the map to walk.');
    this.combat.update(!saved);
    if (this.kind === 'u6' && !saved) this.updateMoongates();
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
      // A new game's hero, as Nuvie sets them up (SaveGame::update_objlist_for_new_game_u6): a name where the
      // files give none, and the starting level and numbers.
      if (objlist[0xf00] === 0) {
        const name = 'Avatar';
        for (let i = 0; i <= name.length; i++) objlist[0xf00 + i] = name.charCodeAt(i) || 0;
      }
      objlist[0x901] = objlist[0xa01] = objlist[0xb01] = 0xf;
      if (this.kind === 'u6') {
        if (objlist[0x1c72] === 0) objlist[0x1c72] = 1;
        objlist[0xc02] = 0x72;
        objlist[0xc03] = 0x01;
        objlist[0x13f2] = 0x1e;
        objlist[0xff2] = 3;
      } else if (this.kind === 'se') {
        objlist[0xe01] = 0xf * 2 + 0xf;
        objlist[0x14f2] = 0xf;
      } else {
        // Martian Dreams (update_objlist_for_new_game_md), as a man.
        objlist[0xc02] = 600 & 0xff;
        objlist[0xc03] = 600 >> 8;
        objlist[0xe01] = 0xf * 2 + 4 * 24;
        objlist[0xff2] = 4;
        objlist[0x14f2] = 0xf;
        objlist[0x15f2] = 20;
        objlist[0x1d27] = 0;
        for (const at of [0x402, 0x16f3]) {
          objlist[at] = 343 & 0xff;
          objlist[at + 1] = (343 >> 8) | (objlist[at + 1] & 0xfc);
        }
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

  /** The other squares of large creatures are drawn with them (Actor.parts), so their objects leave the map. */
  private gatherBackHalves(): void {
    for (const a of this.actors.list) {
      if (!MANY_SQUARES.has(a.objN) || a.objN === SHIP || !a.visible) continue;
      const kind = a.objN === HYDRA ? HYDRA_BODY : a.objN;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const o of [...(this.objects.list(a.x + dx, a.y + dy, a.z) ?? [])]) {
            if (o.objN === kind && (o.quality === a.id || o.quality === 0)) this.objects.unlink(o);
          }
        }
      }
    }
  }

  // ---- the party ----

  /** The boat the party is aboard (actor 0, as in the original), or null. */
  get vehicle(): Actor | null {
    const v = this.actors.get(0);
    return v && v.objN !== 0 && v.visible && VEHICLES.has(v.objN) ? v : null;
  }

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
    this.party.push({ actor: a, name: this.cleanName(this.lib.name(this.lib.scriptNum(a)).slice(0, 13)) || this.lookActor(a) });
  }
  partyRemove(a: Actor): void {
    const i = this.party.findIndex((m) => m.actor === a);
    if (i <= 0) return;
    this.party.splice(i, 1);
    a.statusFlags &= ~STATUS_IN_PARTY;
    a.worktype = WT.MOTIONLESS;
  }
  /** A name as the files spell it: Ultima 6 writes "." as "_", the other two a space. */
  cleanName(n: string): string {
    return n.replace(/_/g, this.kind === 'u6' ? '.' : ' ').replace(/\.\s*$/, '');
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

  advance(minutes: number): void {
    const c = this.clock;
    c.minute += minutes;

    // The wind changes every so often, to any way or none (Weather::change_wind_dir).
    this.windMinutes -= minutes;
    if (this.windMinutes <= 0) {
      this.windMinutes = this.random(30) + 1;
      const d = this.random(9);
      this.setWind(d < 8 ? [-WIND_FROM[d][0], -WIND_FROM[d][1]] : [0, 0]);
    }
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
      if (this.restCounter > 0) this.restCounter--;
      if (this.kind === 'u6') {
        this.magic.hourly();
        this.updateMoongates();
      }
    }
    // Martian Dreams' Mars as time passes: the cold, the air, radium, ice, berries.
    if (this.kind === 'md') this.mdUse.tick(minutes);
  }

  /** Where the party is, for the journal: a rough bearing, the world having no place names in its files. */
  where(): string {
    const p = this.player;
    if (p.z !== 0) return `underground, level ${p.z}`;
    // As the Locate spell has it (locate.lua): eighths of the map from 38 across and 45 down.
    const x = p.x >> 3;
    const y = p.y >> 3;
    return `${Math.abs(y - 45)}${y > 45 ? 'S' : 'N'} ${Math.abs(x - 38)}${x > 38 ? 'E' : 'W'}`;
  }

  // ---- moving ----

  /** Whether an actor could stand on a square now. */
  canStand(x: number, y: number, z: number): boolean {
    return this.map.isPassable(x, y, z) && !this.actors.at(wrap(x, z), wrap(y, z), z);
  }

  private closedDoorAt(x: number, y: number, z: number): Obj | null {
    const l = this.objects.list(x, y, z);
    return l?.find((o) => this.objects.isDoor(o) && this.objects.isShut(o)) ?? null;
  }

  /** Step the party one square. Returns whether a turn passed. */
  move(dx: number, dy: number): boolean {
    if (this.converse) return false;
    if (this.vehicle) return this.vehicle.objN === INFLATED_BALLOON ? this.drift() : this.sail(dx, dy);
    const p = this.player;
    const nx = wrap(p.x + dx, p.z);
    const ny = wrap(p.y + dy, p.z);
    this.openContainer = null;
    // A quest barrier stops those not on a Sacred Quest (U6UseCode::pass_quest_barrier), and passes those who are.
    const barrier = this.kind === 'u6' && this.objects.list(nx, ny, p.z)?.some((o) => o.objN === 416);
    if (barrier && this.questFlag === 0) {
      this.say('npc', '"Thou art not upon a Sacred Quest! Passage denied!"');
      this.sfx('blocked');
      this.onChange();
      return false;
    }
    // Over a Martian Dreams cliff's edge, whatever lies below.
    if (this.kind === 'md' && this.mdUse.cliff(dx, dy) && !this.actors.at(nx, ny, p.z)) {
      p.x = nx;
      p.y = ny;
      this.endTurn();
      return true;
    }
    // Martian Dreams' wheelbarrows, drills, rail cars and planks are pushed ahead (move_obj).
    const pushed = this.kind === 'md' && !this.actors.at(nx, ny, p.z) ? (this.objects.list(nx, ny, p.z) ?? []).find((o) => this.mdUse.pushable(o) && !this.objects.tileOf(o).passable) : undefined;
    if (pushed) {
      if (!this.mdUse.push(pushed, dx, dy)) {
        this.sfx('blocked');
        this.onChange();
        return false;
      }
      if (!this.map.isPassable(nx, ny, p.z)) {
        this.endTurn();
        return true;
      }
    }
    const other = this.actors.at(nx, ny, p.z);
    if (other && this.combat.hostile(other)) {
      this.combat.attack(p, other);
      this.endTurn();
      return true;
    }
    if (other && other.inParty) {
      // Change places with a companion.
      other.x = p.x;
      other.y = p.y;
      other.setDirection(facing(-dx, -dy));
    } else if (other || (!this.map.isPassable(nx, ny, p.z) && !barrier)) {
      const door = this.closedDoorAt(nx, ny, p.z);
      if (door && !other) {
        this.useDoor(door);
        this.endTurn();
        return true;
      }
      p.setDirection(facing(dx, dy));
      this.say('sys', 'Blocked!');
      this.sfx('blocked');
      this.onChange();
      return false;
    }
    const trail = this.party.map((m) => ({ x: m.actor.x, y: m.actor.y }));
    p.x = nx;
    p.y = ny;
    p.setDirection(facing(dx, dy));
    // Each companion takes the square the one ahead has left - but in a fight, each fights.
    const fighting = this.combat.fighting;
    for (let i = 1; i < this.party.length && !fighting; i++) {
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
    if (this.kind === 'u6') this.enterGate(nx, ny, p.z);
    this.endTurn();
    return true;
  }

  /** A turn goes by after something was done (the use code's). */
  passTurn(): void {
    this.endTurn();
  }

  /**
   * Rest (Event::rest, Party::can_rest, TimedRest): not in a fight, a town, near others, on a horse or in a cramped
   * place; on a ship, mend her. Otherwise a campfire and a meal - the bard plays - then sleep for the hours asked; those
   * who ate heal, once each twelve hours.
   */
  rest(hours: number): void {
    if (this.converse) return;
    const p = this.player;
    const v = this.vehicle;
    const no = (why: string): void => {
      this.say('sys', `Rest - ${why}`);
      this.sfx('failure');
      this.onChange();
    };
    if (this.combat.fighting) return no('Not while in combat!');
    if (v) {
      if (v.objN !== SHIP) return no('Can not be repaired!');
      v.hp = Math.min(100, v.hp + hours * 10);
      this.say('sys', `The crew mends the ship. Hull ${v.hp}%.`);
      for (let i = 0; i < hours; i++) this.advance(60);
      return this.endTurn();
    }
    if (this.inTown()) return no('Only in the wilderness!');
    if (this.combat.foes(5).length) return no('Not while foes are near!');
    if (this.actors.list.some((a) => a.visible && a.alive && a.objN && !a.inParty && a.z === p.z && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 5)) {
      return no('Not while others are near!');
    }
    if (p.objN === HORSE_WITH_RIDER) return no('Dismount first!');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!this.map.isPassable(p.x + dx, p.y + dy, p.z)) return no('Not enough room!');
    const fire = this.objects.create(253, 1, 0);
    fire.frameN = 1;
    fire.status |= STATUS_TEMPORARY;
    [fire.x, fire.y, fire.z] = [p.x, p.y, p.z];
    this.objects.add(fire);
    this.say('sys', 'Mealtime!');
    const bard = this.party.find((m) => m.actor.objN === OBJ.MUSICIAN);
    if (bard) this.say('sys', `${bard.name} plays a tune.`);
    const fed: Actor[] = [];
    for (const m of this.party) {
      const own = [...this.objects.inventories[m.actor.id]].find((o) => FOODS.has(o.objN));
      let food: Obj | undefined = own;
      if (!food) for (const q of this.party) food ??= this.objects.inventories[q.actor.id].find((o) => FOODS.has(o.objN));
      if (food) {
        if (this.objects.isStackable(food) && food.qty > 1) food.qty--;
        else this.objects.unlink(food);
        fed.push(m.actor);
        this.say('sys', `${m.name} has food.`);
      } else this.say('sys', `${m.name} has no food.`);
    }
    this.say('sys', `The party sleeps for ${hours} hour${hours === 1 ? '' : 's'}.`);
    for (let i = 0; i < hours; i++) this.advance(60);
    const heal = this.restCounter === 0;
    if (heal) {
      for (const a of fed) {
        let diff = a.maxHp - a.hp;
        if (diff <= 0) continue;
        if (diff === 1) diff = 2;
        a.hp = Math.min(a.maxHp, a.hp + this.random(Math.max(1, diff >> 1)) + (diff >> 1));
        this.say('sys', `${this.partyMemberName(a.id)} has healed.`);
      }
      this.restCounter = 12;
    }
    fire.frameN = 0;
    this.endTurn();
  }

  /** Walls with their sides marked within five squares: a town, where no one camps (MapWindow::in_town). */
  private inTown(): boolean {
    const p = this.player;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const t = this.map.tile(p.x + dx, p.y + dy, p.z);
        if (t.flags1 & 0x04 && t.flags1 & 0xf0) return true;
      }
    }
    return false;
  }

  /** Let a turn go by. */
  pass(): void {
    if (this.converse) return;
    if (this.vehicle?.objN === INFLATED_BALLOON && (this.wind[0] || this.wind[1])) {
      this.drift();
      return;
    }
    this.say('sys', 'Pass.');
    this.endTurn();
  }

  private endTurn(): void {
    this.turns++;
    if (this.turns % 2 === 0) this.advance(1);
    if (this.lightTurns > 0) this.lightTurns--;
    if (this.kegTurns > 0 && --this.kegTurns === 0) this.usecode.explodeKegs();
    if (this.infraTurns > 0) this.infraTurns--;
    if (this.stormTurns > 0) this.stormTurns--;
    if (this.kind === 'md') this.mdUse.turn();
    if (this.eclipseTurns > 0) this.eclipseTurns--;
    this.combat.update();
    this.combat.round();
    this.moveNpcs();
    const p = this.player;
    for (const a of this.actors.list) if (a.z === p.z && Math.abs(a.x - p.x) <= 16 && Math.abs(a.y - p.y) <= 16) this.combat.mapDamage(a);
    this.onChange();
  }

  /** Move the party to a place, as a ladder or death does, and let the eggs there hatch. */
  relocate(x: number, y: number, z: number): void {
    this.teleport(x, y, z);
    this.combat.update(true);
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
    const boat = this.vehicle;
    const ok = (x: number, y: number): boolean => {
      if (boat) return this.afloat(boat, x, y);
      if (this.map.isPassable(x, y, p.z)) {
        const a = this.actors.at(wrap(x, p.z), wrap(y, p.z), p.z);
        return !a || a.inParty;
      }
      const d = this.closedDoorAt(wrap(x, p.z), wrap(y, p.z), p.z);
      if (!d) return false;
      return this.kind === 'md' ? !(d.quality & 0x80) : d.frameN !== 9 && d.frameN !== 11 && d.frameN !== 13 && d.frameN !== 15;
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

  stepActor(a: Actor, dx: number, dy: number): boolean {
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
        default:
          // Martian Dreams' miners: the cokers and stokers of the coal works (worktype.lua).
          if (this.kind === 'md') this.mdUse.work(a);
      }
    }
  }

  // ---- casting ----

  /** Cast a spell (at a square, where it is aimed); a turn passes if it was cast. */
  castSpell(caster: Actor, spell: Spell, x?: number, y?: number): void {
    if (this.converse) return;
    if (this.magic.cast(caster, spell, x, y)) this.endTurn();
    else this.onChange();
  }

  // ---- fighting ----

  /** Attack whoever is at a square, if the party's leader can reach them from here. Returns false where not. */
  attackAt(x: number, y: number): boolean {
    if (this.converse) return false;
    const p = this.player;
    const foe = this.actors.at(x, y, p.z);
    if (!foe || foe === p) {
      this.say('sys', 'Nothing to attack there.');
      this.onChange();
      return true;
    }
    if (foe.inParty) {
      this.say('sys', 'Not a party member!');
      this.onChange();
      return true;
    }
    if (this.combat.range(p, x, y) > this.combat.reach(p) || !this.combat.clearLine(p.x, p.y, x, y, p.z)) return false;
    this.say('you', `Attack ${this.lookActor(foe).replace(/^(a|an|the) /, '')}`);
    if (!this.combat.hostile(foe) && !foe.inParty && foe.objN !== OBJ.LORD_BRITISH) this.karma = Math.max(0, this.karma - 5);
    this.combat.attack(p, foe);
    this.endTurn();
    return true;
  }

  // ---- looking ----

  look(x: number, y: number): void {
    const p = this.player;
    const a = this.actors.at(x, y, p.z);
    const o = this.objects.get(x, y, p.z);
    let text: string;
    if (a) {
      const m = this.party.find((m) => m.actor === a);
      text = m ? m.name : a.met ? this.cleanName(this.lib.name(this.lib.scriptNum(a))) || this.tiles.look(this.objects.objToTile[a.objN], 0) : this.tiles.look(this.objects.objToTile[a.objN], 0);
    } else if (o && !(o.status & 0x02)) text = this.objects.look(o);
    else text = this.tiles.look(this.map.tileNum(x, y, p.z), 0);
    // A holy brazier is named for the virtue it burns for (holy_flame).
    if (!a && o && this.kind === 'u6' && o.objN === 206 && o.quality >= 1 && o.quality <= 3) {
      this.say('sys', `The flame of ${['truth', 'love', 'courage'][o.quality - 1]}.`);
      return this.onChange();
    }
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
        // Martian Dreams and Savage Empire write a closing quote as &.
        if (this.kind !== 'u6') e.text = e.text.replace(/"/g, '\u201c').replace(/&/g, '\u201d');
        this.say('npc', e.text);
        this.said += e.text;
        this.learn(c, e.text);
      } else if (e.type === 'portrait') this.speaker = { actor: e.actor, name: this.cleanName(e.name) };
      else if (e.type === 'pause') {
        // A stop with nothing after it but the question needs no tap.
        this.said += ' ';
        if (this.pending.some((n) => n.type === 'text' && n.text.trim())) {
          this.paused = true;
          break;
        }
      } else if (e.type === 'end') {
        // The last words stay to be read: the player goes on when ready.
        this.keepNote(c);
        this.pending = [];
        this.talkOver = true;
        this.paused = true;
        break;
      }
    }
    if (!this.paused && c.ask) this.keepNote(c);
    this.onChange();
  }

  private keepNote(c: Converse): void {
    const a = c.npc;
    const name = a.met || this.partyContains(a.id) ? this.cleanName(c.name) : '';
    this.journal.meet(a.id, name, c.desc, this.where(), this.date());
    if (this.asked) this.journal.note(a.id, this.asked === 'met' ? 'On meeting' : this.asked, this.said, this.date());
    this.said = '';
    this.asked = '';
  }

  /** Remember the words a speaker drops that they answer to: those marked in what they say, and any that fit a keyword. */
  private learn(c: Converse, text: string): void {
    const keys = this.lib.keywords(this.lib.scriptNum(c.npc));
    for (const m of text.matchAll(/(@?)([A-Za-z]+(?:'[A-Za-z]+)*)/g)) {
      // "cellar's" is asked about as "cellar".
      const word = m[2].toLowerCase().replace(/'s$/, '');
      if (word.length < 3) continue;
      const fits = keys.some((k) => k.length >= Math.min(4, word.length) && checkKeywords(k, word));
      if (fits || (m[1] && keys.length === 0)) this.journal.addTopic(c.npc.id, word);
    }
  }

  /** The player taps to hear the rest. */
  continueTalk(): void {
    if (!this.converse || !this.paused) return;
    if (this.talkOver) {
      this.talkOver = false;
      this.paused = false;
      this.converse = null;
      this.speaker = null;
      this.endTurn();
      return;
    }
    this.pump();
  }

  reply(s: string): void {
    const c = this.converse;
    if (!c || !c.ask || this.paused) return;
    this.say('you', s || 'bye');
    this.asked = s || 'bye';
    this.said = '';
    // What was asked, by the answer it leads to: every word that gives it is then heard.
    if (c.ask.type === 'keyword') {
      const at = c.answerFor(s);
      if (at !== null) this.heard.add(`${c.npc.id}:${at}`);
    }
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
    for (const o of out) {
      const at = o.say === 'bye' ? null : c.answerFor(o.say);
      o.heard = at !== null && this.heard.has(`${c.npc.id}:${at}`);
    }
    return out;
  }

  /** The answers heard, by person and where they begin in their script (kept with the game). */
  heard = new Set<string>();

  // ---- using ----

  private useDoor(o: Obj): void {
    if (this.kind === 'md') {
      // usecode.lua use_door: stuck with rust, or blocked, or turned.
      if (o.quality & 0x80) this.say('sys', 'It is locked.');
      else if (this.actors.at(o.x, o.y, o.z)) this.say('sys', 'Blocked.');
      else {
        o.frameN ^= 2;
        this.say('sys', o.frameN & 2 ? 'Closed.' : 'Opened.');
      }
      return;
    }
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
    this.relocate(x, y, z);
    this.say('sys', down ? 'Down the party goes.' : 'Up the party goes.');
  }

  /** Use what is at a square (beside the party), or an object carried. */
  use(x: number, y: number): void {
    const p = this.player;
    if (this.vehicle) {
      if (this.vehicle.objN === INFLATED_BALLOON) this.land();
      else this.disembark(x, y);
      return;
    }
    const steed = this.actors.at(x, y, p.z);
    if (steed && (steed.objN === HORSE || (steed === p && p.objN === HORSE_WITH_RIDER))) {
      this.horse(steed);
      return;
    }
    if (steed && steed.objN === 428 && this.kind === 'u6') {
      // A cow gives milk to an empty bucket (use_cow).
      this.usecode.fill(179);
      return;
    }
    const l = this.objects.list(x, y, p.z);
    // Of what is here, the thing that does something when used; else the topmost.
    const door = l?.find((o) => this.objects.isDoor(o));
    const working = l ? [...l].reverse().find((o) => !(o.status & 0x02) && (this.kind === 'md' ? this.mdUse.handles(o) : this.kind === 'se' ? this.seUse.handles(o) : USED_IN_PLACE.has(o.objN) || this.usecode.handles(o))) : undefined;
    const o = door ?? working ?? this.objects.get(x, y, p.z);
    if (!o || o.status & 0x02) {
      this.say('sys', 'Nothing to use there.');
      this.onChange();
      return;
    }
    this.useObj(o);
  }

  useObj(o: Obj): void {
    if (this.kind === 'se' && this.seUse.handles(o)) {
      const holder = o.loc === 'inv' || o.loc === 'readied' ? this.actors.get(o.holder) : null;
      this.seUse.use(o, holder && holder.inParty ? holder : this.player);
      return;
    }
    if (this.kind === 'md' && this.mdUse.handles(o)) {
      // Whoever carries it uses it (berries are eaten by the one who has them).
      const holder = o.loc === 'inv' || o.loc === 'readied' ? this.actors.get(o.holder) : null;
      this.mdUse.use(o, holder && holder.inParty ? holder : this.player);
      return;
    }
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
    } else if (o.objN === 78 && this.kind === 'u6') {
      // A staff is used, not searched: it holds its charges (use_staff).
      this.usecode.use(o);
      return;
    } else if (o.container && o.objN !== OBJ.EGG) {
      if (o.objN === OBJ.CHEST && o.frameN >= 2) this.say('sys', o.frameN === 3 ? 'Magically locked.' : 'Locked.');
      else {
        if (o.objN === OBJ.CHEST) o.frameN = 0;
        this.openContainer = o;
        this.say('sys', o.container.length ? `Searching the ${name}.` : `The ${name} is empty.`);
      }
    } else if (o.objN === OBJ.TORCH && this.kind === 'u6') this.useTorch(o);
    else if ((BOATS.has(o.objN) || o.objN === INFLATED_BALLOON) && this.kind === 'u6') {
      this.board(o);
      return;
    } else if (o.objN === BALLOON && this.kind === 'u6') {
      this.inflate(o);
      return;
    } else if (o.objN === OBJ.ORB_OF_THE_MOONS && this.kind === 'u6') {
      this.useOrb();
      return;
    }
    else if (this.usecode.handles(o)) {
      this.usecode.use(o);
      return;
    } else if (FOOD.has(o.objN)) {
      if (o.qty > 1) o.qty--;
      else this.objects.unlink(o);
      this.say('sys', 'You eat the food.');
    } else this.say('sys', 'Not usable.');
    this.endTurn();
  }

  // ---- getting and dropping ----

  /** Pick up what is on a square, or take `o` from an opened container; it goes to whoever has room. */
  /** Whether a thing on the map can be taken up and dragged: within reach, not fixed in place. */
  canDrag(o: Obj): boolean {
    const p = this.player;
    return o.loc === 'map' && !(o.status & 0x02) && o.z === p.z && Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y)) <= 1 &&
      !this.objects.isDoor(o) && this.objects.weightOf(o) > 0 && !this.vehicle;
  }

  /**
   * Set a dragged thing down (the original's Move): on someone of the party, it is theirs (as Get); else on a free
   * square near enough to throw it to, in plain sight.
   */
  dragTo(o: Obj, x: number, y: number): void {
    const p = this.player;
    const who = this.actors.at(x, y, p.z);
    if (who && who.inParty) return this.get(o.x, o.y, o, who);
    if (x === o.x && y === o.y) return;
    if (who || Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) > 3 || !this.combat.clearLine(p.x, p.y, x, y, p.z) ||
      !this.map.isPassable(x, y, p.z)) {
      this.say('sys', 'Blocked.');
      this.sfx('blocked');
      this.onChange();
      return;
    }
    if (!(o.status & STATUS_OK_TO_TAKE) && this.objects.weightOf(o) < 25.5 && this.objects.tileOf(o).passable) {
      // Moving what is not yours is as taking it.
      this.karma = Math.max(0, this.karma - 1);
      o.status |= STATUS_OK_TO_TAKE;
    }
    this.objects.move(o, x, y, p.z);
    this.say('sys', `Move ${this.objects.look(o)}.`);
    this.endTurn();
  }

  get(x: number, y: number, o: Obj | null = null, to: Actor | null = null): void {
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
    const taker = to ? (this.invRoom(to.id) >= w ? this.party.find((m) => m.actor === to) : undefined) : this.party.find((m) => this.invRoom(m.actor.id) >= w);
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
    } else this.say('sys', to ? `${taker.name} takes ${what}.` : `Get ${what}.`);
    // A moonstone taken from the ground no longer holds a moongate (U6UseCode::use_moonstone).
    if (o.objN === 73 && o.loc === 'map' && this.kind === 'u6') {
      this.moonstones[o.frameN & 7] = [0, 0, 0];
      this.objects.toInventory(o, taker.actor.id);
      this.updateMoongates();
    } else this.objects.toInventory(o, taker.actor.id);
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

  // ---- boats and horses (U6UseCode::use_boat, use_horse) ----

  /** Board a ship, skiff or raft beside the party: it becomes the party's vehicle, and the party goes aboard. */
  private board(o: Obj): void {
    const p = this.player;
    let centre = o;
    if (o.objN === SHIP) {
      // A ship is three objects; its middle (frames 8 to 15) is the ship.
      const near: Obj[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.push(...(this.objects.list(o.x + dx, o.y + dy, o.z) ?? []));
      const mid = [o, ...near].find((n) => n.objN === SHIP && n.frameN >= 8 && n.frameN < 16);
      if (!mid) {
        this.say('sys', 'Ship not usable.');
        this.onChange();
        return;
      }
      centre = mid;
    } else if (o.objN === INFLATED_BALLOON) {
      // Aloft from where it stands.
    } else if (!this.map.isWater(o.x, o.y, o.z) && !this.map.tile(o.x, o.y, o.z).water) {
      this.say('sys', 'You must place it in water first.');
      this.onChange();
      return;
    }
    if (o.loc !== 'map') {
      this.say('sys', 'Not usable.');
      this.onChange();
      return;
    }
    // Beside any part of it: a ship's bow and stern reach a square either side of its middle.
    if (Math.max(Math.abs(centre.x - p.x), Math.abs(centre.y - p.y)) > (centre.objN === SHIP ? 3 : 2)) {
      this.say('sys', 'Out of range.');
      this.onChange();
      return;
    }
    if (centre.quality !== 0) {
      if (!this.party.some((m) => invFind(this.objects, m.actor.id, SHIP_DEED, centre.quality, true))) {
        this.say('sys', 'A deed is required.');
        this.onChange();
        return;
      }
      centre.quality = 0;
    }
    const v = this.actors.get(0)!;
    v.objN = centre.objN;
    v.baseObjN = centre.objN;
    v.frameN = centre.frameN;
    v.direction = centre.objN === SHIP ? ((centre.frameN - 8) >> 1) & 3 : centre.objN === SKIFF ? centre.frameN & 3 : 0;
    [v.x, v.y, v.z] = [centre.x, centre.y, centre.z];
    v.hp = centre.objN === SHIP ? centre.qty || 100 : 10;
    v.worktype = WT.PLAYER;
    v.statusFlags = 0x40; // good
    v.visible = true;
    v.setDirection(v.direction);
    // The ship's bow and stern go with it.
    if (centre.objN === SHIP) for (const part of v.parts()) for (const n of [...(this.objects.list(part.x, part.y, v.z) ?? [])]) if (n.objN === SHIP) this.objects.unlink(n);
    this.objects.unlink(centre);
    for (const m of this.party) {
      [m.actor.x, m.actor.y, m.actor.z] = [v.x, v.y, v.z];
      m.actor.visible = false;
    }
    this.say('sys', `Board the ${this.tiles.look(this.objects.objToTile[centre.objN], 0, false)}.`);
    if (centre.objN === INFLATED_BALLOON) this.say('sys', `The wind is ${this.windWords()}.`);
    this.endTurn();
  }

  /**
   * Whether a boat can lie on a square (U6Actor::check_move): water, nothing else there, and for a ship open water -
   * not the shore's tiles (16 to 47).
   */
  afloat(v: Actor, x: number, y: number): boolean {
    const other = this.actors.at(wrap(x, v.z), wrap(y, v.z), v.z);
    if (other && other !== v) return false;
    if (v.objN === INFLATED_BALLOON) return true;
    if (!this.map.isWater(x, y, v.z)) return false;
    const n = this.map.tileNum(x, y, v.z);
    return !(v.objN === SHIP && n >= 16 && n <= 47);
  }

  /** Sail a square: water only, the party aboard going with the boat. */
  private sail(dx: number, dy: number): boolean {
    const v = this.vehicle!;
    const d = facing(dx, dy);
    const [ox, oy, od] = [v.x, v.y, v.direction];
    // A ship turns before it moves.
    const turning = v.objN === SHIP && d !== v.direction;
    if (!turning) {
      v.x = wrap(v.x + dx, v.z);
      v.y = wrap(v.y + dy, v.z);
    }
    v.setDirection(v.objN === SHIP ? d : v.objN === SKIFF ? d : 0);
    if (!this.afloat(v, v.x, v.y) || v.parts().some((q) => !this.afloat(v, q.x, q.y))) {
      [v.x, v.y] = [ox, oy];
      v.setDirection(od);
      this.say('sys', 'Blocked!');
      this.sfx('blocked');
      this.onChange();
      return false;
    }
    for (const m of this.party) [m.actor.x, m.actor.y] = [v.x, v.y];
    this.endTurn();
    return true;
  }

  /** Step off the boat onto land beside it; the boat stays where it is. */
  disembark(x: number, y: number): void {
    const v = this.vehicle;
    if (!v) return;
    let land: [number, number] | null = null;
    const isLand = (lx: number, ly: number): boolean => this.map.isPassable(lx, ly, v.z) && !this.map.tile(lx, ly, v.z).water && !this.actors.at(lx, ly, v.z);
    if (Math.max(Math.abs(x - v.x), Math.abs(y - v.y)) <= 1 && isLand(x, y)) land = [x, y];
    for (let dy = -1; dy <= 1 && !land; dy++) for (let dx = -1; dx <= 1 && !land; dx++) if (isLand(v.x + dx, v.y + dy)) land = [v.x + dx, v.y + dy];
    if (!land) {
      this.say('sys', 'Only next to land.');
      this.onChange();
      return;
    }
    // The boat is objects on the map again (a ship its three).
    const put = (objN: number, frame: number, px: number, py: number, qty: number): void => {
      const o = this.objects.create(objN, qty, 0);
      o.frameN = frame;
      [o.x, o.y, o.z] = [px, py, v.z];
      this.objects.add(o);
    };
    put(v.objN, v.frameN, v.x, v.y, v.objN === SHIP ? v.hp : 0);
    if (v.objN === SHIP) for (const q of v.parts()) put(SHIP, q.frame, q.x, q.y, 150);
    Object.assign(v, { objN: 0, visible: false, worktype: 0, x: 0, y: 0, z: 0 });
    for (const m of this.party) m.actor.visible = true;
    this.relocate(land[0], land[1], v.z === 0 ? this.player.z : this.player.z);
    this.say('sys', 'The party goes ashore.');
    this.endTurn();
  }

  // ---- the balloon (U6UseCode::use_balloon, Player::moveRelative) ----

  /** The wind as words: "from the north", or calm. */
  windWords(): string {
    const [dx, dy] = this.wind;
    if (!dx && !dy) return 'calm';
    const i = WIND_FROM.findIndex(([fx, fy]) => fx === -dx && fy === -dy);
    return `from the ${WIND_NAMES[i]}`;
  }

  setWind(w: [number, number]): void {
    const p = this.player;
    if (p.z > 0 && p.z < 5) w = [0, 0];
    const changed = w[0] !== this.wind[0] || w[1] !== this.wind[1];
    this.wind = w;
    if (changed && this.vehicle?.objN === INFLATED_BALLOON) this.say('sys', `The wind is ${this.windWords()}.`);
  }

  /** Lay out a balloon carried, or one on the ground, and fill it: it stands ready to board. */
  inflate(o: Obj): void {
    const p = this.player;
    if (p.z > 0 && p.z < 5) {
      this.say('sys', 'Not usable.');
      return this.onChange();
    }
    if (o.loc !== 'map') {
      let spot: [number, number] = [p.x, p.y];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && spot[0] === p.x && spot[1] === p.y && this.canStand(p.x + dx, p.y + dy, p.z)) spot = [p.x + dx, p.y + dy];
      this.objects.unlink(o);
      [o.x, o.y, o.z] = [spot[0], spot[1], p.z];
      o.status |= STATUS_OK_TO_TAKE;
      this.objects.add(o);
    }
    o.objN = INFLATED_BALLOON;
    o.frameN = 3;
    this.say('sys', 'Done!');
    this.endTurn();
  }

  /** The balloon goes where the wind takes it, over anything; the party's wishes count for nothing. */
  private drift(): boolean {
    const v = this.vehicle!;
    const [dx, dy] = this.wind;
    if (!dx && !dy) {
      this.say('sys', 'Thou canst not move without wind!');
      this.onChange();
      return false;
    }
    v.x = wrap(v.x + dx, v.z);
    v.y = wrap(v.y + dy, v.z);
    for (const m of this.party) [m.actor.x, m.actor.y] = [v.x, v.y];
    this.endTurn();
    return true;
  }

  /** Come down beside the balloon's square (use_boat_find_land: north, east, south, west); it lies there, empty. */
  private land(): void {
    const v = this.vehicle!;
    const spot = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [v.x + dx, v.y + dy]).find(([x, y]) => this.canStand(x, y, v.z) && !this.map.tile(x, y, v.z).water);
    if (!spot) {
      this.say('sys', 'Only next to land.');
      return this.onChange();
    }
    const o = this.objects.create(BALLOON, 1, 0);
    [o.x, o.y, o.z] = [spot[0], spot[1], v.z];
    o.status |= STATUS_OK_TO_TAKE;
    this.objects.add(o);
    Object.assign(v, { objN: 0, visible: false, worktype: 0, x: 0, y: 0, z: 0 });
    for (const m of this.party) m.actor.visible = true;
    this.relocate(spot[0], spot[1], this.player.z);
    this.say('sys', 'The party climbs down.');
    this.endTurn();
  }

  /** Mount a horse beside the leader, or get down from one (only horses that roam may be ridden). */
  private horse(steed: Actor): void {
    const p = this.player;
    if (steed === p) {
      p.objN = p.baseObjN && p.baseObjN !== HORSE_WITH_RIDER ? p.baseObjN : OBJ.AVATAR;
      p.setDirection(p.direction);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && this.canStand(p.x + dx, p.y + dy, p.z)) {
            this.combat.spawn(HORSE, wrap(p.x + dx, p.z), wrap(p.y + dy, p.z), p.z, 1, 0xc);
            this.say('sys', 'Dismount.');
            this.endTurn();
            return;
          }
        }
      }
      this.say('sys', 'Dismount.');
      this.endTurn();
      return;
    }
    if (steed.id < 203) {
      this.say('sys', 'Horse not boardable!');
      this.onChange();
      return;
    }
    if (Math.max(Math.abs(steed.x - p.x), Math.abs(steed.y - p.y)) > 1) {
      this.say('sys', 'Out of range.');
      this.onChange();
      return;
    }
    p.baseObjN = p.objN;
    [p.x, p.y] = [steed.x, steed.y];
    Object.assign(steed, { objN: 0, visible: false, x: 0, y: 0, z: 0, worktype: 0 });
    p.objN = HORSE_WITH_RIDER;
    p.setDirection(p.direction);
    this.say('sys', 'Mount the horse.');
    this.endTurn();
  }

  /**
   * The Orb of the Moons (U6UseCode::use_orb): once Lord British has told of it, it opens a red moongate on a square
   * near the party, and where the gate leads is told by which square.
   */
  private useOrb(): void {
    const lb = this.actors.get(LORD_BRITISH);
    if (!lb || !(lb.talkFlags & ORB_FLAG)) {
      this.say('sys', "You can't figure out how to use it.");
      this.onChange();
      return;
    }
    this.say('sys', 'Where?');
    this.askWhere = {
      label: 'Orb: tap where',
      then: (ox, oy) => {
        this.askWhere = null;
        const p = this.player;
        const px = 3 + ox - p.x;
        const py = 2 + oy - p.y;
        if (px < 0 || py < 0 || px > 5 || py > 4 || this.actors.at(ox, oy, p.z) || !this.map.isPassable(ox, oy, p.z)) {
          this.say('sys', 'Failed.');
          this.onChange();
          return;
        }
        let place = px + py * 5;
        if (place >= 12 && place <= 14) place = 0;
        const gate = this.objects.create(OBJ.RED_GATE, 1, place);
        gate.status |= STATUS_TEMPORARY;
        [gate.x, gate.y, gate.z] = [ox, oy, p.z];
        this.objects.add(gate);
        this.say('sys', 'A red moongate appears.');
        this.endTurn();
      },
    };
    this.onChange();
  }

  /** The moons' phases and places in the sky (Weather::is_moon_visible, U6UseCode::enter_moongate). */
  private moons(): { trammel: number; felucca: number; posT: number; posF: number } {
    const { day, hour } = this.clock;
    const trammel = Math.round((day - 1) / TRAMMEL_PHASE) % 8;
    const pb = ((day - 1) % Math.round(FELUCCA_PHASE * 8)) - 1;
    const felucca = pb >= 0 ? pb : 0;
    return { trammel, felucca, posT: (hour + 1 + 3 * trammel) % 24, posF: (((hour - 1 + 3 * felucca) % 24) + 24) % 24 };
  }

  /** Blue moongates stand at the moonstones while either moon is up (update_moongates in init.lua). */
  updateMoongates(): void {
    const m = this.moons();
    const show = (m.posT >= 5 && m.posT <= 19) || (m.posF >= 5 && m.posF <= 19);
    for (const [x, y, z] of this.moonstones) {
      if (x === 0 && y === 0) continue;
      const gate = this.objects.list(x, y, z)?.find((o) => o.objN === MOONGATE);
      if (show && !gate) {
        const o = this.objects.create(MOONGATE, 1, 0);
        o.frameN = 1;
        [o.x, o.y, o.z] = [x, y, z];
        this.objects.add(o);
      } else if (!show && gate) this.objects.unlink(gate);
    }
  }

  /** Stepping into a moongate (U6UseCode::enter_moongate): a red one where its place says, a blue one where the moons do. */
  private enterGate(x: number, y: number, z: number): boolean {
    const blue = this.objects.list(x, y, z)?.find((o) => o.objN === MOONGATE && o.x === x);
    if (blue) {
      // The moon nearer the top of the sky chooses the moonstone.
      const m = this.moons();
      const phase = Math.abs(m.posT - 12) < Math.abs(m.posF - 12) ? m.trammel : m.felucca;
      const to = 8 - phase < 8 ? this.moonstones[8 - phase] : undefined;
      if (!to || (to[0] === 0 && to[1] === 0)) return false;
      this.relocate(to[0], to[1], to[2]);
      this.say('sys', 'The world shimmers...');
      return true;
    }
    const gate = this.objects.list(x, y, z)?.find((o) => o.objN === OBJ.RED_GATE && o.x === x);
    if (!gate) return false;
    const to = RED_GATES[gate.quality] ?? RED_GATES[0];
    if (!this.party.some((m) => invFind(this.objects, m.actor.id, OBJ.ORB_OF_THE_MOONS))) {
      this.say('sys', 'You forgot the Orb of the Moons!');
      return false;
    }
    this.objects.unlink(gate);
    if (to[0] === 0 && to[1] === 0) {
      this.say('sys', 'The gate leads nowhere, and fades.');
      return true;
    }
    this.relocate(to[0], to[1], to[2]);
    this.say('sys', 'The world shimmers...');
    return true;
  }

  /** Light a torch and hold it, or put one out (U6UseCode::use_torch, simplified). */
  private useTorch(o: Obj): void {
    if (o.frameN === 1) {
      o.frameN = 0;
      if (o.loc === 'readied') o.loc = 'inv';
      this.say('sys', 'The torch goes out.');
      return;
    }
    const holder = o.loc === 'inv' || o.loc === 'readied' ? this.actors.get(o.holder) : this.player;
    if (!holder) return;
    if (o.loc === 'map') this.objects.toInventory(o, holder.id);
    if (this.ready(o, holder)) {
      const lit = this.objects.inventories[holder.id].find((t) => t.objN === OBJ.TORCH && t.loc === 'readied' && t.frameN === 0);
      if (lit) lit.frameN = 1;
      this.say('sys', 'The torch is lit.');
    }
  }

  /** Where a thing is worn or held, or undefined: by object in Ultima VI, by tile in the others. */
  readySlot(o: Obj): number | undefined {
    return this.kind === 'u6' ? READY_SLOT.get(o.objN) : READY_BY_TILE[this.kind].get(this.objects.tileNum(o));
  }

  /** Whether a thing can be worn or held. */
  readiable(o: Obj): boolean {
    return this.readySlot(o) !== undefined;
  }

  /**
   * Wear or hold a thing (Actor::add_readied_object): a slot each for head, neck, body and feet; two arms, a weapon
   * held in both taking both; two hands for rings.
   */
  ready(o: Obj, a: Actor): boolean {
    const slot = this.readySlot(o);
    const what = this.objects.look(o);
    if (slot === undefined) {
      this.say('sys', `${what} cannot be readied.`);
      this.onChange();
      return false;
    }
    const worn = this.objects.inventories[a.id].filter((r) => r.loc === 'readied' && r !== o).map((r) => this.readySlot(r) ?? -1);
    const arms = worn.filter((w) => w === 3).length + worn.filter((w) => w === 4).length * 2;
    // Two rings in Ultima VI; one pair of gloves in Martian Dreams.
    const ok =
      slot === 3 ? arms < 2 : slot === 4 ? arms === 0 : slot === 5 && this.kind === 'u6' ? worn.filter((w) => w === 5).length < 2 : !worn.includes(slot);
    if (ok && this.kind === 'md' && !this.mdUse.ready(o, a, true)) return false;
    if (!ok) {
      this.say('sys', `${this.partyMemberName(a.id) || 'They'} cannot ready ${what}: take something off first.`);
      this.onChange();
      return false;
    }
    // A thing in a bag comes out to be held; a stack gives one of itself.
    let item = o;
    if (this.objects.isStackable(o) && o.qty > 1) {
      o.qty--;
      item = this.objects.create(o.objN, 1, o.quality);
      item.frameN = o.frameN;
    }
    if (item.loc !== 'inv' || item.holder !== a.id) {
      this.objects.unlink(item);
      this.objects.inventories[a.id].unshift(item);
      item.holder = a.id;
    }
    item.loc = 'readied';
    this.say('sys', `${this.partyMemberName(a.id) || 'They'} readied ${what}.`);
    if (this.kind === 'u6') this.u6Worn(item, a, true);
    this.onChange();
    return true;
  }

  unready(o: Obj): void {
    if (o.loc !== 'readied') return;
    if (this.kind === 'md' && !this.mdUse.ready(o, this.actors.get(o.holder) ?? this.player, false)) return this.onChange();
    // The amulet of submission will not come off (amulet_of_submission).
    if (this.kind === 'u6' && o.objN === 76) {
      this.say('sys', 'Magical energy prevents you from removing the amulet.');
      return this.onChange();
    }
    o.loc = 'inv';
    this.say('sys', `Unreadied ${this.objects.look(o)}.`);
    if (this.kind === 'u6') this.u6Worn(o, this.actors.get(o.holder) ?? this.player, false);
    this.onChange();
  }

  /**
   * What putting on or taking off a magic thing does in Ultima VI: an invisibility ring hides its wearer while one is
   * worn (magic_ring), and the storm cloak stills magic about the party while worn (storm_cloak's TIMER_U6_STORM).
   */
  private u6Worn(o: Obj, a: Actor, on: boolean): void {
    if (o.objN === 258) {
      const worn = this.objects.inventories[a.id].some((r) => r.loc === 'readied' && r.objN === 258);
      if (worn) a.objFlags |= 0x02;
      else a.objFlags &= ~0x02;
    } else if (o.objN === 81) {
      this.stormTurns = on ? 20 : 0;
    }
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

  /** A face for an actor, or null. */
  portrait(a: Actor): Shape | null {
    if (this.kind !== 'u6') {
      const num = this.kind === 'md' ? mdPortrait(a.id, a.objFlags, a.talkFlags, this.gender === 1) : a.id - 1;
      const item = num >= 0 ? this.portraits[0]?.item(num) : null;
      return item && item.length > 16 ? readShape(item, 8) : null;
    }
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
      return d.length >= 56 * 64 ? { w: 56, h: 64, data: d } : null;
    } catch {
      return null;
    }
  }

  /** One of the twelve faces the Avatar may wear (portrait.z): women's 0 to 5, men's 6 to 11. */
  avatarFace(n: number): Shape | null {
    const raw = this.portraits[2]?.raw(n);
    if (!raw) return null;
    try {
      const d = lzwDecompress(raw);
      return d.length >= 56 * 64 ? { w: 56, h: 64, data: d } : null;
    } catch {
      return null;
    }
  }

  /**
   * The Avatar as the player made them (SaveGame::update_objlist_for_new_game_u6): name, sex and face, and the
   * strength, dexterity and intelligence the gypsy's questions gave; magic twice the wits, level 3.
   */
  createHero(h: { name: string; female: boolean; face: number; str: number; dex: number; int: number }): void {
    const a = this.actors.get(1)!;
    this.party[0].name = h.name.trim().slice(0, 13) || 'Avatar';
    this.gender = h.female ? 1 : 0;
    if (this.kind === 'u6') this.avatarPortrait = (h.female ? 0 : 6) + h.face;
    a.strength = h.str;
    a.dex = h.dex;
    a.intelligence = h.int;
    if (this.kind === 'u6') {
      a.magic = h.int * 2;
      a.level = 3;
      a.exp = 0x172;
    } else if (this.kind === 'md') {
      // update_objlist_for_new_game_md: a man or a woman to look at, level 4, health strength twice and 96.
      a.objN = a.baseObjN = h.female ? 344 : 343;
      a.level = 4;
      a.exp = 600;
      a.hp = h.str * 2 + 4 * 24;
      a.setDirection(a.direction);
    } else {
      // update_objlist_for_new_game_se: health twice the strength and the wits.
      a.hp = h.str * 2 + h.int;
    }
    a.hp = Math.min(a.hp, a.maxHp) || a.maxHp;
    this.onChange();
  }

  /** A conversation's call into the game's own scripts (Martian Dreams' talk.lua). */
  talkScript(n: number): void {
    if (this.kind === 'md') this.mdUse.talkScript(n);
  }

  /** A cutscene's lines (ScriptCutscene::load_text): one item of a .lzc file, a line a string. */
  sceneText(file: string, item: number): string[] {
    const data = this.files.get(file) ? new Lib(this.files.get(file)!, 4, true).item(item) : null;
    if (!data) return [];
    let t = '';
    for (const c of data) t += String.fromCharCode(c);
    return t.split('\r\n');
  }

  /** The palette's file. */
  get paletteFile(): string {
    return PALETTE[this.kind];
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
      light: this.lightTurns,
      rest: this.restCounter,
      keg: this.kegTurns,
      wind: this.wind,
      heard: [...this.heard],
      dream: this.kind === 'md' ? this.mdUse.saveDream() : undefined,
      moonstones: this.moonstones,
      party: this.party.map((m) => ({ id: m.actor.id, name: m.name })),
      flags: { karma: this.karma, quest: this.questFlag, garg: this.gargFlag, gender: this.gender, face: this.avatarPortrait },
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
    this.lightTurns = s.light ?? 0;
    if (s.wind) this.wind = s.wind;
    if (s.heard) this.heard = new Set(s.heard);
    if (this.kind === 'md') this.mdUse.loadDream(s.dream);
    this.restCounter = s.rest ?? 0;
    this.kegTurns = s.keg ?? 0;
    if (s.moonstones) this.moonstones = s.moonstones;
    this.karma = s.flags.karma;
    this.questFlag = s.flags.quest;
    this.gargFlag = s.flags.garg;
    this.gender = s.flags.gender;
    if (s.flags.face !== undefined) this.avatarPortrait = s.flags.face;
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

}
