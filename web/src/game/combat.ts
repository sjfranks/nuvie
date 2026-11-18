/**
 * combat.ts - fighting, and the monsters that come to fight: Ultima 6's rules as Nuvie's Lua has them
 * (data/scripts/u6/actor.lua: actor_attack, actor_combat_hit_check, actor_take_hit, actor_hit, actor_dead,
 * actor_find_target, actor_wt_attack, actor_init, actor_avatar_death) and its eggs (EggManager.cpp spawn_eggs and
 * spawn_egg, ActorManager.cpp create_temp_actor and the clean-up of temporary actors).
 *
 * Simplified where the original's detail would not show on a phone: every actor in a fight acts once a turn rather
 * than by movement points; thrown weapons are not lost.
 */
import type { Actor } from './actors.ts';
import { SILVER_SERPENT, STATUS_DEAD, STATUS_IN_PARTY } from './actors.ts';
import type { Game } from './game.ts';
import { carried, invCount, invDelete } from './inventory.ts';
import { wrap } from './map.ts';
import { STATUS_OK_TO_TAKE, STATUS_TEMPORARY, type Obj } from './objects.ts';
import { ARMOUR, MONSTERS, PROJECTILE, WEAPON_DMG, WEAPON_RANGE, type MonsterType } from './u6combat.ts';
import { EGG } from './kind.ts';
import { MD_AMMO, MD_ARMOUR, MD_MONSTERS, MD_PROJECTILE, MD_STATS, MD_WEAPON_DMG, MD_WEAPON_RANGE, mdBit } from './mdse.ts';
import { ACTOR_TYPES, OBJ } from './u6tables.ts';

export const ALIGN = { DEFAULT: 0, NEUTRAL: 1, EVIL: 2, GOOD: 3, CHAOTIC: 4 } as const;
const WT = {
  NOTHING: 0x0, FOLLOW: 0x1, PLAYER: 0x2, FRONT: 0x3, REAR: 0x4, FLANK: 0x5, BERSERK: 0x6, RETREAT: 0x7, ASSAULT: 0x8, FLEE: 0x9, LIKE: 0xa,
  UNFRIENDLY: 0xb, STATIONARY: 0xe, UNK_13: 0x13, WALK_TO_LOCATION: 0x86, BRAWLING: 0x99, MOUSE: 0x9a, ATTACK_PARTY: 0x9b,
} as const;
/** The worktypes that fight. */
const FIGHTING: ReadonlySet<number> = new Set([
  WT.FRONT, WT.REAR, WT.FLANK, WT.BERSERK, WT.RETREAT, WT.ASSAULT, WT.FLEE, WT.UNFRIENDLY, WT.STATIONARY, WT.ATTACK_PARTY,
]);
/** Actors from here on are made as they are needed (Ultima 6's temp_actor_offset). */
const TEMP_FROM = 203;
/** actor_immune_to_dmg: Martian Dreams' creatures and people no blow can hurt. */
const MD_IMMUNE_OBJ = new Set([381, 390, 391, 358, 382]);
const MD_IMMUNE_ID = new Set([0x5c, 0x5d, 0x59, 0x5a, 0x54, 0x52, 0x6d, 0x68, 0x67, 0x69, 0x77, 0x78, 0x40, 0x3c]);
/** A spell held as a weapon: a monster's, or a staff's (obj 336). */
const CHARGE = 336;
const BLOOD = 338;
const ARROW = 55;
const BOLT = 56;
const MOVETYPE_WATER_LOW = 2;
const MOVETYPE_WATER_HIGH = 3;
const MOVETYPE_AIR_LOW = 4;
const MOVETYPE_AIR_HIGH = 5;
const FOOD = [129, 133, 128];

/** get_combat_range's table: how far, in combat, a square dx, dy away is. */
const RANGE = [
  0, 1, 2, 3, 4, 5, 6, 7, 1, 1, 2, 3, 4, 5, 6, 7, 2, 2, 2, 3, 4, 5, 6, 7, 3, 3, 3, 4, 5, 6, 7, 7, 4, 4, 4, 5, 6, 7, 7, 8,
  5, 5, 5, 6, 7, 7, 8, 8, 6, 6, 6, 7, 7, 8, 8, 8, 7, 7, 7, 7, 8, 8, 8, 8,
];

/** What an actor hits with: a thing carried, or its own body. */
interface Weapon {
  objN: number;
  obj: Obj | null;
}

/** A mark over the map where a blow landed, or a shot flew. */
export interface Flash {
  x: number;
  y: number;
  z: number;
  kind: 'hit' | 'miss';
  until: number;
  /** A shot: the tile that flew, and from where. */
  shot?: { tile: number; fromX: number; fromY: number };
}

const isEvil = (al: number): boolean => al === ALIGN.EVIL || al === ALIGN.CHAOTIC;

/** Status: in the actor's status flags... */
export const PROTECTED = 0x01;
export const PARALYZED = 0x02;
export const ASLEEP = 0x04;
export const POISONED = 0x08;
/** ...and in its object flags. */
export const INVISIBLE = 0x02;
export const CHARMED = 0x04;
export const CURSED = 0x40;

/** A number as a curse leaves it (actor_str_adj and the like): three less, never under one. */
export function adj(a: Actor, v: number): number {
  return a.objFlags & CURSED ? Math.max(1, v - 3) : v;
}

export function alignment(a: Actor): number {
  return ((a.statusFlags & 0x60) >> 5) + 1;
}

export function setAlignment(a: Actor, al: number): void {
  a.statusFlags = (a.statusFlags & ~0x60) | (((al - 1) & 3) << 5);
}

/** Which way an actor's kind moves: by land, water or air (U6ActorTypes.h). */
const MOVETYPE = new Map<number, number>(ACTOR_TYPES.map((r) => [r[0] as number, r[10] as number]));
/** What an actor's kind leaves when it dies: [object, frame] (255 its own frame). */
const DEAD = new Map<number, [number, number]>(ACTOR_TYPES.map((r) => [r[0] as number, [r[5] as number, r[6] as number]]));

const randomise = (g: Game, base: number): number => {
  const t = Math.floor(base / 2);
  return t === 0 ? base : g.random(t + 1) + g.random(t + 1) + base - t;
};

export class Combat {
  flashes: Flash[] = [];
  /** Turns left of a Time Stop: no one but the party moves. */
  timeStop = 0;
  /** Party members fallen since the Avatar last died. */
  fallen: Actor[] = [];
  private block = '';
  private eggs: Obj[] | null = null;

  /** The game's own numbers: Ultima VI's tables, or Martian Dreams' (mdse.ts). */
  private readonly t: {
    monsters: Map<number, MonsterType>;
    dmg: Map<number, number>;
    range: Map<number, number>;
    shot: Map<number, number>;
    armour: Map<number, number>;
  };

  constructor(private readonly g: Game) {
    this.t = g.kind === 'md'
      ? { monsters: MD_MONSTERS, dmg: MD_WEAPON_DMG, range: MD_WEAPON_RANGE, shot: MD_PROJECTILE, armour: MD_ARMOUR }
      : g.kind === 'u6'
        ? { monsters: MONSTERS, dmg: WEAPON_DMG, range: WEAPON_RANGE, shot: PROJECTILE, armour: ARMOUR }
        : { monsters: new Map(), dmg: new Map(), range: new Map(), shot: new Map(), armour: new Map() };
  }

  /** The first actor number kept for creatures that come and go (ActorManager's temp_actor_offset). */
  private get tempFrom(): number {
    return this.g.kind === 'u6' ? TEMP_FROM : 224;
  }

  /** Turns are shown one by one (the app sets this; the battle speed is its own). */
  paced = false;

  /** A creature's base numbers in this game. */
  monster(objN: number): MonsterType | undefined {
    return this.t.monsters.get(objN);
  }

  private rand(lo: number, hi: number): number {
    return lo + this.g.random(hi - lo + 1);
  }

  private name(a: Actor): string {
    const m = this.g.party.find((p) => p.actor === a);
    return m ? m.name : this.g.lookActor(a).replace(/^(a|an|the) /, '');
  }

