/**
 * kind.ts - which of Nuvie's three games a set of files is, and what differs between them that the engine needs to
 * know (from the game_type branches through Nuvie: TileManager, ObjManager, ActorManager, Converse, GameClock,
 * SaveGame, the portraits, and the games' own Lua usecode).
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { STACKABLE_MD, STACKABLE_SE } from './u6tables.ts';

/** Ultima 6, Martian Dreams or Savage Empire. */
export type Kind = 'u6' | 'md' | 'se';

export const KIND_NAMES: Record<Kind, string> = { u6: 'Ultima VI', md: 'Martian Dreams', se: 'The Savage Empire' };

export function detectKind(files: GameFiles): Kind {
  if (files.has('converse.a')) return 'u6';
  if (files.has('mdpal')) return 'md';
  if (files.has('sepal')) return 'se';
  // A copy with no talk files is likely the demo world, which is laid out as Ultima 6.
  return 'u6';
}

/** Where things are kept in the objlist, where the games differ (Objlist.h, ActorManager::load). */
export interface Offsets {
  gametime: number;
  oldObj: number;
  combatMode: number;
  magic: number;
  talkFlags: number;
  movementFlags: number;
  movementPoints: number;
  gender: number;
}

export const OFFSETS: Record<Kind, Offsets> = {
  u6: { gametime: 0x1bf3, oldObj: 0x15f1, combatMode: 0x12f1, magic: 0x13f1, talkFlags: 0x17f1, movementFlags: 0x19f1, movementPoints: 0x14f1, gender: 0x1c71 },
  md: { gametime: 0x1cf3, oldObj: 0x16f1, combatMode: 0x13f1, magic: 0x12f1, talkFlags: 0x18f1, movementFlags: 0x1af1, movementPoints: 0x15f1, gender: 0x1d27 },
  se: { gametime: 0x1cf3, oldObj: 0x16f1, combatMode: 0x13f1, magic: 0x12f1, talkFlags: 0x18f1, movementFlags: 0x19f1, movementPoints: 0x14f1, gender: 0x1d27 },
};

/** The egg - an invisible marker that spawns things - in each game. */
export const EGG: Record<Kind, number> = { u6: 335, md: 466, se: 230 };

/** What stacks, for the two games that list it (Ultima 6's is in objects.ts). */
export const STACKABLE: Record<'md' | 'se', ReadonlySet<number>> = { md: new Set(STACKABLE_MD), se: new Set(STACKABLE_SE) };

/** Martian Dreams' doors (usecode.lua use_door): frame bit 2 is shut, quality bit 7 stuck with rust. */
export const MD_DOORS: ReadonlySet<number> = new Set([152, 222, 421]);
/** Martian Dreams' containers (usecode.lua use_container). */
export const MD_CONTAINERS: ReadonlySet<number> = new Set([86, 87, 104, 284]);

/** The palette file. */
export const PALETTE: Record<Kind, string> = { u6: 'u6pal', md: 'mdpal', se: 'sepal' };

/**
 * Martian Dreams' face for an actor (actor.lua get_portrait_number); -1 for none. Its item in mdfaces.lzc read as a
 * library whose first four bytes are its length (Nuvie reads them as an item, so adds one).
 */
export function mdPortrait(actorNum: number, objFlags: number, talkFlags: number, female: boolean): number {
  let idx = actorNum;
  if (idx >= 0xa && idx <= 0xf) idx = 0x51;
  if (idx >= 0xbf) return -1;
  if (idx <= 1) idx = female ? 0 : 1;
  else if (idx === 6 && talkFlags & 2) idx = 0x16;
  else if (objFlags & 1) idx = female ? 0x73 : 0x72;
  else if (idx === 0x21 && !(talkFlags & 4)) idx = 0x61;
  else if (idx === 0x15 || (idx >= 0x47 && idx <= 0x4a) || idx === 0x4e) idx = 0x14;
  else if (idx >= 0x4b && idx <= 0x4d) idx = 0x16;
  else if (idx === 0x1e) idx = 0x18;
  else if (idx === 0x46) idx = 0x40;
  else if (idx >= 0x50 && idx <= 0x57) idx -= 0x26;
  else if (idx === 0x5e) idx = 0x6;
  else if (idx === 0x68 || idx === 0x77 || idx === 0x78) idx = 0x67;
  else if (idx === 0x69) idx = 0x19;
  else if (idx === 0x6d) idx = 0x2;
  return idx;
}
