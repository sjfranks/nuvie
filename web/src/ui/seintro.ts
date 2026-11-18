/**
 * seintro.ts - Savage Empire's title in motion, as data/scripts/se/intro.lua's intro_sequence plays it: the two
 * logos, then the title rising over the jungle, and the jungle sliding by in layers (far, middle, near at one, two and
 * three steps a frame) as the credits come and go.
 */
import { fromGen, poll, type Frame, type Scene, type Sprite } from './anim.ts';

type S = Sprite & { visible: boolean };

export function seTitleScene(): Scene {
  const sprites: S[] = [];
  const mk = (grp: number, pic: number, x: number, y: number): S => {
    const s: S = { lib: 'intro.lzc', grp, pic, x, y, visible: true };
    sprites.push(s);
    return s;
  };
  let screen = 1;
  const frame = (ms: number): Frame => ({ ms, opacity: screen, sprites: sprites.filter((s) => s.visible && (s.opacity ?? 1) > 0) });
  function* fade(to: number): Generator<Frame> {
    for (let i = 0; i <= 0xff; i += 3) {
      screen = to ? i / 0xff : 1 - i / 0xff;
      yield frame(25);
    }
    screen = to;
  }
  function* script(): Generator<Frame> {
    const logo = mk(0, 0, 0, 0);
    screen = 0;
    yield* fade(1);
    yield frame(poll(175));
    yield* fade(0);
    logo.pic = 1;
    yield* fade(1);
    yield frame(poll(175));
    yield* fade(0);
    logo.visible = false;
    // The jungle, in layers, and the title rising over it.
    const far = [mk(1, 0, 0, 0), mk(1, 1, 320, 0)];
    const mid = [mk(1, 2, 0, 0), mk(1, 3, 320, 0), mk(1, 4, 640, 0)];
    const title = mk(2, 0, 0, 240);
    const near = [mk(1, 5, 0, 0), mk(1, 6, 320, 0), mk(1, 7, 640, 0)];
    screen = 1;
    for (let i = 0; i < 240; i += 3) {
      title.y = Math.max(0, title.y - 3);
      yield frame(poll(1) + 25);
    }
    yield frame(poll(30));
    for (let i = 0xff; i >= 0; i -= 4) {
      title.opacity = i / 0xff;
      yield frame(25);
    }
    title.visible = false;
    // The credits, shown and hidden in turn as the jungle slides by.
    let credit = 1;
    let shown: S | null = mk(2, credit, 0, 0);
    let time = 15;
    let showing = true;
    for (let i = 0; i < 636; i += 3) {
      for (const s of far) s.x -= 1;
      for (const s of mid) s.x -= 2;
      for (const s of near) s.x -= 3;
      if (--time === 0) {
        if (showing) {
          showing = false;
          if (shown) shown.visible = false;
          time = 20;
        } else {
          showing = true;
          credit++;
          if (credit < 7) {
            shown = mk(2, credit, 0, 0);
            time = 15;
          }
        }
      }
      yield frame(poll(8) + 25);
    }
  }
  return fromGen(script());
}