  private cap(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  flash(x: number, y: number, z: number, kind: Flash['kind'], shot?: Flash['shot']): void {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.flashes.push({ x, y, z, kind, until: now + 450, shot });
    if (this.flashes.length > 24) this.flashes.shift();
  }

  // ---- who fights whom ----

  /** Whether an actor would attack another (actor_find_target's test), the unseen excepted (actor_ok_to_attack). */
  canTarget(att: Actor, tgt: Actor): boolean {
    if (tgt.objFlags & INVISIBLE && !(tgt.inParty && att.inParty)) return false;
    const wt = att.worktype;
    const align = alignment(att);
    const talign = alignment(tgt);
    if (wt === WT.FLEE || wt === WT.MOUSE || wt === WT.UNK_13 || wt === WT.RETREAT || wt === WT.BRAWLING) return true;
    return (
      (align !== ALIGN.NEUTRAL || (wt === WT.ATTACK_PARTY && talign === ALIGN.GOOD)) &&
      (align !== ALIGN.CHAOTIC || talign !== ALIGN.CHAOTIC) &&
      talign !== ALIGN.NEUTRAL &&
      (align !== ALIGN.GOOD || isEvil(talign)) &&
      (align !== ALIGN.EVIL || talign === ALIGN.GOOD || talign === ALIGN.CHAOTIC)
    );
  }

  private standing(a: Actor): boolean {
    return a.alive && a.visible && a.objN !== 0;
  }

  /** Whether an actor means the party harm now. */
  hostile(a: Actor): boolean {
    if (!this.standing(a) || a.inParty || !FIGHTING.has(a.worktype)) return false;
    // 0x9b is Martian Dreams' coker at work, not a foe.
    if (this.g.kind === 'md' && a.worktype === WT.ATTACK_PARTY) return false;
    return this.g.party.some((m) => this.canTarget(a, m.actor));
  }

  /** The foes near the party. */
  foes(radius = 9): Actor[] {
    const p = this.g.player;
    return this.g.actors.list.filter((a) => a.z === p.z && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= radius && this.hostile(a));
  }

  get fighting(): boolean {
    return this.foes().length > 0;
  }

  /** The nearest actor this one would attack, within eight squares (actor_find_target). */
  findTarget(a: Actor): Actor | null {
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const t of this.g.actors.list) {
      if (t === a || !this.standing(t) || t.z !== a.z || !this.canTarget(a, t)) continue;
      if (a.inParty && t.inParty) continue;
      if (Math.max(Math.abs(t.x - a.x), Math.abs(t.y - a.y)) > 8) continue;
      const d = (t.x - a.x) ** 2 + (t.y - a.y) ** 2;
      if (d < bestD || (d === bestD && this.g.random(2) === 1)) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  // ---- weapons and blows ----

  range(a: Actor, x: number, y: number): number {
    const dx = Math.abs(a.x - x);
    const dy = Math.abs(a.y - y);
    return dx < 8 && dy < 8 ? RANGE[dx * 8 + dy] : 9;
  }

  private dmgOf(objN: number): number | undefined {
    return this.t.dmg.get(objN) ?? this.t.monsters.get(objN)?.dmg;
  }

  /** The hardest-hitting thing an actor has that reaches (actor_get_weapon); party members use what they have readied. */
  weapon(a: Actor, x: number, y: number): Weapon {
    const reach = this.range(a, x, y);
    let best: Weapon = { objN: a.objN, obj: null };
    let max = 0;
    for (const o of carried(this.g.objects, a.id)) {
      if (o.parentObj) continue;
      // A spell the creature knows (a charge), now and then, the less often the higher the spell (actor_get_weapon).
      if (o.objN === CHARGE) {
        if (this.g.stormTurns === 0 && this.rand(0, 3) === 0 && this.rand(0, o.quality) < 16) return { objN: CHARGE, obj: o };
        continue;
      }
      if (a.inParty && o.loc !== 'readied') continue;
      const dmg = this.t.dmg.get(o.objN);
      if (dmg !== undefined && dmg > max && (this.t.range.get(o.objN) ?? 1) >= reach && !this.outOfAmmo(a, o.objN, o)) {
        max = dmg;
        best = { objN: o.objN, obj: o };
      }
    }
    return best;
  }

  /** How far an actor can hit from here: their best weapon's reach. */
  reach(a: Actor): number {
    let r = 1;
    for (const o of carried(this.g.objects, a.id)) {
      if (a.inParty && o.loc !== 'readied') continue;
      if (this.t.dmg.has(o.objN) && !this.outOfAmmo(a, o.objN, o)) r = Math.max(r, this.t.range.get(o.objN) ?? 1);
    }
    return r;
  }

  private outOfAmmo(a: Actor, objN: number, o?: Obj | null): boolean {
    if (this.g.kind === 'md') {
      const ammo = MD_AMMO.get(objN);
      if (ammo === undefined) return false;
      if (ammo === 0) return !!o && o.qty === 0;
      return invCount(this.g.objects, a.id, ammo) === 0;
    }
    if (this.g.kind !== 'u6') return false;
    if (objN === 41 || objN === 54) return invCount(this.g.objects, a.id, ARROW) === 0;
    if (objN === 42 || objN === 50) return invCount(this.g.objects, a.id, BOLT) === 0;
    return false;
  }

  private ac(a: Actor): number {
    let ac = 0;
    for (const o of this.g.objects.inventories[a.id] ?? []) if (o.loc === 'readied') ac += this.t.armour.get(o.objN) ?? 0;
    if (a.objFlags & CURSED) ac -= 3;
    if (a.statusFlags & PROTECTED) ac += 3;
    return ac;
  }

  /** actor_combat_hit_check: dexterity (or strength, for a club) against the foe's dexterity. */
  private hits(att: Actor, foe: Actor, w: Weapon): boolean {
    if (w.objN === 48 && this.g.kind === 'u6') return true; // the glass sword
    const useStr = w.obj ? this.g.kind === 'u6' && [4, 34, 39, 44].includes(w.objN) : this.t.monsters.get(att.objN)?.useStr === 1;
    const role = useStr ? adj(att, att.strength) : adj(att, att.dex);
    const foeDex = foe.statusFlags & (ASLEEP | PARALYZED) || this.timeStop > 0 ? 1 : adj(foe, foe.dex);
    return Math.floor((foeDex + 30 - role) / 2) < this.rand(1, 30);
  }

  /** Whether a shot from one square reaches another, nothing in the way. */
  clearLine(x0: number, y0: number, x1: number, y1: number, z: number): boolean {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (let n = 0; n < 32; n++) {
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return true;
      if (this.g.map.isMissileBoundary(x, y, z)) return false;
    }
    return true;
  }

  /** One actor attacks another (actor_attack). Returns false where the foe is out of reach. */
  attack(att: Actor, foe: Actor): boolean {
    const w = this.weapon(att, foe.x, foe.y);
    if (this.range(att, foe.x, foe.y) > (this.t.range.get(w.objN) ?? 1)) return false;
    att.setDirection(Math.abs(foe.x - att.x) <= Math.abs(foe.y - att.y) ? (foe.y >= att.y ? 2 : 0) : foe.x >= att.x ? 1 : 3);
    if (w.objN === CHARGE && w.obj) {
      if (w.obj.quality === 0x81) return this.wispTeleport(att);
      this.g.magic.castAs(att, w.obj.quality, foe.x, foe.y);
      return true;
    }
    const far = Math.abs(foe.x - att.x) > 1 || Math.abs(foe.y - att.y) > 1;
    const md = this.g.kind === 'md';
    const ranged = md ? far || this.t.shot.has(w.objN) : w.objN !== 40 && w.objN !== 47 && (far || this.t.shot.has(w.objN));
    let hit = this.hits(att, foe, w);
    if (ranged) {
      if (!this.clearLine(att.x, att.y, foe.x, foe.y, att.z)) hit = false;
      if (md) {
        // A round from the pack, or a charge from a ray gun or sprayer (fire_range_based_weapon).
        const ammo = MD_AMMO.get(w.objN);
        if (ammo) invDelete(this.g.objects, att.id, ammo, 1, 0);
        else if (ammo === 0 && w.obj) w.obj.qty = Math.max(0, w.obj.qty - 1);
      } else {
        if (w.objN === 41 || w.objN === 54) invDelete(this.g.objects, att.id, ARROW, 1, 0);
        if (w.objN === 42 || w.objN === 50) invDelete(this.g.objects, att.id, BOLT, 1, 0);
      }
    }
    if (!ranged && Math.max(Math.abs(att.x - this.g.player.x), Math.abs(att.y - this.g.player.y)) < 6) this.g.sfx('swing');
    const shot = ranged && this.t.shot.has(w.objN) ? { tile: this.t.shot.get(w.objN)!, fromX: att.x, fromY: att.y } : undefined;
    if (!hit) {
      this.flash(foe.x, foe.y, foe.z, 'miss', shot);
      if (att === this.g.player || foe === this.g.player || att.inParty) this.g.say('sys', `${this.cap(this.name(att))} misses.`);
      return true;
    }
    if (md && this.mdSpecial(att, foe, w)) return true;
    let dmg = this.dmgOf(w.objN) ?? 1;
    // Some can only be half hurt, but for the glass sword, the triple crossbow and the magic bow.
    if (this.t.monsters.get(foe.objN)?.halfDmg === 1 && w.objN !== 48 && w.objN !== 50 && w.objN !== 54) dmg = Math.floor((dmg + 1) / 2);
    this.flash(foe.x, foe.y, foe.z, 'hit', shot);
    this.takeHit(att, foe, dmg);
    if (w.objN === 48 && w.obj && !md) {
      this.g.say('sys', 'Thy sword hath shattered!');
      this.g.objects.unlink(w.obj);
    }
    return true;
  }

  /**
   * Martian Dreams' weapons that do other than wound (attack_target_with_weapon): the freeze ray holds fast what it
   * can, Cupid's bow charms, the heat ray does nothing to what heat cannot hurt. True where the blow is dealt with.
   */
  private mdSpecial(att: Actor, foe: Actor, w: Weapon): boolean {
    const g = this.g;
    const who = this.cap(this.name(foe));
    const t = MD_STATS.get(foe.objN);
    if (w.objN === 241) {
      if (t && (mdBit(t, 14) || mdBit(t, 7))) {
        foe.statusFlags |= PARALYZED;
        g.say('sys', `${who} is paralyzed.`);
        this.flash(foe.x, foe.y, foe.z, 'hit');
      } else g.say('sys', 'It has no effect.');
      return true;
    }
    if (w.objN === 40) {
      if (alignment(foe) !== ALIGN.GOOD) {
        this.charm(foe, ALIGN.GOOD);
        g.say('sys', `${who} is charmed.`);
      }
      return true;
    }
    if (w.objN === 240 && mdBit(t, 3)) {
      g.say('sys', 'It has no effect.');
      return true;
    }
    return false;
  }

  /** actor_take_hit: a roll up to the weapon's damage, less a roll up to the defender's armour. */
  private takeHit(att: Actor, def: Actor, max: number): void {
    let dmg = max === -1 ? 1 : max > 1 && max !== 255 ? this.rand(1, max) : max;
    const ac = this.ac(def);
    if (dmg !== 255 && ac > 0) dmg -= this.rand(1, ac);
    // Martian Dreams' creatures that take double harm (actor_hit's stat bit 4), and those nothing harms.
    if (this.g.kind === 'md' && dmg > 0) {
      if (MD_IMMUNE_OBJ.has(def.objN) || MD_IMMUNE_ID.has(def.id)) {
        this.g.say('sys', 'It has no effect.');
        return;
      }
      if (mdBit(MD_STATS.get(def.objN), 4)) dmg *= 2;
    }
    const who = this.cap(this.name(def));
    if (dmg > 0) this.g.sfx('hit');
    if (dmg > 0) def.statusFlags &= ~0x04;
    if (dmg > 0) att.exp += this.hit(def, dmg);
    else this.g.say('sys', `${who} grazed.`);
    if (def.hp > 0 || dmg <= 0) {
      if (this.g.kind === 'md' && dmg > 0 && mdBit(MD_STATS.get(att.objN), 2) && this.g.random(4) === 0) {
        def.statusFlags |= PARALYZED;
        this.g.say('sys', `${who} is paralyzed!`);
      }
      if (this.t.monsters.get(att.objN)?.poison === 1 && this.g.random(4) === 0 && !(def.statusFlags & 0x08)) {
        def.statusFlags |= 0x08;
        this.g.say('sys', `${this.cap(this.name(def))} poisoned!`);
      }
      if (dmg > 0) this.hitMessage(def);
      // The struck strike back.
      if (!FIGHTING.has(def.worktype) && !def.inParty && dmg > 0) {
        def.worktype = WT.ASSAULT;
        if (att.inParty) setAlignment(def, ALIGN.CHAOTIC);
      }
    } else if (def.id !== 1) this.g.say('sys', `${who} killed!`);
  }

  /** Harm without a blow or its messages (the cold, starvation): actor_hit alone. */
  harm(def: Actor, dmg: number): void {
    this.hit(def, dmg);
  }

  /** Damage that does not miss and no armour turns (spells): as a blow, with its messages. */
  hurt(att: Actor, def: Actor, dmg: number): void {
    const who = this.cap(this.name(def));
    def.statusFlags &= ~0x04; // the hurt wake
    this.flash(def.x, def.y, def.z, 'hit');
    this.g.sfx('hit');
    att.exp += this.hit(def, dmg);
    if (def.hp > 0) {
      this.hitMessage(def);
      if (!FIGHTING.has(def.worktype) && !def.inParty) {
        def.worktype = WT.ASSAULT;
        if (att.inParty) setAlignment(def, ALIGN.CHAOTIC);
      }
    } else if (def.id !== 1) this.g.say('sys', `${who} killed!`);
  }

  /**
   * actor_map_dmg / actor_tile_dmg: what the square an actor stands on does to it - swamp and poison fields poison,
   * fire burns, traps, spikes and force fields cut, webs hold, sleep fields put to sleep. Once a turn.
   */
  mapDamage(a: Actor): void {
    const g = this.g;
    if (g.kind !== 'u6') return;
    if (!a.alive || !a.visible || !a.objN || a.id === 0) return;
    const base = this.t.monsters.get(a.objN);
    if (base?.flies === 1 || a.statusFlags & PROTECTED) return;
    if (a.inParty && g.vehicle) return;
    let t = g.map.tile(a.x, a.y, a.z);
    if (!t.damages) {
      const objs = g.objects.list(a.x, a.y, a.z) ?? [];
      let found = null;
      for (let i = objs.length - 1; i >= 0 && !found; i--) {
        const o = objs[i];
        if (o.status & 0x10 && o.objN !== 173) continue; // invisible, but traps still bite
        const ot = g.objects.tileOf(o);
        if (ot.damages) found = ot;
      }
      if (!found) return;
      t = found;
    }
    const n = t.num;
    const name = this.cap(this.name(a));
    if (n === 564) {
      if (a.objN !== 0x169 && adj(a, a.strength) < this.rand(1, 30)) {
        a.statusFlags |= PARALYZED;
        g.say('sys', `${name} is stuck in a web!`);
      }
    } else if ((n >= 2 && n <= 5) || n === 1165) {
      const boots = g.objects.inventories[a.id].some((o) => o.loc === 'readied' && o.objN === 28);
      if ((!boots || n === 1165) && base?.poisonImmune !== 1 && !(a.statusFlags & POISONED)) {
        a.statusFlags |= POISONED;
        g.say('sys', `${name} poisoned!`);
        this.flash(a.x, a.y, a.z, 'hit');
      }
    } else if ((n >= 220 && n <= 223) || [890, 1124, 1125, 1130, 1131, 1164, 1193].includes(n)) {
      let dmg = n === 1164 ? this.rand(1, 30) : this.rand(1, 8);
      if (base?.fireDouble === 1) dmg *= 2;
      this.mapHit(a, dmg);
    } else if (n === 732 || n === 1010) {
      this.mapHit(a, this.rand(1, 30));
      if (n === 732) for (const o of g.objects.list(a.x, a.y, a.z) ?? []) if (o.objN === 173) o.status &= ~0x10;
    } else if (n >= 1458 && n <= 1463) {
      if (a.objN !== 0x16e) this.mapHit(a, this.rand(1, 8));
    } else if (n === 562 || n === 731) {
      this.mapHit(a, this.rand(1, 8));
    } else if (n === 1167) {
      if (base?.sleepImmune !== 1 && !(a.statusFlags & ASLEEP)) {
        a.statusFlags |= ASLEEP;
        g.say('sys', `${name} falls asleep.`);
      }
    }
  }

  private mapHit(a: Actor, dmg: number): void {
    const who = this.cap(this.name(a));
    this.flash(a.x, a.y, a.z, 'hit');
    this.g.sfx('hit');
    this.hit(a, dmg);
    if (a.hp > 0) this.hitMessage(a);
    else if (a.id !== 1) this.g.say('sys', `${who} killed!`);
  }

  /** actor_hit: the damage itself. Returns the experience it earns. */
  private hit(def: Actor, dmg: number): number {
    // The party's boat takes blows to its hull, but is not sunk here.
    if (def.id === 0) {
      def.hp = Math.max(1, def.hp - dmg);
      return 0;
    }
    if (def.objN === OBJ.LORD_BRITISH) {
      def.hp = 255;
      return 0;
    }
    if (dmg < def.hp) {
      def.hp -= dmg;
      if (def.worktype === WT.FLEE) def.worktype = WT.ASSAULT;
      return 0;
    }
    if (def.hp === 0) return 0;
    if (def.inParty) this.g.karma = Math.max(0, this.g.karma - 5);
    def.hp = 0;
    let exp = 0;
    const base = this.t.monsters.get(def.objN);
    if (isEvil(alignment(def)) && base) exp = Math.floor((base.str + base.dex + base.int + base.hp + base.dmg + base.exp) / 4);
    this.die(def);
    return exp;
  }

  private hitMessage(a: Actor): void {
    if (a.hp === 0) return;
    const di = Math.floor((a.hp * 4) / Math.max(1, a.maxHp));
    if (di >= 4) return;
    const how = di === 0 ? 'critical!' : `${['', 'heavily', 'lightly', 'barely'][di]} wounded.`;
    this.g.say('sys', `${this.cap(this.name(a))} ${how}`);
    if (di === 0 && a.intelligence >= 5 && a.worktype !== WT.BERSERK && a.worktype !== WT.STATIONARY && a.worktype > WT.FRONT && !a.inParty) a.worktype = WT.RETREAT;
  }

  /** actor_dead and U6Actor::die: blood, a body holding what they carried, and gone. */
  private die(a: Actor): void {
    const g = this.g;
    const base = this.t.monsters.get(a.objN);
    if (base?.blood === 1) {
      const b = g.objects.create(BLOOD, 1, 0);
      b.frameN = g.random(3);
      b.status |= STATUS_TEMPORARY;
      [b.x, b.y, b.z] = [a.x, a.y, a.z];
      g.objects.add(b);
    }
    if (a.id === 1) {
      this.avatarDeath();
      return;
    }
    const [deadObj, deadFrame] = (g.kind === 'u6' ? DEAD.get(a.objN) : undefined) ?? [0, 0];
    for (const k of (g.objects.inventories[a.id] ?? []).filter((o) => o.objN === CHARGE)) g.objects.unlink(k);
    const inv = [...(g.objects.inventories[a.id] ?? [])];
    let into: Obj | null = null;
    if (deadObj !== 0 && deadObj !== BLOOD) {
      const body = g.objects.create(deadObj, 0, a.id);
      body.frameN = deadFrame === 255 ? a.frameN : deadFrame;
      body.status = STATUS_OK_TO_TAKE | (a.id >= this.tempFrom ? STATUS_TEMPORARY : 0);
      [body.x, body.y, body.z] = [a.x, a.y, a.z];
      body.container ??= [];
      g.objects.add(body);
      into = body;
    }
    for (const o of inv) {
      if (into) g.objects.toContainer(o, into);
      else {
        g.objects.unlink(o);
        [o.x, o.y, o.z] = [a.x, a.y, a.z];
        o.status |= STATUS_OK_TO_TAKE;
        g.objects.add(o);
      }
    }
    if (a.inParty) {
      g.partyRemove(a);
      this.fallen.push(a);
    }
    a.statusFlags = (a.statusFlags | STATUS_DEAD) & ~STATUS_IN_PARTY;
    a.visible = false;
    a.worktype = WT.NOTHING;
    if (a.id >= this.tempFrom) this.free(a);
  }

  /** actor_avatar_death: darkness, KAL LOR, and the party wakes healed in Lord British's castle. */
  private avatarDeath(): void {
    const g = this.g;
    this.waiting = false;
    if (g.kind === 'md') return this.unconscious();
    g.say('sys', 'An unending darkness engulfs thee...');
    g.sfx('death');
    setTimeout(() => g.sfx('kallor'), 2400);
    g.say('npc', 'A voice in the darkness intones, "KAL LOR!"');
    // The party's dead are raised with the Avatar.
    for (const a of this.fallen) {
      a.statusFlags &= ~STATUS_DEAD;
      a.visible = true;
      g.partyAdd(a);
      for (const o of g.objects.all()) if (o.objN === OBJ.DEAD_BODY && o.quality === a.id) g.objects.unlink(o);
    }
    this.fallen = [];
    for (const m of g.party) {
      m.actor.hp = m.actor.maxHp;
      m.actor.statusFlags &= ~(STATUS_DEAD | 0x08);
    }
    for (const a of g.actors.list) if (a.id < this.tempFrom && a.worktype === WT.ATTACK_PARTY) a.worktype = WT.WALK_TO_LOCATION;
    g.relocate(0x133, 0x160, 0);
  }

  /**
   * Martian Dreams' Avatar is not killed but falls unconscious (avatar_falls_unconscious), and wakes, healed with the
   * party's fallen, at the space capsule - or the Olympus mine once that is the party's home - at seven the next morning.
   */
  private unconscious(): void {
    const g = this.g;
    if (g.mdUse.dream) {
      // Killed in a dream: back to the last teleporter, or awake (party_update).
      const d = g.mdUse.dream;
      if (d.back) {
        g.player.hp = g.player.maxHp;
        g.player.statusFlags &= ~(STATUS_DEAD | 0x08);
        g.player.visible = true;
        g.relocate(d.back[0], d.back[1], g.player.z);
        g.say('sys', 'You feel your dream consciousness returning.');
      } else g.mdUse.wake(true);
      return;
    }
    g.say('sys', 'Overcome by your wounds, you fall unconscious!');
    g.sfx('death');
    const mine = (g.actors.get(0x46)?.talkFlags ?? 0) & (1 << 3);
    for (const a of this.fallen) {
      a.statusFlags &= ~STATUS_DEAD;
      a.visible = true;
      g.partyAdd(a);
    }
    this.fallen = [];
    for (const m of g.party) {
      m.actor.hp = m.actor.maxHp;
      m.actor.statusFlags &= ~(STATUS_DEAD | 0x08 | PARALYZED);
    }
    for (const a of g.actors.list) if (a.id < this.tempFrom && a.worktype === WT.ATTACK_PARTY) a.worktype = WT.WALK_TO_LOCATION;
    const c = g.clock;
    const hours = c.hour < 7 ? 6 - c.hour : 24 - (c.hour + 1) + 7;
    g.advance(hours * 60 + (60 - c.minute) + this.rand(0, 59));
    if (mine) g.relocate(0xa4, 0xc3, 4);
    else g.relocate(0x19d, 0x278, 0);
    g.say('sys', `You awaken back at ${mine ? 'the Olympus mine' : 'the space capsule'}, feeling restored.`);
  }

  private free(a: Actor): void {
    for (const o of [...(this.g.objects.inventories[a.id] ?? [])]) this.g.objects.unlink(o);
    a.objN = 0;
    a.x = a.y = a.z = 0;
    a.visible = false;
    a.worktype = 0;
    a.statusFlags = 0;
  }

  // ---- moving in a fight ----

  /** Whether an actor's kind can stand on a square: walkers on ground, swimmers in water, fliers over both. */
  canEnter(a: Actor, x: number, y: number): boolean {
    const g = this.g;
    x = wrap(x, a.z);
    y = wrap(y, a.z);
    const there = g.actors.at(x, y, a.z);
    if (there && there !== a) return false;
    // A silver serpent goes straight, never back over its own neck (check_move_silver_serpent).
    if (a.objN === SILVER_SERPENT) {
      if (x !== a.x && y !== a.y) return false;
      const neck = a.parts()[0];
      if (neck && neck.x === x && neck.y === y) return false;
    }
    const mt = (g.kind === 'u6' ? MOVETYPE.get(a.objN) : undefined) ?? 1;
    if (mt === MOVETYPE_WATER_LOW || mt === MOVETYPE_WATER_HIGH) return g.map.isWater(x, y, a.z);
    if (mt === MOVETYPE_AIR_LOW || mt === MOVETYPE_AIR_HIGH) return g.map.isPassable(x, y, a.z) || g.map.isWater(x, y, a.z);
    return g.map.isPassable(x, y, a.z);
  }

  /** A step towards (or, `away`, from) a square (actor_move_towards_loc): straight, else either way round. */
  step(a: Actor, tx: number, ty: number, away = false): boolean {
    let dx = Math.sign(tx - a.x);
    let dy = Math.sign(ty - a.y);
    if (away) {
      dx = -dx;
      dy = -dy;
    }
    const tries: [number, number][] = [[dx, dy]];
    if (dx && dy) tries.push(this.g.random(2) ? [dx, 0] : [0, dy], [dx, 0], [0, dy]);
    else if (dx) tries.push([dx, 1], [dx, -1]);
    else if (dy) tries.push([1, dy], [-1, dy]);
    for (const [sx, sy] of tries) {
      if ((sx || sy) && this.canEnter(a, a.x + sx, a.y + sy)) {
        a.x = wrap(a.x + sx, a.z);
        a.y = wrap(a.y + sy, a.z);
        a.setDirection(Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 1 : 3) : sy > 0 ? 2 : 0);
        return true;
      }
    }
    return false;
  }

  // ---- turns, by movement points (actor_update_all) ----

  /** Whether the party fights now: foes near (Party::in_combat_mode), worked out once a step. */
  private inFight = false;
  /** Turns wait to be taken before the player's next (shown one at a time when paced). */
  waiting = false;
  /** Actions taken since the player's last, against a script that never hands back. */
  private spentSteps = 0;

  /** Points a step costs: five, and the ground's own impedance; twice that on the diagonal (Actor::move). */
  private stepCost(dx: number, dy: number): number {
    return dx !== 0 && dy !== 0 ? 10 : 5;
  }

  /** subtract_movement_pts: a rider spends half. */
  spend(a: Actor, pts: number): void {
    if (a.objN === 0x1af) pts = Math.floor(pts / 2);
    a.moves = Math.max(-127, a.moves - Math.max(1, pts));
  }

  /**
   * What an actor does now (its worktype): in a fight, each of the party by the way they were told to fight
   * (Party::set_in_combat_mode, the combat_mode each keeps), the leader and those under command by the player's hand.
   */
  wt(a: Actor): number {
    if (!a.inParty) return a.worktype;
    if (!this.inFight) return a === this.g.player ? WT.PLAYER : WT.FOLLOW;
    if (a === this.g.party[0]?.actor) return WT.PLAYER;
    const m = a.combatMode;
    return m >= WT.PLAYER && m <= WT.ASSAULT ? m : WT.FRONT;
  }

  /** Who may take a turn: those fighting near the party, and the party itself. */
  private takesTurns(a: Actor): boolean {
    const p = this.g.player;
    if (!this.standing(a) || a.z !== p.z) return false;
    if (Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) > 16) return false;
    return a.inParty ? this.inFight : FIGHTING.has(a.worktype);
  }

