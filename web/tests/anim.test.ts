import { describe, expect, it } from 'vitest';
import { mdEndingScene } from '../src/ui/mdending.ts';
import { u6EndingScene } from '../src/ui/u6ending.ts';

describe('the endings in motion', () => {
  it('plays every page of Ultima VI\'s ending, each from where the last left off', () => {
    for (let page = 0; page < 11; page++) {
      const scene = u6EndingScene(page);
      for (let i = 0; i < 400; i++) {
        const f = scene.frame(i);
        expect(f.sprites.length).toBeGreaterThan(0);
      }
    }
    // The Codex has opened by the tenth page, and the stars show behind it.
    const nine = u6EndingScene(9);
    let f = nine.frame(0);
    for (let i = 1; i < 200; i++) f = nine.frame(i);
    expect(f.sprites.some((s) => s.grp === 2)).toBe(true);
    expect(f.sprites.some((s) => s.shape)).toBe(true);
  });

  it('plays every page of Martian Dreams\' ending', () => {
    for (let page = 0; page < 10; page++) {
      const scene = mdEndingScene(page, page % 2 === 0);
      for (let i = 0; i < Math.min(scene.frames, 200); i++) expect(scene.frame(i).ms).toBeGreaterThan(0);
    }
  });
});
