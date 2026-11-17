import { describe, expect, it } from 'vitest';
import { Gypsy, QUESTIONS } from '../src/ui/gypsy.ts';

describe('the gypsy', () => {
  it('splits every question into its two answers', () => {
    for (const t of QUESTIONS) expect(t).toMatch(/A\).*or B\)/s);
  });
  it('asks seven questions, a contest of the virtues', () => {
    const g = new Gypsy();
    const seen = new Set<string>();
    while (!g.done) {
      const q = g.question();
      expect(q.a.length).toBeGreaterThan(5);
      expect(q.b.length).toBeGreaterThan(5);
      seen.add(q.text);
      g.answer('a');
    }
    expect(g.asked).toBe(7);
    expect(seen.size).toBe(7);
    expect(g.str + g.dex + g.int).toBeGreaterThanOrEqual(45);
  });
  it('makes a strong Avatar of one who always chooses Valor', () => {
    const g = new Gypsy();
    while (!g.done) {
      const q = g.question();
      g.answer(q.virtues[1] === 'Valor' ? 'b' : q.virtues[0] === 'Valor' ? 'a' : 'a');
    }
    expect(g.str).toBeGreaterThanOrEqual(15);
  });
});
