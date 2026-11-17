/**
 * combat.ts - fighting, and the monsters that come to fight: Ultima 6's rules as Nuvie's Lua has them
 * (data/scripts/u6/actor.lua: actor_attack, actor_combat_hit_check, actor_take_hit, actor_hit, actor_dead,
 * actor_find_target, actor_wt_attack, actor_init, actor_avatar_death) and its eggs (EggManager.cpp spawn_eggs and
 * spawn_egg, ActorManager.cpp create_temp_actor and the clean-up of temporary actors).
 *
 * Simplified where the original's detail would not show on a phone: every actor in a fight acts once a turn rather
 * than by movement points; monsters that cast spells fight with their hands; thrown weapons are not lost.
 */
import type { Actor } from './actors.ts';
import { STATUS_DEAD, STATUS_IN_PARTY } from './actors.ts';
import type { Game } from './game.ts';
import { carried, invCount, invDelete } from './inventory.ts';
import { wrap } from './map.ts';
import { STATUS_OK_TO_TAKE, STATUS_TEMPORARY, type Obj } from './objects.ts';
import { ARMOUR, MONSTERS, PROJECTILE, WEAPON_DMG, WEAPON_RANGE } from './u6combat.ts';
import { ACTOR_TYPES, OBJ } from './u6tables.ts';

