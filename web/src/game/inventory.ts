/** inventory.ts - what an actor carries: finding, counting, giving and taking away (from Nuvie's Actor.cpp). */
import { Obj, type Objects } from './objects.ts';

/** Everything an actor carries, with what is inside their containers. */
export function* carried(objects: Objects, actor: number): Generator<Obj> {
  function* walk(l: Obj[]): Generator<Obj> {
    for (const o of l) {
      yield o;
      if (o.container) yield* walk(o.container);
    }
  }
  yield* walk(objects.inventories[actor] ?? []);
}

export function invFind(objects: Objects, actor: number, objN: number, quality = 0, matchQuality = false): Obj | null {
  for (const o of carried(objects, actor)) if (o.objN === objN && (!matchQuality || o.quality === quality)) return o;
  return null;
}

export function invCount(objects: Objects, actor: number, objN: number): number {
  let n = 0;
  for (const o of carried(objects, actor)) if (o.objN === objN) n += objects.isStackable(o) ? o.qty : 1;
  return n;
}

export function invNew(objects: Objects, actor: number, objN: number, qty: number, quality: number): Obj {
  const o = objects.create(objN, qty, quality);
  if (!objects.isStackable(o)) o.qty = 0;
  else if (o.qty === 0) o.qty = 1;
  return objects.toInventory(o, actor);
}

/** Take `qty` of a thing away from an actor; returns how many went. */
export function invDelete(objects: Objects, actor: number, objN: number, qty: number, quality: number): number {
  let gone = 0;
  qty = Math.max(1, qty);
  while (gone < qty) {
    const o = invFind(objects, actor, objN, quality, quality !== 0);
    if (!o) break;
    if (objects.isStackable(o) && o.qty > qty - gone) {
      o.qty -= qty - gone;
      gone = qty;
    } else {
      gone += objects.isStackable(o) ? Math.max(1, o.qty) : 1;
      objects.unlink(o);
    }
  }
  return gone;
}

export function invWeight(objects: Objects, actor: number): number {
  let w = 0;
  for (const o of objects.inventories[actor] ?? []) w += objects.weightOf(o);
  return w;
}
