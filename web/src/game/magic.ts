/**
 * magic.ts - casting spells (Ultima VI): the checks of Nuvie's Magic.cpp (a readied spellbook holding the spell, a
 * level as high as its circle, magic points as many, a reagent of each kind it takes) and the spells themselves, from
 * data/scripts/u6/magic/ - all 80 of them.
 */
import type { Actor } from './actors.ts';
import { STATUS_DEAD } from './actors.ts';
import type { Game } from './game.ts';
import { ALIGN, CHARMED, CURSED, INVISIBLE, PARALYZED, PROTECTED, adj, alignment } from './combat.ts';
import { carried, invCount, invDelete, invNew } from './inventory.ts';
import type { Obj } from './objects.ts';
import { MONSTERS, SPELLS } from './u6combat.ts';
import { setAlignment as setAlign } from './combat.ts';
import { OBJ } from './u6tables.ts';

export type Spell = (typeof SPELLS)[number];
/** What a spell is cast on: nothing, someone, something, or a place. */
export type Aim = 'none' | 'actor' | 'obj' | 'place';

const SPELLBOOK = 57;
const SPELL = 58;
const ALL_SPELLS = 255;
const MEAT = 129;

/** Reagents, in the order of a spell's bits (Magic.cpp obj_n_reagent). */
export const REAGENTS: readonly { objN: number; name: string }[] = [
  { objN: OBJ.MANDRAKE_ROOT, name: 'mandrake root' },
  { objN: OBJ.NIGHTSHADE, name: 'nightshade' },
  { objN: OBJ.BLACK_PEARL, name: 'black pearl' },
  { objN: OBJ.BLOOD_MOSS, name: 'blood moss' },
  { objN: OBJ.SPIDER_SILK, name: 'spider silk' },
  { objN: OBJ.GARLIC, name: 'garlic' },
  { objN: OBJ.GINSENG, name: 'ginseng' },
  { objN: OBJ.SULFUROUS_ASH, name: 'sulfurous ash' },
];

const SYLLABLES: Record<string, string> = {
  a: 'An', b: 'Bet', c: 'Corp', d: 'Des', e: 'Ex', f: 'Flam', g: 'Grav', h: 'Hur', i: 'In', j: 'Jux', k: 'Kal', l: 'Lor',
  m: 'Mani', n: 'Nox', o: 'Ort', p: 'Por', q: 'Quas', r: 'Rel', s: 'Sanct', t: 'Tym', u: 'Uus', v: 'Vas', w: 'Wis',
  x: 'Xen', y: 'Ylem', z: 'Zu',
};

/** "In Mani Ylem". */
export const words = (s: Spell): string => [...s.words].map((c) => SYLLABLES[c] ?? c).join(' ');

export const reagentNames = (s: Spell): string[] => REAGENTS.filter((_, i) => s.reagents & (1 << i)).map((r) => r.name);

interface Cast {
  aim: Aim;
  /** The tile that flies to the target (select_actor_with_projectile's). */
  tile?: number;
  run(m: Magic, caster: Actor, x: number, y: number): void;
}

/** Lit things, and what lighting them does (ignite.lua, douse.lua). */
const LIGHTS: ReadonlySet<number> = new Set([122, 145, 164, OBJ.TORCH, 206]);

export class Magic {
  constructor(readonly g: Game) {}

  rand(lo: number, hi: number): number {
    return lo + this.g.random(hi - lo + 1);
  }

  private name(a: Actor): string {
    return this.g.party.find((m) => m.actor === a)?.name ?? this.g.lookActor(a).replace(/^(a|an|the) /, '');
  }

  /** Magic points an actor can hold (actor_get_max_magic_points): the Avatar, mages, swashbucklers and bards. */
  maxMagic(a: Actor): number {
    if (a.objN === OBJ.AVATAR) return a.intelligence * 2;
    if (a.objN === OBJ.MAGE) return a.intelligence;
    if (a.objN === OBJ.SWASHBUCKLER || a.objN === OBJ.MUSICIAN) return Math.floor(a.intelligence / 2);
    return 0;
  }

  /** Each hour the party's casters gain back their level in magic points. */
  hourly(): void {
    for (const m of this.g.party) {
      const max = this.maxMagic(m.actor);
      if (max) m.actor.magic = Math.min(max, m.actor.magic + m.actor.level);
    }
  }

  book(a: Actor): Obj | null {
    return this.g.objects.inventories[a.id]?.find((o) => o.objN === SPELLBOOK && o.loc === 'readied') ?? null;
  }

  /** The spells in an actor's readied book (Magic::spellbook_has_spell). */
  known(a: Actor): Spell[] {
    const book = this.book(a);
    const pages = book?.container?.filter((o) => o.objN === SPELL) ?? [];
    if (pages.some((o) => o.quality === ALL_SPELLS)) return [...SPELLS];
    return SPELLS.filter((s) => pages.some((o) => o.quality === s.num));
  }

