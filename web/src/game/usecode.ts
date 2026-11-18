/**
 * usecode.ts - what using a thing does in Ultima VI, for the things the game itself (game.ts) does not handle:
 * levers and switches, cranks and drawbridges, keys and lock picks, fires, bells, wells and cows and churns and hives,
 * fishing, digging, potions, food and drink, and the small things - sextant, clock, mirror, instruments, fan, ducky
 * (Nuvie's usecode/U6UseCode.cpp, function by function as its U6ObjectTypes.h table assigns them).
 */
import type { Actor } from './actors.ts';
import type { Game } from './game.ts';
import { invFind } from './inventory.ts';
import { STATUS_OK_TO_TAKE, STATUS_TEMPORARY, type Obj } from './objects.ts';
import { OBJ } from './u6tables.ts';

const U = {
  LEVER: 268, SWITCH: 174, CRANK: 288, CHAIN: 293, DRAWBRIDGE: 269, DOORWAY: 301, PORTCULLIS: 310, ELECTRIC_FIELD: 175,
  CANDLE: 122, CANDELABRA: 145, FIREPLACE: 164, BRAZIER: 206, CAMPFIRE: 253, BELL: 236, PULL_CHAIN: 419, WELL: 233,
  FOUNTAIN: 234, COW: 428, BUCKET: 178, BUCKET_OF_WATER: 179, BUCKET_OF_MILK: 180, CHURN: 181, BUTTER: 96, BEEHIVE: 182,
  HONEY_JAR: 183, JAR_OF_HONEY: 184, FISHING_POLE: 264, FISH: 265, SHOVEL: 104, PICK: 103, HOLE: 308, LADDER: 305,
  POTION: 275, SEXTANT: 93, CLOCK: 159, SUNDIAL: 235, MIRROR: 123, PANPIPES: 153, HARPSICHORD: 156, HARP: 157, LUTE: 158,
  XYLOPHONE: 296, FAN: 212, RUBBER_DUCKY: 169, GEM: 77, GOLD_NUGGET: 89, MEAT_PORTION: 129, WINE: 115, MEAD: 116, ALE: 117,
} as const;

/** use_food's table: everything eaten or drunk. */
export const FOODS: ReadonlySet<number> = new Set([
  96, 115, 116, 117, 128, 129, 130, 131, 132, 210, 209, 95, 133, 67, 135, 184, 417, 265,
]);

const INSTRUMENTS: Record<number, string> = {
  [U.PANPIPES]: 'panpipes', [U.HARPSICHORD]: 'harpsichord', [U.HARP]: 'harp', [U.LUTE]: 'lute', [U.XYLOPHONE]: 'xylophone',
};

/** Things used where they stand in the world (a tap on one uses it, rather than walking onto it). */
export const USED_IN_PLACE: ReadonlySet<number> = new Set([
  U.LEVER, U.SWITCH, U.CRANK, U.CANDLE, U.CANDELABRA, U.FIREPLACE, U.BRAZIER, U.CAMPFIRE, U.BELL, U.PULL_CHAIN, U.WELL,
  U.FOUNTAIN, U.CHURN, U.BEEHIVE, U.CLOCK, U.SUNDIAL, U.MIRROR, U.HARPSICHORD, 221, 223,
]);

const MOONSTONE = 73;
const STAFF = 78;
const CHARGE = 336;
const RUNE_FIRST = 242;
const RUNE_LAST = 249;
/** The mantras, rune by rune (use_rune). */
const MANTRAS = ['AHM', 'MU', 'RA', 'BEH', 'CAH', 'SUMM', 'OM', 'LUM'];
const FORCE_FIELD = 51;
const GARGISH_VOCABULARY = 97;
const VORTEX_CUBE = 62;
const CODEX = 59;
const CRYSTAL_BALL = 155;
const SPELLBOOK = 57;
const CANNON = 221;
const BALLOON_PLANS = 270;
const POWDER_KEG = 223;

const POTIONS = ['awaken', 'cure', 'heal', 'poison', 'sleep', 'protection', 'invisibility', 'x-ray vision'];

export class UseCode {
  constructor(private readonly g: Game) {}

