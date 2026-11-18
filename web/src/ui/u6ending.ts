/**
 * u6ending.ts - Ultima VI's ending in motion, as data/scripts/u6/ending.lua plays it in the Codex's shrine: the red
 * gates rising from the floor (the stones' colours turning), the kings and their lenses, the wall fading to a field of
 * stars and the Codex wavering into view, then opening.
 *
 * The script runs as one: to show a page it runs through the pages before it without drawing, so each page begins
 * where the last left off; where the script waits for a key on that page, the scene goes on (stars, turning colours).
 */
import type { Shape } from '../files/shape.ts';
import { fromGen, starField, type Frame, type Scene, type Sprite } from './anim.ts';

const END = 'end.shp';

export function u6EndingScene(page: number): Scene {
  // The sprites, in the order the script makes them (and so draws them).
  const pic = (grp: number, x: number, y: number, more: Partial<Sprite> = {}): Sprite & { visible: boolean } => ({ lib: END, grp, pic: 0, x, y, visible: true, ...more });
  const bg = pic(7, 0, 0);
  const stars = { ...pic(0, 106, 0, { clipRect: [106, 0, 107, 84] }), visible: false };
  const codex = { ...pic(1, 0x97, 0x1d), visible: false };
  const codexOpened = { ...pic(2, 0x85, 0x17), visible: false };
  const wallSeen = { ...pic(0, 106, 0, { key0: true }), visible: false };
  const wall = pic(4, 106, 0);
  const gate = pic(3, 9, 0x7d, { clipRect: [0, 0, 320, 0x7e] });
  const chars = { ...pic(8, 0, 0, { clipRect: [0, 0, 160, 200] }), visible: false };
  const chars1 = { ...pic(9, 0, 0, { clipRect: [0, 0, 160, 200] }), visible: false };
  const blueLens = pic(5, 0x49, 0x57);
  const redLens = pic(6, 0xda, 0x57);
  const all = [bg, stars, codex, codexOpened, wallSeen, wall, gate, chars, chars1, blueLens, redLens];

  const field = starField(114, 94);
  let turns = 0;
  let count = 0;
  const turnStones = (): void => {
    if (count === 4) {
      turns++;
      count = 0;
    } else count++;
  };

  let p = 0;
  const frame = (): Frame => ({
    ms: 25,
    rot: [16, 16, turns],
    sprites: all.filter((s) => s.visible && (s.opacity ?? 1) > 0),
  });
  /** A canvas update, shown only on the page being played. */
  function* update(rotate: boolean, starry: boolean): Generator<Frame> {
    if (p !== page) return;
    if (starry) stars.shape = field() as Shape;
    if (rotate) turnStones();
    yield frame();
  }
  /** The script's wait for a key: on the page being played the scene goes on; before it, the page ends here. */
  function* wait(rotate: boolean, starry: boolean): Generator<Frame> {
    if (p === page) for (;;) yield* update(rotate, starry);
    p++;
  }
  /** As wait, but only for a while (where the script waits within what is here one page). */
  function* pause(n: number, rotate: boolean, starry: boolean): Generator<Frame> {
    for (let i = 0; i < n; i++) yield* update(rotate, starry);
  }
  function* fade(s: Sprite, from: number, to: number, starry: boolean): Generator<Frame> {
    const step = from < to ? 3 : -3;
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
      s.opacity = i / 0xff;
      yield* update(false, starry);
    }
    s.opacity = to / 0xff;
  }
  function* rise(from: number, to: number, starry: boolean): Generator<Frame> {
    const step = from < to ? 1 : -1;
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
      gate.y = i;
      yield* update(true, starry);
    }
  }

  function* script(): Generator<Frame> {
    stars.shape = field() as Shape;
    // A glowing portal springs from the floor!
    yield* rise(0x7d, -0xc, false);
    yield* wait(true, false);
    // Lord British and Nystul.
    chars.visible = true;
    yield* wait(true, false);
    // "...WHAT HAST THOU DONE WITH IT?"
    yield* rise(-0xc, 0x7d, false);
    gate.visible = false;
    yield* wait(false, false);
    // The concave lens passes to the King.
    yield* pause(60, false, false);
    blueLens.visible = false;
    chars.clipRect = [160, 0, 160, 200];
    chars.visible = false;
    chars1.visible = true;
    yield* wait(false, false);
    // The wall fades to stars, and the Codex wavers into view.
    stars.visible = true;
    wallSeen.visible = true;
    yield* fade(wall, 0xff, 0, true);
    codex.opacity = 0;
    codex.visible = true;
    yield* fade(codex, 0, 0xff, true);
    yield* wait(false, true);
    // Another red gate.
    gate.x = 0xe6;
    gate.y = 0x7d;
    gate.visible = true;
    yield* rise(0x7d, -0xc, true);
    yield* wait(true, true);
    // King Draxinusom. "Thy time hath come, Thief."
    chars.visible = true;
    yield* pause(100, true, true);
    yield* rise(-0xc, 0x7d, true);
    gate.visible = false;
    yield* wait(false, true);
    // The convex lens.
    yield* wait(false, true);
    // Both lenses raised.
    chars.visible = false;
    chars1.clipRect = [0, 0, 320, 200];
    redLens.visible = false;
    yield* wait(false, true);
    // The book opens.
    codexOpened.opacity = 0;
    codexOpened.visible = true;
    yield* fade(codexOpened, 0, 0xff, true);
    codex.visible = false;
    yield* wait(false, true);
    // Its wisdom gleaned: the Codex fades, and the wall returns.
    yield* pause(120, false, true);
    yield* fade(codexOpened, 0xff, 0, true);
    codexOpened.visible = false;
    wall.opacity = 0;
    yield* fade(wall, 0, 0xff, true);
    stars.visible = false;
    yield* wait(false, false);
  }
  return fromGen(script());
}