  /** advance_time's share of a fight: each fighter's points come back, as many as their dexterity. */
  private refill(): void {
    const g = this.g;
    const p = g.player;
    for (const a of g.actors.list) {
      if (a.z === p.z && a.objN !== 0 && a.alive && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 16) {
        this.updateFlags(a);
        const dex = Math.max(1, a.dex);
        a.moves = a.moves >= 0 ? dex : Math.min(dex, a.moves + dex);
      }
    }
    if (this.timeStop > 0) this.timeStop--;
  }

  /** Who goes next (actor_update_all's choice): the most points for their dexterity, or one with a full turn's worth. */
  private chooseNext(): Actor | null {
    let chosen: Actor | null = null;
    let di = 0;
    let dex6 = 1;
    for (const a of this.g.actors.list) {
      if (a.moves <= 0 || !this.takesTurns(a) || a.statusFlags & (PARALYZED | 0x04)) continue;
      const wt = this.wt(a);
      if (wt === WT.NOTHING || wt === WT.FOLLOW) continue;
      const dex = Math.max(1, a.dex);
      const dx = a.moves * dex6 - dex * di;
      if (a.moves >= dex || dx > 0 || (dx === 0 && dex > dex6)) {
        chosen = a;
        di = a.moves;
        dex6 = dex;
      }
      if (a.moves >= dex) break;
    }
    return chosen;
  }