  /** Whether this module knows what using `o` does. */
  handles(o: Obj): boolean {
    return (
      this.g.kind === 'u6' &&
      (USED_IN_PLACE.has(o.objN) || FOODS.has(o.objN) || o.objN in INSTRUMENTS ||
        (o.objN >= RUNE_FIRST && o.objN <= RUNE_LAST) ||
        [OBJ.KEY, OBJ.LOCK_PICK, U.FISHING_POLE, U.SHOVEL, U.PICK, U.POTION, U.SEXTANT, U.FAN, U.RUBBER_DUCKY, U.GEM,
          BALLOON_PLANS, STAFF, MOONSTONE, GARGISH_VOCABULARY, VORTEX_CUBE, CRYSTAL_BALL, SPELLBOOK, CANNON, POWDER_KEG].includes(o.objN as never))
    );
  }

  /** Use a thing. Returns whether a turn passed (or the game waits on a square chosen). */
  use(o: Obj): void {
    const g = this.g;
    switch (o.objN) {
      case U.LEVER:
      case U.SWITCH:
        return this.lever(o);
      case U.CRANK:
        return this.crank(o);
      case OBJ.KEY:
      case OBJ.LOCK_PICK:
        return this.ask(o.objN === OBJ.KEY ? 'Key: tap the door' : 'Lock pick: tap the door', (x, y) => this.key(o, x, y));
      case U.CANDLE:
      case U.CANDELABRA:
      case U.BRAZIER:
      case U.CAMPFIRE:
      case U.FIREPLACE:
        return this.fire(o);
      case U.BELL:
      case U.PULL_CHAIN:
        g.sfx('bell');
        return this.done();
      case U.WELL:
        return this.fill(U.BUCKET_OF_WATER);
      case U.FOUNTAIN:
        return this.wish();
      case U.CHURN:
        return this.swap(U.BUCKET_OF_MILK, U.BUCKET, 'You need some milk.', 'You need some milk.', U.BUTTER);
      case U.BEEHIVE:
        return this.swap(U.HONEY_JAR, U.JAR_OF_HONEY, 'You need a honey jar.', 'You need an empty honey jar.');
      case U.FISHING_POLE:
        return this.fish();
      case U.SHOVEL:
      case U.PICK:
        return this.ask('Dig: tap a square beside the party', (x, y) => this.dig(x, y));
      case U.POTION:
        return this.ask('Potion: tap who drinks', (x, y) => this.potion(o, x, y));
      case U.SEXTANT:
        g.say('sys', g.player.z === 0 ? g.where() : 'Not usable.');
        return this.done();
      case U.CLOCK:
      case U.SUNDIAL:
        if (o.objN === U.SUNDIAL && (g.clock.hour < 5 || g.clock.hour > 19)) g.say('sys', 'No shadow falls at night.');
        else g.say('sys', `The time is ${g.time()}.`);
        return this.done();
      case U.MIRROR: {
        const p = g.player;
        g.say('sys', p.x === o.x && p.y > o.y && p.y <= o.y + 2 ? 'You can see yourself!' : 'You see nothing.');
        return this.done();
      }
      case U.FAN: {
        // The fan turns the wind a step round (use_fan's wind_tbl).
        g.say('sys', 'You feel a breeze.');
        const ROUND: [number, number][] = [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]];
        const i = ROUND.findIndex(([x, y]) => x === g.wind[0] && y === g.wind[1]);
        g.setWind(ROUND[(i < 0 ? 0 : i + 1) % 8]);
        return this.done();
      }
      case BALLOON_PLANS:
        return this.balloonPlans();
      case U.RUBBER_DUCKY:
        g.say('sys', 'Squeak!');
        g.sfx('success');
        return this.done();
      case U.GEM:
        // A peer gem shows the land from above.
        if (o.frameN === 0) g.peer = true;
        else g.say('sys', 'A fine gem.');
        return this.done();
    }
    if (o.objN >= RUNE_FIRST && o.objN <= RUNE_LAST) return this.rune(o);
    switch (o.objN) {
      case MOONSTONE:
        return this.bury(o);
      case STAFF:
        return this.staff(o);
      case GARGISH_VOCABULARY:
        g.gargFlag = 1;
        g.say('sys', 'You study the scroll!');
        return this.done();
      case VORTEX_CUBE:
        return this.vortex(o);
      case CRYSTAL_BALL:
        return this.crystal();
      case SPELLBOOK:
        g.openBook = true;
        return g.onChange();
      case CANNON:
        return this.cannon(o);
      case POWDER_KEG:
        if (o.frameN !== 0) g.say('sys', 'No effect.');
        else if (g.kegTurns > 0) g.say('sys', 'Not now.');
        else {
          o.frameN = 1;
          g.kegTurns = 3;
          g.say('sys', 'Powder lit!');
        }
        return this.done();
    }
    if (o.objN in INSTRUMENTS) {
      g.say('sys', `You play the ${INSTRUMENTS[o.objN]}.`);
      return this.done();
    }
    if (FOODS.has(o.objN)) return this.eat(o);
    g.say('sys', 'Not usable.');
    this.done();
  }

  /** A fountain grants a wish, now and then, if the wish is for something to eat (use_fountain). */
  private wish(): void {
    const g = this.g;
    const who = g.player;
    g.askChoice = { label: 'Make a wish?', options: ['Yes', 'No'], then: (i) => {
      g.askChoice = null;
      if (i !== 0) return this.done();
      g.askText = { label: 'Wish for:', then: (text) => {
        g.askText = null;
        const w = text.trim().toLowerCase();
        if (!['food', 'mutton', 'wine', 'fruit', 'mead'].includes(w)) g.say('sys', 'Failed');
        else if (Math.floor(Math.random() * 4) !== 0) g.say('sys', 'No effect');
        else {
          const food = g.objects.create(U.MEAT_PORTION, 1, 0);
          if (g.invRoom(who.id) < g.objects.weightOf(food)) g.say('sys', "You got food, but you can't carry it.");
          else {
            g.objects.toInventory(food, who.id);
            g.say('sys', 'You got food.');
          }
        }
        this.done();
      } };
      g.onChange();
    } };
    g.onChange();
  }

  /** A readied staff lets loose the spell charged into it (use_staff). */
  private staff(o: Obj): void {
    const g = this.g;
    if (o.loc !== 'readied') {
      g.say('sys', 'Not readied.');
      return this.done();
    }
    const charge = o.container?.find((k) => k.objN === CHARGE);
    if (!charge) {
      g.say('sys', 'No effect.');
      return this.done();
    }
    const who = g.actors.get(o.holder) ?? g.player;
    const fire = (x: number, y: number): void => {
      o.container!.splice(o.container!.indexOf(charge), 1);
      g.magic.castAs(who, charge.quality, x, y);
      this.done();
    };
    const aim = g.magic.aimOf(charge.quality);
    if (!aim || aim === 'none') fire(who.x, who.y);
    else this.ask('Staff: tap where the spell goes', fire);
  }

  private done(): void {
    this.g.passTurn();
  }

  private ask(label: string, then: (x: number, y: number) => void): void {
    const g = this.g;
    g.askWhere = {
      label,
      then: (x, y) => {
        g.askWhere = null;
        then(x, y);
      },
    };
    g.onChange();
  }

  private near(x: number, y: number): boolean {
    const p = this.g.player;
    return Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1;
  }

  // ---- levers and switches (use_switch) ----

  /**
   * A lever raises or drops the portcullis in every doorway of its level that shares its quality; a switch does the
   * same with fields of energy.
   */
  private lever(o: Obj): void {
    const g = this.g;
    const target = o.objN === U.LEVER ? U.PORTCULLIS : U.ELECTRIC_FIELD;
    let any = false;
    for (const d of g.objects.all().filter((n) => n.objN === U.DOORWAY && n.z === o.z && n.quality === o.quality)) {
      any = true;
      const here = g.objects.list(d.x, d.y, d.z) ?? [];
      const barrier = here.find((n) => n.objN === target);
      if (barrier) g.objects.unlink(barrier);
      else {
        const b = g.objects.create(target, 0, 0);
        b.frameN = target === U.PORTCULLIS ? (d.frameN === 9 ? 1 : d.frameN) : 0;
        b.status = d.status & ~STATUS_OK_TO_TAKE;
        [b.x, b.y, b.z] = [d.x, d.y, d.z];
        g.objects.add(b);
      }
    }
    o.frameN = o.frameN > 0 ? o.frameN - 1 : 1;
    const verb = o.objN === U.LEVER ? 'Switch the lever' : 'Operate the switch';
    g.say('sys', any ? `${verb}, you hear a noise.` : `${verb}, strange, nothing happened.`);
    this.done();
  }

  // ---- cranks and drawbridges (use_crank, drawbridge_*) ----

  private at(objN: number, x: number, y: number, z: number): Obj | undefined {
    return this.g.objects.list(x, y, z)?.find((n) => n.objN === objN);
  }

  private drawbridgeFind(crank: Obj): Obj | null {
    for (let i = 0; i < 6; i++) {
      const s = this.at(U.DRAWBRIDGE, crank.x + 1, crank.y + i, crank.z);
      if (s) return s;
    }
    for (let i = 0; i < 6; i++) {
      if (!this.at(U.DRAWBRIDGE, crank.x - 1, crank.y + i, crank.z)) continue;
      // The right-hand crank: the bridge starts by the crank on the other side.
      for (let j = 1; j < crank.x && j < 32; j++) {
        const other = this.at(U.CRANK, crank.x - j, crank.y, crank.z);
        if (other) return this.at(U.DRAWBRIDGE, other.x + 1, other.y + i, other.z) ?? null;
      }
    }
    return null;
  }

  private removeAll(objN: number, x: number, y: number, z: number): boolean {
    const here = (this.g.objects.list(x, y, z) ?? []).filter((n) => n.objN === objN);
    for (const n of here) this.g.objects.unlink(n);
    return here.length > 0;
  }

  private place(objN: number, frame: number, x: number, y: number, z: number): void {
    const o = this.g.objects.create(objN, 0, 0);
    o.frameN = frame;
    o.status = 0;
    [o.x, o.y, o.z] = [x, y, z];
    this.g.objects.add(o);
  }

  private crank(crank: Obj): void {
    const g = this.g;
    const start = this.drawbridgeFind(crank);
    if (!start) {
      g.say('sys', 'Nothing happens.');
      return this.done();
    }
    const open = start.frameN === 3;
    const { x, y, z } = start;
    // Take the bridge away, measuring it (drawbridge_remove).
    if (x > 0) this.removeAll(U.DRAWBRIDGE, x - 1, y, z);
    let width = 0;
    for (let h = 0, w = 1; w !== 0; h++) {
      for (w = 0; ; w++) {
        if (!this.removeAll(U.DRAWBRIDGE, x + w, y + h, z)) {
          if (w !== 0) width = w;
          break;
        }
      }
    }
    crank.frameN = open ? 0 : 3;
    if (open) {
      // Close it (drawbridge_close): raised, a row above where it lay.
      const ty = y - 1;
      this.place(U.DRAWBRIDGE, 6, x - 1, ty, z);
      this.place(U.DRAWBRIDGE, 8, x + width - 1, ty, z);
      for (let i = 0; i < width - 1; i++) this.place(U.DRAWBRIDGE, 7, x + i, ty, z);
      g.say('sys', 'Close the drawbridge.');
    } else {
      // Open it (drawbridge_open): down, until it meets ground that can be walked.
      const by = y + 1;
      let i = 0;
      for (; i < 16; i++) {
        this.place(U.DRAWBRIDGE, 3, x, by + i, z);
        this.place(U.DRAWBRIDGE, 5, x + width - 1, by + i, z);
        for (let j = 0; j < width - 2; j++) this.place(U.DRAWBRIDGE, 4, x + 1 + j, by + i, z);
        if (g.map.isPassable(x, by + i + 1, z)) break;
      }
      i++;
      for (let j = 0; j < width - 2; j++) this.place(U.DRAWBRIDGE, 1, x + 1 + j, by + i, z);
      this.place(U.DRAWBRIDGE, 0, x, by + i, z);
      this.place(U.DRAWBRIDGE, 2, x + width - 1, by + i, z);
      g.say('sys', 'Open the drawbridge.');
    }
    this.done();
  }

  // ---- keys and lock picks (use_key) ----

  private key(k: Obj, x: number, y: number): void {
    const g = this.g;
    const p = g.player;
    if (!this.near(x, y)) {
      g.say('sys', 'Out of range.');
      return g.onChange();
    }
    const here = g.objects.list(x, y, p.z) ?? [];
    const door = here.find((n) => g.objects.isDoor(n)) ?? here.find((n) => n.objN === OBJ.CHEST);
    if (!door) {
      g.say('sys', 'No effect.');
      return this.done();
    }
    // A lock pick breaks now and then: the less deft, the more often (lock_pick_dex_check).
    if (k.objN === OBJ.LOCK_PICK && g.random(30) < Math.floor((45 - p.dex) / 2)) {
      g.say('sys', 'Key broke.');
      g.sfx('failure');
      if (k.qty > 1) k.qty--;
      else g.objects.unlink(k);
      return this.done();
    }
    const fits = (k.objN === OBJ.KEY && door.quality !== 0 && door.quality === k.quality) || (k.objN === OBJ.LOCK_PICK && door.quality === 0);
    const isDoor = g.objects.isDoor(door);
    const magical = isDoor ? door.frameN >= 13 : door.frameN === 3;
    const closed = isDoor ? door.frameN > 3 : door.frameN > 0;
    const locked = isDoor ? door.frameN === 9 || door.frameN === 11 : door.frameN === 2;
    if (fits && closed && !magical) {
      if (isDoor) door.frameN += locked ? -4 : 4;
      else door.frameN = locked ? 1 : 2;
      g.say('sys', locked ? 'Unlocked!' : 'Locked!');
      g.sfx('success');
    } else if (fits && !closed) g.say('sys', "Can't (un)lock an opened door.");
    else g.say('sys', 'No effect.');
    this.done();
  }

  // ---- fires (use_firedevice) ----

  private fire(o: Obj): void {
    const g = this.g;
    if (o.objN === U.BRAZIER && o.frameN === 2) {
      g.say('sys', 'A holy flame; it cannot be put out.');
      return this.done();
    }
    let lit: boolean;
    if (o.objN === U.FIREPLACE) {
      lit = !(o.frameN === 1 || o.frameN === 3);
      o.frameN += lit ? 1 : -1;
    } else {
      o.frameN = o.frameN > 0 ? o.frameN - 1 : 1;
      lit = o.frameN !== 0;
    }
    const n = g.objects.name(o);
    g.say('sys', `${n[0].toUpperCase() + n.slice(1)} is ${lit ? 'lit' : 'doused'}.`);
    this.done();
  }

  // ---- buckets, milk, butter and honey (fill_bucket, use_churn, use_beehive, use_cow) ----

  private carrier(objN: number): Actor | undefined {
    return this.g.party.find((m) => invFind(this.g.objects, m.actor.id, objN))?.actor;
  }

  /** A well or a cow: an empty bucket filled. */
  fill(full: number): void {
    const g = this.g;
    const who = this.carrier(U.BUCKET);
    if (!who) {
      g.say('sys', this.carrier(U.BUCKET_OF_MILK) || this.carrier(U.BUCKET_OF_WATER) ? 'You need an empty bucket.' : 'You need a bucket.');
      return this.done();
    }
    invFind(g.objects, who.id, U.BUCKET)!.objN = full;
    g.say('sys', 'Done.');
    this.done();
  }

  /** One thing carried becomes another (and maybe makes a third). */
  private swap(from: number, to: number, none: string, wrong: string, also?: number): void {
    const g = this.g;
    const who = this.carrier(from);
    if (!who) {
      g.say('sys', this.carrier(to) ? wrong : none);
      return this.done();
    }
    invFind(g.objects, who.id, from)!.objN = to;
    if (also !== undefined) g.invNew(who.id, also, 1, 0);
    g.say('sys', 'Done.');
    this.done();
  }

  // ---- fishing and digging (use_fishing_pole, use_shovel) ----

  private fish(): void {
    const g = this.g;
    const p = g.player;
    const water = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => g.map.isWater(p.x + dx, p.y + dy, p.z));
    if (!water) g.say('sys', 'You need to stand next to water.');
    else if (g.random(100) <= 20) {
      g.invNew(p.id, U.FISH, 1, 0);
      g.say('sys', 'Got it!');
    } else g.say('sys', "Didn't get a fish.");
    this.done();
  }

  private dig(x: number, y: number): void {
    const g = this.g;
    const p = g.player;
    if (!this.near(x, y) || (x === p.x && y === p.y)) {
      g.say('sys', 'Dig beside the party.');
      return g.onChange();
    }
    if (p.z === 5 || this.at(U.HOLE, x, y, p.z) || (p.z === 0 && (x !== 0x2c3 || y !== 0x343))) {
      g.say('sys', 'No effect.');
      return this.done();
    }
    // A ladder up on the level below: a hole through to it.
    const lx = p.z === 0 ? (x & 0x07) | ((x >> 2) & 0xf8) : x;
    const ly = p.z === 0 ? (y & 0x07) | ((y >> 2) & 0xf8) : y;
    const ladder = this.at(U.LADDER, lx, ly, p.z + 1);
    let made: Obj | null = null;
    if (ladder?.frameN === 1) {
      g.say('sys', 'You dig a hole.');
      made = g.objects.create(U.HOLE, 0, 0);
    }
    const t = g.map.tileNum(x, y, p.z);
    if (!((t >= 108 && t <= 111) || t === 540)) {
      g.say('sys', 'No effect.');
      return this.done();
    }
    if (!made) {
      if (g.random(10) !== 0) {
        g.say('sys', 'Failed.');
        return this.done();
      }
      if (g.random(2)) {
        g.say('sys', 'You find a water fountain.');
        if (!this.at(U.FOUNTAIN, x, y, p.z)) made = g.objects.create(U.FOUNTAIN, 0, 0);
      } else {
        g.say('sys', 'You find a gold nugget.');
        made = g.objects.create(U.GOLD_NUGGET, 1, 0);
      }
    }
    if (made) {
      made.status |= STATUS_TEMPORARY;
      [made.x, made.y, made.z] = [x, y, p.z];
      g.objects.add(made);
    }
    this.done();
  }

  // ---- potions and food (use_potion, use_food) ----

  private potion(o: Obj, x: number, y: number): void {
    const g = this.g;
    const a = g.actors.at(x, y, g.player.z);
    if (!a || !a.inParty) {
      g.say('sys', a ? 'No effect.' : 'Nobody.');
      return g.onChange();
    }
    switch (o.frameN) {
      case 0:
        a.statusFlags &= ~0x04; // awaken
        break;
      case 1:
        a.statusFlags &= ~0x08; // cure
        break;
      case 2:
        a.hp = a.maxHp; // heal
        break;
      case 3:
        a.statusFlags |= 0x08; // poison
        break;
      case 4:
        a.statusFlags |= 0x04; // sleep
        break;
      case 5:
        a.statusFlags |= 0x01; // protection
        break;
      case 6:
        a.objFlags |= 0x02; // invisibility
        break;
      case 7:
        g.xrayUntil = performance.now() + 6000; // x-ray
        break;
    }
    g.say('sys', `${g.partyMemberName(a.id)} drinks the ${POTIONS[o.frameN] ?? ''} potion.`);
    if (o.qty > 1) o.qty--;
    else g.objects.unlink(o);
    this.done();
  }

  // ---- the quest (use_rune, use_moonstone, use_vortex_cube) ----

  /** A rune and its mantra, beside the force field of its shrine, lifts the field and the gargoyles' watch. */
  private rune(o: Obj): void {
    const g = this.g;
    const which = o.objN - RUNE_FIRST;
    g.askText = {
      label: 'Mantra:',
      then: (said) => {
        g.askText = null;
        const p = g.player;
        if (said.trim().toUpperCase() !== MANTRAS[which]) {
          g.say('sys', 'Wrong mantra!');
          g.sfx('failure');
          return this.done();
        }
        const field = g.objects.all().find((f) => f.objN === FORCE_FIELD && f.z === p.z && f.quality === which);
        if (!field || Math.abs(p.x - field.x) >= 2 || Math.abs(p.y - field.y) >= 2) {
          g.say('sys', 'No effect!');
          return this.done();
        }
        g.sfx('cast2', 4);
        // The gargoyles that watched the shrine are gone with the field (remove_gargoyle_egg).
        for (const egg of g.objects.all()) {
          if (egg.objN !== OBJ.EGG || egg.z !== field.z || Math.abs(egg.x - field.x) >= 20 || Math.abs(egg.y - field.y) >= 20) continue;
          if (egg.container?.some((e) => e.objN === OBJ.GARGOYLE || e.objN === OBJ.WINGED_GARGOYLE)) g.objects.unlink(egg);
        }
        g.objects.unlink(field);
        g.say('sys', 'Done!');
        this.done();
      },
    };
    g.onChange();
  }

  /** use_balloon_plans: with the bag, basket, cauldron and rope, a balloon is made. */
  private balloonPlans(): void {
    const g = this.g;
    const need: [number, string][] = [[421, 'a mammoth silk bag'], [422, 'a balloon basket'], [OBJ.CAULDRON, 'a cauldron'], [OBJ.ROPE, 'a rope']];
    const find = (n: number): Obj | undefined => {
      for (const m of g.party) {
        const o = g.objects.inventories[m.actor.id].find((q) => q.objN === n) ?? [...g.objects.inventories[m.actor.id]].flatMap((q) => q.container ?? []).find((q) => q.objN === n);
        if (o) return o;
      }
      return undefined;
    };
    const missing = need.filter(([n]) => !find(n));
    for (const [, name] of missing) g.say('sys', `Missing ${name}.`);
    if (!missing.length) {
      for (const [n] of need) g.objects.unlink(find(n)!);
      const p = g.player;
      const b = g.objects.create(420, 1, 0);
      b.status |= 0x01;
      [b.x, b.y, b.z] = [p.x, p.y, p.z];
      g.objects.add(b);
      g.say('sys', 'Done!');
    }
    this.done();
  }

  /** Bury a moonstone where the party stands: a moongate will rise there. */
  private bury(o: Obj): void {
    const g = this.g;
    const p = g.player;
    const t = g.map.tileNum(p.x, p.y, p.z);
    if ((t < 1 || t > 7) && (t < 0x10 || t > 0x6f)) {
      g.say('sys', 'Cannot be buried here!');
      return this.done();
    }
    g.moonstones[o.frameN & 7] = [p.x, p.y, p.z];
    g.objects.unlink(o);
    [o.x, o.y, o.z] = [p.x, p.y, p.z];
    o.status |= STATUS_OK_TO_TAKE;
    g.objects.add(o);
    g.say('sys', 'Buried.');
    g.updateMoongates();
    this.done();
  }

  /** The vortex cube, all eight moonstones within, beside the Codex with both lenses set: the end. */
  private vortex(cube: Obj): void {
    const g = this.g;
    const p = g.player;
    const codex = g.objects.all().find((c) => c.objN === CODEX && c.z === p.z && c.quality === 128);
    const brit = g.objects.all().find((l) => l.objN === 394 && l.loc === 'map');
    const garg = g.objects.all().find((l) => l.objN === 396 && l.loc === 'map');
    let stones = 0;
    for (const s of cube.container ?? []) if (s.objN === MOONSTONE) stones |= 1 << (s.frameN & 7);
    const near = codex && Math.abs(p.x - codex.x) < 11 && Math.abs(p.y - codex.y) < 11;
    const lenses = brit && garg && brit.x === 0x399 && brit.y === 0x353 && brit.z === 0 && garg.x === 0x39d && garg.y === 0x353 && garg.z === 0;
    if (!near || !lenses || stones !== 0xff) {
      if (cube.container) g.openContainer = cube;
      g.say('sys', 'No effect!');
      return this.done();
    }
    g.objects.unlink(codex!);
    g.say('sys', 'The Codex has vanished!');
    g.won = true;
    g.onChange();
  }

  /** The crystal ball shows a place far off, given its bearings - but it may hurt the unwise (use_crystal_ball). */
  private crystal(): void {
    const g = this.g;
    const p = g.player;
    if (g.random(30) < Math.floor((45 - p.intelligence) / 2)) {
      g.combat.hurt(p, p, g.random(10) + 1);
      return this.done();
    }
    const read = (s: string, pos: string, neg: string): number | null => {
      const m = /^\s*(\d+)\s*([a-z])\s*$/i.exec(s);
      if (!m) return null;
      const n = +m[1];
      const d = m[2].toUpperCase();
      return d === pos ? n : d === neg ? -n : null;
    };
    g.askText = {
      label: 'Latitude (e.g. 12N):',
      then: (latS) => {
        const lat = read(latS, 'S', 'N');
        if (lat === null || lat > 80 || lat < -44) {
          g.askText = null;
          g.say('sys', 'No effect.');
          return this.done();
        }
        g.askText = {
          label: 'Longitude (e.g. 5E):',
          then: (lonS) => {
            g.askText = null;
            const lon = read(lonS, 'E', 'W');
            if (lon === null || lon > 88 || lon < -37) {
              g.say('sys', 'No effect.');
              return this.done();
            }
            let x = lon * 8 + 304;
            let y = lat * 8 + 360;
            if (p.z !== 0) {
              x >>= 2;
              y >>= 2;
            }
            g.scry = { x, y, z: p.z };
            g.say('sys', 'Done.');
            this.done();
          },
        };
        g.onChange();
      },
    };
    g.onChange();
  }

  /** A cannon fires five squares the way it faces, at the first thing in the way (CannonballEffect). */
  private cannon(o: Obj): void {
    const g = this.g;
    g.say('sys', 'Fire!');
    g.sfx('quake');
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][o.frameN & 3];
    for (let i = 1; i <= 5; i++) {
      const x = o.x + dx * i;
      const y = o.y + dy * i;
      const a = g.actors.at(x, y, o.z);
      if (a) {
        g.combat.flash(x, y, o.z, 'hit', { tile: 399, fromX: o.x, fromY: o.y });
        g.combat.hurt(g.player, a, g.random(30) + 1);
        break;
      }
      if (!g.map.isPassable(x, y, o.z)) {
        g.combat.flash(x, y, o.z, 'hit', { tile: 399, fromX: o.x, fromY: o.y });
        break;
      }
    }
    this.done();
  }

  /** A lit keg goes off (explode_obj): all near are hurt, doors near are blown in, other kegs go too. */
  explodeKegs(): void {
    const g = this.g;
    const lit: { x: number; y: number; z: number; o: Obj }[] = [];
    for (const k of g.objects.all()) if (k.objN === POWDER_KEG && k.frameN === 1) lit.push({ x: k.x, y: k.y, z: k.z, o: k });
    for (const m of g.party) {
      for (const k of g.objects.inventories[m.actor.id]) if (k.objN === POWDER_KEG && k.frameN === 1) lit.push({ x: m.actor.x, y: m.actor.y, z: m.actor.z, o: k });
    }
    const seen = new Set<Obj>();
    while (lit.length) {
      const { x, y, z, o } = lit.shift()!;
      if (seen.has(o)) continue;
      seen.add(o);
      g.objects.unlink(o);
      g.say('sys', 'Boom!');
      g.sfx('quake');
      for (const a of [...g.actors.list]) {
        if (a.alive && a.visible && a.objN && a.z === z && Math.abs(a.x - x) <= 2 && Math.abs(a.y - y) <= 2) g.combat.hurt(g.player, a, g.random(60) + 1);
      }
      for (let yy = y - 2; yy <= y + 2; yy++) {
        for (let xx = x - 2; xx <= x + 2; xx++) {
          for (const n of [...(g.objects.list(xx, yy, z) ?? [])]) {
            if (n.objN === POWDER_KEG && !seen.has(n)) lit.push({ x: n.x, y: n.y, z, o: n });
            else if (n.objN >= 297 && n.objN <= 300 && n.frameN <= 12) {
              g.objects.unlink(n);
              g.say('sys', 'The door is blown up!');
            }
          }
        }
      }
    }
    g.onChange();
  }

  private eat(o: Obj): void {
    const g = this.g;
    const drink = o.objN === U.WINE || o.objN === U.MEAD || o.objN === U.ALE;
    g.say('sys', drink ? 'You drink it.' : 'You eat the food.');
    if (g.objects.isStackable(o) && o.qty > 1) o.qty--;
    else g.objects.unlink(o);
    this.done();
  }
}

export const MEAT = U.MEAT_PORTION;