  /** Who of the party can cast: those with a book readied. */
  casters(): Actor[] {
    return this.g.party.map((m) => m.actor).filter((a) => this.book(a));
  }

  aim(s: Spell): Aim {
    return CASTS.get(s.num)?.aim ?? 'none';
  }

  /** Why an actor cannot cast a spell now (Magic::cast's checks), or null. */
  cannot(a: Actor, s: Spell): string | null {
    if (!this.book(a)) return 'No spellbook is readied.';
    if (!this.known(a).includes(s)) return 'That spell is not in thy spellbook!';
    if (a.level < s.circle) return 'Your level is not high enough.';
    if (a.magic < s.circle) return 'Not enough magic points.';
    if (REAGENTS.some((r, i) => s.reagents & (1 << i) && invCount(this.g.objects, a.id, r.objN) === 0)) return 'No reagents.';
    return null;
  }

  /** Cast, at a square where the spell is aimed. Returns whether it was cast. */
  cast(a: Actor, s: Spell, x = a.x, y = a.y): boolean {
    const g = this.g;
    if (g.stormTurns > 0) {
      g.say('sys', 'No magic at this time!');
      return false;
    }
    const why = this.cannot(a, s);
    g.say('you', `${s.name}: "${words(s)}"`);
    if (why) {
      g.say('sys', why);
      g.sfx('failure');
      return false;
    }
    const c = CASTS.get(s.num);
    if (c && c.aim !== 'none' && g.combat.range(a, x, y) > 7) {
      g.say('sys', 'Out of range.');
      return false;
    }
    a.magic -= s.circle;
    REAGENTS.forEach((r, i) => s.reagents & (1 << i) && invDelete(g.objects, a.id, r.objN, 1, 0));
    if (!c) {
      g.say('sys', 'The spell takes no shape here (not yet ported).');
      return true;
    }
    g.sfx('cast2', s.circle);
    if (c.tile && (x !== a.x || y !== a.y)) g.combat.flash(x, y, a.z, 'miss', { tile: c.tile, fromX: a.x, fromY: a.y });
    c.run(this, a, x, y);
    return true;
  }

  // ---- what spells do, shared ----

  /** actor_int_check: the caster's wits against the target's. True where the target holds out. */
  resists(foe: Actor, caster: Actor): boolean {
    return Math.floor(caster.intelligence / 2) + 15 - foe.intelligence <= this.rand(1, 30);
  }

  actorAt(x: number, y: number, z: number): Actor | null {
    return this.g.actors.at(x, y, z);
  }

  /** Everyone within five squares of the caster (fear.lua, tremor.lua and the like). */
  nearCaster(c: Actor): Actor[] {
    return this.g.actors.list.filter((a) => a !== c && a.alive && a.visible && a.objN !== 0 && a.z === c.z && Math.abs(a.x - c.x) <= 5 && Math.abs(a.y - c.y) <= 5);
  }

  /** A wind (magic_wind): the square aimed at and two to either side of it, across the way it blows. */
  wind(c: Actor, x: number, y: number): Actor[] {
    const dx = Math.sign(x - c.x);
    const dy = Math.sign(y - c.y);
    const [px, py] = dx && dy ? [dx, -dy] : [dy, dx];
    const out: Actor[] = [];
    for (let i = -2; i <= 2; i++) {
      const a = this.actorAt(x + px * i, y + py * i, c.z);
      if (a && a !== c && !out.includes(a)) out.push(a);
    }
    return out;
  }

  /** Bring creatures to fight for the caster (conjure.lua, insect_swarm.lua, summon.lua). */
  summon(c: Actor, objN: number, n: number, near = 5): void {
    let made = 0;
    for (let tries = 0; tries < n * 8 && made < n; tries++) {
      const x = c.x + this.rand(-near, near);
      const y = c.y + this.rand(-near, near);
      if (!this.g.canStand(x, y, c.z)) continue;
      const a = this.g.combat.spawn(objN, x, y, c.z, alignment(c), 0x8);
      if (a) made++;
    }
    if (made) this.g.say('sys', `${made === 1 ? 'A creature appears' : `${made} creatures appear`} to fight for ${this.name(c)}.`);
    else this.noEffect();
  }

  /** spell_kill_actor */
  kill(c: Actor, a: Actor): void {
    if (MONSTERS.get(a.objN)?.corpImmune === 1) this.noEffect();
    else if (this.resists(a, c)) this.failed();
    else this.g.combat.hurt(c, a, a.hp);
  }

  /** spell_poison_actor */
  poison(c: Actor, a: Actor): void {
    if (MONSTERS.get(a.objN)?.poisonImmune === 1 || !MONSTERS.has(a.objN) || a.id === 0) this.noEffect();
    else if (Math.floor((Math.floor(adj(a, a.strength) / 2) + 30 - adj(c, c.intelligence)) / 2) <= this.rand(1, 30)) {
      a.statusFlags |= 0x08;
      this.g.combat.flash(a.x, a.y, a.z, 'hit');
      this.g.say('sys', `${this.name(a)} poisoned!`);
    } else this.failed();
  }

