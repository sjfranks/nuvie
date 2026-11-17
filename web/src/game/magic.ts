/**
 * magic.ts - casting spells (Ultima VI): the checks of Nuvie's Magic.cpp (a readied spellbook holding the spell, a
 * level as high as its circle, magic points as many, a reagent of each kind it takes) and the spells themselves, from
 * data/scripts/u6/magic/ - those that matter in a fight or on the road. The rest say so.
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
    const why = this.cannot(a, s);
    g.say('you', `${s.name}: "${words(s)}"`);
    if (why) {
      g.say('sys', why);
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
    return false;
  }
  noEffect(): boolean {
    this.g.say('sys', 'No effect.');
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
]);

/** Whether a thing carried is reagents (for the spellbook's list of what there is). */
export function reagentCounts(g: Game, a: Actor): number[] {
  return REAGENTS.map((r) => {
    let n = 0;
    for (const o of carried(g.objects, a.id)) if (o.objN === r.objN) n += Math.max(1, o.qty);
    return n;
  });
}
