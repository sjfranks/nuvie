/**
 * seusecode.ts - what using things does in Savage Empire, as far as Nuvie's data/scripts/se/usecode.lua goes: corn
 * from its stalk, clay with a digging stick, and a soft pot shaped from clay. (Its other uses are commented out there.)
 */
import type { Actor } from './actors.ts';
import type { Game } from './game.ts';
import type { Obj } from './objects.ts';

const TEXT: Record<string, string> = {
  OUT_OF_RANGE: 'Out of Range!',
  CARRY_TOO_MUCH: 'You are carrying too much already.',
  GOT_CORN: 'You got some corn from the plant.',
  USE_CLAY: 'You shaped a small, soft pot from the clay.',
  USE_DIGGING_STICK: 'You get some clay.',
};

const CORN_STALK = 61;
const CORN = 108;
const DIGGING_STICK = 131;
const SOFT_CLAY_POT = 132;
const CLAY = 192;

export class SeUseCode {
  constructor(private readonly g: Game) {}

  handles(o: Obj): boolean {
    return [CORN_STALK, DIGGING_STICK, CLAY].includes(o.objN);
  }

  use(o: Obj, a: Actor = this.g.player): void {
    const g = this.g;
    // check_can_reach: beside it, or carried by one of the party.
    const user = o.loc === 'map' ? (Math.max(Math.abs(o.x - a.x), Math.abs(o.y - a.y)) <= 1 && o.z === a.z ? a : null) : a;
    if (!user) return this.say('OUT_OF_RANGE');
    if (o.objN === CORN_STALK) {
      if (this.give(user, CORN)) this.say('GOT_CORN');
    } else if (o.objN === DIGGING_STICK) {
      if (this.give(user, CLAY)) this.say('USE_DIGGING_STICK');
    } else if (o.objN === CLAY) {
      if (o.qty > 1) o.qty--;
      else g.objects.unlink(o);
      if (this.give(user, SOFT_CLAY_POT, false)) this.say('USE_CLAY');
    }
    g.onChange();
  }

  private give(a: Actor, objN: number, speak = true): boolean {
    const g = this.g;
    const o = g.objects.create(objN, 1, 0);
    if (g.invRoom(a.id) < g.objects.weightOf(o)) {
      if (speak) this.say('CARRY_TOO_MUCH');
      return false;
    }
    g.objects.toInventory(o, a.id);
    return true;
  }

  private say(key: string): void {
    this.g.say('sys', TEXT[key] ?? key);
  }
}