  /** The player has acted: the turns after theirs (all at once, or one at a time when paced). */
  round(): void {
    const g = this.g;
    if (g.kind === 'se') return; // Nuvie has no Savage Empire fighting to port
    this.inFight = this.fighting;
    if (!this.inFight) {
      // Out of a fight, those who would fight close in, a step each.
      this.waiting = false;
      if (g.controlled) g.controlled = null;
      const p = g.player;
      for (const a of g.actors.list) {
        if (a.z === p.z && a.objN !== 0 && a.alive && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 16) this.updateFlags(a);
      }
      if (this.timeStop > 0) {
        this.timeStop--;
        return;
      }
      for (const a of g.actors.list) {
        if (a.inParty || !this.takesTurns(a) || this.asleep(a) || a.statusFlags & PARALYZED) continue;
        this.perform(a);
      }
      return;
    }
    this.spentSteps = 0;
    this.waiting = true;
    if (!this.paced) while (this.waiting) this.nextTurn();
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.flashes = this.flashes.filter((f) => f.until > now - 2000);
  }

  /** Take the next turn; returns who took it, or null once it is the player's (or someone under their command's) turn. */
  nextTurn(): Actor | null {
    const g = this.g;
    if (!this.waiting) return null;
    for (let tries = 0; tries < 64; tries++) {
      if (!g.party.length) return this.handBack(null);
      const a = this.chooseNext();
      if (!a) {
        this.refill();
        continue;
      }
      if (a.inParty && this.wt(a) === WT.PLAYER) return this.handBack(a);
      if (++this.spentSteps > 300) return this.handBack(null);
      this.calculateAvgCoords();
      this.perform(a);
      return a;
    }
    return this.handBack(null);
  }