export const ALIGN = { DEFAULT: 0, NEUTRAL: 1, EVIL: 2, GOOD: 3, CHAOTIC: 4 } as const;
const WT = {
  NOTHING: 0x0, FRONT: 0x3, REAR: 0x4, FLANK: 0x5, BERSERK: 0x6, RETREAT: 0x7, ASSAULT: 0x8, FLEE: 0x9, LIKE: 0xa,
  UNFRIENDLY: 0xb, STATIONARY: 0xe, UNK_13: 0x13, WALK_TO_LOCATION: 0x86, BRAWLING: 0x99, MOUSE: 0x9a, ATTACK_PARTY: 0x9b,
} as const;
/** The worktypes that fight. */
const FIGHTING: ReadonlySet<number> = new Set([
  WT.FRONT, WT.REAR, WT.FLANK, WT.BERSERK, WT.RETREAT, WT.ASSAULT, WT.FLEE, WT.UNFRIENDLY, WT.STATIONARY, WT.ATTACK_PARTY,
]);
/** Actors from here on are made as they are needed (Ultima 6's temp_actor_offset). */
const TEMP_FROM = 203;
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

  constructor(private readonly g: Game) {}

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
    return WEAPON_DMG.get(objN) ?? MONSTERS.get(objN)?.dmg;
  }

  /** The hardest-hitting thing an actor has that reaches (actor_get_weapon); party members use what they have readied. */
  weapon(a: Actor, x: number, y: number): Weapon {
    const reach = this.range(a, x, y);
    let best: Weapon = { objN: a.objN, obj: null };
    let max = 0;
    for (const o of carried(this.g.objects, a.id)) {
      if (a.inParty && o.loc !== 'readied') continue;
      if (o.parentObj) continue;
      const dmg = WEAPON_DMG.get(o.objN);
      if (dmg !== undefined && dmg > max && (WEAPON_RANGE.get(o.objN) ?? 1) >= reach && !this.outOfAmmo(a, o.objN)) {
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
      if (WEAPON_DMG.has(o.objN) && !this.outOfAmmo(a, o.objN)) r = Math.max(r, WEAPON_RANGE.get(o.objN) ?? 1);
    }
    return r;
  }

  private outOfAmmo(a: Actor, objN: number): boolean {
    if (objN === 41 || objN === 54) return invCount(this.g.objects, a.id, ARROW) === 0;
    if (objN === 42 || objN === 50) return invCount(this.g.objects, a.id, BOLT) === 0;
    return false;
  }

  private ac(a: Actor): number {
    let ac = 0;
    for (const o of this.g.objects.inventories[a.id] ?? []) if (o.loc === 'readied') ac += ARMOUR.get(o.objN) ?? 0;
    if (a.objFlags & CURSED) ac -= 3;
    if (a.statusFlags & PROTECTED) ac += 3;
    return ac;
  }

  /** actor_combat_hit_check: dexterity (or strength, for a club) against the foe's dexterity. */
  private hits(att: Actor, foe: Actor, w: Weapon): boolean {
    if (w.objN === 48) return true; // the glass sword
    const useStr = w.obj ? [4, 34, 39, 44].includes(w.objN) : MONSTERS.get(att.objN)?.useStr === 1;
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
    if (this.range(att, foe.x, foe.y) > (WEAPON_RANGE.get(w.objN) ?? 1)) return false;
    att.setDirection(Math.abs(foe.x - att.x) <= Math.abs(foe.y - att.y) ? (foe.y >= att.y ? 2 : 0) : foe.x >= att.x ? 1 : 3);
    const far = Math.abs(foe.x - att.x) > 1 || Math.abs(foe.y - att.y) > 1;
    const ranged = w.objN !== 40 && w.objN !== 47 && (far || PROJECTILE.has(w.objN));
    let hit = this.hits(att, foe, w);
    if (ranged) {
      if (!this.clearLine(att.x, att.y, foe.x, foe.y, att.z)) hit = false;
      if (w.objN === 41 || w.objN === 54) invDelete(this.g.objects, att.id, ARROW, 1, 0);
      if (w.objN === 42 || w.objN === 50) invDelete(this.g.objects, att.id, BOLT, 1, 0);
    }
    const shot = ranged && PROJECTILE.has(w.objN) ? { tile: PROJECTILE.get(w.objN)!, fromX: att.x, fromY: att.y } : undefined;
    if (!hit) {
      this.flash(foe.x, foe.y, foe.z, 'miss', shot);
      if (att === this.g.player || foe === this.g.player || att.inParty) this.g.say('sys', `${this.cap(this.name(att))} misses.`);
      return true;
    }
    let dmg = this.dmgOf(w.objN) ?? 1;
    // Some can only be half hurt, but for the glass sword, the triple crossbow and the magic bow.
    if (MONSTERS.get(foe.objN)?.halfDmg === 1 && w.objN !== 48 && w.objN !== 50 && w.objN !== 54) dmg = Math.floor((dmg + 1) / 2);
    this.flash(foe.x, foe.y, foe.z, 'hit', shot);
    this.takeHit(att, foe, dmg);
    if (w.objN === 48 && w.obj) {
      this.g.say('sys', 'Thy sword hath shattered!');
      this.g.objects.unlink(w.obj);
    }
    return true;
  }

  /** actor_take_hit: a roll up to the weapon's damage, less a roll up to the defender's armour. */
  private takeHit(att: Actor, def: Actor, max: number): void {
    let dmg = max === -1 ? 1 : max > 1 && max !== 255 ? this.rand(1, max) : max;
    const ac = this.ac(def);
    if (dmg !== 255 && ac > 0) dmg -= this.rand(1, ac);
    const who = this.cap(this.name(def));
    if (dmg > 0) def.statusFlags &= ~0x04;
    if (dmg > 0) att.exp += this.hit(def, dmg);
    else this.g.say('sys', `${who} grazed.`);
    if (def.hp > 0 || dmg <= 0) {
      if (MONSTERS.get(att.objN)?.poison === 1 && this.g.random(4) === 0 && !(def.statusFlags & 0x08)) {
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

  /** Damage that does not miss and no armour turns (spells): as a blow, with its messages. */
  hurt(att: Actor, def: Actor, dmg: number): void {
    const who = this.cap(this.name(def));
    def.statusFlags &= ~0x04; // the hurt wake
    this.flash(def.x, def.y, def.z, 'hit');
    att.exp += this.hit(def, dmg);
    if (def.hp > 0) {
      this.hitMessage(def);
      if (!FIGHTING.has(def.worktype) && !def.inParty) {
        def.worktype = WT.ASSAULT;
        if (att.inParty) setAlignment(def, ALIGN.CHAOTIC);
      }
    } else if (def.id !== 1) this.g.say('sys', `${who} killed!`);
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
    const base = MONSTERS.get(def.objN);
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
    const base = MONSTERS.get(a.objN);
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
    const [deadObj, deadFrame] = DEAD.get(a.objN) ?? [0, 0];
    const inv = [...(g.objects.inventories[a.id] ?? [])];
    let into: Obj | null = null;
    if (deadObj !== 0 && deadObj !== BLOOD) {
      const body = g.objects.create(deadObj, 0, a.id);
      body.frameN = deadFrame === 255 ? a.frameN : deadFrame;
      body.status = STATUS_OK_TO_TAKE | (a.id >= TEMP_FROM ? STATUS_TEMPORARY : 0);
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
    if (a.id >= TEMP_FROM) this.free(a);
  }

  /** actor_avatar_death: darkness, KAL LOR, and the party wakes healed in Lord British's castle. */
  private avatarDeath(): void {
    const g = this.g;
    g.say('sys', 'An unending darkness engulfs thee...');
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
    for (const a of g.actors.list) if (a.id < TEMP_FROM && a.worktype === WT.ATTACK_PARTY) a.worktype = WT.WALK_TO_LOCATION;
    g.relocate(0x133, 0x160, 0);
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
    if (g.actors.at(x, y, a.z)) return false;
    const mt = MOVETYPE.get(a.objN) ?? 1;
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

  // ---- a round ----

  /** Everyone in a fight near the party acts once (actor_update_all, much simplified). */
  round(): void {
    const g = this.g;
    if (g.kind !== 'u6') return;
    const p = g.player;
    for (const a of g.actors.list) {
      if (a.z === p.z && a.objN !== 0 && a.alive && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 16) this.updateFlags(a);
    }
    if (this.timeStop > 0) {
      this.timeStop--;
      return;
    }
    for (const a of g.actors.list) {
      if (!g.party.length || g.player !== p) return; // the Avatar fell
      if (a.inParty || !this.standing(a) || a.z !== p.z || !FIGHTING.has(a.worktype)) continue;
      if (this.asleep(a) || a.statusFlags & PARALYZED) continue;
      if (Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) > 16) continue;
      this.act(a);
    }
    // The party fights by itself, but for the one the player moves.
    if (this.fighting) {
      for (const m of g.party.slice(1)) {
        const a = m.actor;
        if (!this.standing(a) || a.z !== p.z || this.asleep(a) || a.statusFlags & PARALYZED) continue;
        const t = this.findTarget(a);
        if (!t) continue;
        if (this.range(a, t.x, t.y) <= this.reach(a) && this.clearLine(a.x, a.y, t.x, t.y, a.z)) this.attack(a, t);
        else if (Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) < 6) this.step(a, t.x, t.y);
        else this.step(a, p.x, p.y);
      }
    }
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.flashes = this.flashes.filter((f) => f.until > now - 2000);
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

  private act(a: Actor): void {
    const g = this.g;
    switch (a.worktype) {
      case WT.UNFRIENDLY: {
        // actor_wt_unfriendly: near the party, now and then turns to attack.
        const near = g.party.some((m) => Math.abs(m.actor.x - a.x) < 3 && Math.abs(m.actor.y - a.y) < 3);
        if (near && g.random(8) === 0) {
          a.worktype = WT.ASSAULT;
          this.fight(a);
        } else if (g.random(2) === 0) this.step(a, a.x + this.rand(-1, 1) * 10, a.y + this.rand(-1, 1) * 10);
        return;
      }
      case WT.RETREAT:
      case WT.FLEE: {
        const t = this.findTarget(a);
        if (t && Math.max(Math.abs(t.x - a.x), Math.abs(t.y - a.y)) <= 1 && g.random(3) === 0) this.attack(a, t);
        else if (t) this.step(a, t.x, t.y, true);
        return;
      }
      default:
        this.fight(a);
    }
  }

  /** actor_wt_attack: at the nearest foe, or towards them, or about. */
  private fight(a: Actor): void {
    const t = this.findTarget(a);
    if (!t) {
      if (a.worktype !== WT.STATIONARY && this.g.random(8) === 0) {
        const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][this.g.random(4)];
        this.step(a, a.x + dx, a.y + dy);
      }
      return;
    }
    const w = this.weapon(a, t.x, t.y);
    if (this.range(a, t.x, t.y) <= (WEAPON_RANGE.get(w.objN) ?? 1) && this.clearLine(a.x, a.y, t.x, t.y, a.z)) {
      this.attack(a, t);
      return;
    }
    if (a.worktype !== WT.STATIONARY && a.worktype !== WT.FRONT) this.step(a, t.x, t.y);
    else if (a.worktype === WT.FRONT) this.step(a, t.x, t.y);
  }

  // ---- eggs ----

  /** Every egg in the world (found once). */
  private allEggs(): Obj[] {
    this.eggs ??= this.g.objects.all().filter((o) => o.objN === OBJ.EGG);
    return this.eggs;
  }

  /**
   * After the party moves: on a new eight-square block, temporary actors far behind are cleared away and eggs near
   * enough hatch (ObjManager::update, EggManager::spawn_eggs). `teleport` - a new level, or a game begun - hatches
   * eggs however near.
   */
  update(teleport = false): void {
    const g = this.g;
    if (g.kind !== 'u6') return;
    const p = g.player;
    const block = `${p.x >> 3},${p.y >> 3},${p.z}`;
    if (block === this.block && !teleport) return;
    const levelChanged = this.block !== '' && this.block.split(',')[2] !== String(p.z);
    this.block = block;
    for (const a of g.actors.list) {
      if (a.id < TEMP_FROM || a.objN === 0 || a.inParty) continue;
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
      const qty = embryo.objN === OBJ.SILVER_SERPENT ? 1 : Math.max(1, embryo.qty);
      for (let i = 0; i < qty; i++) {
        if (embryo.objN >= OBJ.GIANT_RAT || embryo.objN === OBJ.CHEST || embryo.quality !== 0) {
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
    const a = g.actors.list.find((t) => t.id >= TEMP_FROM && t.objN === 0);
    if (!a) return null;
    for (const o of [...g.objects.inventories[a.id]]) g.objects.unlink(o);
    Object.assign(a, { objN, frameN: 0, x, y, z, objFlags: 0, statusFlags: 0, talkFlags: 0, movementFlags: 0, visible: true, sched: [], schedPos: -1, dest: null });
    const base = MONSTERS.get(objN);
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

  /** actor_init's weapons, armour and treasure. */
  private equip(a: Actor, base: (typeof MONSTERS extends Map<number, infer T> ? T : never)): void {
    const g = this.g;
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
