import { describe, expect, it } from 'vitest';
import { Intanya, QUESTIONS } from '../src/ui/intanya.ts';

describe('Intanya', () => {
  it('asks three different questions and strengthens what the answers feed', () => {
    for (let seed = 0; seed < 20; seed++) {
      let n = seed;
      const rand = (lo: number, hi: number): number => lo + ((n = (n * 1103515245 + 12345) & 0x7fffffff) % (hi - lo + 1));
      const s = new Intanya(rand);
      const base = s.stats.reduce((a, b) => a + b, 0);
      const asked = new Set<number>();
      while (!s.done) {
        asked.add(s.q);
        expect(QUESTIONS[s.q]).toMatch(/\(a\).*\(b\)/);
        s.answer(seed % 2 === 0);
      }
      expect(asked.size).toBe(3);
      expect(s.stats.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(base + 9);
    }
  });
});