  /** The player's turn again: theirs, or one of the party under their command (player_set_actor). */
  private handBack(a: Actor | null): null {
    const g = this.g;
    this.waiting = false;
    const leader = g.party[0]?.actor;
    const next = a && a !== leader ? a : null;
    if (next !== g.controlled) {
      g.controlled = next;
      if (next) g.say('sys', `${this.cap(this.name(next))}'s turn.`);
    }
    return null;
  }

  /** perform_worktype: what an actor does with its turn; one that does nothing loses its turn's worth. */
  private perform(a: Actor): void {
    if (this.timeStop > 0 && !a.inParty) {
      a.moves = 0;
      return;
    }
    const before = a.moves;
    if (a.moves > 0 || !this.inFight) {
      switch (this.wt(a)) {
        case WT.FRONT:
          this.wtFront(a);
          break;
        case WT.REAR:
          this.wtRear(a);
          break;
        case WT.FLANK:
          this.wtFlank(a);
          break;
        case WT.BERSERK:
          this.wtBerserk(a);
          break;
        case WT.RETREAT:
        case WT.FLEE:
        case WT.MOUSE:
        case WT.UNK_13:
          this.wtTimid(a);
          break;
        case WT.UNFRIENDLY:
          this.wtUnfriendly(a);
          break;
        case WT.STATIONARY:
          this.wtStationary(a);
          break;
        default:
          this.wtAttack(a);
      }
    }
    if (a.moves === 0 || a.moves === before) this.spend(a, 10);
  }

  /** actor_update_flags: what wears off this turn, and poison's bite. */
  private updateFlags(a: Actor): void {
    const g = this.g;
    const r = (n: number): boolean => g.random(n) === 0;
    if (a.objFlags & INVISIBLE && r(64) && adj(a, a.intelligence) <= this.rand(1, 30)) a.objFlags &= ~INVISIBLE;
    if (a.statusFlags & PROTECTED && r(64) && adj(a, a.intelligence) <= this.rand(1, 30)) a.statusFlags &= ~PROTECTED;
    if (a.objFlags & CURSED && r(16) && adj(a, a.intelligence) >= this.rand(1, 30)) a.objFlags &= ~CURSED;
    if (a.objFlags & CHARMED && r(8) && adj(a, a.intelligence) >= this.rand(1, 30)) this.uncharm(a);
    if (a.statusFlags & PARALYZED && r(4) && adj(a, a.strength) >= this.rand(1, 30)) {
      a.statusFlags &= ~PARALYZED;
      if (a.inParty) g.say('sys', `${this.cap(this.name(a))} can move again.`);
    }
    if (a.statusFlags & POISONED && !(a.statusFlags & PROTECTED) && r(8)) this.hit(a, 1);
  }

  /** Charmed: fights for the one who charmed them (spell_charm_actor); the old alignment kept in the movement flags. */
  charm(a: Actor, align: number): void {
    if (a.objFlags & CHARMED) {
      this.uncharm(a);
      return;
    }
    a.movementFlags = (a.movementFlags & ~0x60) | (((alignment(a) - 1) & 3) << 5);
    a.objFlags |= CHARMED;
    setAlignment(a, align);
    a.worktype = WT.ASSAULT;
    this.g.say('sys', `${this.cap(this.name(a))} is charmed.`);
  }

  uncharm(a: Actor): boolean {
    if (!(a.objFlags & CHARMED)) return false;
    a.objFlags &= ~CHARMED;
    setAlignment(a, a.inParty ? ALIGN.GOOD : ((a.movementFlags & 0x60) >> 5) + 1);
    return true;
  }

  /** Asleep, and stays so this turn (one chance in ten to wake). */
  private asleep(a: Actor): boolean {
    if (!(a.statusFlags & 0x04)) return false;
    if (this.g.random(10) === 0) {
      a.statusFlags &= ~0x04;
      this.g.say('sys', `${this.cap(this.name(a))} awakens.`);
      return false;
    }
    return true;
  }

  // ---- the ways of fighting (actor_wt_*) ----

  /** Where the party stands and where its foes do, and who leads and flanks each side (actor_calculate_avg_coords). */
  private avg = { px: 0, py: 0, cx: 0, cy: 0, near: 0 };
  private frontTarget: Actor | null = null;
  private rearMaxMonster: Actor | null = null;
  private rearMinMonster: Actor | null = null;
  private rearMaxParty: Actor | null = null;
  private rearMinParty: Actor | null = null;

