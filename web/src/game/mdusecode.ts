/**
 * mdusecode.ts - what using things does in Martian Dreams (Nuvie's data/scripts/md/usecode.lua): berries and
 * sextants, crates and containers, gates and switches with the doors they work, oil for rusted doors, the oxium bin
 * and geodes, reading matter, instruments, the pool table, spray guns, dreamstuff, radium and the heartstone. Things
 * used on something else ask where, as the original asks "On -".
 */
import type { Actor } from './actors.ts';
import type { Game } from './game.ts';
import { MD_TEXT } from './mdlang.ts';
import type { Obj } from './objects.ts';
import { Lib } from '../files/lib.ts';

type On = (o: Obj, target: Obj | Actor | null, a: Actor, x: number, y: number) => void;
/** A thing used on one thing, to another (use_obj_on_to: "On -", then "To -"). */
type OnTo = (o: Obj, target: Obj, to: Obj, a: Actor) => void;
type OnEntry = On | Record<number, OnTo>;

const BERRY = 73;
const OXIUM = 131;
/** clothing_get_warmth_rating's table: how warm each thing worn keeps its wearer. */
const WARMTH = new Map<number, number>([[1, 1], [2, 2], [3, 3], [4, 3], [5, 2], [6, 1], [7, 1], [8, 2], [9, 1], [10, 1], [11, 2], [14, 4], [13, 3],
  [17, 2], [18, 3], [19, 3], [20, 4], [21, 4], [22, 3], [23, 5], [90, 12], [25, 2], [26, 2], [27, 2], [28, 3], [29, 3], [30, 3], [33, 1],
  [34, 1], [35, 1], [36, 2], [37, 3], [38, 1], [39, 3]]);
/** player.lua's map_entrance_tbl: where each mine or cave mouth leads, by its quality. */
const ENTRANCES: [number, number, number][] = [
  [0x43, 0x51, 1], [0x80, 0x8d, 0], [0x76, 0xf2, 3], [0x7a, 0x0c, 3], [0x9a, 0x41, 4], [0x2b2, 0x1cc, 0], [0x73, 0x40, 4],
  [0x29d, 0x1ce, 0], [0xb3, 0xe1, 4], [0x27b, 0x1f1, 0], [0xc3, 0x70, 1], [0xcb, 0x1d1, 0], [0x24, 0xf1, 1], [0x31a, 0x232, 0],
  [0x5c, 0xf1, 1], [0x34c, 0x25a, 0], [0x7c, 0x28, 4], [0x13e, 0x118, 0], [0x0a, 0x61, 5], [0x3b7, 0x1c4, 0], [0x5c, 0xb1, 5],
  [0x3dc, 0x1dd, 0], [0x5e, 0x29, 4], [0x227, 0x1ab, 0],
];
/** pod_teleport_tbl: where the alien pods send the party. */
const POD_EXITS: [number, number][] = [[0xca, 0x295], [0x34d, 0x295], [0x13a, 0x17a], [0x2cd, 0x1fa]];
/** usecode_move_obj_table: the wheelbarrow, plank, rail car and drill. */
const MOVED: ReadonlySet<number> = new Set([268, 395, 410, 441]);
/** rest_level_up_actor's experience for each level. */
const LEVEL_EXP = [0, 100, 200, 400, 800, 1600, 3200, 6400, 32767];

/** Things used where they stand when tapped on the map: levers, gates, bins, tables, crates and chests. */
export const MD_IN_PLACE: ReadonlySet<number> = new Set([86, 87, 104, 181, 196, 212, 284, 286, 311, 312, 399, 411]);

export class MdUseCode {
  private text: Lib | null | undefined;
  /** The berries each has eaten, by kind (purple, green, brown): the counts fade a turn at a time in the original. */
  readonly berries = new Map<number, [number, number, number]>();
  /** Battle frenzy from a red berry. */
  readonly frenzy = new Set<number>();

  constructor(private readonly g: Game) {}

  private text$(key: string, ...args: (string | number)[]): string {
    let t = MD_TEXT[key] ?? key;
    for (const a of args) t = t.replace(/%[sd]/, String(a));
    // '*' waits for a key in the original, '@' marks a word to press.
    return t.replace(/\*/g, '').replace(/@/g, '');
  }

