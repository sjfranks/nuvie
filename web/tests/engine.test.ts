import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/demo.ts';
import { Lib, buildLib } from '../src/files/lib.ts';
import { isLzw, lzwCompress, lzwDecompress } from '../src/files/lzw.ts';
import { checkKeywords } from '../src/game/converse.ts';
import { Game } from '../src/game/game.ts';
import { invCount } from '../src/game/inventory.ts';
import { OBJ } from '../src/game/u6tables.ts';

describe('files', () => {
  it('unpacks what the literal packer packs', () => {
    const src = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7 + (i >> 3)) & 0xff);
    const packed = lzwCompress(src);
    expect(isLzw(packed)).toBe(true);
    expect(lzwDecompress(packed)).toEqual(src);
  });

  it('reads a library, packed and plain items alike', () => {
    const a = Uint8Array.from([1, 2, 3, 4, 5]);
    const b = Uint8Array.from([9, 9]);
    const lib = new Lib(buildLib([a, null, b], 4), 4);
    expect(lib.count).toBe(3);
    expect(lib.item(0)).toEqual(a);
    expect(lib.item(1)).toBeNull();
    expect(lib.item(2)).toEqual(b);
    const lib2 = new Lib(buildLib([a, b], 2), 2);
    expect(lib2.item(1)).toEqual(b);
  });

  it('matches keywords by their own length', () => {
    expect(checkKeywords('name,job', 'jobs')).toBe(true);
    expect(checkKeywords('name,job', 'jo')).toBe(false);
    expect(checkKeywords('*', 'anything')).toBe(true);
    expect(checkKeywords('bake', 'BAKERY')).toBe(true);
  });
});