  charm(c: Actor, a: Actor): void {
    if (this.resists(a, c)) this.failed();
    else this.g.combat.charm(a, alignment(c));
  }

  /** Everyone within two squares of a place (an explosion's reach). */
  around(x: number, y: number, z: number): Actor[] {
    return this.g.actors.list.filter((a) => a.alive && a.visible && a.objN !== 0 && a.z === z && Math.abs(a.x - x) <= 2 && Math.abs(a.y - y) <= 2);
  }

  /** spell_take_fire_dmg: up to twenty, twice that to what fire hurts most, nothing to what magic cannot touch. */
  fire(caster: Actor, foe: Actor): void {
    const base = MONSTERS.get(foe.objN);
    if (base?.magicImmune === 1) return;
    let dmg = this.rand(1, 20);
    if (!base || base.fireDouble === 1) dmg *= 2;
    this.g.combat.hurt(caster, foe, dmg);
  }

  sleep(caster: Actor, foe: Actor): boolean {
    if (MONSTERS.get(foe.objN)?.sleepImmune === 1) return this.noEffect();
    if (this.resists(foe, caster)) return this.failed();
    foe.statusFlags |= 0x04;
    this.g.say('sys', `${this.name(foe)} falls asleep.`);
    return true;
  }

  success(): boolean {
    this.g.say('sys', 'Success.');
    return true;
  }
  failed(): boolean {
    this.g.say('sys', 'Failed.');
    this.g.sfx('failure');
    return false;
  }
  noEffect(): boolean {
    this.g.say('sys', 'No effect.');
    this.g.sfx('failure');
    return false;
  }
}

/** On someone: the actor at the square, or a word that there is none. */
const onActor = (m: Magic, x: number, y: number, z: number, f: (a: Actor) => void): void => {
  const a = m.actorAt(x, y, z);
  if (!a) m.g.say('sys', 'Nothing there.');
  else f(a);
};

const onObj = (m: Magic, x: number, y: number, z: number, f: (o: Obj) => boolean): void => {
  const l = m.g.objects.list(x, y, z) ?? [];
  if (![...l].reverse().some((o) => f(o))) m.noEffect();
};

const EFFECT = 337;
const CHARGE = 336;
const SLIME = 0x177;
const BODIES = new Set([0x153, 0x154, 0x155, 0x160]);
const PHASES = ['New moon', 'Crescent waxing', 'First quarter', 'Gibbous waxing', 'Full moon', 'Gibbous waning', 'Last quarter', 'Crescent waning'];
const POTIONS = ['an awaken', 'a cure', 'a heal', 'a poison', 'a sleep', 'a protection', 'an invisibility', 'an xray vision', 'an unknown'];
/** detect_magic.lua's tiles that are magical. */
const MAGICAL_TILES = new Set([0x207, 0x20f, 0x216, 0x22f, 0x232, 0x235, 0x238, 0x239, 0x23d, 0x248, 0x249, 0x24a, 0x24b, 0x24c, 0x24d,
  0x24e, 0x24f, 0x251, 0x252, 0x253, 0x255, 0x256, 0x257, 0x25a, 0x25b, 0x25c, 0x25d, 0x25f, 0x26e, 0x2b6, 0x31e, 0x31f, 0x326,
  0x368, 0x369, 0x36a, 0x36b, 0x36c, 0x36d, 0x36e, 0x36f, 0x37d, 0x37e, 0x37f, 0x3a8, 0x3a9, 0x3aa, 0x3ab, 0x3ac, 0x3ad, 0x3ae,
  0x3af, 0x3fd, 0x3fe, 0x40c, 0x40d, 0x40e, 0x40f, 0x41c, 0x41d, 0x41e, 0x41f, 0x42c, 0x42d, 0x42e, 0x42f, 0x43c, 0x43d, 0x43e,
  0x43f, 0x484, 0x485, 0x48e, 0x48f, 0x6d0, 0x6d1, 0x6d2, 0x6d3]);

/** A field spell (fire_field.lua and the like): a field where it lands, for a time, but not on water. */
const field = (objN: number, tile: number): Cast => ({ aim: 'place', tile, run: (m, c, x, y) => {
  const g = m.g;
  if (!g.map.isPassable(x, y, c.z) || g.map.tile(x, y, c.z).water) {
    g.say('sys', 'Not possible.');
    return void g.sfx('failure');
  }
  const f = g.objects.create(objN, 1, 0);
  f.status |= 0x20;
  [f.x, f.y, f.z] = [x, y, c.z];
  g.objects.add(f);
  m.success();
} });