  /** Print strings as the original does, one after another: those that end without a new line run on. */
  private say(...keys: string[]): void;
  private say(key: string, ...args: (string | number)[]): void;
  private say(key: string, ...rest: (string | number)[]): void {
    const keys = [key, ...rest].every((k) => typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) && k in MD_TEXT);
    const t = (keys ? [key, ...rest].map((k) => this.text$(k as string)).join('') : this.text$(key, ...rest)).replace(/^\n+|\n+$/g, '');
    if (t) this.g.say('sys', t);
  }

  /**
   * What a closer look tells of a thing (look.lua's look_usecode): the time on a pocket watch, what a barrow or rail car
   * holds, where a marker flag stands, a ray gun's setting and charges, a lamp's fuel, a locked or rusted door, a
   * panel's or cabinet's purpose, a seed growing, the sprayer's rubber; an obelisk shows its picture, and a broken
   * strap sets Spector talking.
   */
  look(o: Obj): void {
    const g = this.g;
    const q = o.quality;
    const charges = (n: number): string => this.text$(n === 1 ? 'AND_HAS_1_CHARGE_LEFT' : 'AND_HAS_N_CHARGES_LEFT', n);
    const mode = (): string => this.text$(q === 0 ? 'COMBINATION' : q === 1 ? 'RIFLE' : 'SHOTGUN');
    const line = (t: string): void => {
      const s = t.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      if (s) g.say('sys', s);
    };
    switch (o.objN) {
      case 91:
      case 98: {
        // The pocket watch.
        let h = g.clock.hour;
        const pm = h >= 12;
        if (h > 12) h -= 12;
        line(`${this.text$('THE_TIME_IS')} ${h}:${String(g.clock.minute).padStart(2, '0')} ${pm ? 'P.M.' : 'A.M.'}`);
        return;
      }
      case 333:
        if (q !== 0) this.say('THE_CANNON_WILL_FIRE_STEEL_CANNON_BALLS');
        return;
      case 268:
      case 410: {
        if (o.qty === 0) return this.say('IT_IS_EMPTY');
        const stuff = this.text$(['', 'DIRT', 'ROCK', 'IRON_ORE', 'COAL'][q] ?? 'DIRT');
        line(o.qty === 1 ? this.text$('IT_HAS_1_LOAD_OF', stuff) : this.text$('IT_HAS_N_LOADS_OF', o.qty, stuff));
        return;
      }
      case 172: {
        const names = ['', 'Coprates Chasma', 'Arsia Mons', 'Pavonis Mons', 'Ascraeus Mons', 'Alber Tholus', 'Elysium Mons', 'Hecates Tholus',
          'Terra Sirenum', 'Noctis Labyrinthus', 'Deuteronicus Mensae', 'Syrtis Major Planum', 'Olympus Mons'];
        if (o.z !== 0) return;
        if (q > 12) return this.say('AARGH');
        if (q !== 0) line(`${names[q]} ${this.latLong(o.x, o.y)}`);
        return;
      }
      case 460: {
        const spector = g.actors.get(2);
        if (spector) {
          spector.talkFlags |= 1 << 6;
          g.talkTo(spector);
        }
        return;
      }
      case 287:
        if (q !== 0) this.say('IT_HAS_A_HEARTSTONE');
        return;
      case 251:
        if (o.frameN < 4) this.say(q === 15 ? 'IT_IS_GROWING' : q === 16 ? 'IT_IS_RIPE' : 'IT_IS_NOT_GROWING');
        return;
      case 276: {
        const fussy = !!((g.actors.get(0x3e)?.talkFlags ?? 0) & (1 << 5));
        if (q & 1) {
          if (fussy && !(q & 2)) this.say('THE_RUBBER_IN_THE_SPRAYER_SYSTEM_IS_NOT_FLESH_COLORED');
          else this.say('IT_IS_READY_TO_USE');
        } else {
          this.say('THERE_IS_NO_RUBBER_IN_THE_SPRAYER_SYSTEM');
          if (fussy && !(q & 2)) this.say('IT_IS_ALSO_NOT_FLESH_COLORED');
        }
        return;
      }
      case 457:
        return this.say(q === 0 || q > 7 ? 'YOU_CANNOT_DECIPHER_WHAT_IT_CONTROLS' : `CABINET_${q}`);
      case 314:
        if (q & 1 && o.loc === 'map') this.say('IT_APPEARS_TO_BE_LOOSE');
        if (q & 2) this.say('IT_APPEARS_TO_BE_BROKEN');
        return;
      case 458: {
        const purpose = o.qty === 0 ? ['THESE_APPEAR_TO_BE_MECHANICAL_CONTROLS', 'THESE_APPEAR_TO_BE_VALVE_CONTROLS', 'THESE_APPEAR_TO_BE_ELECTRICAL_CONTROLS'][o.frameN]
          : ({ 4: 'IT_APPEARS_TO_CONTROL_A_DREAM_MACHINE', 5: 'IT_APPEARS_TO_CONTROL_A_SPRAY_SYSTEM', 6: 'IT_APPEARS_TO_CONTROL_THE_RUBY_LENS_SYSTEM', 7: 'IT_APPEARS_TO_CONTROL_THE_CISTERN_VALVES' } as Record<number, string>)[o.qty] ?? 'YOU_CANNOT_DECIPHER_ITS_PURPOSE';
        if (purpose) this.say(purpose);
        if (q & 1 && o.loc === 'map') this.say('THE_PANEL_IS_LOOSE');
        if (q & 2) this.say('THE_PANEL_IS_BROKEN');
        return;
      }
      case 129:
      case 261: {
        const what = g.tiles.look(q === 0 ? 649 : 640, 0);
        line(this.text$('IT_IS_LOADED_WITH', what) + charges(o.qty));
        return;
      }
      case 240:
      case 241:
        line(this.text$('IT_IS_SET_TO', mode()) + charges(o.qty));
        return;
      case 45:
        line(`${this.text$('IT_IS_SET_TO', mode())}.`);
        return;
      case 411:
        if (q === 1) this.say('IT_SEEMS_TO_BE_LOOSE');
        else if (q === 2) this.say('IT_IS_NOT_INSTALLED');
        return;
      case 179:
      case 227:
        if (q >= 128) this.say(q - 128 >= 64 ? 'IT_IS_APPARENTLY_RUSTED_SHUT' : 'IT_IS_APPARENTLY_LOCKED');
        return;
      case 292:
        // An obelisk: its picture (mdream.lzc).
        if (q !== 0) g.picture = { file: 'mdream.lzc', item: q - 1, title: 'Obelisk' };
        return;
    }
    if (o.objN >= 109 && o.objN <= 118) {
      // A light source: its fuel or wick.
      if ((o.objN === 109 || o.objN === 110) && o.qty > 1) return;
      const lamp = o.objN >= 115;
      let t: string;
      if (q > 30) t = this.text$('PLENTY_OF');
      else if (q > 6) t = this.text$('IT_HAS_N_MORE_MINUTES_OF', q);
      else if (q > 0) t = this.text$('ITS_ALMOST_OUT_OF');
      else t = this.text$(lamp ? 'NO' : 'PLENTY_OF');
      line(t + this.text$(lamp ? 'FUEL' : 'WICK'));
    }
  }

  /** get_lat_long_string: where a square lies on Mars in degrees. */
  latLong(x: number, y: number): string {
    const lat = Math.trunc(((y - 512) * 240) / 1024);
    const lng = Math.trunc(((x - 512) * 360) / 1024);
    const ns = lat > 0 ? 'S' : lat === 0 ? ' ' : 'N';
    const ew = lng === 180 || lng === -180 || lng === 0 ? ' ' : lng < 0 ? 'E' : 'W';
    return `${Math.abs(lat)}${ns} ${180 - Math.abs(lng)}${ew}`.replace(/ +/g, ' ').trim();
  }

  private onTable(o: Obj): Record<number, OnEntry> | null {
    const crate: On = (tool, t) => this.crate(tool, t as Obj);
    const misc: On = (_tool, t) => this.misc(t as Obj);
    const oil: On = (tool, t) => this.oil(tool, t as Obj | null);
    const spray: On = (bottle, t) => this.refillSprayGun(bottle, t as Obj);
    const holes = { 255: misc, 257: misc };
    switch (o.objN) {
      case 65: case 67: case 263: case 327: return holes;
      case 66: case 267: {
        // use_shovel_on_tbl: dig, fill a hole, load and unload ore.
        const unload: OnTo = (_s, from, to, a) => this.unload(from, to, a);
        const load: OnTo = (_s, ore, to) => void this.load(ore, to);
        return {
          ...holes,
          258: { 257: (_s, pile, hole) => this.fill(pile, hole) },
          268: { 233: unload, 257: unload, 268: unload, 410: unload },
          410: { 233: unload, 257: unload, 268: unload, 410: unload },
          442: { 268: load, 410: load },
          443: { 268: load, 410: load },
          444: { 268: load, 410: load },
          0: (_s, t, a, x, y) => this.dig(t, a, x, y),
        };
      }
      case 102: return { 86: crate, 427: (_t, h, a) => this.hatch(h as Obj, a) };
      case 273: return { 86: crate };
      case 119: case 128: return { 129: spray, 261: spray };
      case 124: case 235: return { 179: oil, 227: oil, 421: oil, 152: oil, 219: oil, 222: oil, 0: (_o, t, a, x, y) => this.dreamDoor(t, a, x, y) };
      case 88: return { 84: () => this.dreamQuestDone(0x57, 6) };
      case 144: return { 192: (b, r) => this.belt(b, r as Obj) };
      case 52: return { 404: { 405: (_h, t, broken) => this.fixTrack(t, broken) } };
      case 53: return { 199: { 201: (_p, s, tw, a) => this.cable(s, tw, a), 215: (_p, s, tw, a) => this.cable(s, tw, a) } };
      case 135: return { 411: (_w, t) => this.wrench(t as Obj), 440: (_w, t) => this.wrench(t as Obj), 458: (_w, t) => this.wrench(t as Obj) };
      case 296: return { 288: (_g, t) => this.headgear(t as Obj), 289: (_g, t) => this.headgear(t as Obj) };
      case 231: return { 130: (_t, geode, a) => this.geode(geode as Obj, a), 298: () => this.gong() };
      case 129: case 261: return { 0: (gun, t, a) => this.spray(gun, t, a) };
      case 426: return { 287: (stone, woman) => this.heartstone(stone, woman as Obj) };
      case 448: return { 290: (r, t) => this.radium(r, t as Obj), 448: (r, t) => this.radium(r, t as Obj) };
      case 449: return { 240: (r, t) => this.radium(r, t as Obj), 241: (r, t) => this.radium(r, t as Obj) };
      default: return null;
    }
  }

  /** Whether usecode.lua has something for it. */
  handles(o: Obj): boolean {
    return this.single(o) !== null || this.onTable(o) !== null;
  }

  private single(o: Obj): ((o: Obj, a: Actor) => void) | null {
    const n = o.objN;
    if (n >= BERRY && n <= BERRY + 3) return (b, a) => this.berry(b, a);
    switch (n) {
      case 12: return (s, a) => this.slippers(s, a);
      case 38: case 136: case 401: return (r, a) => this.readyIt(r, a);
      case 77: return (b, a) => this.redBerry(b, a);
      case 78: case 131: case 184: case 199: case 288: case 293: case 323: case 427: case 442: case 443: case 444:
        return (m) => this.misc(m);
      case 86: case 87: case 104: case 284: return (c) => this.container(c);
      case 96: return (_s, a) => this.sextant(a);
      case 147: return (_m, a) => this.mirror(a);
      case 148: case 151: case 243: return (r) => this.read(r);
      case 181: return (gate) => this.gate(gate);
      case 196: case 311: case 312: return (s) => this.switchDevice(s);
      case 212: return (_b, a) => this.oxiumBin(a);
      case 280: case 281: case 282: case 283: return (i) => this.instrument(i);
      case 286: return () => this.say('YOU_SPIT_INTO_THE_SPITTOON');
      case 106: return (t) => this.tent(t);
      case 331: return (d, a) => this.dreamstuff(d, a);
      case 399: return (_t, a) => this.poolTable(a);
      case 411: return (b) => this.switchBar(b);
      case 441: return (d) => this.drill(d);
      case 458: return (panel) => this.panel(panel);
      default: return null;
    }
  }

  /** use_obj: within reach, then the thing's own use, or "On -" and what it is used on. */
  use(o: Obj, a: Actor = this.g.player): void {
    const g = this.g;
    if (o.loc === 'map' && Math.max(Math.abs(o.x - a.x), Math.abs(o.y - a.y)) > 1) {
      this.say('OUT_OF_RANGE');
      return g.onChange();
    }
    const f = this.single(o);
    if (f) {
      f(o, a);
      return g.onChange();
    }
    const table = this.onTable(o);
    if (!table) return;
    g.askWhere = {
      label: 'On -',
      then: (x, y) => {
        g.askWhere = null;
        const target: Obj | Actor | null = g.actors.at(x, y, a.z) ?? g.objects.get(x, y, a.z);
        const on = (target && table[target.objN]) ?? table[0];
        if (target) g.say('you', `On ${'id' in target ? g.lookActor(target) : g.objects.look(target)}`);
        if (typeof on === 'function') on(o, target, a, x, y);
        else if (on && target && !('id' in target)) {
          // And to what (use_obj_on_to).
          g.askWhere = {
            label: 'To -',
            then: (tx, ty) => {
              g.askWhere = null;
              const to = g.objects.get(tx, ty, a.z);
              if (!to) this.say('SOMETHING');
              else {
                g.say('you', `To ${g.objects.look(to)}`);
                on[to.objN]?.(o, target, to, a);
              }
              g.onChange();
            },
          };
        } else this.say(target ? 'NO_EFFECT' : 'NOTHING');
        g.onChange();
      },
    };
    g.onChange();
  }

  // ---- things used by themselves ----

  private misc(o: Obj | null): void {
    const n = o?.objN ?? 0;
    if ([65, 66, 67, 263, 267, 327].includes(n)) this.say('YOU_CANT_DIG_ANY_DEEPER');
    else if (n === 427) this.say('IT_IS_STUCK');
    else if (n === 288) this.say('THE_CONTROL_PANEL_OPERATES_THE_DREAM_MACHINE');
    else if (n === 199) this.say('YOU_NEED_TO_USE_PLIERS_TO_ATTACH_THE_CABLE');
    else if (n === 131) this.say('YOU_WILL_CHEW_IT_INSTINCTIVELY');
    else if (n === 184) this.say('THE_PLATE_IN_THE_CAMERA_HAS_ALREADY_BEEN_EXPOSED');
    else if (n === 442 || n === 443 || n === 444) this.say('YOU_MUST_USE_A_SHOVEL_TO_MOVE_THAT');
    else if (n === 293) this.say('YOU_CANT_DETERMINE_HOW_TO_READ_THE_TIME');
    else if (n === 77 || n === 78) this.say('THE_BERRIES_ARE_NOT_EDIBLE');
    else if (n === 323) this.say('YOU_DONT_KNOW_HOW_IT_WORKS');
    else this.say('IT_HAS_NO_EFFECT');
  }

  private one(o: Obj): void {
    if (o.qty > 1) o.qty--;
    else this.g.objects.unlink(o);
  }

  private berry(o: Obj, a: Actor): void {
    if (a.id === 6) return this.say('A_MECHANICAL_PERSON_CANT_EAT_BERRIES');
    const kind = o.objN - BERRY;
    const eaten = this.berries.get(a.id) ?? [0, 0, 0];
    const start = kind < 3 && eaten[kind] > 0 ? 'YOU_EAT_A_MARTIAN_BERRY_YOU_FEEL_AN_INCREASE_IN_THE_STRANGE' : 'YOU_EAT_A_MARTIAN_BERRY_YOU_FEEL_A_STRANGE';
    const feel = ['RELATIONSHIP_WITH_THINGS_AROUND_YOU', 'SENSITIVITY_TO_THE_FEELINGS_OF_OBJECTS_AROUND_YOU', 'SENSE_OF_YOUR_SPATIAL_LOCATION', 'SUDDEN_FLUSH_DIZZINESS_AND_NAUSEA'][kind];
    this.say(start, feel);
    if (kind === 3) {
      a.statusFlags &= ~0x08;
      this.g.combat.hurt(a, a, this.rand(5, 20) + this.rand(5, 20));
    }
    if (kind < 3) {
      eaten[kind] = Math.min(15, eaten[kind] + 1);
      this.berries.set(a.id, eaten);
    }
    this.one(o);
  }

  private redBerry(o: Obj, a: Actor): void {
    if (!this.g.combat.mode) return this.say('THAT_WOULD_BE_A_WASTE_OUTSIDE_OF_COMBAT');
    if (!this.frenzy.has(a.id)) this.say('ENTERS_A_BATTLE_FRENZY', this.g.partyMemberName(a.id) || 'You');
    this.frenzy.add(a.id);
    this.one(o);
  }

  private rand(lo: number, hi: number): number {
    return lo + this.g.random(hi - lo + 1);
  }

  private slippers(o: Obj, a: Actor): void {
    if (o.loc !== 'readied') {
      this.g.ready(o, a);
      return;
    }
    if (o.quality >= 2) {
      this.say('YOU_MAY_USE_THE_RUBY_SLIPPERS_TO_GO_HOME');
      const g = this.g;
      g.askChoice = {
        label: 'Go home?',
        options: ['Yes', 'No'],
        then: (i) => {
          g.askChoice = null;
          if (i === 0) g.won = true; // play_end_sequence
          else g.cutscene = 13;
          g.onChange();
        },
      };
    } else {
      this.say('CLICK');
      o.quality++;
    }
  }

  private readyIt(o: Obj, a: Actor): void {
    if (o.loc === 'readied') return;
    if (this.g.invRoom(a.id) < this.g.objects.weightOf(o) && o.loc === 'map') return this.say('YOU_ARE_CARRYING_TOO_MUCH_ALREADY');
    this.g.ready(o, a);
  }

  /** use_container: nailed shut or locked; shut, it opens to be searched; open, it shuts. */
  private container(o: Obj): void {
    if (o.frameN === 2) this.say(o.objN === 86 || o.objN === 284 ? 'IT_IS_NAILED_SHUT' : 'IT_IS_LOCKED');
    else if (o.frameN === 1) {
      o.frameN = 0;
      this.g.openContainer = o;
      this.g.say('sys', o.container?.length ? `Searching ${this.g.objects.look(o)}.` : 'Searching here, you find nothing.');
    } else o.frameN = 1;
  }

  private sextant(a: Actor): void {
    if (a.z !== 0) return this.say('NOT_WHILE_UNDERGROUND');
    const lat = Math.trunc(((a.y - 512) * 240) / 1024);
    const long = Math.trunc(((a.x - 512) * 360) / 1024);
    const ns = lat > 0 ? 'S' : lat === 0 ? ' ' : 'N';
    const ew = long === 180 || long === -180 || long === 0 ? ' ' : long < 0 ? 'E' : 'W';
    this.say('YOU_ARE_SOMEWHERE_NEAR');
    this.g.say('sys', `Lat: ${Math.abs(lat)} ${ns}\nLong: ${180 - Math.abs(long)} ${ew}`);
  }

  private mirror(a: Actor): void {
    if (a.x >= 0x76 && a.x <= 0x78 && a.y >= 0xca && a.y <= 0xcc && a.z === 2) {
      const lowell = this.g.actors.get(0x50);
      if (lowell) {
        lowell.talkFlags |= 1 << 6;
        this.finishDreamQuest(lowell);
        this.g.talkTo(lowell);
        this.wakeAfterTalk = true;
        return;
      }
    }
    this.say('YOU_SEE_YOURSELF');
  }

  /** use_reading_material: the affidavit, signed by those who vouched; else a page of mdtext.lzc. */
  private read(o: Obj): void {
    const g = this.g;
    let text: string | null = null;
    if (o.quality === 0) {
      const sig = (id: number, name: string): string => ((g.actors.get(id)?.talkFlags ?? 0) & (1 << 3) ? `  ${name}` : '');
      text = (MD_TEXT.AFFIDAVIT ?? '%s\n%s').replace('%s', g.playerName()).replace('%s', [sig(5, 'Richard Sherman'), sig(0x19, 'Capt. Gregory Duprey'), sig(0x1a, 'Doctor David Yellin')].join('\n'));
    } else {
      if (this.text === undefined) this.text = g.files.has('mdtext.lzc') ? new Lib(g.files.get('mdtext.lzc')!, 4, true) : null;
      const data = this.text?.item(o.quality - 1);
      if (data) {
        text = '';
        for (const c of data) {
          if (c === 0 || c === 0xff) break;
          text += String.fromCharCode(c);
        }
        // A star alone on its line breaks the page.
        text = text.replace(/\r/g, '').replace(/^\s*\*\s*$/gm, '');
      }
    }
    if (!text?.trim()) return this.say('YOU_CANT_READ_IT');
    g.say('read', text.trim());
    g.journal.read(g.objects.name(o), g.where(), text.trim(), g.date());
  }

  private gate(o: Obj): void {
    if (o.quality & 0x80) return this.say('IT_IS_APPARENTLY_LOCKED');
    const f = o.frameN;
    if (f <= 1) {
      o.frameN = 3;
      this.g.objects.move(o, o.x - 1, o.y, o.z);
    } else if (f <= 3) {
      o.frameN = 1;
      this.g.objects.move(o, o.x + 1, o.y, o.z);
    } else if (f <= 5) o.frameN = 7;
    else o.frameN = 5;
  }

  /** use_switch: a lever works the door its quantity names (by quality), opening and shutting, or locking. */
  private switchDevice(o: Obj): void {
    if (o.quality !== 1 && o.quality !== 2) return this.say('WHAT_AN_ODD_LEVER');
    const g = this.g;
    let door: Obj | null = null;
    const switches: Obj[] = [];
    for (const n of g.objects.all()) {
      if (n.loc !== 'map' || n.z !== o.z || Math.abs(n.x - o.x) > 32 || Math.abs(n.y - o.y) > 32) continue;
      if ((n.objN === 179 || n.objN === 227) && (n.quality & 0x7f) === o.qty) door = n;
      else if ((n.objN === 311 || n.objN === 312 || n.objN === 196) && switches.length < 4) switches.push(n);
    }
    if (!door) return this.say('STRANGELY_NOTHING_HAPPENS');
    if (!switches.length) return this.say('STRANGELY_IT_DOESNT_MOVE');
    let frame = 0;
    if (o.quality === 1) {
      if (door.quality & 0x80) {
        door.quality &= 0x7f;
        frame = 1;
      } else door.quality |= 0x80;
    } else if (door.frameN < 4) {
      door.frameN = (door.frameN & 2) + 9;
      frame = 1;
    } else {
      door.frameN = (door.frameN & 2) + 1;
      // The minotaur let out of the shop ends Tiffany's dream.
      if (this.dream?.stage === 0x44 && this.minotaurOut(door.z)) return this.tiffanyDone();
    }
    for (const s of switches) s.frameN = frame;
    g.sfx('success');
  }

  private switchBar(o: Obj): void {
    const g = this.g;
    o.frameN = o.frameN ? 0 : 1;
    const turntable = o.loc === 'map' ? (g.objects.list(o.x - 1, o.y - 1, o.z) ?? []).find((n) => n.objN === 413) : undefined;
    if (!turntable) return this.say('IT_HAS_NO_EFFECT');
    if (o.quality === 1) return this.say('IT_TURNS_LOOSELY');
    turntable.frameN = o.frameN;
    const car = (g.objects.list(o.x - 1, o.y - 1, o.z) ?? []).find((n) => n.objN === 410);
    if (car) car.frameN = car.frameN - (car.frameN % 2) + turntable.frameN;
  }

  private oxiumBin(a: Actor): void {
    const g = this.g;
    const ox = g.objects.create(OXIUM, 20, 0);
    if (g.invRoom(a.id) < g.objects.weightOf(ox)) return this.say('YOU_ARE_CARRYING_TOO_MUCH_ALREADY');
    g.objects.toInventory(ox, a.id);
    this.say('YOU_GET_TWO_HANDFULS_OF_OXIUM_FROM_THE_BIN');
    const blood = g.actors.get(0x12);
    if (blood) blood.talkFlags |= 1 << 4;
  }

  private instrument(o: Obj): void {
    const words: Record<number, string> = { 280: 'CHING', 281: 'SHING', 282: 'THUMP_THUMP', 283: 'WHEEEEZE' };
    this.say(words[o.objN] ?? 'YOU_PLAY_THE', this.g.objects.name(o));
    this.g.sfx('success');
  }

  private poolTable(a: Actor): void {
    const cue = this.g.objects.inventories[a.id].some((o) => o.loc === 'readied' && o.objN === 401);
    if (!cue) return this.say('YOU_NEED_A_POOL_CUE');
    this.g.sfx('hit');
    if (this.rand(0, 40) < a.dex) this.say('GOOD_SHOT_OLD_BEAN');
  }

  /** use_dreamstuff: what it holds is imagined into being - a thing where it lies, or a creature beside the user. */
  private dreamstuff(o: Obj, a: Actor): void {
    const g = this.g;
    const item = o.container?.[0];
    if (!item) return this.say('YOU_IMAGINE', 'NOTHING');
    if (item.objN < 342) {
      g.say('sys', this.text$('YOU_IMAGINE') + g.objects.look(item));
      g.objects.unlink(item);
      if (o.loc === 'map') {
        [item.x, item.y, item.z] = [o.x, o.y, o.z];
        g.objects.add(item);
      } else g.objects.toInventory(item, a.id);
    } else {
      const made = g.combat.spawn(item.objN, a.x, a.y, a.z, o.quality + 1, item.quality);
      if (made) g.say('sys', this.text$('YOU_IMAGINE') + g.lookActor(made));
    }
    g.objects.unlink(o);
  }

  /**
   * use_tent: pitch camp where the tent is (or the party stands) - flat ground, no foes near, no one about, no one
   * dizzy with berries - and rest until sunrise or sunset, or some hours. Six hours apart, more than four hours' rest
   * heals; each member may dream and grow (rest_level_up_actor); the poisoned get better or worse.
   */
  tent(o: Obj | null): void {
    const g = this.g;
    const p = g.player;
    const at = o && o.loc === 'map' ? { x: o.x, y: o.y, z: o.z } : { x: p.x, y: p.y, z: p.z };
    const fail = (key: string, ...args: string[]): void => {
      this.say(key, ...args);
      g.sfx('failure');
    };
    for (let y = at.y - 2; y <= at.y; y++) {
      for (let x = at.x - 1; x <= at.x + 1; x++) {
        if (!g.map.tile(x, y, at.z).passable) return fail('THE_GROUND_IS_NOT_FLAT_ENOUGH');
        const thing = (g.objects.list(x, y, at.z) ?? []).find((n) => n !== o && !g.objects.tileOf(n).passable);
        if (thing) return fail('TENT_OBJ_IN_THE_WAY', g.objects.name(thing));
      }
    }
    if (g.combat.mode) return fail('NOT_WHILE_IN_COMBAT_MODE');
    const near = (a: Actor, r: number): boolean => a.z === at.z && Math.abs(a.x - at.x) < r && Math.abs(a.y - at.y) < r;
    if (g.combat.foes(40).length) return fail('NOT_WHILE_FOES_ARE_NEAR');
    const npc = g.actors.list.find((a) => a.alive && a.objN && a.visible && !a.inParty && !(a.statusFlags & 0x04) && near(a, 6));
    if (npc) return fail('IS_TOO_NEAR_TO_SETUP_CAMP', g.lookActor(npc));
    for (const m of g.party) if (m.actor.statusFlags & 0x08) this.say('IS_POISONED', m.name);
    let dizzy = false;
    for (const m of g.party) {
      const [, green, brown] = this.berries.get(m.actor.id) ?? [0, 0, 0];
      if (green && brown) this.say('COMPLAINS_OF_TOO_MUCH_LIGHT_AND_INANIMATE', m.name);
      else if (brown) this.say('COMPLAINS_OF_TOO_MUCH_LIGHT', m.name);
      else if (green) this.say('COMPLAINS_OF_INANIMATE_THINGS_TALKING', m.name);
      dizzy ||= !!(green || brown);
    }
    if (dizzy) return this.say(g.party.length === 1 ? 'YOU_CANT_SLEEP' : 'NOBODY_CAN_SLEEP');
    const h = g.clock.hour;
    const night = h < 7 || h > 16;
    const until = night ? (h < 7 ? 7 - h : 24 - h + 7) : 18 - h;
    this.say('REST');
    g.askChoice = {
      label: this.text$('REST_UNTIL', this.text$(night ? 'SUNRISE' : 'SUNSET')).trim(),
      options: [`Yes (${until} hours)`, '1 hour', '2 hours', '4 hours', '8 hours'],
      then: (i) => {
        g.askChoice = null;
        this.sleep([until, 1, 2, 4, 8][i] ?? until);
      },
    };
    g.onChange();
  }

  private sleep(hours: number): void {
    const g = this.g;
    this.warm = true;
    if (g.restCounter === 0 && hours > 4) {
      for (const m of g.party) m.actor.hp = Math.min(m.actor.maxHp, m.actor.hp + this.rand(3, 8) + this.rand(3, 8) * Math.floor(hours / 2));
      g.restCounter = 6;
    }
    const dreamers: Actor[] = [];
    for (let i = 0; i < hours * 3; i++) {
      g.advance(20);
      const m = g.party[i]?.actor;
      if (m && m.id <= 15 && m.exp > LEVEL_EXP[Math.min(8, m.level)]) dreamers.push(m);
    }
    for (const m of g.party) {
      const a = m.actor;
      if (!(a.statusFlags & 0x08)) continue;
      if (this.rand(1, 8) + this.rand(1, 8) >= 15) {
        a.statusFlags &= ~0x08;
        this.say('FEELS_BETTER', m.name);
      } else a.hp = Math.max(5, a.hp - (hours * 2 + 5));
    }
    this.warm = false;
    g.say('sys', `The party rests for ${hours} hour${hours === 1 ? '' : 's'}.`);
    this.obelisks(dreamers);
    g.onChange();
  }

  /** rest_level_up_actor: a level, thirty health, and a point of wits, dexterity or strength from the obelisk touched. */
  private obelisks(dreamers: Actor[]): void {
    const g = this.g;
    const a = dreamers.shift();
    if (!a) return;
    a.level++;
    a.hp = Math.min(a.maxHp, a.hp + 30);
    const name = g.partyMemberName(a.id);
    const female = [344, 346].includes(a.objN) || (a.objN >= 354 && a.objN <= 357);
    const pro = female ? 'She' : 'He';
    this.say('HAS_A_DREAM', name);
    this.say('SEES_THREE_STONE_OBELISKS', pro);
    this.say('FEELS_DRAWN_TO_ONE_OF_THE_OBELISKS', pro);
    this.say('DOES_TOUCH_THE_OBELISK', name);
    g.askChoice = {
      label: `Which obelisk does ${name} touch?`,
      options: ['The book', 'The heart', 'The sword'],
      then: (i) => {
        g.askChoice = null;
        if (i === 0) a.intelligence = Math.min(30, a.intelligence + 1);
        else if (i === 1) a.dex = Math.min(30, a.dex + 1);
        else a.strength = Math.min(30, a.strength + 1);
        this.obelisks(dreamers);
        g.onChange();
      },
    };
  }

  // ---- each turn: entrances, the belt, the powered doors ----

  private last = '';

  /** After each turn (player_post_move_action): where the party stepped, the conveyor, the doors that open themselves. */
  turn(): void {
    const g = this.g;
    if (this.endAfterTalk && !g.converse) {
      this.endAfterTalk = false;
      g.won = true;
    }
    if (this.wakeAfterTalk && !g.converse) {
      this.wakeAfterTalk = false;
      this.wake();
      return;
    }
    const p = g.player;
    const here = `${p.x},${p.y},${p.z}`;
    const moved = here !== this.last;
    this.last = here;
    if (moved && this.entrance()) {
      this.last = `${g.player.x},${g.player.y},${g.player.z}`;
      return;
    }
    this.conveyor(true);
    this.aroundParty();
  }

  /**
   * Mine and cave mouths (map_entrance_tbl, by the entrance's quality), and the alien pods once they work: the party
   * comes out at the other end. A rail car on the track at a mine's mouth goes through with it.
   */
  private entrance(): boolean {
    const g = this.g;
    const p = g.player;
    for (const o of g.objects.list(p.x, p.y, p.z) ?? []) {
      const n = o.objN;
      if (n === 461 && this.dream) return this.teleporter(o);
      if (n === 462 && this.dream) {
        // OBJ_DREAM_TELEPORTER1: walking on the walls, or back on one's feet.
        if (o.quality === 0) this.restoreLook();
        else {
          p.objN = g.gender === 1 ? 319 : 318;
          p.frameN = 0;
        }
        continue;
      }
      if (!(n === 175 || n === 163 || n === 180 || n === 178 || (n === 197 && o.frameN === 3) || n === 210)) continue;
      if (n === 197) {
        if (!((g.actors.get(0x73)?.talkFlags ?? 0) & (1 << 4))) {
          this.say('THE_ALIEN_DEVICE_DOESNT_SEEM_TO_BE_FUNCTIONING');
          return false;
        }
        const pod = POD_EXITS[o.quality - 1];
        if (!pod) {
          this.say('NOTHING_APPEARS_TO_HAPPEN');
          return false;
        }
        g.relocate(pod[0], pod[1], 0);
        return true;
      }
      const to = ENTRANCES[o.quality - 1];
      if (!to) return false;
      // What stands on the track before a mine's mouth goes through too.
      const dy = n === 175 ? -1 : n === 163 ? 1 : 0;
      if (dy) {
        for (const t of [...(g.objects.list(p.x, p.y + dy, p.z) ?? [])]) {
          if (t.objN === 410 || t.objN === 268) g.objects.move(t, to[0], to[1] + (n === 175 ? -1 : 2), to[2]);
        }
      }
      g.relocate(to[0], to[1], to[2]);
      return true;
    }
    return false;
  }

  /**
   * update_objects_around_party: with the power on, the mine's doors open for whoever comes near and shut behind; a
   * reflective surface shows who stands before it.
   */
  private aroundParty(): void {
    const g = this.g;
    const p = g.player;
    const flag = (f: number): boolean => !!((g.actors.get(0x73)?.talkFlags ?? 0) & (1 << f));
    const OX = [0, 1, 1, 1, 0, -1, -1, -1];
    const OY = [-1, -1, 0, 1, 1, 1, 0, -1];
    for (let y = p.y - 5; y <= p.y + 5; y++) {
      for (let x = p.x - 5; x <= p.x + 5; x++) {
        for (const o of g.objects.list(x, y, p.z) ?? []) {
          if ((o.objN === 227 && flag(2)) || (o.objN === 179 && flag(4))) {
            if (o.quality & 0x80) continue;
            const base = o.frameN & 2;
            if (g.actors.at(o.x, o.y, o.z)) {
              o.frameN = base + 9;
              continue;
            }
            const near = g.actors.at(o.x + OX[base], o.y + OY[base], o.z) ?? g.actors.at(o.x + OX[base + 4], o.y + OY[base + 4], o.z);
            if (near) o.frameN = base + (o.frameN < 4 ? 5 : o.frameN < 8 ? 1 : 5);
            else if (o.frameN === 5) o.frameN = 1;
            else if (o.frameN === 7) o.frameN = 3;
          } else if (o.objN === 301 && o.frameN < 3) {
            const a = g.actors.at(o.x, o.y + 1, o.z);
            if (!a) o.frameN = 0;
            else {
              const id = a.id;
              o.frameN = id >= 0x70 || id === 0x5d || (id >= 0x6a && id <= 0x6c) ? 0
                : (id < 0x20 && id !== 6) || (id >= 0x2a && id <= 0x5c) || id === 0x60 || id === 0x69 || id === 0x6d ? 1 : 2;
            }
          }
        }
      }
    }
  }

  // ---- the dream machine and the dream world (usecode.lua, dreamworld.lua) ----

  /** While the Avatar dreams: the waking party set aside, and the dream's stage. */
  dream: {
    seat: [number, number, number];
    companions: { actor: Actor; name: string; at: [number, number, number] }[];
    hp: number;
    stage: number;
    back: [number, number] | null;
  } | null = null;
  private wakeAfterTalk = false;

  private endAfterTalk = false;

  /** talk.lua's talk_script: what a conversation sets going. */
  /**
   * Talk aimed where no one answers in the usual way (talk.lua): to oneself - in a dream, trying to wake - or to Your
   * Mother; and, with green berries eaten, to things, which give up psychic impressions of who used them, or let the
   * conveyor, the tower and the dream machine speak. True where it was dealt with here.
   */
  talkExtra(x: number, y: number, a: Actor | null): boolean {
    const g = this.g;
    if (a && (a === g.player || a.id < 2)) {
      if (this.dream) {
        this.say('YOU_TRY_TO_WAKE_YOURSELF_UP');
        if (g.player.z !== 3) this.wake();
      } else if (g.isSolo) this.say('NOT_WHILE_IN_SOLO_MODE');
      else this.say('YOU_ARENT_YET_THAT_INSANE');
      g.onChange();
      return true;
    }
    if (a && a.objN === 391) {
      this.say(g.gender === 0 ? 'NO_BACKTALK_FROM_YOU_YOUNG_MAN' : 'NO_BACKTALK_FROM_YOU_YOUNG_WOMAN');
      g.onChange();
      return true;
    }
    if (a) return false;
    const o = g.objects.get(x, y, g.player.z);
    if (!o) return false;
    const green = (this.berries.get(g.player.id)?.[1] ?? 0) > 0;
    if (!green) {
      this.say('NOTHING');
      g.onChange();
      return true;
    }
    const voice = (id: number) => (): void => {
      const who = g.actors.get(id);
      if (who) g.talkTo(who);
    };
    const said = (key: string) => (): void => this.say(key);
    const things: Record<number, () => void> = {
      0xc: said('YOU_RECEIVE_A_MOMENTARY_IMPRESSION'), 0x5c: said('THIS_WAS_WORN_LAST_BY_A_DYING_MAN'),
      0x64: voice(0x74), 0xbc: voice(0x72), 0xbf: voice(0x72), 0xc0: voice(0x72),
      0xc8: voice(0x73), 0xc9: voice(0x73), 0xd6: voice(0x73), 0xd7: voice(0x73),
      0xe7: said('THIS_WAS_USED_BY_A_MARTIAN_MEASURING_TIME'), 0xea: said('THIS_JEWELRY_WAS_WORN_BY'),
      0xf6: said('THESE_FOOTBAGS_WERE_WORN_BY'), 0xf7: said('THIS_SAW_WAS_USED_BY'), 0xf9: said('THIS_DEVICE_WAS_USED_BY'),
      0x113: said('THIS_SCULPTURE_HAD_GREAT_RITUAL_OR_RELIGIOUS_SIGNIFICANCE'),
      0x120: voice(0x74), 0x121: voice(0x74), 0x122: voice(0x74),
    };
    const f = o.status & 1 ? things[o.objN] : undefined;
    if (f) f();
    else this.say('YOU_RECIEVE_NO_PSYCHIC_IMPRESSIONS');
    g.onChange();
    return true;
  }

  talkScript(n: number): void {
    const g = this.g;
    const at = (x: number, y: number, z: number, objN: number): Obj | undefined => (g.objects.list(x, y, z) ?? []).find((o) => o.objN === objN);
    if (n === 1) {
      // talk_script_fix_panels
      let panels = 0;
      for (const m of g.party) {
        for (const o of g.objects.inventories[m.actor.id]) {
          if (o.objN !== 458) continue;
          panels++;
          o.quality &= 0xfd;
          o.qty = 4;
        }
      }
      this.flag(0x39, 3, panels > 1);
    } else if (n === 6) {
      // open_gates_at_olympus_mons
      const a = at(0x2c3, 0x1f3, 0, 181);
      if (a) {
        g.objects.move(a, 0x2c2, 0x1f3, 0);
        a.frameN = 3;
      }
      const b = at(0x2c4, 0x1f3, 0, 181);
      if (b) b.frameN = 7;
    } else if (n === 7) {
      const door = at(0x2c7, 0x1dc, 0, 152);
      if (door) door.frameN = 7;
    } else if (n === 9) this.endAfterTalk = true;
    else if (n === 0x34 || n === 0x36) this.wakeAfterTalk = true;
    else if (n === 0x35) {
      const p = g.player;
      for (let i = 0; i < 6; i++) {
        const spot = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0]].map(([dx, dy]) => [p.x + dx, p.y + dy]).find(([x, y]) => g.canStand(x, y, p.z));
        if (spot) g.combat.spawn(145, spot[0], spot[1], p.z, 0, 0x8);
      }
    }
  }

  /** The dream, for a saved game. */
  saveDream(): unknown {
    const d = this.dream;
    return d && { ...d, companions: d.companions.map((m) => ({ id: m.actor.id, name: m.name, at: m.at })) };
  }

  loadDream(v: unknown): void {
    const d = v as { seat: [number, number, number]; companions: { id: number; name: string; at: [number, number, number] }[]; hp: number; stage: number; back: [number, number] | null } | undefined;
    if (!d) return;
    const g = this.g;
    const companions = d.companions.map((m) => ({ actor: g.actors.get(m.id)!, name: m.name, at: m.at })).filter((m) => m.actor);
    for (const m of companions) {
      const i = g.party.findIndex((q) => q.actor === m.actor);
      if (i > 0) g.party.splice(i, 1);
    }
    this.dream = { ...d, companions };
  }

  /** use_panel: a panel on its cabinet works what the cabinet holds - the dream machine, or lights to no effect. */
  private panel(o: Obj): void {
    if (o.quality & 2) return this.say('THE_PANEL_IS_BROKEN');
    if (o.quality & 1) return this.say('THE_PANEL_IS_NOT_INSTALLED');
    const cabinet = (this.g.objects.list(o.x, o.y, o.z) ?? []).find((n) => n.objN === 457);
    if (!cabinet) return this.say('PANELS_ARE_ONLY_INSTALLED_ONTO_CABINETS');
    const said = ['YOU_ARE_COMPLETELY_UNSURE_WHAT_YOU_JUST_DID', 'YOU_ACTUATE_THE_MECHANISM_TO_NO_APPARENT_EFFECT', 'STATUS_LIGHTS_CHANGE_BUT_YOU_SEE_NO_OTHER_EFFECT', 'LIGHTS_FLASH_AND_CHANGE_COLOR_BUT_NOTHING_ELSE_HAPPENS'];
    if (cabinet.quality < 4) this.say(said[cabinet.quality]);
    else if (cabinet.quality === 4) this.dreamMachine(o);
    else if (cabinet.quality > 7) this.say('IT_HAS_NO_EFFECT');
  }

  /** use_head_gear: the headgear fitted to a dream machine. */
  private headgear(t: Obj): void {
    const g = this.g;
    const machine = t.objN === 289 ? (g.objects.list(t.x, t.y, t.z) ?? []).find((n) => n.objN === 288) : t;
    if (!machine) return this.say('IT_HAS_NO_EFFECT');
    const gear = g.objects.create(100, 1, 0);
    gear.frameN = 1;
    [gear.x, gear.y, gear.z] = [machine.x, machine.y, machine.z];
    g.objects.add(gear);
    this.say('THE_HEADGEAR_IS_INSTALLED');
    this.flag(0x74, 4);
    if (this.hasFlag(0x74, 0)) this.flag(0x60, 2);
  }

  private flag(id: number, f: number, on = true): void {
    const a = this.g.actors.get(id);
    if (a) a.talkFlags = on ? a.talkFlags | (1 << f) : a.talkFlags & ~(1 << f);
  }
  private hasFlag(id: number, f: number): boolean {
    return !!((this.g.actors.get(id)?.talkFlags ?? 0) & (1 << f));
  }

  /** use_dream_machine: powered, with headgear, and someone in its seat - who dreams. */
  private dreamMachine(panel: Obj): void {
    const g = this.g;
    if (this.hasFlag(0x46, 3)) return this.say('THE_DREAM_MACHINES_SEEM_TO_HAVE_CEASED_FUNCTIONING');
    let power = false;
    let gear = false;
    let seat: [number, number] | null = null;
    let quality: number | null = null;
    for (let y = panel.y - 5; y <= panel.y + 5; y++) {
      for (let x = panel.x - 5; x <= panel.x + 5; x++) {
        for (const o of g.objects.list(x, y, panel.z) ?? []) {
          if (o.objN === 290 && o.frameN === 1) power = true;
          else if (o.objN === 100) gear = true;
          else if (o.objN === 289) seat = [o.x, o.y];
          else if (o.objN === 288) quality = o.quality;
        }
      }
    }
    if (!power || quality === null || !gear || !seat) return this.say('THE_MACHINE_DOES_NOT_WORK');
    const sitter = g.actors.at(seat[0], seat[1], panel.z);
    if (!sitter) return this.say('THERE_IS_NOBODY_SITTING_IN_THE_MACHINE');
    if (panel.z !== 0) return this.wake();
    if (quality < 2) this.flag(0x60, 3);
    if (quality === 3) return this.say('THE_MACHINE_DOES_NOT_WORK');
    if (sitter.id !== 1) {
      this.say('ACTOR_DREAMS_UNTIL_DAWN_WHILE_THE_PARTY_WAITS', g.partyMemberName(sitter.id) || g.lookActor(sitter));
      const c = g.clock;
      g.advance(60 - c.minute + ((c.hour < 8 ? 7 - c.hour : 31 - c.hour) * 60));
      return;
    }
    // actor_use_dream_machine: the Avatar alone in the dream world, the party left waking.
    const p = g.player;
    const companions = g.party.slice(1).map((m) => ({ ...m, at: [m.actor.x, m.actor.y, m.actor.z] as [number, number, number] }));
    g.party.splice(1);
    for (const m of companions) m.actor.visible = false;
    // The Avatar dreams empty-handed: what they carry waits with the dream actor's slot (actor 0), so it is saved.
    for (const o of [...g.objects.inventories[p.id]]) {
      g.objects.unlink(o);
      g.objects.toInventory(o, 0);
    }
    this.dream = { seat: [p.x, p.y, p.z], companions, hp: p.hp, stage: 0, back: null };
    p.hp = p.maxHp;
    g.cutscene = 4;
    g.relocate(quality === 1 ? 0x64 : 0x93, quality === 1 ? 0x3b : 0x34, 2);
    g.say('sys', 'You drift into a dream...');
  }

  /** Stepping on a dream teleporter (player_post_move_action, dreamworld_cleanup_state). */
  private teleporter(o: Obj): boolean {
    const g = this.g;
    const d = this.dream!;
    const stage = o.status & 0xe5;
    if (stage === 0xa5 && g.player.hp <= 4) return false;
    if (stage === 0) {
      g.relocate(o.quality, o.qty, g.player.z);
      return true;
    }
    if (stage === 1) {
      d.stage = 0;
      return false;
    }
    if (stage === 0x24) {
      this.wake();
      return true;
    }
    // The stage left (dreamworld_cleanup_tbl): back on one's feet after the cliff.
    if (d.stage === 0x40 && stage !== 0xa5 && stage !== 0xe5) this.restoreLook();
    if (d.stage !== 0 && stage === 0x40) {
      // fall_from_cliff: flat on the ground, and Your Mother above crushed with the fall.
      this.say('YOU_FALL_OFF_THE_CLIFF');
      const p = g.player;
      p.objN = g.gender === 1 ? 0x127 : 0x126;
      p.frameN = 0;
      for (const a of g.actors.list) if (a.objN === 391 && a.alive && a.x === p.x && a.y >= p.y - 8 && a.y <= p.y && a.z === p.z) g.combat.harm(a, a.hp);
    }
    d.back = [o.quality, o.qty];
    g.relocate(o.quality, o.qty, g.player.z);
    if (stage !== 0xe5) {
      if (stage === 0x25) {
        const p = g.player;
        const mother = g.combat.spawn(391, p.x, p.y - 1, p.z, 0, 0x15);
        if (mother) mother.worktype = 0x8;
      } else if (stage === 0x44) this.tiffanyStage();
      d.stage = stage;
    }
    return true;
  }

  /** The dreamer as they were (cleanup_cliff_fall, and the end of walking on walls). */
  private restoreLook(): void {
    const p = this.g.player;
    const base = this.g.gender === 1 ? 344 : 343;
    if (p.objN !== base) {
      p.objN = base;
      p.setDirection(p.direction);
    }
  }

  /** player_before_move_action: a step south off a cliff's edge (tiles 384 to 387) is taken, wall or no. */
  cliff(dx: number, dy: number): boolean {
    const p = this.g.player;
    const t = this.g.map.tileNum(p.x, p.y, p.z);
    return dx === 0 && dy === 1 && t >= 384 && t <= 387;
  }

  /** setup_tiffany_stage: the shop of pitchers and the minotaur. */
  private tiffanyStage(): void {
    const g = this.g;
    this.flag(0x54, 0, false);
    this.flag(0x54, 6, false);
    const z = g.player.z;
    for (const o of [...g.objects.all()]) {
      if (o.loc === 'map' && o.z === z && o.x >= 0x21 && o.x < 0x3d && o.y >= 0x33 && o.y < 0x43 && [161, 162, 217, 218, 398].includes(o.objN)) g.objects.unlink(o);
    }
    const put = (n: number, x: number, y: number, frame = 0, qty = 1): void => {
      const o = g.objects.create(n, qty, 0);
      o.frameN = frame;
      [o.x, o.y, o.z] = [x, y, z];
      g.objects.add(o);
    };
    put(161, 0x24, 0x36);
    const pitcher = (x: number, y: number): void => put(217, x, y, Math.floor(this.rand(0, 5) / 2), 3);
    for (let i = 57; i <= 65; i++) {
      if (i !== 0x3e) pitcher(0x37, i);
      if (i > 0x3a && i !== 0x40) pitcher(0x39, i);
      pitcher(0x3b, i);
    }
    pitcher(0x38, 0x39);
    pitcher(0x38, 0x41);
    pitcher(0x3a, 0x39);
    pitcher(0x3a, 0x41);
    const minotaur = g.combat.spawn(398, 0x3b, 0x41, z, 0, 0x16);
    if (minotaur) minotaur.worktype = 0x16;
  }

  /** finish_dream_quest: the dreamer home, their teleporter and obelisk gone, and the count of quests done. */
  private finishDreamQuest(a: Actor): void {
    const g = this.g;
    const home = a.sched?.[0];
    if (home) {
      a.x = home.x;
      a.y = home.y;
      a.z = home.z;
      for (const [dy, n] of [[0, 461], [-1, 292]]) {
        const o = (g.objects.list(home.x, home.y + dy, home.z) ?? []).find((q) => q.objN === n);
        if (o) g.objects.unlink(o);
      }
    }
    a.talkFlags |= 1 << 7;
    const done = (ids: number[]): boolean => ids.every((id) => this.hasFlag(id, 7));
    if (done([0x56, 0x54, 0x52, 0x55])) this.flag(0x60, 4);
    if (done([0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57])) this.flag(0x20, 4);
  }

  private dreamQuestDone(id: number, flag: number): void {
    const a = this.g.actors.get(id);
    if (!a) return;
    this.finishDreamQuest(a);
    a.talkFlags |= 1 << flag;
    this.g.talkTo(a);
    this.wakeAfterTalk = true;
  }

  /** use_oil_on_dream_door: Melies' door in the dream (tile 8). */
  private dreamDoor(t: Obj | Actor | null, a: Actor, x: number, y: number): void {
    if (!t && this.dream && this.g.map.tileNum(x, y, a.z) === 8) this.dreamQuestDone(0x51, 6);
    else this.say('IT_HAS_NO_EFFECT');
  }

  /** wake_from_dream: morning, the party as it was, the dream's things gone. */
  wake(nightmare = false): void {
    const g = this.g;
    const d = this.dream;
    if (!d) return;
    if (nightmare) this.say('YOU_SHAKE_YOURSELF_AWAKE_FROM_THE_NIGHTMARE');
    const c = g.clock;
    const hour = c.hour + 1;
    g.advance(60 - c.minute + (hour >= 8 ? 24 - hour + 8 : 8 - hour) * 60);
    const p = g.player;
    this.restoreLook();
    for (const o of [...g.objects.inventories[p.id]]) g.objects.unlink(o);
    for (const o of [...g.objects.inventories[0]]) {
      g.objects.unlink(o);
      g.objects.toInventory(o, p.id);
    }
    p.hp = Math.max(1, d.hp);
    p.statusFlags &= ~0x10;
    p.visible = true;
    for (const m of d.companions) {
      [m.actor.x, m.actor.y, m.actor.z] = m.at;
      m.actor.visible = true;
      g.party.push({ actor: m.actor, name: m.name });
    }
    this.berries.clear();
    for (const m of g.party) {
      const a = m.actor;
      if (a.statusFlags & 0x08) a.hp = a.hp <= 10 ? 1 : a.hp <= 30 ? this.rand(1, 10) : this.rand(24, 30);
    }
    this.dream = null;
    g.relocate(d.seat[0], d.seat[1], d.seat[2]);
    this.say('YOU_WAKE_UP');
  }

  // ---- pushing, the drill and the conveyor ----

  /** Whether a thing is pushed rather than walked over (usecode_move_obj_table). */
  pushable(o: Obj): boolean {
    return MOVED.has(o.objN);
  }

  /**
   * Push a thing a square (move_obj): a wheelbarrow or drill turns to the way it goes, a rail car keeps to its track,
   * a plank simply moves. Returns whether it moved.
   */
  push(o: Obj, dx: number, dy: number): boolean {
    const g = this.g;
    if (dx && dy) {
      if (o.objN === 410) this.say('IT_WONT_GO_IN_THAT_DIRECTION');
      return false;
    }
    const nx = o.x + dx;
    const ny = o.y + dy;
    if (o.objN === 410) {
      const along = dx ? [0, 2, 4] : [1, 3, 5];
      if (!along.includes(o.frameN) || !this.track(o, nx, ny)) {
        this.say('IT_WONT_GO_IN_THAT_DIRECTION');
        return false;
      }
    } else if (!g.map.tile(nx, ny, o.z).passable || (g.objects.list(nx, ny, o.z) ?? []).some((n) => !g.objects.tileOf(n).passable)) return false;
    if (g.actors.at(nx, ny, o.z)) return false;
    if (o.objN === 268) o.frameN = dx < 0 ? 3 : dx > 0 ? 1 : dy < 0 ? 0 : 2;
    else if (o.objN === 441) o.frameN = dx < 0 ? 1 : dx > 0 ? 4 : dy < 0 ? 3 : 5;
    g.objects.move(o, nx, ny, o.z);
    return true;
  }

  /** check_for_track */
  private track(car: Obj, x: number, y: number): boolean {
    const g = this.g;
    for (const n of g.objects.list(x, y, car.z) ?? []) {
      if ((n.objN >= 412 && n.objN <= 414) || n.objN === 419 || n.objN === 175 || n.objN === 163) {
        return car.frameN % 2 === n.frameN || n.frameN === 2 || n.objN === 412 || n.objN === 175 || n.objN === 163;
      }
      if (n.objN !== 417 && n.objN !== 338) return false;
    }
    return [108, 109, 110, 77, 79].includes(g.map.tileNum(x, y, car.z));
  }

  /** use_assembled_drill: into rock, iron ore, a coal vein or a cave-in ahead; the spoil beside the drill. */
  private drill(d: Obj): void {
    const g = this.g;
    g.sfx('quake');
    let [x, y] = [d.x + 1, d.y];
    if (d.frameN === 1) x = d.x - 1;
    else if (d.frameN === 3) [x, y] = [d.x, d.y - 1];
    else if (d.frameN === 4) [x, y] = [d.x, d.y + 1];
    const target = (g.objects.list(x, y, d.z) ?? []).find((n) => n.objN === 445 || n.objN === 446 || n.objN === 213);
    let spoil = 0;
    if (!target) {
      const t = g.map.tileNum(x, y, d.z);
      if (t >= 0xf0 && t <= 0xfb) spoil = 442;
      else {
        const a = g.actors.at(x, y, d.z);
        if (a) g.combat.hurt(g.player, a, 40);
        else this.say('THERE_IS_NOTHING_TO_DRILL_INTO');
        return;
      }
    } else if (target.objN === 445) spoil = 443;
    else if (target.objN === 446) spoil = 444;
    if (spoil) {
      const at = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([dx, dy]) => [d.x + dx, d.y + dy])
        .find(([px, py]) => (!g.objects.get(px, py, d.z) || g.objects.get(px, py, d.z)!.objN === 338) && g.map.tile(px, py, d.z).passable);
      if (at) {
        const o = g.objects.create(spoil, 1, 0);
        [o.x, o.y, o.z] = [at[0], at[1], d.z];
        g.objects.add(o);
      } else this.say('THERE_IS_NO_ROOM_LEFT_FOR_THE_ORE');
    }
    if (target) {
      if (spoil && target.quality > 1) target.quality--;
      else g.objects.unlink(target);
    }
  }

  /**
   * update_conveyor_belt: while the power runs, the mine's one belt (from 0x3c, 0x63 on level 5 westward) carries
   * what lies on it, and whoever stands on it, a square east each turn; now and then it stops.
   */
  conveyor(canStop: boolean): void {
    const g = this.g;
    const flag = (id: number, f: number): boolean => !!((g.actors.get(id)?.talkFlags ?? 0) & (1 << f));
    if (!flag(0x73, 2) || g.player.z !== 5) return;
    const z = 5;
    let x = 0x3c;
    const y = 0x63;
    const at = (cx: number, n: number): Obj | undefined => (g.objects.list(cx, y, z) ?? []).find((o) => o.objN === n);
    let belt = at(x, 188);
    while (belt) {
      if (belt.frameN === 2) {
        const seam = at(x, 189);
        if (seam) g.objects.unlink(seam);
      } else if (belt.frameN === 0) {
        if (belt.qty === 0) {
          const seam = g.objects.create(189, 1, 0);
          [seam.x, seam.y, seam.z] = [x, y, z];
          g.objects.add(seam);
          belt.qty = 4;
        }
        belt.qty--;
      }
      for (const o of [...(g.objects.list(x, y, z) ?? [])]) {
        if (o.objN === 189 || o.objN === 447 || (o.objN !== 188 && g.objects.weightOf(o) > 0)) g.objects.move(o, x + 1, y, z);
      }
      const a = g.actors.at(x, y, z);
      if (a && !g.actors.at(x + 1, y, z)) a.x = x + 1;
      x--;
      belt = at(x, 188);
    }
    if (canStop && flag(0x71, 3) && g.random(7) === 0) {
      this.say('THE_CONVEYOR_BELT_STOPS');
      for (const [id, f] of [[0x73, 2], [0x71, 3]]) {
        const a = g.actors.get(id);
        if (a) a.talkFlags &= ~(1 << f);
      }
      for (const o of [...g.objects.all()]) {
        if (o.loc !== 'map') continue;
        if (o.z === z && o.objN === 209) g.objects.unlink(o);
        else if (o.z === z && o.objN === 233 && (o.frameN === 5 || o.frameN === 7)) o.frameN -= 4;
        else if (o.objN === 154 && (o.z === z || o.z === 4)) o.frameN = 0;
      }
    }
  }

  // ---- time passing: the cold, the thin air, radium, ice, berries (actor.lua's advance_time) ----

  /** The party is camped (or otherwise kept warm): no cold, no air used. */
  warm = false;
  private cold = new Set<number>();
  private lastHour = -1;

  /** A minute's worth of Mars, for each minute passed. */
  tick(minutes: number): void {
    const g = this.g;
    for (let i = 0; i < Math.min(minutes, 30); i++) this.minute();
    if (g.clock.hour !== this.lastHour) {
      if (this.lastHour >= 0) this.hour();
      this.lastHour = g.clock.hour;
    }
  }

  private needsAir(a: Actor): boolean {
    return a.id !== 6 && this.hasFlag(0x10, 5) && !this.dream && !this.warm;
  }

  private setHypoxia(a: Actor, on: boolean): void {
    const was = !!(a.objFlags & 0x40);
    if (was === on) return;
    a.objFlags = on ? a.objFlags | 0x40 : a.objFlags & ~0x40;
    this.say(on ? 'GASPS_FOR_AIR' : 'BREATHES_EASIER', this.g.partyMemberName(a.id) || this.g.lookActor(a));
  }

  private minute(): void {
    const g = this.g;
    const h = g.clock.hour;
    if (this.dream) return;
    for (const m of g.party) {
      const a = m.actor;
      if (!a.alive || a.statusFlags & 0x04) continue;
      const inv = g.objects.inventories[a.id];
      this.setHypoxia(a, this.needsAir(a) && !inv.some((o) => o.objN === OXIUM));
      // The cold: by night without warm clothes, out on the surface.
      const warmth = inv.filter((o) => o.loc === 'readied').reduce((n, o) => n + (WARMTH.get(o.objN) ?? 0), 0);
      let cold = 0;
      if (!this.warm && a.z === 0 && a.id !== 6) {
        if (h <= 3 || h >= 22) cold = warmth >= 10 ? 1 : 2;
        else if ((h <= 6 || h >= 18) && warmth < 10) cold = 1;
      }
      if (!cold) {
        if (this.cold.delete(a.id)) this.say('FEELS_WARMER', m.name);
      } else {
        this.cold.add(a.id);
        if (this.rand(0, 1) === 1 || cold === 2) {
          this.say('IS_FREEZING', m.name);
          g.combat.harm(a, this.rand(1, 2) + (cold === 2 && this.rand(0, 1) ? this.rand(1, 2) : 0));
        }
      }
      // Radium carried outside its lead box poisons; ice melts; the berries' powers fade.
      for (const o of [...inv, ...inv.flatMap((c) => c.container ?? [])]) {
        if ((o.objN === 448 || (o.objN === 449 && a.id !== 6)) && o.parentObj?.objN !== 139 && !(a.statusFlags & 0x08)) {
          a.statusFlags |= 0x08;
          this.say('IS_POISONED', m.name);
        } else if ((o.objN === 160 && o.frameN > 1) || o.objN === 256) {
          if (this.rand(0, 100) < 10) {
            this.say('SOME_ICE_HAS_MELTED');
            if (o.objN === 160) o.frameN = 1;
            else g.objects.unlink(o);
          }
        }
      }
      const b = this.berries.get(a.id);
      if (b) {
        for (let k = 0; k < 3; k++) {
          if (b[k] > 0 && this.rand(1, Math.max(1, a.intelligence * 4)) === 1) {
            b[k]--;
            this.say('A_PSYCHIC_POWER_FADES');
          }
        }
      }
      if (this.frenzy.has(a.id) && !g.combat.mode) this.frenzy.delete(a.id);
    }
  }

  /** On the hour: each breathes a blob of oxium where the air is thin. */
  private hour(): void {
    const g = this.g;
    for (const m of g.party) {
      const a = m.actor;
      if (!this.needsAir(a) || a.statusFlags & 0x04) continue;
      const ox = g.objects.inventories[a.id].find((o) => o.objN === OXIUM);
      if (ox) {
        if (ox.qty > 1) ox.qty--;
        else g.objects.unlink(ox);
      }
      this.setHypoxia(a, !g.objects.inventories[a.id].some((o) => o.objN === OXIUM));
    }
  }

  // ---- the coal works' people (worktype.lua) and its repairs ----

  private objAt(x: number, y: number, z: number, n: number): Obj | undefined {
    return (this.g.objects.list(x, y, z) ?? []).find((o) => o.objN === n);
  }

  /** The cokers dig coal onto the belt; the stokers carry it from the belt's end to the furnace; in the dreams, Your Mother and the minotaur. */
  work(a: Actor): void {
    const g = this.g;
    const { x, y, z } = a;
    switch (a.worktype) {
      case 0x15: { // worktype_15_your_mother: down upon you, a cuff for whoever is nearest
        if (g.stepActor(a, 0, 1)) break;
        const t = g.combat.findTarget(a);
        if (t && Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 1) g.combat.hurt(a, t, this.rand(1, 6));
        break;
      }
      case 0x16: // worktype_16_minotaur
        this.minotaur(a);
        break;
      case 0x99: // coker to the coal vein
        if (!g.stepActor(a, 0, -1) && this.objAt(x, y - 1, z, 446)) a.worktype = 0x9a;
        break;
      case 0x9a: // coker drops coal on the belt
        if (this.objAt(x, y + 1, z, 188)) {
          const coal = g.objects.create(447, 1, 0);
          [coal.x, coal.y, coal.z] = [x, y + 1, z];
          g.objects.add(coal);
        } else if (!this.objAt(x, y + 1, z, 192)) {
          g.stepActor(a, 0, 1);
          break;
        }
        a.worktype = 0x9b;
        break;
      case 0x9b: // coker waits for the coal to move away
        if (!this.objAt(x, y + 1, z, 447) && !this.objAt(x, y + 1, z, 192)) a.worktype = 0x99;
        break;
      case 0x9c: // stoker back to the belt
        if (!this.objAt(x, y + 2, z, 191)) g.stepActor(a, 0, 1);
        else a.worktype = 0x9d;
        break;
      case 0x9d: { // stoker waits for coal
        let coal = this.objAt(x, y + 1, z, 447);
        if (!coal) break;
        while (coal) {
          g.objects.unlink(coal);
          coal = this.objAt(x, y + 1, z, 447);
        }
        a.worktype = 0x9e;
        break;
      }
      case 0x9e: // stoker to the furnace
        if (g.stepActor(a, 0, -1)) break;
        if (this.objAt(x, y - 1, z, 233) || this.objAt(x + 1, y - 1, z, 233)) {
          if (!this.hasFlag(0x72, 2)) this.power();
          else if (!this.hasFlag(0x73, 2) || this.hasFlag(0x71, 3)) {
            if (this.hasFlag(0x71, 3)) {
              this.flag(0x73, 2, false);
              this.flag(0x71, 3, false);
            }
            this.flag(0x73, 2);
            this.towers(true);
            g.cutscene = 2;
          }
          a.worktype = 0x9c;
        }
        break;
    }
  }

  /** The minotaur charges the red cape - carried, or dropped in the shop - smashing pitchers as it goes. */
  private minotaur(a: Actor): void {
    const g = this.g;
    const d = this.dream;
    if (d?.stage === 0x60) {
      g.combat.hurt(a, a, a.hp);
      return;
    }
    const p = g.player;
    let target: { x: number; y: number; who?: Actor } | null = null;
    if (g.objects.inventories[p.id].some((o) => o.objN === 162)) target = { x: p.x, y: p.y, who: p };
    else {
      const cape = g.objects.all().find((o) => o.objN === 162 && o.loc === 'map' && o.z === 2 && o.x >= 0x21 && o.x < 0x3d && o.y >= 0x33 && o.y < 0x43);
      if (cape) target = { x: cape.x, y: cape.y };
    }
    const smash = (): void => {
      for (const o of [...(g.objects.list(a.x, a.y, a.z) ?? [])]) if (o.objN === 217 || o.objN === 218) g.objects.unlink(o);
    };
    if (!target) {
      // worktype_stomp_around
      const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][this.rand(0, 3)];
      g.stepActor(a, dx, dy);
      smash();
      return;
    }
    if (Math.max(Math.abs(target.x - a.x), Math.abs(target.y - a.y)) <= 1) {
      if (target.who) return void g.combat.attack(a, target.who);
      if (!this.hasFlag(0x54, 6) && a.x >= 0x37 && a.y <= 0x37) return this.tiffanyDone();
    }
    g.combat.step(a, target.x, target.y);
    g.sfx('quake');
    smash();
  }

  /** complete_tiffany_stage */
  private tiffanyDone(): void {
    const t = this.g.actors.get(0x54);
    if (!t) return;
    this.finishDreamQuest(t);
    t.talkFlags |= 1 << 1;
    this.g.talkTo(t);
    this.wakeAfterTalk = true;
  }

  /** has_minotaur_left_the_shop */
  private minotaurOut(z: number): boolean {
    return !this.hasFlag(0x54, 6) && this.g.actors.list.some((a) => a.objN === 398 && a.alive && a.z === z && a.x >= 0x37 && a.y <= 0x37);
  }

  /** ready_obj: the throw rug worn becomes a red cape; winged shoes lay a bridge in the dream, and will not come off. */
  ready(o: Obj, a: Actor, readying: boolean): boolean {
    const g = this.g;
    if (readying) {
      if (o.objN === 161) o.objN = 162;
      else if (o.objN === 136) this.say('THE_TONGS_WILL_NOW_PROTECT_YOUR_HANDS');
      else if (o.objN === 15 && a.z === 2) {
        const bridge = g.objects.create(146, 1, 0);
        [bridge.x, bridge.y, bridge.z] = [0xc9, 0x9b, 2];
        g.objects.add(bridge);
      }
      return true;
    }
    if (o.objN === 15) {
      this.say('THEY_WONT_COME_OFF');
      return false;
    }
    return true;
  }

  /** activate_tower_electricity: the towers by the works light, their cables live. */
  private towers(on: boolean): void {
    for (const o of this.g.objects.all()) {
      if (o.loc !== 'map' || o.z !== 0 || o.x < 0x3d0 || o.x > 0x3f0 || o.y < 0x1d0 || o.y > 0x1e7) continue;
      if (o.objN === 201 && on) o.frameN |= 4;
      else if (o.objN === 214 && on) o.objN = 215;
    }
  }

  /** use_fixed_belt_on_bare_rollers: the mended belt laid over the rollers, a join every five. */
  private belt(beltObj: Obj, rollers: Obj): void {
    const g = this.g;
    let start: Obj | undefined;
    for (let r: Obj | undefined = rollers; r; r = this.objAt(r.x - 1, r.y, r.z, r.objN)) {
      if (r.frameN === 0) {
        start = r;
        break;
      }
    }
    if (!start) return this.say('OOOPS_THESE_ROLLERS_CAN_NEVER_BE_FIXED');
    let i = 4;
    for (let r: Obj | undefined = start; r; ) {
      const next = this.objAt(r.x + 1, r.y, r.z, 192);
      r.objN = 188;
      if (i === 0) {
        i = 4;
        const join = g.objects.create(189, 1, 0);
        [join.x, join.y, join.z] = [r.x, r.y, r.z];
        g.objects.add(join);
      } else i--;
      r = next;
    }
    g.objects.unlink(beltObj);
    this.flag(0x72, 2);
  }

  private fixTrack(t: Obj, broken: Obj): void {
    this.say('WHICH_SECTION_OF_RAIL_NEEDS_FIXING');
    this.g.objects.unlink(t);
    broken.objN = 414;
  }

  /** use_pliers_on_spool_to_tower: new cable for the tower - with rubber gloves on. */
  private cable(spool: Obj, tower: Obj, a: Actor): void {
    const g = this.g;
    if (Math.max(Math.abs(a.x - tower.x), Math.abs(a.y - tower.y)) > 1) return this.say('THE_WORK_IS_TO_PRECISE_TO_PERFORM_TELEKINETICALLY');
    if (!this.hasFlag(0x73, 2) || this.hasFlag(0x71, 3)) return this.say('THE_CABLE_DOES_NOT_NEED_REPLACEMENT');
    const gloves = g.objects.inventories[a.id].some((o) => o.loc === 'readied' && o.objN === 38);
    if (!gloves) {
      g.combat.hurt(a, a, this.rand(0, Math.floor(a.maxHp / 2)));
      const spector = g.actors.get(2);
      if (spector && spector.alive && spector.z === a.z && Math.abs(spector.x - a.x) < 6 && Math.abs(spector.y - a.y) < 6) {
        spector.talkFlags |= 1 << 2;
        g.talkTo(spector);
      }
      return;
    }
    g.objects.unlink(spool);
    this.flag(0x73, 4);
    g.cutscene = 3;
    for (const o of [...g.objects.all()]) {
      if (o.loc !== 'map' || o.z !== 0) continue;
      if (o.objN === 215 && o.x >= 0x3d0 && o.x < 0x3f0 && o.y >= 0x1d0 && o.y < 0x1e1) o.objN = 214;
      else if (o.objN === 315) g.objects.unlink(o);
    }
  }

  /** The wrench: a turntable's switch loosened or fastened, a drill fixed to its cart, a panel loosened or fastened. */
  private wrench(t: Obj): void {
    const g = this.g;
    if (t.objN === 411) {
      if (t.quality === 1) {
        const tt = t.loc === 'map' ? this.objAt(t.x - 1, t.y - 1, t.z, 413) : undefined;
        if (!tt) return this.say('THIS_SWITCH_CANNOT_BE_FIXED');
        t.frameN = tt.frameN;
        t.quality = 0;
        return this.say('THE_SWITCH_IS_FASTENED');
      }
      this.say('THE_SWITCH_IS_LOOSE');
      t.quality = 1;
    } else if (t.objN === 440) {
      const cart = t.loc === 'map' ? this.objAt(t.x, t.y, t.z, 439) : undefined;
      if (!cart) return this.say('THE_DRILL_MUST_BE_INSTALLED_ONTO_A_DRILL_CART');
      const drill = g.objects.create(441, 1, 0);
      drill.frameN = 1;
      [drill.x, drill.y, drill.z] = [t.x, t.y, t.z];
      g.objects.unlink(t);
      g.objects.unlink(cart);
      g.objects.add(drill);
      this.say('THE_DRILLS_POWER_IS_CONNECTED');
    } else if (t.objN === 458) {
      if (t.loc !== 'map') return this.say('IT_HAS_NO_EFFECT');
      if (t.quality === 0) {
        t.quality = 1;
        return this.say('THE_PANEL_IS_LOOSE');
      }
      if (t.quality & 2) return this.say('IT_MUST_BE_REPAIRED_FIRST');
      const cab = this.objAt(t.x, t.y, t.z, 457);
      if (!cab) return this.say('PANELS_ARE_ONLY_INSTALLED_ONTO_CABINETS');
      const q = cab.quality;
      const n = t.qty;
      if ((q === 0 && n !== 0) || (q !== 0 && q <= 3 && n === 0 && t.frameN !== q - 1) || (q !== 0 && (q > 3 || n !== 0) && q !== n)) {
        return this.say('THIS_CABINET_REQUIRES_A_DIFFERENT_TYPE_OF_PANEL');
      }
      t.quality--;
      this.say('THE_PANEL_IS_FASTENED');
      if (t.quality === 3) {
        this.flag(0x74, 3);
        if (this.hasFlag(0x74, 0)) this.flag(0x60, 2);
      }
    }
  }

  // ---- digging and shovelling ----

  /** use_tool_on_ground: dirt or ice dug out to a hole, the pile beside the digger. */
  private dig(t: Obj | Actor | null, a: Actor, x: number, y: number): void {
    const g = this.g;
    if (t) return this.say('THE_GROUND_IS_NOT_CLEAR_FOR_DIGGING');
    const tile = g.map.tileNum(x, y, a.z);
    const pile = (tile >= 32 && tile <= 36) || tile === 12 || tile === 13 || (tile >= 40 && tile <= 63) ? 258 : [124, 125, 127].includes(tile) ? 256 : 0;
    if (!pile) return this.say('IT_HAS_NO_EFFECT');
    const around = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([dx, dy]) => [a.x + dx, a.y + dy])
      .find(([px, py]) => (px !== x || py !== y) && g.canStand(px, py, a.z) && !g.objects.get(px, py, a.z));
    if (!around) return this.say('YOU_CANT_DIG_HERE');
    const put = (n: number, px: number, py: number): void => {
      const o = g.objects.create(n, 1, 0);
      o.status |= 0x20;
      [o.x, o.y, o.z] = [px, py, a.z];
      g.objects.add(o);
    };
    put(pile === 256 ? 255 : 257, x, y);
    put(pile, around[0], around[1]);
  }

  private fill(pile: Obj, hole: Obj): void {
    this.g.objects.unlink(pile);
    this.g.objects.unlink(hole);
    this.say('YOU_FILLED_IN_THE_HOLE');
  }

  /** use_shovel_on_ore_to_container: ore into a wheelbarrow (one load) or a rail car (seven of a kind). */
  private load(ore: Obj, to: Obj): boolean {
    const quality = ({ 258: 1, 442: 2, 443: 3, 444: 4 } as Record<number, number>)[ore.objN] ?? 1;
    const name = this.g.objects.name(ore);
    if (to.objN === 268) {
      if (to.qty === 1) return this.say('THERE_IS_NO_MORE_ROOM'), false;
      to.qty = 1;
      to.quality = quality;
      this.say('YOU_PUT_THE_ORE_INTO_THE_WHEELBARROW', name);
    } else if (to.objN === 410) {
      if (to.qty >= 7) return this.say('THERE_IS_NO_MORE_ROOM'), false;
      if (to.qty > 0 && to.quality !== quality) return this.say('YOU_CANT_MIX_DIFFERENT_THINGS_IN_THE_SAME_LOAD'), false;
      to.quality = quality;
      to.qty++;
      if (to.qty === 1 || to.qty === 7) to.frameN += 2;
      this.say('YOU_PUT_THE_ORE_INTO_THE_RAIL_CAR', name);
    } else return false;
    if (ore.loc !== 'none') this.g.objects.unlink(ore);
    return true;
  }

  /** use_shovel_to_unload_container: a load out of a barrow or car, into another or the furnace. */
  private unload(from: Obj, to: Obj, _a: Actor): void {
    const g = this.g;
    if (from.qty === 0) return this.say('THERE_IS_NOTHING_TO_UNLOAD');
    const ore = g.objects.create([0, 258, 442, 443, 444][from.quality] ?? 258, 1, 0);
    let ok = false;
    if (to.objN === 268 || to.objN === 410) ok = this.load(ore, to);
    else if (to.objN === 233) {
      ok = true;
      if (ore.objN === 444) {
        if (to.frameN < 4) this.power();
      } else this.say('IT_HAS_NO_EFFECT');
    }
    if (!ok) return;
    from.qty--;
    if (from.objN === 410 && (from.qty === 6 || from.qty === 0)) from.frameN -= 2;
  }

  /**
   * Each hour (advance_time): the pocket watch's face shows the hour (update_watch_tile), and the lamp posts light at
   * night once the power is on (update_lamp_posts).
   */
  hourly(): void {
    const g = this.g;
    g.tiles.setAnimFirst(616, 416 + (g.clock.hour % 12));
    const h = g.clock.hour;
    const lit = !!((g.actors.get(0x73)?.talkFlags ?? 0) & (1 << 4)) && (h < 6 || h > 17);
    const z = g.player.z;
    for (const o of g.objects.all()) if (o.objN === 228 && o.z === z) o.frameN = lit ? 7 : 3;
  }

  /** activate_power_system: coal in the furnace - steam from the cracks, the furnaces lit, the lamps on. */
  private power(): void {
    const g = this.g;
    this.say('THE_COAL_BEGINS_MOVING_DOWN_THE_BELT');
    for (const [id, flag] of [[0x73, 2], [0x71, 3]]) {
      const a = g.actors.get(id);
      if (a) a.talkFlags |= 1 << flag;
    }
    const z = g.player.z;
    for (const o of [...g.objects.all()]) {
      if (o.loc !== 'map') continue;
      if (o.z === z && o.objN === 208 && !(g.objects.list(o.x, o.y + 1, z) ?? []).some((n) => n.objN === 209)) {
        const steam = g.objects.create(209, 1, 0);
        steam.frameN = 1;
        [steam.x, steam.y, steam.z] = [o.x, o.y + 1, z];
        g.objects.add(steam);
      } else if (o.z === z && o.objN === 233 && (o.frameN === 1 || o.frameN === 3)) o.frameN += 4;
      else if (o.objN === 154 && (o.z === z || o.z === 4)) o.frameN = 1;
    }
  }

  // ---- things used on something ----

  private crate(tool: Obj, c: Obj): void {
    if (c.frameN === 2) {
      c.frameN = 1;
      this.say('YOU_PRIED_THE_NAILS_OUT_OF_THE_CRATE');
    } else if (c.frameN === 1 && tool.objN === 273) {
      c.frameN = 2;
      this.say('YOU_NAIL_THE_CRATE_SHUT');
    } else this.say('IT_HAS_NO_EFFECT');
  }

  private hatch(h: Obj, a: Actor): void {
    const g = this.g;
    if (a.id !== 1) return this.say('IS_NOT_STRONG_ENOUGH', g.partyMemberName(a.id));
    const tesla = g.actors.get(16);
    if (!tesla) return;
    if (!(tesla.talkFlags & (1 << 4))) {
      tesla.talkFlags |= 1 << 2;
      return g.talkTo(tesla);
    }
    this.g.cutscene = 1;
    tesla.talkFlags |= 1 << 5;
    h.objN = 428;
    h.frameN = 0;
    g.objects.move(h, h.x + 1, h.y + 1, h.z);
    const blood = g.actors.get(18);
    if (blood) {
      blood.talkFlags |= (1 << 3) | (1 << 6);
      g.talkTo(blood);
    }
  }

  private geode(geode: Obj, a: Actor): void {
    const g = this.g;
    if (geode.frameN !== 0) return this.say('IT_HAS_NO_EFFECT');
    geode.frameN = 1;
    g.sfx('hit');
    const qty = this.rand(1, 50) + this.rand(1, 50);
    const ox = g.objects.create(OXIUM, qty, 0);
    if (geode.loc === 'map') {
      [ox.x, ox.y, ox.z] = [geode.x, geode.y, geode.z];
      g.objects.add(ox);
    } else g.objects.toInventory(ox, a.id);
  }

  private gong(): void {
    this.say('GONG');
    this.g.sfx('bell');
  }

  /** use_oil_on_door: a rusted door comes unstuck, and the oil is used. */
  private oil(oil: Obj, door: Obj | null): void {
    if (oil.objN === 235 && oil.frameN !== 4) return this.say('IT_HAS_NO_EFFECT');
    if (!door) return;
    if (!(door.quality & 0x80)) return this.say('THIS_DOOR_IS_NOT_RUSTED');
    door.quality &= 0x7f;
    this.say('THE_DOOR_IS_UNSTUCK');
    this.g.sfx('success');
    this.one(oil);
  }

  private refillSprayGun(bottle: Obj, gun: Obj): void {
    if (bottle.objN === 119 && gun.quality === 0) {
      gun.quality = 1;
      gun.qty = 20;
      this.say('SPRAY_GUN_GREEN_PAINT');
    } else if (bottle.objN === 128 && gun.quality !== 0) {
      gun.quality = 0;
      gun.qty = 10;
      this.say('SPRAY_GUN_WEED_KILLER');
    } else {
      gun.qty = Math.min(0x1e, gun.qty + 10);
      this.say('SPRAY_GUN_10_MORE_CHARGES');
    }
    this.g.objects.unlink(bottle);
  }

  /** use_spray_gun: green paint shows the unseen; weed killer kills plants, or is fired at a creature. */
  private spray(gun: Obj, t: Obj | Actor | null, a: Actor): void {
    const g = this.g;
    if (gun.qty === 0) return this.say('THERE_IS_NOTHING_IN_THE_GUN');
    if (!t) return this.say('NOTHING');
    if (gun.quality !== 0) {
      gun.qty--;
      if ('id' in t && t.objN === 145) {
        t.objN = 364;
        this.say('BECOMES_VISIBLE', g.lookActor(t));
      } else if ('id' in t && t.objFlags & 0x02) {
        t.objFlags &= ~0x02;
        this.say('BECOMES_VISIBLE', g.lookActor(t));
      } else if (!('id' in t) && t.status & 0x02) {
        t.status &= ~0x02;
        this.say('BECOMES_VISIBLE', g.objects.look(t));
      } else this.say('IT_HAS_NO_EFFECT');
    } else if ('id' in t) {
      g.combat.attack(a, t);
    } else if ([205, 408].includes(t.objN)) {
      gun.qty--;
      this.say('YOU_KILLED_THE_PLANT');
      if (t.objN === 205) {
        const n = g.actors.get(0x30);
        if (n) n.talkFlags |= 1 << 7;
        g.objects.unlink(t);
      } else t.objN = 166;
    } else {
      gun.qty--;
      this.say('IT_HAS_NO_EFFECT');
    }
  }

  private heartstone(stone: Obj, woman: Obj): void {
    if (woman.quality === 1) return this.say('THE_ROBOT_ALREADY_HAS_A_HEARTSTONE');
    woman.quality = 1;
    this.g.objects.unlink(stone);
    this.say('THE_HEARTSTONE_IS_INSTALLED');
  }

  /** use_radium: a block into the power unit; chips charge a ray gun, thirty charges each. */
  private radium(r: Obj, t: Obj): void {
    const g = this.g;
    if (r.objN === 448) {
      let unit = t;
      if (t.objN === 448 && t.loc === 'map') unit = (g.objects.list(t.x, t.y, t.z) ?? []).find((n) => n.objN === 290) ?? t;
      if (unit.objN !== 290) return this.say('IT_HAS_NO_EFFECT');
      if (unit.frameN === 1) return this.say('RADIUM_HAS_ALREADY_BEEN_INSTALLED');
      g.objects.unlink(r);
      this.say('THE_RADIUM_HAS_BEEN_INSTALLED');
      unit.frameN = 1;
      const a = g.actors.get(0x74);
      if (a) {
        a.talkFlags |= 1 << 2;
        if (a.talkFlags & 1) {
          const b = g.actors.get(0x60);
          if (b) b.talkFlags |= 1 << 2;
        }
      }
      return;
    }
    if (t.qty >= 0xf0) return this.say('THE_OBJ_IS_FULLY_CHARGED', g.objects.name(t));
    const need = Math.ceil((0xf0 - t.qty) / 30);
    const use = Math.min(Math.max(1, r.qty), need);
    t.qty = Math.min(0xf0, t.qty + use * 30);
    if (t.qty === 0xf0) this.say('THE_OBJ_IS_FULLY_CHARGED', g.objects.name(t));
    if (r.qty > use) r.qty -= use;
    else g.objects.unlink(r);
  }
}
