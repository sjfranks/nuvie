/**
 * intro6.ts - Ultima VI's introduction (data/scripts/u6/intro.lua's intro): its words, a page each, over stills
 * composed as the script lays out its pictures - the lounge, the storm at the window, the stones, the altar.
 */

/** [image file, palette index in palettes.int, layers: [picture, x, y]] */
export type Still = [string, number, [number, number, number][]];

const LOUNGE: Still = ['intro_1.shp', 1, [[0, 0, 0], [13, 0, 63]]];
const STORM: Still = ['intro_2.shp', 2, [[1, 0, 0], [0, 20, -5], [10, 0, 0x4c], [8, 0, 0], [28, 0, 0], [26, 0x39, 0]]];
const STRIKE: Still = ['intro_2.shp', 2, [[1, 0, 0], [0, 20, -5], [10, 0, 0x4c], [8, 0, 0], [19, 158, 114], [28, 0, 0], [26, 0x39, 0]]];
const STONES: Still = ['intro_3.shp', 3, [[0, 0, 0]]];
const HAND: Still = ['intro_3.shp', 3, [[0, 0, 0], [1, 0xbd, 0xc7]]];
const GATE: Still = ['intro_3.shp', 3, [[5, 0, 0], [2, 0x7c, 0x64]]];
const PALM: Still = ['intro_3.shp', 3, [[5, 0, 0], [2, 0x7c, 0x64], [6, 0xbd, 0xc7]]];
const PLAIN: Still = ['intro.shp', 7, [[6, 0, 0], [5, 0, 0x70]]];
const MOB: Still = ['intro.shp', 7, [[6, 0, 0], [3, 0, 0x4a], [4, 175, 0x8a], [5, 0, 0x70]]];
const BOUND: Still = ['intro.shp', 7, [[6, 0, 0], [3, 0, 0x4a], [4, 175, 0x8a], [5, 0, 0x70], [9, 0x31, 0x44], [12, 0xd2, 0x84]]];
const PRIEST: Still = ['intro.shp', 7, [[6, 0, 0], [3, 0, 0x4a], [4, 175, 0x8a], [5, 0, 0x70], [9, 0x31, 0x44], [12, 0xd2, 0x84], [8, 0xd5, 0x8d], [11, 0x123, 0x9b]]];
const DARK: Still = ['intro.shp', 7, []];
const RESCUE: Still = ['intro.shp', 7, [[6, 0, 0], [7, 0x78, 0x3a], [3, 0, 0x4a], [4, 175, 0x8a], [5, 0, 0x70], [9, 0x31, 0x44], [12, 0xd2, 0x84], [8, 0xd5, 0x8d], [10, 0x123, 0x9b]]];
const FRIENDS: Still = ['intro.shp', 7, [[6, 0, 0], [7, 0x78, 0x3a], [3, 0, 0x4a], [4, 175, 0x8a], [5, 0, 0x70], [9, 0x31, 0x44], [1, 0xa8, 0xca], [2, 0x44, 0x7a], [0, 0x10, 0x7a]]];
const WANING: Still = ['intro.shp', 7, [[6, 0, 0], [7, 0x78, 0x3a], [3, 0, 0x4a], [4, 175, 0x8a]]];

export const INTRO_U6: [string, Still][] = [
  ['Upon your world, five seasons have passed since your triumphant homecoming from Britannia.', LOUNGE],
  ['You have traded the Avatar\'s life of peril and adventure for the lonely serenity of a world at peace. But television supermen cannot take the place of friends who died at your side!', LOUNGE],
  ['Outside, a chill wind rises...', STORM],
  ['...and in moments, the storm is upon you.', STORM],
  ['Tongues of lightning lash the sky, conducting an unceasing crescendo of thunder....', STRIKE],
  ['In a cataclysm of sound and light, a bolt of searing blue fire strikes the earth!', STRIKE],
  ['Lightning among the stones! Is this a sign from distant Britannia?', STRIKE],
  ['You bolt from your house, stumbling, running blind in the storm. Into the forest, down the path, through the rain... to the stones.', STONES],
  ['Near the stones, the smell of damp, blasted earth hangs in the air. In a frozen moment of lightning-struck daylight, you glimpse a tiny obsidian stone in the midst of the circle!', STONES],
  ['Wondering, you pick it up....', HAND],
  ['...and from the heart of the stones, a softly glowing door ascends in silence!', GATE],
  ['Exultant memories wash over you as you clutch the stone. When last you saw an orb such as this, it was cast down by Lord British to banish the tyrant Blackthorn!', PALM],
  ['But your joy soon gives way to apprehension. The gate to Britannia has always been blue... as blue as the morning sky.', GATE],
  ['Abruptly, the portal quivers and begins to sink into the ground. Its crimson light wanes!', GATE],
  ['Desperation makes the decision an easy one.', GATE],
  ['Dazed, you emerge from the portal to find yourself standing on a desolate plain. Nearby rests a massive rune-struck altar, shrouded in moonlit fog.', PLAIN],
  ['At first the plain is still. Then a hundred voices raise a slow, deathlike song, drawing closer and closer with each passing moment. You are seized by an urge to run...', PLAIN],
  ['...but you have no place to go.', MOB],
  ['Before you can offer a protest to the creatures who surround you, scaly claws grasp your body.', MOB],
  ['With unearthly strength, the monsters bind you to the altar stone!', BOUND],
  ['Kneeling, the hordes sway and chant as a stately winged nightmare steps forward.', PRIEST],
  ['The leader unwraps a velvet covered, brass-bound book and recites from it in a formal, stilted tongue.', PRIEST],
  ['Shouts and jeers explode from the masses as the priest slams shut the book. In his hand a malignant dagger drips with moonlight.', PRIEST],
  ['You close your eyes. A dying scream, certainly your own, curdles the air.', DARK],
  ['Catcalls, the dagger, a scream, Death....', DARK],
  ['Pandemonium. Shrieks of rage, of terror.', DARK],
  ['From the inevitable, an impossibility emerges.', DARK],
  ['You are still alive.', DARK],
  ['Silent red light fills the darkness. There is the wooden clack of a crossbow, and a violet-fletched rose blooms in the priest\'s barren forehead.', RESCUE],
  ['Friendly faces vault from a newborn moongate, while a rain of quarrels holds the furious mob at bay. The knight Dupre\'s sword flashes twice in the darkness, slicing away your bonds!', FRIENDS],
  ['"Quickly, old friend! To the gate!" Accompanied by the swordsman Shamino and a grinning, crossbow-wielding Iolo the Bard, Dupre thrusts a spare sword into your hand.', FRIENDS],
  ['Snatching the fallen priest\'s book, Iolo dives into the redness with Shamino at his heels. The howling throng surges forward, all of one terrible mind.', FRIENDS],
  ['The gate wanes rapidly as you and Dupre charge through...', WANING],
  ['...but not rapidly enough.', WANING],
  ['From the mob\'s vanguard, three of the abominations scramble toward the gate. Driven by fury, the creatures hurl their bodies into the portal\'s last handspan of light!', WANING],
];