const CASTS = new Map<number, Cast>([
  // Circle 1
  [0, { aim: 'none', run: (m, c) => {
    const qty = m.g.random(10) + 1;
    invNew(m.g.objects, c.id, MEAT, qty, 0);
    m.g.say('sys', `Create ${qty} food.`);
  } }],
  [4, { aim: 'obj', tile: 0x18b, run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    if (!LIGHTS.has(o.objN) || (o.objN === 206 && o.frameN !== 1) || !(o.frameN === 1 || o.frameN === 3)) return false;
    o.frameN--;
    return m.success();
  }) }],
  [5, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    if (m.resists(a, c)) m.failed();
    else m.g.combat.hurt(c, a, m.g.random(10) + 1);
  }) }],
  [6, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    a.hp = Math.min(a.maxHp, a.hp + m.g.random(30) + 1);
    m.success();
  }) }],
  [7, { aim: 'none', run: (m) => {
    // Help: the party, healed and its fallen raised, at Lord British's castle.
    const g = m.g;
    for (const a of g.combat.fallen) {
      a.statusFlags &= ~STATUS_DEAD;
      a.visible = true;
      g.partyAdd(a);
    }
    g.combat.fallen = [];
    for (const p of g.party) p.actor.hp = p.actor.maxHp;
    g.relocate(0x133, 0x160, 0);
    g.say('npc', 'A voice in the darkness intones, "KAL LOR!"');
    g.sfx('kallor');
  } }],
  [8, { aim: 'obj', tile: 0x18d, run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    if (!LIGHTS.has(o.objN) || (o.objN === 206 && o.frameN !== 0) || !(o.frameN === 0 || o.frameN === 2)) return false;
    o.frameN++;
    return m.success();
  }) }],
  [9, { aim: 'none', run: (m) => {
    m.g.lightTurns = Math.max(m.g.lightTurns, 100);
    m.success();
  } }],
  // Circle 2
  [17, { aim: 'actor', tile: 0x236, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    if ((Math.floor(a.dex / 2) + 30 - c.intelligence) / 2 <= m.g.random(30) + 1) m.g.combat.hurt(c, a, m.g.random(10) + 1);
    else m.failed();
  }) }],
  [18, { aim: 'actor', tile: 0x17c, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => m.poison(c, a)) }],
  [20, { aim: 'actor', tile: 0x17d, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => void m.sleep(c, a)) }],
  [23, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    if (o.objN >= OBJ.OAKEN_DOOR && o.objN <= OBJ.STEEL_DOOR && o.frameN >= 13) o.frameN -= 8;
    else if (o.objN === OBJ.CHEST && o.frameN === 3) o.frameN = 1;
    else return false;
    m.g.say('sys', 'Unlocked!');
    return true;
  }) }],
  // Circle 3
  [34, { aim: 'actor', tile: 0x17e, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => m.fire(c, a)) }],
  [35, { aim: 'none', run: (m) => {
    m.g.lightTurns = Math.max(m.g.lightTurns, 255);
    m.success();
  } }],
  [37, { aim: 'place', tile: 0x18b, run: (m, c, x, y) => {
    for (const a of m.around(x, y, c.z)) a.statusFlags &= ~0x04;
    m.success();
  } }],
  [38, { aim: 'place', tile: 0x18b, run: (m, c, x, y) => {
    for (const a of m.around(x, y, c.z)) if (!a.inParty) m.sleep(c, a);
  } }],
  // Circle 4
  [52, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    a.hp = a.maxHp;
    m.success();
  }) }],
  [53, { aim: 'none', run: (m) => m.g.say('sys', m.g.where()) }],
  // Circle 5
  [65, { aim: 'place', tile: 0x189, run: (m, c, x, y) => {
    for (const a of m.around(x, y, c.z)) m.fire(c, a);
  } }],
  [68, { aim: 'actor', tile: 0x188, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => m.g.combat.hurt(c, a, m.g.random(30) + 1)) }],
  // Circle 7
  [96, { aim: 'actor', tile: 0x188, run: (m, c, x, y) => onActor(m, x, y, c.z, (first) => {
    // Chain Bolt: from one to the next nearest, up to eight.
    let a: Actor | null = first;
    const struck = new Set<Actor>();
    for (let i = 0; i < 8 && a; i++) {
      struck.add(a);
      m.g.combat.hurt(c, a, m.g.random(30) + 1);
      const from: Actor = a;
      a = m.g.actors.list
        .filter((t) => t.alive && t.visible && t.objN !== 0 && t.z === c.z && !struck.has(t) && !t.inParty && Math.abs(t.x - c.x) < 5 && Math.abs(t.y - c.y) < 5)
        .sort((p, q) => (p.x - from.x) ** 2 + (p.y - from.y) ** 2 - ((q.x - from.x) ** 2 + (q.y - from.y) ** 2))[0] ?? null;
    }
  }) }],
  [101, { aim: 'actor', tile: 0x18c, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => m.kill(c, a)) }],
  // Circle 8
  // ---- more, ported for the round after combat ----
  [3, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    // Dispel Magic: sleep, poison, paralysis and charm undone.
    const was = a.statusFlags & (0x04 | 0x08 | PARALYZED) || a.objFlags & CHARMED;
    a.statusFlags &= ~(0x04 | 0x08 | PARALYZED);
    m.g.combat.uncharm(a);
    if (was) m.success();
    else m.noEffect();
  }) }],
  [16, { aim: 'none', run: (m) => {
    m.g.infraTurns = Math.max(m.g.infraTurns, 20);
    m.success();
  } }],
  [19, { aim: 'place', tile: 0x17f, run: (m, c, x, y) => {
    // Reappear: what Vanish took, set down here.
    const v = m.g.vanished;
    if (!v || !m.g.map.isPassable(x, y, c.z)) return void m.noEffect();
    const o = m.g.objects.create(v.objN, 1, 0);
    o.frameN = v.frameN;
    o.status |= 0x21;
    [o.x, o.y, o.z] = [x, y, c.z];
    m.g.objects.add(o);
    m.g.vanished = null;
    m.success();
  } }],
  [25, { aim: 'obj', tile: 0x17f, run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Vanish: small things only (tile flag 3, bit 3).
    if (!(m.g.objects.tileOf(o).flags3 & 0x08) || o.container) return false;
    m.g.vanished = { objN: o.objN, frameN: o.frameN };
    m.g.objects.unlink(o);
    return m.success();
  }) }],
  [32, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    a.objFlags |= CURSED;
    m.success();
  }) }],
  [36, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    if (o.objN >= OBJ.OAKEN_DOOR && o.objN <= OBJ.STEEL_DOOR && o.frameN >= 5 && o.frameN <= 7) o.frameN += 8;
    else if (o.objN === OBJ.CHEST && (o.frameN === 1 || o.frameN === 2)) o.frameN = 3;
    else return false;
    m.g.say('sys', 'Magically locked!');
    return true;
  }) }],
  [39, { aim: 'none', run: (m) => {
    m.g.peer = true;
  } }],
  [40, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    a.statusFlags |= PROTECTED;
    m.success();
  }) }],
  [41, { aim: 'none', run: (m, c) => {
    for (const a of m.nearCaster(c)) if (MONSTERS.get(a.objN)?.halfDmg === 1 && !m.resists(a, c)) a.worktype = 0x13;
    m.success();
  } }],
  [49, { aim: 'none', run: (m, c) => {
    const i = m.g.random(16);
    m.summon(c, i <= 3 ? 0x173 : i <= 6 ? 0x156 : i <= 9 ? 0x169 : i <= 12 ? 0x158 : 0x166, 1);
  } }],
  [50, { aim: 'actor', run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    // Disable: down to one hit point.
    if (m.resists(a, c)) m.failed();
    else m.g.combat.hurt(c, a, Math.max(0, a.hp - 1));
  }) }],
  [66, { aim: 'none', run: (m, c) => m.summon(c, 0x157, 8) }],
  [67, { aim: 'actor', tile: 0x18b, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    if (a.objFlags & INVISIBLE) return void m.noEffect();
    a.objFlags |= INVISIBLE;
    m.success();
  }) }],
  [69, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    a.statusFlags |= PARALYZED;
    m.g.combat.flash(a.x, a.y, a.z, 'hit');
    m.g.say('sys', `${m.g.lookActor(a)} is paralyzed.`);
  }) }],
  [71, { aim: 'none', run: (m, c) => {
    for (const a of m.g.actors.list) if (a.objFlags & INVISIBLE && a.z === c.z && Math.abs(a.x - c.x) <= 5 && Math.abs(a.y - c.y) <= 5) a.objFlags &= ~INVISIBLE;
    m.success();
  } }],
  [73, { aim: 'none', run: (m) => {
    m.g.xrayUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + 6000;
    m.g.say('sys', 'The walls fade...');
  } }],
  [80, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => m.charm(c, a)) }],
  [82, { aim: 'none', run: (m, c) => {
    // Confuse: the evil turn on their own.
    for (const a of m.nearCaster(c)) if (alignment(a) === ALIGN.EVIL && !m.resists(a, c)) {
      setAlign(a, ALIGN.GOOD);
      a.worktype = 0x8;
    }
    m.success();
  } }],
  [83, { aim: 'place', run: (m, c, x, y) => m.wind(c, x, y).forEach((a) => m.fire(c, a)) }],
  [84, { aim: 'place', run: (m, c, x, y) => {
    // Hail Storm: a hard rain of small blows.
    m.g.sfx('hail');
    for (const a of m.around(x, y, c.z)) for (let i = m.rand(1, 4); i > 0 && a.hp > 0; i--) m.g.combat.hurt(c, a, 1);
    m.success();
  } }],
  [85, { aim: 'place', tile: 0x18b, run: (m, c, x, y) => {
    for (const a of m.around(x, y, c.z)) a.statusFlags |= PROTECTED;
    m.success();
  } }],
  [87, { aim: 'place', run: (m, c, x, y) => m.wind(c, x, y).forEach((a) => m.poison(c, a)) }],
  [98, { aim: 'place', run: (m, c, x, y) => m.wind(c, x, y).forEach((a) => m.g.combat.hurt(c, a, m.rand(1, 30))) }],
  [99, { aim: 'none', run: (m, c) => {
    // Fear: all but the good, and the dead that walk, flee.
    for (const a of m.nearCaster(c)) if (alignment(a) !== ALIGN.GOOD && !m.resists(a, c) && MONSTERS.get(a.objN)?.corpImmune !== 1) a.worktype = 0x13;
    m.success();
  } }],
  [102, { aim: 'place', tile: 0x18b, run: (m, c, x, y) => {
    for (const a of m.around(x, y, c.z)) if (!a.inParty) a.objFlags |= CURSED;
    m.success();
  } }],
  [103, { aim: 'none', run: (m) => {
    for (const p of m.g.party) p.actor.objFlags |= INVISIBLE;
    m.success();
  } }],
  [104, { aim: 'none', run: (m, c) => {
    // Wing Strike: a dragon's shadow over every foe near.
    const foes = m.nearCaster(c).filter((a) => alignment(a) === ALIGN.EVIL || alignment(a) === ALIGN.CHAOTIC);
    if (!foes.length) return void m.g.say('sys', 'No foes.');
    for (const a of foes) m.g.combat.hurt(c, a, m.rand(1, 20));
  } }],
  [113, { aim: 'place', run: (m, c, x, y) => m.wind(c, x, y).forEach((a) => m.kill(c, a)) }],
  [115, { aim: 'place', tile: 0x188, run: (m, c, x, y) => m.around(x, y, c.z).forEach((a) => a !== c && !a.inParty && m.charm(c, a)) }],
  [116, { aim: 'place', tile: 0x188, run: (m, c, x, y) => m.around(x, y, c.z).forEach((a) => a !== c && m.kill(c, a)) }],
  [119, { aim: 'none', run: (m, c) => m.summon(c, 367, 1, 1) }],
  [120, { aim: 'none', run: (m) => {
    m.g.combat.timeStop = 10;
    m.g.say('sys', 'Time stops.');
  } }],
  [121, { aim: 'none', run: (m, c) => {
    // Tremor: the earth shakes the evil, but not what flies.
    m.g.sfx('quake');
    for (const a of m.nearCaster(c)) if (alignment(a) === ALIGN.EVIL && MONSTERS.get(a.objN)?.flies !== 1) m.g.combat.hurt(c, a, m.rand(1, 30));
    m.success();
  } }],
  [117, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Resurrect: a body that was someone (not a passing monster) gets up.
    if (o.objN !== OBJ.DEAD_BODY || o.quality === 0 || o.quality >= 203) return false;
    const a = m.g.actors.get(o.quality);
    if (!a) return false;
    a.statusFlags &= ~STATUS_DEAD;
    Object.assign(a, { x: o.x, y: o.y, z: o.z, visible: true, hp: Math.max(1, Math.floor(a.maxHp / 2)) });
    for (const it of [...(o.container ?? [])]) m.g.objects.toInventory(it, a.id);
    m.g.objects.unlink(o);
    const fallen = m.g.combat.fallen.indexOf(a);
    if (fallen >= 0) {
      m.g.combat.fallen.splice(fallen, 1);
      m.g.partyAdd(a);
    }
    m.g.say('sys', `${m.g.lookActor(a)} lives!`);
    return true;
  }) }],
  // ---- the rest of the spellbook ----
  [1, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Detect Magic
    if (MAGICAL_TILES.has(m.g.objects.tileNum(o))) {
      if (o.objN === 0x113) m.g.say('sys', `It's ${POTIONS[Math.min(8, o.frameN)]} potion.`);
      else m.g.say('sys', "It's magical.");
    } else {
      const charge = o.container?.find((k) => k.objN === CHARGE);
      m.g.say('sys', charge ? `It shows a charge of ${SPELLS.find((s) => s.num === charge.quality)?.name ?? 'something'}.` : "It's not magical.");
    }
    return true;
  }) }],
  [2, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Detect Trap: the wiser the caster, the surer the finding.
    const found = adj(c, c.intelligence) >= m.rand(1, 30) && o.container?.some((k) => k.objN === EFFECT);
    m.g.say('sys', found ? "It's trapped." : 'No trap.');
    return true;
  }) }],
  [21, { aim: 'obj', tile: 0x17f, run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Telekinesis: a crank or lever worked from afar, or a thing pushed a square further away.
    const g = m.g;
    if (o.objN === 0x120 || o.objN === 0x10c) {
      g.useObj(o);
      return true;
    }
    if (g.objects.weightOf(o) <= 0 || g.objects.isDoor(o)) {
      g.say('sys', 'Not possible.');
      return true;
    }
    const nx = o.x + Math.sign(o.x - c.x);
    const ny = o.y + Math.sign(o.y - c.y);
    if ((nx === o.x && ny === o.y) || !g.map.isPassable(nx, ny, o.z) || g.actors.at(nx, ny, o.z)) {
      g.say('sys', 'Blocked.');
      return true;
    }
    g.objects.unlink(o);
    [o.x, o.y] = [nx, ny];
    g.objects.add(o);
    return m.success();
  }) }],
  [22, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Trap: an effect hidden in a door or chest.
    if (!(m.g.objects.isDoor(o) || o.objN === OBJ.CHEST) || o.container?.some((k) => k.objN === EFFECT)) return false;
    m.g.objects.toContainer(m.g.objects.create(EFFECT, 0, 0), o);
    return m.success();
  }) }],
  [24, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Untrap
    const e = (m.g.objects.isDoor(o) || o.objN === OBJ.CHEST) && o.container?.find((k) => k.objN === EFFECT);
    if (!e) return false;
    m.g.objects.unlink(e);
    return m.success();
  }) }],
  [33, { aim: 'obj', tile: 0x17f, run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Dispel Field
    if (o.objN < 317 || o.objN > 320) return false;
    m.g.combat.flash(o.x, o.y, o.z, 'hit');
    m.g.objects.unlink(o);
    return m.success();
  }) }],
  [48, { aim: 'obj', tile: 0x17f, run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Animate: a thing that can be readied rises to fight for the party.
    if (!m.g.readiable(o)) return false;
    const a = m.g.combat.spawn(o.objN, o.x, o.y, o.z, ALIGN.GOOD, 0x8);
    if (!a) return false;
    a.frameN = o.frameN;
    m.g.objects.unlink(o);
    return m.success();
  }) }],
  [51, field(317, 0x17e)],
  [54, { aim: 'place', tile: 0x18b, run: (m, c, x, y) => {
    // Mass Dispel
    for (const a of m.around(x, y, c.z)) {
      a.statusFlags &= ~(0x04 | 0x08 | PARALYZED);
      m.g.combat.uncharm(a);
    }
    m.success();
  } }],
  [55, field(318, 0x17c)],
  [56, field(320, 0x17d)],
  [57, { aim: 'place', run: (m, c, x, y) => {
    // Wind Change: the wind blows the way the caster points.
    const dx = Math.sign(x - c.x);
    const dy = Math.sign(y - c.y);
    if (!dx && !dy) return void m.noEffect();
    const name = (dy < 0 ? 'north' : dy > 0 ? 'south' : '') + (dx < 0 ? 'west' : dx > 0 ? 'east' : '');
    m.g.wind = [dx, dy];
    m.g.say('sys', `The wind blows to the ${name}.`);
  } }],
  [64, field(319, 0x17f)],
  [70, { aim: 'actor', tile: 0x18b, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    // Pickpocket: choose a thing from what they carry; it flies to the caster.
    const g = m.g;
    const have = g.objects.inventories[a.id].filter((o) => o.loc !== 'readied');
    if (!have.length || a === c) return void m.noEffect();
    g.askChoice = {
      label: 'Which object?',
      options: have.map((o) => g.objects.look(o)),
      then: (i) => {
        g.askChoice = null;
        const o = have[i];
        if (!o) return void m.noEffect();
        if (g.invRoom(c.id) < g.objects.weightOf(o)) return void g.say('sys', "Can't carry!");
        g.combat.flash(c.x, c.y, c.z, 'miss', { tile: g.objects.tileNum(o), fromX: a.x, fromY: a.y });
        g.objects.unlink(o);
        g.objects.toInventory(o, c.id);
        g.karma = Math.max(0, g.karma - 5);
        m.success();
      },
    };
  }) }],
  [72, { aim: 'obj', run: (m, c, x, y) => {
    // Seance: speak with the dead whose body lies there.
    const g = m.g;
    const a = g.actors.at(x, y, c.z);
    if (a && a.id === 91 && BODIES.has(a.objN)) {
      a.talkFlags |= 0x80;
      return void g.talkTo(a);
    }
    const body = [...(g.objects.list(x, y, c.z) ?? [])].reverse().find((o) => BODIES.has(o.objN));
    const dead = body && g.actors.get(body.quality);
    if (!dead) return void m.noEffect();
    g.talkTo(dead);
  } }],
  [81, { aim: 'actor', tile: 0x17f, run: (m, c, x, y) => onActor(m, x, y, c.z, (a) => {
    // Clone
    for (let i = 0; i < 8; i++) {
      const nx = c.x + m.rand(0, 10) - 5;
      const ny = c.y + m.rand(0, 10) - 5;
      if (!m.g.canStand(nx, ny, c.z)) continue;
      const b = m.g.combat.spawn(a.objN, nx, ny, c.z, alignment(a), a.worktype > 0x0f ? a.worktype : 0x8);
      if (!b) break;
      b.frameN = a.frameN;
      return void m.success();
    }
    m.noEffect();
  }) }],
  [86, { aim: 'none', run: (m) => {
    // Negate Magic: no spell will take for a while.
    m.g.stormTurns = 20;
    m.g.say('sys', 'Magic is negated!');
  } }],
  [88, { aim: 'obj', tile: 0x17f, run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Replicate: a copy of a thing that can be carried, nearby, for a time.
    if (!(m.g.objects.tileOf(o).flags3 & 0x08)) return false;
    for (let i = 0; i < 8; i++) {
      const nx = c.x + m.rand(0, 10) - 5;
      const ny = c.y + m.rand(0, 10) - 5;
      if (!m.g.map.isPassable(nx, ny, c.z)) continue;
      const r = m.g.objects.create(o.objN, 1, 0);
      r.frameN = o.frameN;
      r.status |= 0x21;
      [r.x, r.y, r.z] = [nx, ny, c.z];
      m.g.objects.add(r);
      return m.success();
    }
    return m.failed();
  }) }],
  [89, { aim: 'place', tile: 564, run: (m, c, x, y) => {
    // Web: a three by three web where it lands.
    let made = 0;
    for (let j = y - 1; j <= y + 1; j++) for (let i = x - 1; i <= x + 1; i++) {
      if (!m.g.map.isPassable(i, j, c.z)) continue;
      const w = m.g.objects.create(0x35, 1, 0);
      [w.x, w.y, w.z] = [i, j, c.z];
      m.g.objects.add(w);
      made++;
    }
    if (made) m.success();
    else m.noEffect();
  } }],
  [97, { aim: 'obj', run: (m, c, x, y) => onObj(m, x, y, c.z, (o) => {
    // Enchant: a staff takes a charge of a spell the caster knows.
    const g = m.g;
    if (o.objN !== 0x4e) return false;
    const can = m.known(c).filter((s) => s.num !== 97);
    g.askChoice = {
      label: 'With which spell?',
      options: can.map((s) => s.name),
      then: (i) => {
        g.askChoice = null;
        const s = can[i];
        if (!s) return void g.say('sys', 'None.');
        if ((o.container?.length ?? 0) >= 10) {
          g.say('sys', "It's full.");
          return void g.sfx('failure');
        }
        const k = g.objects.create(CHARGE, 0, s.num);
        k.status |= 0x10;
        g.objects.toContainer(k, o);
        g.say('sys', `The staff holds ${s.name}.`);
      },
    };
    return true;
  }) }],
  [100, { aim: 'none', run: (m) => {
    // Gate Travel: to the moongate of a phase of the moons.
    const g = m.g;
    g.askChoice = {
      label: 'To phase',
      options: PHASES,
      then: (i) => {
        g.askChoice = null;
        const at = g.moonstones[i];
        if (!at || (!at[0] && !at[1])) return void g.sfx('failure');
        g.relocate(at[0], at[1], at[2]);
        g.say('sys', `To the moongate of the ${PHASES[i].toLowerCase()}.`);
      },
    };
  } }],
  [105, { aim: 'none', run: (m, c) => {
    // Wizard Eye: the land about seen from far above.
    m.g.scry = { x: c.x, y: c.y, z: c.z };
    m.g.say('sys', 'Done.');
  } }],
  [112, { aim: 'none', run: (m) => {
    // Armageddon: all life ends but the Avatar's and Lord British's.
    const g = m.g;
    for (const a of g.actors.list) {
      if (a.id === 1 || a.id === 5 || a.id === 0 || !a.alive || !a.objN) continue;
      a.hp = 0;
      a.statusFlags |= STATUS_DEAD;
      a.visible = false;
      g.partyRemove?.(a);
    }
    g.say('sys', 'All is still.');
  } }],
  [114, { aim: 'none', run: (m) => {
    // Eclipse: the sun is darkened for a while.
    m.g.eclipseTurns = 20;
    m.g.say('sys', 'The sun is darkened!');
  } }],
  [118, { aim: 'none', run: (m, c) => {
    // Slime: evil about the party turned to slime.
    const g = m.g;
    const p = g.player;
    let n = 0;
    for (const a of g.actors.list) {
      if (!a.alive || !a.visible || a.z !== p.z || Math.abs(a.x - p.x) > 5 || Math.abs(a.y - p.y) > 5) continue;
      if (alignment(a) !== ALIGN.EVIL || MONSTERS.get(a.objN)?.magicImmune === 1 || m.resists(a, c)) continue;
      a.objN = SLIME;
      a.frameN = 0;
      if (a.id >= 203) for (const o of [...g.objects.inventories[a.id]]) g.objects.unlink(o);
      n++;
    }
    if (n) m.success();
    else m.noEffect();
  } }],
]);

/** Whether a thing carried is reagents (for the spellbook's list of what there is). */
export function reagentCounts(g: Game, a: Actor): number[] {
  return REAGENTS.map((r) => {
    let n = 0;
    for (const o of carried(g.objects, a.id)) if (o.objN === r.objN) n += Math.max(1, o.qty);
    return n;
  });
}
