import { expect, it } from 'vitest';
import { makeSfx, type SfxId } from '../src/audio/sfx.ts';

it('makes each of the PC speaker effects as a short sound', () => {
  const ids: SfxId[] = ['blocked', 'success', 'failure', 'swing', 'hit', 'cast1', 'cast2', 'kallor', 'death', 'quake', 'hail', 'bell'];
  const secs = ids.map((id) => [id, +(makeSfx(id, 3).length / 22050).toFixed(2)] as const);
  console.log(secs.map(([id, s]) => `${id} ${s}s`).join(', '));
  for (const [, s] of secs) {
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(8); // the death tune is a slow dirge
  }
});