  private calculateAvgCoords(): void {
    const g = this.g;
    const p = g.player;
    const [fx, fy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][p.direction & 3];
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (const m of g.party) {
      const w = this.wt(m.actor);
      if (w !== WT.FLANK && w !== WT.BERSERK) {
        n++;
        sx += m.actor.x;
        sy += m.actor.y;
      }
    }
    const A = this.avg;
    if (n > 0) {
      A.px = Math.floor(sx / n);
      A.py = Math.floor(sy / n);
    } else {
      A.px = p.x;
      A.py = p.y;
    }
    n = sx = sy = 0;
    for (const a of g.actors.list) {
      if (a.objN === 0 || !a.alive || a.z !== p.z) continue;
      const al = alignment(a);
      if (al !== ALIGN.EVIL && al !== ALIGN.CHAOTIC) continue;
      if (a.worktype === WT.RETREAT && (Math.abs(a.x - p.x) > 5 || Math.abs(a.y - p.y) > 5)) continue;
      if (Math.abs(a.x - p.x) < 0x18 && Math.abs(a.y - p.y) < 0x18) {
        n++;
        sx += a.x;
        sy += a.y;
      }
    }
    A.near = n;
    this.frontTarget = this.rearMaxMonster = this.rearMinMonster = null;
    this.rearMaxParty = this.rearMinParty = null;
    if (n > 0) {
      A.cx = Math.floor((sx + n / 2) / n);
      A.cy = Math.floor((sy + n / 2) / n);
      const tx = A.cx - A.px;
      const ty = A.cy - A.py;
      let minM = 0;
      let maxM = 0;
      let minP = 0;
      let maxP = 0;
      for (const a of g.actors.list) {
        if (a.objN === 0 || !a.alive || a.z !== p.z) continue;
        const w = this.wt(a);
        if (w !== WT.FRONT && w !== WT.PLAYER) continue;
        const v = (a.x - A.px) * ty - (a.y - A.py) * tx;
        if (!a.inParty) {
          this.frontTarget ??= a;
          if (v > maxM) [maxM, this.rearMaxMonster] = [v, a];
          if (v < minM) [minM, this.rearMinMonster] = [v, a];
        } else {
          if (v > maxP) [maxP, this.rearMaxParty] = [v, a];
          if (v < minP) [minP, this.rearMinParty] = [v, a];
        }
      }
      this.rearMaxParty ??= p;
      this.rearMinParty ??= p;
    } else {
      A.cx = p.x + fx;
      A.cy = p.y + fy;
    }
    if (A.cx === A.px && A.cy === A.py) {
      A.cx += fx;
      A.cy += fy;
    }
  }

  private far(a: Actor, x: number, y: number): number {
    return Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
  }

  /** actor_move: a step one way, its points spent; returns whether it moved. */
  private moveDir(a: Actor, dx: number, dy: number): boolean {
    if (!this.canEnter(a, a.x + dx, a.y + dy)) return false;
    a.x = wrap(a.x + dx, a.z);
    a.y = wrap(a.y + dy, a.z);
    a.setDirection(dy !== 0 ? (dy > 0 ? 2 : 0) : dx > 0 ? 1 : 3);
    this.spend(a, this.stepCost(dx, dy));
    return true;
  }

  /** actor_move_towards_loc: straight, or on the diagonal, or the other way, or aside; returns whether it moved. */
  moveTowards(a: Actor, tx: number, ty: number): boolean {
    const g = this.g;
    const ddx = tx - a.x;
    const ddy = ty - a.y;
    if ((ddx === 0 && ddy === 0) || a.worktype === WT.STATIONARY) {
      this.spend(a, 5);
      return false;
    }
    const xd = ddx !== 0 ? Math.sign(ddx) : g.random(2) ? 1 : -1;
    const yd = ddy !== 0 ? Math.sign(ddy) : g.random(2) ? 1 : -1;
    let alongY: boolean;
    if (Math.abs(ddx) >= 4 || Math.abs(ddy) >= 4) alongY = this.rand(1, Math.abs(ddx) + Math.abs(ddy)) > Math.abs(ddx);
    else alongY = Math.abs(ddx) > Math.abs(ddy) ? false : Math.abs(ddx) < Math.abs(ddy) ? true : g.random(2) === 1;
    const tries: [number, number][] = alongY ? [[0, yd], [xd, yd], [xd, 0]] : [[xd, 0], [xd, yd], [0, yd]];
    for (const [sx, sy] of tries) if (this.moveDir(a, sx, sy)) return true;
    if (g.random(2) === 0 && (alongY ? this.moveDir(a, -xd, 0) : this.moveDir(a, 0, -yd))) return true;
    this.spend(a, 5);
    return false;
  }

