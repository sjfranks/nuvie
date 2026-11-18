/**
 * mdintro.ts - Martian Dreams' introduction in motion, as data/scripts/md/intro.lua's run_introduction plays it: one
 * film on a clock, its words changing as they come (scenetxt.lzc, each speaker in a colour of the palette). Spector's
 * study and the letter, the map and the hike, Spector's lab now (the moongate rising, the two stepping through), and
 * Tesla's lab in 1895 (sparks, the gate, Freud and his blood, Garrett and Nellie).
 */
import type { Shape } from '../files/shape.ts';
import { fromGen, poll, type Frame, type Scene, type Sprite } from './anim.ts';

type S = Sprite & { visible: boolean };

export function mdIntroScene(text: (item: number) => string[], bgShape: () => Shape | null): Scene {
  let sprites: S[] = [];
  let lib = 'scene1.lzc';
  const mk = (grp: number, pic: number, x: number, y: number, visible = true, clip = false, from = lib): S => {
    const s: S = { lib: from, grp, pic, x, y, visible, clip };
    sprites.push(s);
    return s;
  };
  const set = (s: S, grp: number, pic = 0, from?: string): void => {
    s.grp = grp;
    s.pic = pic;
    if (from) s.lib = from;
  };
  let screen = 1;
  let words = '';
  let color = 2;
  const say = (t: string, c?: number): void => {
    words = (t ?? '').replace(/\^/g, ' ').trim();
    if (c !== undefined) color = c;
  };
  const frame = (ms: number): Frame => ({ ms, opacity: screen, text: words, textColor: color, sprites: sprites.filter((s) => s.visible) });
  function* hold(n: number): Generator<Frame> {
    yield frame(poll(n));
  }
  function* fadeIn(speed = 3): Generator<Frame> {
    for (let i = 0; i <= 0xff; i += speed) {
      screen = i / 0xff;
      yield frame(25);
    }
    screen = 1;
  }
  function* fadeOut(speed = 3): Generator<Frame> {
    for (let i = 0xff; i >= 0; i -= speed) {
      screen = i / 0xff;
      yield frame(25);
    }
    screen = 0;
  }
  const hideAll = (): void => {
    for (const s of sprites) s.visible = false;
  };

  function* home(): Generator<Frame> {
    sprites = [];
    lib = 'scene1.lzc';
    const t = text(0);
    const bg = mk(0, 0, 0, 24);
    const door = mk(0, 1, 0, 24);
    const avatar = mk(1, 0, 240, 151);
    say(t[1], 14);
    screen = 0;
    yield* fadeIn();
    yield* hold(75);
    const woman = mk(8, 0, 0, 151);
    const spector = mk(2, 0, 60, 151, true, true);
    door.visible = false;
    set(avatar, 1, 1);
    say(t[2]);
    yield* hold(100);
    set(avatar, 1, 3);
    set(spector, 2, 1);
    spector.x = 80;
    say(t[3], 2);
    yield* hold(100);
    set(woman, 8, 1);
    say(t[4], 14);
    yield* hold(100);
    set(woman, 8, 2);
    set(spector, 2, 2);
    spector.x = 100;
    say(t[5], 2);
    yield* hold(75);
    set(woman, 3, 0);
    woman.x = -10;
    woman.y = 155;
    set(spector, 2, 3);
    spector.x = 145;
    say(t[6], 9);
    yield* hold(75);
    // The woman hands Spector the note.
    say(t[7]);
    for (let i = 0; i <= 10; i++) {
      if (i <= 9) set(woman, 3, i);
      set(spector, 2, i + 5);
      yield* hold(5);
    }
    yield* hold(50);
    say(t[8], 2);
    yield* hold(100);
    // A close look at the woman.
    hideAll();
    set(bg, 7, 0);
    bg.visible = true;
    say(t[9], 9);
    yield* hold(100);
    // Spector and the Avatar read the papers.
    set(bg, 0, 0);
    set(avatar, 1, 1);
    avatar.x = 270;
    avatar.visible = true;
    set(spector, 2, 16);
    spector.x = 193;
    spector.y = 161;
    spector.visible = true;
    say(t[10], 2);
    yield* hold(75);
    // The papers, close.
    hideAll();
    set(bg, 5, 0);
    bg.visible = true;
    const letter = mk(5, 1, 50, 24);
    const hand = mk(4, 0, 235, 78);
    say(t[11], 14);
    yield* hold(100);
    hand.visible = false;
    say(t[12], 2);
    yield* hold(100);
    set(letter, 6, 0);
    letter.x = 0;
    say(t[13]);
    for (let i = 0; i <= 19; i++) {
      letter.y = -20 - i;
      yield* hold(1);
    }
    letter.visible = false;
    say(t[14], 14);
    yield* hold(100);
    yield* fadeOut(6);
  }

  function* map(): Generator<Frame> {
    sprites = [];
    say('');
    const XHAIR = [[190, 80], [180, 82], [170, 84], [162, 81], [154, 75], [145, 73], [135, 73], [125, 74], [115, 76], [105, 78], [95, 81], [86, 86]];
    const base = bgShape();
    if (!base) return;
    const img: Shape = { ...base, data: new Uint8Array(base.data) };
    const bg: S = { shape: img, x: 0, y: 24, visible: true };
    sprites.push(bg);
    const plot = (x: number, y: number): void => {
      const px = x + (img.hx ?? 0);
      const py = y + (img.hy ?? 0);
      if (px >= 0 && py >= 0 && px < img.w && py < img.h) img.data[py * img.w + px] = 9;
    };
    yield* fadeIn(6);
    yield* hold(50);
    for (const [x, y] of XHAIR) {
      for (let k = x - 1; k <= x + 3; k++) plot(k, y - 24 - 5);
      for (let k = y - 1; k <= y + 1; k++) plot(x + 1, k - 24 - 5);
      yield* hold(20);
    }
    yield* hold(50);
    yield* fadeOut(6);
  }

  function* hike(): Generator<Frame> {
    sprites = [];
    lib = 'scene2.lzc';
    mk(1, 0, 0, 24);
    const avatar = mk(3, 0, -15, 148);
    const spector = mk(4, 0, -45, 149);
    mk(2, 0, 0, 24);
    yield* fadeIn(6);
    for (let i = 0; i <= 94; i++) {
      set(avatar, 3, i % 12);
      avatar.x = i * 4 - 15;
      set(spector, 4, (i + 4) % 12);
      spector.x = i * 4 - 45;
      yield* hold(3);
    }
    yield* fadeOut(6);
  }

  function* labNow(): Generator<Frame> {
    sprites = [];
    lib = 'scene3.lzc';
    const G = 'moongate.lzc';
    const t = text(1);
    say(t[1], 2);
    const bg = mk(0, 0, 0, 24);
    const gate = mk(0, 0, 125, 130, false, true, G);
    const spector = mk(3, 0, 165, 137);
    const table = mk(1, 0, 151, 82, true, true);
    const avatar = mk(2, 0, 65, 150, true, true);
    yield* fadeIn(6);
    const LAB = [[1, 2, 0, 0, 50], [1, 2, 0, 1, 100], [2, 14, 0, 1, 100], [3, 2, 0, 2, 100], [4, 2, -1, 0, 100], [5, 14, -2, 0, 100], [6, 2, -1, 0, 100], [7, 14, 1, 3, 100], [8, 2, 1, 2, 100], [9, 14, 0, 2, 100]];
    for (let i = 0; i < 7; i++) {
      const [line, c, a, s, wait] = LAB[i];
      if (a >= 0) set(spector, 3, s);
      else {
        spector.visible = table.visible = avatar.visible = false;
        set(bg, 4, Math.abs(a) - 1);
      }
      say(t[line], c);
      yield* hold(wait);
    }
    set(bg, 0, 0);
    spector.visible = avatar.visible = table.visible = true;
    set(table, 1, 1);
    set(spector, 3, 3);
    set(avatar, 2, 1);
    gate.visible = true;
    // The moongate rises from the floor.
    for (let i = 0; i <= 8; i++) {
      set(gate, 0, i);
      yield* hold(4);
    }
    for (let i = 7; i <= 9; i++) {
      const [line, c, a, s] = LAB[i];
      for (let j = 0; j <= 39; j++) {
        set(gate, 1, j % 8);
        set(avatar, 2, a);
        set(spector, 3, s);
        say(t[line], c);
        yield* hold(4);
      }
    }
    // Into the gate.
    set(spector, 4, 0, G);
    for (let i = 0; i <= 64; i++) {
      set(gate, 1, i % 8);
      set(avatar, 2, Math.floor(i / 2), G);
      yield* hold(4);
    }
    avatar.visible = false;
    for (let i = 0; i <= 39; i++) {
      set(gate, 1, i % 8);
      if (i !== 39) set(spector, 4, Math.floor(i / 2), G);
      yield* hold(4);
    }
    yield* fadeOut(6);
  }

  function* lab1895(): Generator<Frame> {
    sprites = [];
    const A = 'scene4a.lzc';
    const B = 'scene4b.lzc';
    const G = 'moongate.lzc';
    lib = A;
    const t = text(2);
    say(t[1], 6);
    const bg = mk(0, 0, 0, 24);
    const gate = mk(0, 0, 140, 125, false, true, G);
    const tesla = mk(6, 0, 187, 125);
    const spark = mk(2, 0, 32, 24, false, false, B);
    const freudBody = mk(4, 0, 0, 74, true, true);
    const freudHead = mk(4, 2, 23, 100, true, true);
    const nellie = mk(1, 0, 242, 24, false, false, B);
    const bookcase = mk(1, 0, 242, 24, false);
    const blood = mk(5, 0, 240, 40);
    const garrett = mk(0, 0, 270, 45, false, false, B);
    yield* fadeIn(6);
    for (let i = 1; i <= 2; i++) {
      say(t[i]);
      for (let j = 0; j <= 20; j++) {
        const k = 10 - Math.abs(j - 10);
        set(tesla, 6, k > 5 ? 5 : k);
        spark.visible = j > 4 && j < 16;
        if (spark.visible) set(spark, 2, j % 10);
        yield* hold(4);
      }
      color = 7;
    }
    gate.visible = true;
    // The moongate rises.
    tesla.x = 188;
    tesla.y = 128;
    set(tesla, 6, 6);
    for (let i = 0; i <= 8; i++) {
      set(gate, 0, i);
      if (i === 5) set(tesla, 6, 7);
      if (i === 2) set(blood, 5, 1);
      yield* hold(4);
    }
    // The Avatar steps out of it.
    const avatar = mk(3, 0, 80, 150, true, true, G);
    tesla.x = 180;
    tesla.y = 133;
    set(tesla, 6, 8);
    for (let i = 0; i <= 68; i++) {
      set(gate, 1, i % 8);
      set(avatar, 3, Math.floor(i / 2), G);
      if (i === 3) set(blood, 5, 2);
      if (i === 4) set(freudHead, 4, 3);
      if (i === 11) say(t[3], 7);
      yield* hold(3);
    }
    // And Spector.
    const spector = mk(5, 0, 140, 130, true, true, G);
    say(t[4], 14);
    for (let i = 0; i <= 24; i++) {
      set(gate, 1, i % 8);
      set(spector, 5, Math.floor(i / 2), G);
      yield* hold(3);
    }
    // Spector's face.
    hideAll();
    set(bg, 9, 0);
    bg.visible = true;
    const face = mk(9, 1, 0, 24);
    say(t[5], 2);
    yield* hold(200);
    // Spector shows Tesla the note.
    const lab = (): void => {
      face.visible = false;
      set(bg, 0, 0);
      tesla.visible = blood.visible = freudHead.visible = freudBody.visible = avatar.visible = spector.visible = true;
    };
    say(t[6]);
    lab();
    set(tesla, 6, 9);
    set(freudHead, 4, 2);
    avatar.x = 80;
    avatar.y = 150;
    set(avatar, 2, 1, A);
    spector.x = 145;
    spector.y = 140;
    set(spector, 3, 1, A);
    gate.visible = false;
    yield* hold(200);
    // Tesla's face.
    hideAll();
    set(bg, 7, 0);
    bg.visible = true;
    set(face, 7, 1);
    face.visible = true;
    say(t[7], 7);
    yield* hold(200);
    // The blood, close.
    set(bg, 8, 0);
    color = 4;
    for (let i = 8; i <= 9; i++) {
      set(face, 8, i - 7);
      say(t[i]);
      yield* hold(200);
    }
    // Tesla calls Mr Garrett.
    say(t[10], 7);
    lab();
    set(tesla, 6, 10);
    set(avatar, 2, 0);
    set(spector, 3, 0);
    yield* hold(200);
    garrett.visible = true;
    spector.x = 150;
    spector.y = 140;
    say(t[11], 9);
    for (let i = 0; i <= 31; i++) {
      if (i === 5) set(spector, 3, 2);
      if (i <= 10) set(avatar, 2, i);
      set(garrett, 0, i);
      yield* hold(3);
    }
    // Tesla reads the note, and speaks of the mission.
    set(spector, 3, 1);
    spector.x = 155;
    set(avatar, 2, 10);
    set(freudHead, 4, 1);
    const COLORS = [4, 6, 7, 7, 14, 2, 2, 7, 4, 4, 7, 9, 7, 4, 7, 4, 7, 2, 7, 7, 7, 7, 7, 11, 2, 7, 7];
    for (let i = 12; i <= 20; i++) {
      if (i === 13 || i === 16 || i === 20) {
        for (const s of [tesla, blood, freudHead, freudBody, avatar, spector, garrett]) s.visible = false;
        face.visible = true;
        const idx = i === 13 ? 8 : 7;
        set(bg, idx, 0);
        set(face, idx, i === 16 ? 2 : 1);
      } else {
        if (i === 14) set(spector, 3, 0);
        set(tesla, 6, i === 12 || i === 17 ? 9 : i === 14 || i === 15 ? 10 : 11);
      }
      say(t[i], COLORS[i]);
      yield* hold(200);
      lab();
      garrett.visible = true;
    }
    // Nellie comes in.
    set(tesla, 6, 10);
    say(t[21], COLORS[21]);
    nellie.visible = true;
    nellie.y = 125;
    bookcase.visible = true;
    for (let i = 0; i <= 31; i++) {
      if (i === 7) set(freudHead, 4, 2);
      set(nellie, 1, i % 4);
      nellie.x = 320 - i * 3;
      if (i > 25) nellie.y = 125 + (i - 26) * 2;
      set(avatar, 2, Math.max(4, Math.min(10, 20 - i)));
      set(garrett, 0, Math.max(18, Math.min(31, 45 - i)));
      yield* hold(3);
    }
    // She shakes hands with Spector and the Avatar.
    spector.x = 165;
    nellie.x = 227;
    nellie.y = 135;
    for (let i = 22; i <= 26; i++) {
      set(nellie, 1, i === 24 ? 7 : i === 23 ? 6 : 5);
      set(spector, 3, i === 24 ? 3 : 0);
      set(tesla, 6, i === 25 ? 9 : i === 26 ? 11 : 12);
      say(t[i], COLORS[i]);
      yield* hold(200);
    }
    yield* fadeOut(6);
  }

  function* script(): Generator<Frame> {
    yield* home();
    yield* map();
    yield* hike();
    yield* labNow();
    yield* lab1895();
  }
  return fromGen(script());
}
