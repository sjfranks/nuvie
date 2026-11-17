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

const BERRY = 73;
const OXIUM = 131;

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
    return t;
  }

  /** Print strings as the original does, one after another: those that end without a new line run on. */
  private say(...keys: string[]): void;
  private say(key: string, ...args: (string | number)[]): void;
  private say(key: string, ...rest: (string | number)[]): void {
    const keys = [key, ...rest].every((k) => typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) && k in MD_TEXT);
    const t = (keys ? [key, ...rest].map((k) => this.text$(k as string)).join('') : this.text$(key, ...rest)).replace(/^\n+|\n+$/g, '');
    if (t) this.g.say('sys', t);
  }

  private onTable(o: Obj): Record<number, On> | null {
    const crate: On = (tool, t) => this.crate(tool, t as Obj);
    const misc: On = (_tool, t) => this.misc(t as Obj);
    const oil: On = (tool, t) => this.oil(tool, t as Obj | null);
    const spray: On = (bottle, t) => this.refillSprayGun(bottle, t as Obj);
    const holes = { 255: misc, 257: misc };
    switch (o.objN) {
      case 65: case 67: case 263: case 327: return holes;
      case 102: return { 86: crate, 427: (_t, h, a) => this.hatch(h as Obj, a) };
      case 273: return { 86: crate };
      case 119: case 128: return { 129: spray, 261: spray };
      case 124: case 235: return { 179: oil, 227: oil, 421: oil, 152: oil, 219: oil, 222: oil };
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
      case 331: return (d, a) => this.dreamstuff(d, a);
      case 399: return (_t, a) => this.poolTable(a);
      case 411: return (b) => this.switchBar(b);
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
        if (on) on(o, target, a, x, y);
        else this.say(target ? 'NO_EFFECT' : 'NOTHING');
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
    if (!this.g.combat.fighting) return this.say('THAT_WOULD_BE_A_WASTE_OUTSIDE_OF_COMBAT');
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
    if (o.quality >= 2) this.say('YOU_MAY_USE_THE_RUBY_SLIPPERS_TO_GO_HOME');
    else {
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
        this.g.talkTo(lowell);
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
    } else door.frameN = (door.frameN & 2) + 1;
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