describe('the demo world', () => {
  const game = (): Game => new Game(buildDemo());
  const text = (g: Game): string => g.log.map((l) => l.text).join('\n');

  it('loads: the party, the clock, the ground and what is on it', () => {
    const g = game();
    expect(g.playerName()).toBe('Wanderer');
    expect(g.time()).toBe('9:30 am');
    expect(g.player.x).toBe(320);
    expect(g.tiles.look(g.map.tileNum(320, 326, 0), 0)).toBe('a path');
    expect(g.map.isPassable(320, 325, 0)).toBe(true);
    expect(g.map.isPassable(200, 200, 0)).toBe(false); // the sea
    const chest = g.objects.get(332, 315, 0)!;
    expect(chest.objN).toBe(OBJ.CHEST);
    expect(chest.container!.map((o) => g.objects.look(o))).toEqual(expect.arrayContaining(['a key', '25 gold coins']));
  });

  it('walks, is blocked by walls, and opens a door by walking into it', () => {
    const g = game();
    expect(g.pathTo(310, 319)!.length).toBeGreaterThan(5); // to below the bakery's door
    // People wander, so the way is planned afresh at each step.
    for (let n = 0; n < 60 && (g.player.x !== 310 || g.player.y !== 319); n++) {
      const [dx, dy] = g.pathTo(310, 319)![0];
      g.move(dx, dy);
    }
    expect([g.player.x, g.player.y]).toEqual([310, 319]);
    expect(g.map.isPassable(310, 318, 0)).toBe(false); // the door, shut
    expect(g.move(0, -1)).toBe(true); // walking into it opens it
    expect(text(g)).toContain('Opened.');
    expect(g.player.y).toBe(319);
    expect(g.move(0, -1)).toBe(true);
    expect(g.player.y).toBe(318);
    // A way planned through a shut door is found, and a wall is not walked through.
    expect(g.pathTo(328, 316)).not.toBeNull();
    expect(g.pathTo(307, 313)).toBeNull();
  });

  it('talks: greeting, keywords, a yes or no, a gift, and a journal of it', () => {
    const g = game();
    const baker = g.actors.get(2)!;
    g.talkTo(baker);
    expect(g.speaker?.name).toBe('baker');
    expect(text(g)).toContain('You see a round man dusted with flour.');
    expect(text(g)).toContain('I am Tobble');
    expect(g.sayOptions().map((o) => o.say)).toEqual(['name', 'job', 'bye']);
    g.reply('job');
    expect(text(g)).toContain('Up before the sun');
    // The words he dropped can now be asked about.
    expect(g.sayOptions().map((o) => o.say)).toEqual(expect.arrayContaining(['bake', 'loaf']));
    g.reply('bake');
    expect(g.paused).toBe(true); // he stops mid-answer
    expect(text(g)).not.toContain('Mostly patience');
    g.continueTalk();
    expect(text(g)).toContain('Mostly patience');
    g.reply('loaf');
    expect(g.sayOptions().map((o) => o.label)).toEqual(['Yes', 'No']);
    g.reply('yes');
    expect(invCount(g.objects, 1, OBJ.BREAD)).toBe(1);
    g.reply('nonsense');
    expect(text(g)).toContain('I know naught of that');
    g.reply('bye');
    expect(g.converse).toBeNull();
    const p = g.journal.person(2)!;
    expect(p.name).toBe('Tobble');
    expect(p.notes.map((n) => n.asked)).toEqual(expect.arrayContaining(['On meeting', 'job', 'bake']));
    // Met before, he greets differently, and gives no second loaf.
    g.talkTo(baker);
    expect(text(g)).toContain('Back again, Wanderer!');
    g.reply('loaf');
    g.reply('y');
    expect(text(g)).toContain('two is a business');
    expect(invCount(g.objects, 1, OBJ.BREAD)).toBe(1);
  });

  it('runs a packed script too', () => {
    const g = game();
    g.talkTo(g.actors.get(3)!);
    g.reply('job');
    expect(text(g)).toContain('When the @cellar is not flooding');
  });

  it('takes the key from the chest, unlocks the shed and goes down the ladder and back', () => {
    const g = game();
    const chest = g.objects.get(332, 315, 0)!;
    g.useObj(chest);
    expect(g.openContainer).toBe(chest);
    g.get(0, 0, chest.container!.find((o) => o.objN === OBJ.KEY)!);
    expect(invCount(g.objects, 1, OBJ.KEY)).toBe(1);
    const door = g.objects.list(320, 312, 0)!.find((o) => g.objects.isDoor(o))!;
    expect(door.frameN).toBe(9);
    g.useObj(door);
    expect(text(g)).toContain('Unlocked.');
    g.useObj(door);
    expect(g.map.isPassable(320, 312, 0)).toBe(true);
    g.use(320, 310);
    expect(g.player.z).toBe(1);
    const up = g.objects.get(g.player.x, g.player.y, 1)!;
    expect(up.objN).toBe(OBJ.LADDER);
    g.useObj(up);
    expect([g.player.x, g.player.y, g.player.z]).toEqual([320, 310, 0]);
  });

  it('reads a sign into the journal, and saves and restores', () => {
    const g = game();
    g.look(321, 325);
    expect(text(g)).toContain('Thou dost see a sign.');
    expect(g.journal.data.readings[0].text).toContain('SALTMERE');
    g.get(323, 329);
    expect(g.gold()).toBe(5);
    g.move(0, -1);
    const saved = JSON.parse(JSON.stringify(g.save()));
    const h = new Game(buildDemo(), saved);
    expect(h.player.y).toBe(g.player.y);
    expect(h.gold()).toBe(5);
    expect(h.objects.get(323, 329, 0)).toBeNull();
    expect(h.objects.get(332, 315, 0)!.container!.length).toBe(2);
    expect(h.journal.data.readings.length).toBe(1);
  });

  it('keeps the day: the baker walks home in the evening', () => {
    const g = game();
    const baker = g.actors.get(2)!;
    for (let i = 0; i < 2 * 60 * 11; i++) g.pass();
    expect(g.clock.hour).toBe(20);
    expect(baker.worktype).toBe(0x89);
    for (let i = 0; i < 60; i++) g.pass();
    expect([baker.x, baker.y]).toEqual([312, 317]);
  });
});