  /** actor_move_towards_player: a party member drifts back to the leader; others wander now and then. */
  private towardsPlayer(a: Actor): void {
    const g = this.g;
    if (a.worktype !== WT.STATIONARY) {
      const p = g.player;
      if (a.inParty && a.x !== p.x && a.y !== p.y && g.random(4) === 0) {
        this.moveTowards(a, p.x, p.y);
        return;
      }
      if (g.random(8) === 0) {
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][g.random(4)];
        if (this.moveDir(a, dx, dy)) return;
      }
    }
    this.spend(a, 5);
  }

  /** actor_attack and its cost. */
  private strike(a: Actor, t: Actor, pts = 10): void {
    this.attack(a, t);
    this.spend(a, pts);
  }

  /** A square to go round to, when the line to the foe is blocked: a quarter turn either way. */
  private aside(a: Actor, t: Actor): [number, number] {
    return this.g.random(2) === 0 ? [t.y - a.y + a.x, a.y - t.x - a.x] : [a.x - t.y - a.y, t.x - a.x + a.y];
  }

  /** actor_wt_attack: the nearest foe, struck if in reach, else gone for. */
  private wtAttack(a: Actor): void {
    const t = this.findTarget(a);
    if (t) {
      const reach = this.t.range.get(this.weapon(a, t.x, t.y).objN) ?? 1;
      if (Math.abs(t.x - a.x) < 8 && Math.abs(t.y - a.y) < 8 && this.range(a, t.x, t.y) <= reach) {
        if (this.clearLine(a.x, a.y, t.x, t.y, a.z)) return this.strike(a, t);
        const [x, y] = this.aside(a, t);
        this.moveTowards(a, x, y);
        return;
      }
      if (this.wt(a) !== WT.FRONT) {
        this.moveTowards(a, t.x, t.y);
        return;
      }
      this.spend(a, 5);
      return;
    }
    if (this.wt(a) !== WT.FRONT) return this.towardsPlayer(a);
    this.spend(a, 5);
  }

  /** actor_wt_front: hold the front line between the party and its foes, and fight from it. */
  private wtFront(a: Actor): void {
    if (this.frontLine(a) === 0) return;
    if (a.inParty) return this.wtAttack(a);
    const A = this.avg;
    if (this.far(a, A.px, A.py) >= 8) this.spend(a, 5);
    else if (a !== this.frontTarget || this.g.random(8) !== 0) this.wtAttack(a);
    else this.moveTowards(a, A.px, A.py);
  }

  /** actor_wt_front_1FB6E: the square on the front line this one should hold; 1 when there is none to go to. */
  private frontLine(a: Actor): number {
    const g = this.g;
    const A = this.avg;
    const p = g.player;
    if ((A.near === 0 || !this.frontTarget) && !a.inParty) {
      this.spend(a, 5);
      return 1;
    }
    let cx: number;
    let cy: number;
    let dx: number;
    let dy: number;
    if (!a.inParty) {
      cx = A.px;
      cy = A.py;
      dx = this.frontTarget!.x - cx;
      dy = this.frontTarget!.y - cy;
    } else {
      cx = p.x;
      cy = p.y;
      dx = A.cx - cx;
      dy = A.cy - cy;
    }
    const side = (a.x - cx) * dy - (a.y - cy) * dx;
    const right = side === 0 ? g.random(2) : side > 0 ? 1 : 0;
    let sx = dy <= 0 ? -1 : 1;
    let sy = dx <= 0 ? 1 : -1;
    if (right === 0) {
      sx = -sx;
      sy = -sy;
    }
    const lead = a.inParty ? p : this.frontTarget!;
    let along = (lead.x - cx) * dx + (lead.y - cy) * dy;
    if (a.inParty) along += Math.abs(dx) + Math.abs(dy);
    const len = dx * dx + dy * dy || 1;
    let tx = Math.floor((along * dx) / len) + cx;
    let ty = Math.floor((along * dy) / len) + cy;
    const chx = p.x - 16 - ((((p.x - 16) % 8) + 8) % 8);
    const chy = p.y - 16 - ((((p.y - 16) % 8) + 8) % 8);
    for (let guard = 0; guard < 40; guard++) {
      if (tx < chx || chx + 0x27 < tx || ty < chy || chy + 0x27 < ty || (a.x === tx && a.y === ty)) return 1;
      if (!g.actors.at(tx, ty, p.z)) break;
      const v10 = (tx + sx - cx) * dx + (ty - cy) * dy;
      const vE = (tx - cx) * dx + (ty + sy - cy) * dy;
      if (Math.abs(v10 - along) >= Math.abs(vE - along)) ty += sy;
      else tx += sx;
    }
    const pts = a.moves;
    if (this.moveTowards(a, tx, ty)) {
      if (!a.inParty || (a.x === tx && a.y === ty)) return 0;
      if (A.near === 0) a.moves = pts;
      if (this.moveTowards(a, tx, ty)) return 0;
    } else a.moves = pts;
    this.wtAttack(a);
    return 0;
  }

  /** actor_wt_rear: stay behind the front line, at its middle, and strike what comes near. */
  private wtRear(a: Actor): void {
    const g = this.g;
    const A = this.avg;
    const p = g.player;
    let lo: Actor;
    let hi: Actor;
    let ax: number;
    let ay: number;
    let ddx: number;
    let ddy: number;
    if (!a.inParty) {
      if (A.near === 0) return this.spend(a, 5);
      lo = this.rearMinMonster ?? a;
      hi = this.rearMaxMonster ?? a;
      ax = A.cx;
      ay = A.cy;
      ddx = A.px - A.cx;
      ddy = A.py - A.cy;
    } else {
      if (A.near === 0) {
        this.moveTowards(a, p.x, p.y);
        return;
      }
      lo = this.rearMaxParty ?? p;
      hi = this.rearMinParty ?? p;
      ax = A.px;
      ay = A.py;
      ddx = A.cx - A.px;
      ddy = A.cy - A.py;
    }
    let front = 0x7fff;
    const al = alignment(a);
    for (const o of g.actors.list) {
      if (o.alive && o.objN !== 0 && this.wt(o) === WT.FRONT && alignment(o) === al) front = Math.min(front, (o.x - ax) * ddx + (o.y - ay) * ddy);
    }
    let v = (a.x - ax) * ddx + (a.y - ay) * ddy;
    const pts = a.moves;
    let strikeNow = false;
    if (!a.inParty || this.far(a, p.x, p.y) <= 3) {
      if (v < front) {
        v = (a.x - ax) * ddy - (a.y - ay) * ddx;
        if ((lo.x - ax) * ddy - (lo.y - ay) * ddx >= v) {
          if ((hi.x - ax) * ddy - (hi.y - ay) * ddx <= v) strikeNow = true;
          else this.moveTowards(a, a.x + ddy, a.y - ddx);
        } else this.moveTowards(a, a.x - ddy, a.y + ddx);
      } else this.moveTowards(a, a.x - ddx, a.y - ddy);
    } else this.moveTowards(a, p.x, p.y);
    if (strikeNow) {
      a.moves = pts;
      this.wtAttack(a);
    }
  }

  /** actor_wt_flank: go round the side of the foes and strike the one furthest out on it. */
  private wtFlank(a: Actor): void {
    const g = this.g;
    const A = this.avg;
    const p = g.player;
    if (A.near === 0 || (!a.inParty && this.far(a, p.x, p.y) > 7)) {
      if (a.inParty && this.far(a, p.x, p.y) > 2) {
        const pts = a.moves;
        this.moveTowards(a, p.x, p.y);
        a.moves = pts;
      }
      return this.spend(a, 5);
    }
    const al = alignment(a);
    const tx0 = A.cx - A.px;
    const ty0 = A.cy - A.py;
    const v20 = (a.x - A.px) * ty0 - (a.y - A.py) * tx0;
    const right = v20 === 0 ? g.random(2) : v20 > 0 ? 1 : 0;
    const [v10, vE] = right === 0 ? [-ty0, tx0] : [ty0, -tx0];
    let best = -0x8000;
    let target: Actor | null = null;
    for (const t of g.actors.list) {
      if (t === a || !this.standing(t) || t.z !== a.z || alignment(t) === al || !this.canTarget(a, t)) continue;
      const tw = t.worktype;
      const near5 = Math.abs(t.x - p.x) <= 5 && Math.abs(t.y - p.y) <= 5;
      if ((tw === WT.RETREAT || tw === WT.FLEE || tw === WT.MOUSE) && !near5) continue;
      if (!((Math.abs(t.x - p.x) <= 7 && Math.abs(t.y - p.y) <= 7) || (Math.abs(t.x - a.x) <= 5 && Math.abs(t.y - a.y) <= 5))) continue;
      let v = (t.x - A.px) * ty0 - (t.y - A.py) * tx0;
      if (right === 0) v = -v;
      if (v > best) {
        best = v;
        target = t;
      }
    }
    if (!target) return this.towardsPlayer(a);
    let tx = target.x;
    let ty = target.y;
    let go = false;
    const reach = this.t.range.get(this.weapon(a, tx, ty).objN) ?? 1;
    const r = this.range(a, tx, ty);
    if (r < 9 && r <= reach) {
      if (!this.clearLine(a.x, a.y, tx, ty, a.z)) {
        [tx, ty] = this.aside(a, target);
        go = true;
      } else this.strike(a, target);
    } else {
      tx += Math.sign(v10);
      ty += Math.sign(vE);
      go = true;
    }
    if (go) {
      const pts = a.moves;
      if (!this.moveTowards(a, tx, ty)) {
        a.moves = pts;
        this.wtAttack(a);
      }
    }
  }

  /** actor_wt_berserk: at the strongest foe within eight squares, whatever stands between. */
  private wtBerserk(a: Actor): void {
    const g = this.g;
    const al = alignment(a);
    let best = 0;
    let target: Actor | null = null;
    for (const t of g.actors.list) {
      if (t === a || !this.standing(t) || t.z !== a.z || this.far(t, a.x, a.y) > 8) continue;
      const ta = alignment(t);
      if (al === ALIGN.GOOD && ta !== ALIGN.EVIL) continue;
      if (al === ALIGN.EVIL && ta !== ALIGN.GOOD) continue;
      if (al === ALIGN.CHAOTIC && (ta === ALIGN.CHAOTIC || ta === ALIGN.NEUTRAL)) continue;
      if (a.inParty && t.inParty) continue;
      const sum = t.strength + t.dex + t.intelligence;
      if (sum > best) {
        best = sum;
        target = t;
      }
    }
    if (!target) {
      this.wtAttack(a);
      return this.spend(a, 5);
    }
    let tx = target.x;
    let ty = target.y;
    const reach = this.t.range.get(this.weapon(a, tx, ty).objN) ?? 1;
    const r = this.range(a, tx, ty);
    if (r < 9 && r <= reach) {
      if (this.clearLine(a.x, a.y, tx, ty, a.z)) return this.strike(a, target, 15);
      [tx, ty] = this.aside(a, target);
    }
    const pts = a.moves;
    if (!this.moveTowards(a, tx, ty)) {
      a.moves = pts;
      this.wtAttack(a);
    }
    this.spend(a, 5);
  }

  /** actor_wt_timid: retreat, flee: away from the nearest foe, striking only when cornered; the retreating mend and come back. */
  private wtTimid(a: Actor): void {
    const g = this.g;
    const p = g.player;
    if (this.far(a, p.x, p.y) > 7) {
      a.moves = 0;
      return;
    }
    const t = this.findTarget(a);
    const w = this.wt(a);
    if (!t) this.towardsPlayer(a);
    else {
      const dx = t.x - a.x;
      const dy = t.y - a.y;
      const keep = w !== WT.RETREAT ? 3 : 8;
      if (Math.abs(dx) < keep && Math.abs(dy) < keep) {
        const pts = a.moves;
        if (!this.moveTowards(a, a.x - dx, a.y - dy) && w !== WT.MOUSE && w !== WT.FLEE) {
          a.moves = pts;
          this.wtAttack(a);
        }
      } else if (alignment(a) === ALIGN.GOOD && w !== WT.FLEE && w !== WT.MOUSE) this.moveTowards(a, this.avg.px, this.avg.py);
      else this.towardsPlayer(a);
    }
    if (w === WT.RETREAT && !a.inParty && g.random(4) === 0) {
      const max = a.maxHp;
      if (a.hp < max) a.hp++;
      if (Math.floor((a.hp * 4) / Math.max(1, max)) > 0 && a.combatMode) a.worktype = a.combatMode;
    }
  }

  /** actor_wt_unfriendly: near the party, now and then turns to attack. */
  private wtUnfriendly(a: Actor): void {
    const g = this.g;
    const near = g.party.some((m) => Math.abs(m.actor.x - a.x) < 3 && Math.abs(m.actor.y - a.y) < 3);
    if (near && g.random(8) === 0) {
      a.worktype = WT.ASSAULT;
      this.wtAttack(a);
    } else if (g.random(2) === 0) this.moveTowards(a, a.x + this.rand(-1, 1) * 10, a.y + this.rand(-1, 1) * 10);
    else this.spend(a, 5);
  }

  /** actor_wt_combat_stationary: strike what comes into reach, never move. */
  private wtStationary(a: Actor): void {
    const t = this.findTarget(a);
    if (t && this.range(a, t.x, t.y) <= (this.t.range.get(this.weapon(a, t.x, t.y).objN) ?? 1) && this.clearLine(a.x, a.y, t.x, t.y, a.z)) this.strike(a, t);
    else this.spend(a, 5);
  }

  // ---- eggs ----

  /** Every egg in the world (found once). */
  private allEggs(): Obj[] {
    this.eggs ??= this.g.objects.all().filter((o) => o.objN === EGG[this.g.kind]);
    return this.eggs;
  }

  /**
   * After the party moves: on a new eight-square block, temporary actors far behind are cleared away and eggs near
   * enough hatch (ObjManager::update, EggManager::spawn_eggs). `teleport` - a new level, or a game begun - hatches
   * eggs however near.
   */
  update(teleport = false): void {
    const g = this.g;
    if (g.kind === 'se') return;
    const p = g.player;
    const block = `${p.x >> 3},${p.y >> 3},${p.z}`;
    if (block === this.block && !teleport) return;
    const levelChanged = this.block !== '' && this.block.split(',')[2] !== String(p.z);
    this.block = block;
    for (const a of g.actors.list) {
      if (a.id < this.tempFrom || a.objN === 0 || a.inParty) continue;
      if (a.z !== p.z || (!levelChanged && (Math.abs(a.x - p.x) > 19 || Math.abs(a.y - p.y) > 19))) this.free(a);
    }
    for (const egg of this.allEggs()) {
      if (egg.loc !== 'map') continue;
      const dx = Math.abs(egg.x - p.x);
      const dy = Math.abs(egg.y - p.y);
      if (egg.status & 0x40 && (egg.z !== p.z || dx >= 20 || dy >= 20)) egg.status &= ~0x40;
      if (dx < 20 && dy < 20 && egg.z === p.z && (dx > 8 || dy > 8 || teleport || levelChanged) && !(egg.status & 0x40)) {
        egg.status |= 0x40;
        this.hatch(egg, g.random(100));
      }
    }
  }

  /** EggManager::spawn_egg. */
  private hatch(egg: Obj, chance: number): void {
    const g = this.g;
    const hour = g.clock.hour;
    const day = hour >= 6 && hour < 19;
    const q = egg.quality;
    const when = q < 10 ? 'always' : q < 20 ? 'day' : q < 30 ? 'night' : 'always';
    if ((when === 'day' && !day) || (when === 'night' && day)) return;
    if (!egg.container || !(egg.qty === 100 || chance <= egg.qty)) return;
    for (const embryo of egg.container) {
      const qty = embryo.objN === OBJ.SILVER_SERPENT && g.kind === 'u6' ? 1 : Math.max(1, embryo.qty);
      for (let i = 0; i < qty; i++) {
        if ((g.kind === 'u6' && (embryo.objN >= OBJ.GIANT_RAT || embryo.objN === OBJ.CHEST)) || embryo.quality !== 0) {
          const occupied = !!g.actors.at(egg.x, egg.y, egg.z);
          const spot = occupied ? this.toss(egg.x, egg.y, egg.z) : { x: egg.x, y: egg.y };
          if (!spot) break;
          const made = this.spawn(embryo.objN, spot.x, spot.y, egg.z, q % 10, embryo.quality);
          if (made && occupied && g.random(100) > egg.qty) break;
        } else {
          const o = g.objects.create(embryo.objN, 1, 0);
          o.status |= STATUS_TEMPORARY | STATUS_OK_TO_TAKE;
          [o.x, o.y, o.z] = [egg.x, egg.y, egg.z];
          g.objects.add(o);
        }
      }
    }
  }

  /** A free square near one, for an actor to stand on. */
  private toss(x: number, y: number, z: number): { x: number; y: number } | null {
    for (let n = 0; n < 16; n++) {
      const tx = x + this.rand(-3, 3);
      const ty = y + this.rand(-3, 3);
      if (this.g.canStand(tx, ty, z)) return { x: wrap(tx, z), y: wrap(ty, z) };
    }
    return null;
  }

  /** Make a monster (create_temp_actor, actor_init): its numbers, its alignment, what it carries. */
  spawn(objN: number, x: number, y: number, z: number, align: number, worktype: number): Actor | null {
    const g = this.g;
    const a = g.actors.list.find((t) => t.id >= this.tempFrom && t.objN === 0);
    if (!a) return null;
    for (const o of [...g.objects.inventories[a.id]]) g.objects.unlink(o);
    Object.assign(a, { objN, frameN: 0, x, y, z, objFlags: 0, statusFlags: 0, talkFlags: 0, movementFlags: 0, visible: true, sched: [], schedPos: -1, dest: null });
    const base = this.t.monsters.get(objN);
    if (base) {
      a.strength = randomise(g, base.str);
      a.dex = randomise(g, base.dex);
      a.intelligence = randomise(g, base.int);
      a.hp = randomise(g, base.hp);
      a.level = Math.floor((a.hp + 29) / 30);
      setAlignment(a, base.align);
    } else {
      Object.assign(a, { strength: 10, dex: 10, intelligence: 10, hp: 30, level: 1 });
      setAlignment(a, ALIGN.NEUTRAL);
    }
    if (align !== ALIGN.DEFAULT) setAlignment(a, align);
    a.worktype = worktype;
    a.combatMode = WT.ASSAULT; // actor_init: what a creature goes back to once it has mended
    a.exp = 100;
    a.magic = 0;
    a.setDirection(2);
    if (base) this.equip(a, base);
    return a;
  }

  private give(a: Actor, objN: number, qty: number, readied = false): Obj {
    const o = this.g.objects.create(objN, qty, 0);
    const kept = this.g.objects.toInventory(o, a.id);
    if (readied && kept === o) o.loc = 'readied';
    return kept;
  }

  /** A wisp's own magic: it vanishes and comes again beside the party (toss_actor). */
  private wispTeleport(a: Actor): boolean {
    const p = this.g.player;
    for (let i = 0; i < 16; i++) {
      const x = p.x + this.rand(-3, 3);
      const y = p.y + this.rand(-3, 3);
      if (!this.g.canStand(x, y, p.z)) continue;
      [a.x, a.y, a.z] = [x, y, p.z];
      this.g.say('sys', 'Wisp teleports!');
      return true;
    }
    return true;
  }

  /** actor_init's spells, weapons, armour and treasure. */
  private equip(a: Actor, base: (typeof MONSTERS extends Map<number, infer T> ? T : never)): void {
    const g = this.g;
    for (const v of base.spells) {
      const k = g.objects.create(CHARGE, 1, v);
      k.status |= 0x38;
      g.objects.toInventory(k, a.id);
    }
    const w = base.weapons[0];
    if (w !== undefined) {
      this.give(a, w, w >= 36 && w <= 38 ? this.rand(6, 12) : 0, true);
      if (w === 41 || w === 54) this.give(a, ARROW, this.rand(12, 24));
      if (w === 42 || w === 50) this.give(a, BOLT, this.rand(12, 24));
    }
    let chance = 2;
    for (const v of base.armour) {
      if (this.rand(1, chance) === 1) this.give(a, v, 0, true);
      chance *= 2;
    }
    chance = 2;
    for (const v of base.treasure) {
      if (this.rand(1, chance) === 1) {
        if (v === OBJ.CHEST) {
          const chest = this.give(a, OBJ.CHEST, 0);
          chest.frameN = 1;
          chest.container ??= [];
          if (g.random(4) !== 0) g.objects.toContainer(g.objects.create(OBJ.GOLD, this.rand(1, 100), 0), chest);
          if (g.random(4) !== 0) g.objects.toContainer(g.objects.create(FOOD[g.random(3)], this.rand(1, 10), 0), chest);
          if (g.random(4) === 0) g.objects.toContainer(g.objects.create(OBJ.TORCH, this.rand(1, 6), 0), chest);
          if (g.random(11) === 0) g.objects.toContainer(g.objects.create(OBJ.GEM, this.rand(1, 4), 0), chest);
        } else if (v === 58) {
          if (g.random(4) !== 0 && a.objN !== 362) this.give(a, OBJ.GOLD, this.rand(1, 100));
          if (g.random(4) === 0) this.give(a, FOOD[g.random(3)], this.rand(1, 100));
        } else if (v === OBJ.GOLD) this.give(a, OBJ.GOLD, this.rand(1, 30) + this.rand(1, 30));
        else this.give(a, v, 1);
      }
      chance *= 2;
    }
  }
}
