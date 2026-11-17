# Nuvie Web

A TypeScript port of the Nuvie engine - Ultima VI, Martian Dreams and The Savage Empire - for a phone held upright
(or sideways) and for any browser. Like Nuvie, it
plays **your own copy** of the game and ships none of it: on the first screen, choose the game's folder, its files or
a .zip, and they are kept in the browser (IndexedDB) and never leave the device.

**Try the demo world** on the first screen needs no game at all: a small island made for this port (its own tiles,
people and words), written out in the game's file formats so the whole engine runs on it. The tests use it too.

```sh
cd web
npm install
npm run dev      # http://localhost:5173/  (?demo starts the demo world, ?demo&new starts it afresh)
npm test         # the engine's tests, on the demo world
npm run build    # a static site in dist/
```

## The look

With your copy of the game the interface takes its look from the game's own files at run time: its 8-pixel typeface
(`u6.ch`, made into a font) at one size throughout, its parchment and burnt edge (`paper.bmp`, cut into frames for the
map, the pane and every sheet), its scroll's ink and red keywords, and its command icons on the buttons. None of it
is in this repository; the demo world uses the same colours with a plain frame.

**Music** (Ultima VI) is the game's own: its `.m` songs played by a port of AdPlug's Ultima 6 player (`u6m.cpp`) on
DOSBox's FM synthesiser compiled to WebAssembly ([@malvineous/opl](https://github.com/Malvineous/opljs)), changing as
the original's does - a song of the land, the battle song in a fight, the hornpipe aboard ship, the dungeon's below.
It starts at the first touch, and Menu turns it off and on. **Sound effects** are the PC speaker's, made as the
original made them (Nuvie's `PCSpeakerStream.cpp`): blocked, the swing and hit of a blow, casting by circle, failure,
Kal Lor, the death dirge, the tremor and the hail; Menu turns them off and on.

**Night** is a modern take, not the original's black that closes in square by square: a soft blue dusk over the map,
deeper underground, with smooth pools of light round the party, and warm firelight from lamps, braziers and torches.
Sunset and sunrise glow orange.

## A new Avatar

A new game of Ultima VI begins as the original's does, in the gypsy's wagon (intro.lua's create_character): a name,
man or woman, one of six faces, and then the gypsy's questions of the eight virtues - four pairs, the winners in two
pairs, then the last two - each answer adding to strength, dexterity or intelligence. The Avatar starts at level 3
with magic twice their intelligence (SaveGame::update_objlist_for_new_game_u6). Close the sheet to keep the
default Avatar. The animated intro itself (the lounge, the stones, the moongate) is not ported.

## The screen

- **Upright**: the map fills the width at the top and takes the taps; under it one pane, the **Log** or the
  **Party**, with tabs beside it to choose (the Log tab is marked when there is news); at the foot, the commands.
- **Sideways**: the map at the left, the pane and the commands beside it.
- **Hold to walk**: hold a finger on the map and the party walks towards it, round walls, for as long as it stays
  down; slide it to steer, lift it to stop. Held, the party walks into no one - talking and fighting are a tap's.
- **Tap to walk**: a tap walks there, round what is in the way, the way marked as it goes. A tap on a person walks up
  and talks; on a door, ladder, sign or chest, walks up and uses it. Walking into a shut door opens it. Tap the party
  to pass a turn or pick up what is underfoot.
- **Fighting**: tap a foe to walk up and attack it - from as far as the weapon reaches, a bow from across a room -
  or choose **Attack** and tap. The rest of the party fights by itself; blows land with the game's own hit
  sparks, and arrows and thrown weapons fly. Monsters hatch from the game's eggs as the party travels.
- **Magic**: **Cast** opens the spellbook of whoever has one readied: their magic points and reagents, and their
  spells by circle with the words of power. A spell aimed at someone or somewhere asks for a tap on the map.
- **Look, Talk, Use, Get**: choose one (the game's own icons), then tap where. **Pass** lets a turn go by; the
  last button opens the journal.
- **Talking**: the speaker's face shows over the map (which shrinks to give the words room), and the foot becomes a
  menu of what can be said: Name and
  Job, the words this person has dropped (shown in gold in what they say), Bye - or Yes and No where that is the
  question - with a box to type anything else. The words a speaker answers to are marked in what they say: tap one
  to ask about it. Where the speaker stops, **Continue** goes on; the last words of a conversation stay to be read
  until the player goes on.
- **Party**: tap a member for their sheet: the original's paper doll, with a ring for each place a thing is worn or
  held and what is there; their numbers; and what they carry, each bag or chest folded until opened with its +.
  Tap a thing (on the doll or in the list) to ready, use, drop or hand it on.
- **Containers** in the world - chests, barrels, bodies - open over the game, each thing to take, or all of it.
- **Journal**: everyone spoken with, what each said to each thing asked, the words they answer to, and every sign
  and book read.
- The game saves itself as you play. A keyboard works too: arrows walk, space passes, L/T/U/G choose a command.

## What is ported, and what is not

Ported from the C++ (each file's header names its source):

| Here | From |
|---|---|
| `src/files/lzw.ts`, `lib.ts` | `files/U6Lzw.cpp`, `files/U6Lib_n.cpp` |
| `src/game/tiles.ts` | `TileManager.cpp`, `Look.cpp` |
| `src/game/map.ts`, `objects.ts` | `Map.cpp`, `Obj.cpp`, `ObjManager.cpp` |
| `src/game/actors.ts`, `u6tables.ts` | `actors/Actor*.cpp`, `U6ActorTypes.h`, `U6objects.h` (`npm run tables` regenerates) |
| `src/game/converse.ts` | `Converse.cpp`, `ConverseInterpret.cpp` |
| `src/game/game.ts` | parts of `Game.cpp`, `Event.cpp`, `Player.cpp`, `Party.cpp`, `SaveGame.cpp`, `usecode/U6UseCode.cpp` |
| `src/game/combat.ts`, `u6combat.ts` | `data/scripts/u6/actor.lua` (attack, hit, damage, death, targets, monster set-up; `npm run tables` regenerates), `EggManager.cpp`, the temporary actors of `ActorManager.cpp` |
| `src/game/magic.ts` | `Magic.cpp`, `data/scripts/u6/magic.lua` and `magic/circle_*/*.lua` |
| `src/ui/mapview.ts` | `MapWindow.cpp` (drawing order, line of sight, wall reshaping), `GamePalette.cpp` |

Working: loading a new game or an original saved game; the map, objects, animated tiles and cycling colours; line
of sight; walking with a party following; schedules (people go about their day); looking; the whole conversation
interpreter; doors, keys, ladders, caves, secret doors, passthroughs, containers, signs and books, food; getting,
dropping and giving; saving.

**Martian Dreams and The Savage Empire** load too, from the same screen (the game is told by its files): their map,
people, schedules, conversations, faces (`mdfaces.lzc`, `faces.lzc`), palette, and their own 8-pixel font
(`system.lzc`), with Martian Dreams' doors. They have no parchment picture, so they take the plain frame. Things are
worn and held by each game's own table (obj_get_readiable_location, by tile).

Martian Dreams fights too, with its own numbers (data/scripts/md): its creatures' strength, dexterity, wits, health,
damage and nature (actor_tbl), its weapons' damage and reach (combat.lua) and its clothes' armour; guns use their
rounds, ray guns and sprayers their charges; the freeze ray holds fast, Cupid's bow charms, the heat ray does nothing
to what heat cannot hurt; some creatures take double harm, some paralyse, some cannot be hurt at all; eggs hatch its
creatures. Nuvie's own Martian Dreams AI is mostly unwritten, so creatures fight as Ultima VI's do. A fallen party
wakes at the space capsule (or the Olympus mine) the next morning. Savage Empire's creature table in Nuvie is a
placeholder, so it has no fighting.

Using things in Martian Dreams follows its usecode.lua, with its own words (lang/en/game.lua): the four kinds of
berry and the red berry's battle frenzy, the sextant, crates and trunks (nailed, locked, opened and searched), pry
bars and hammers on crates, gates, levers that work the doors they name, switch bars and turntables, lamp oil and
potash on rusted doors, the oxium bin and hammering geodes, books, notes, scrolls and the affidavit (mdtext.lzc),
instruments, the spittoon, the pool table, spray guns and their paint or weed killer, dreamstuff, radium for the power
unit and the ray guns, the heartstone, the hand mirror, the hatch, ruby slippers and things readied by using them.
Things used on something ask where ("On -"). The tent (and the Rest button, with a tent carried) camps as use_tent does: flat
ground, no foes or others near, no one dizzy with berries; rest until sunrise or sunset or some hours, heal once in
six, and dream of the obelisks of book, heart and sword to gain a level and a point of wits, dexterity or strength.
A shovel digs dirt and ice into holes and piles, fills holes, and loads ore, rocks and
coal into wheelbarrows and rail cars and out again ("On -", then "To -"); coal in the furnace starts the power (the
steam, furnaces and lamps). Not yet: the drill, the conveyor belt's movement, the dream machine, and Savage Empire's
usecode.

**Combat** follows Ultima VI's rules as Nuvie's Lua has them: the hit roll (dexterity, or strength for clubs and
maces, against the foe's dexterity), weapon damage less a roll against readied armour, half damage for the creatures
that take it, poison, experience for evil foes slain, bodies that hold what was carried, ammunition, missile walls,
and death - the Avatar wakes in Lord British's castle with the fallen raised. Simplified: each fighter acts once a
turn (not by movement points), and thrown weapons are not lost. Monsters that know spells (mages, liches, dragons,
wisps, gazers and the like) carry them as charges and now and then cast one instead of striking, as actor.lua has it.

**Magic** has Magic.cpp's checks - a readied spellbook holding the spell, a level and magic points as high as its
circle, a reagent of each kind - and magic points come back each hour. All 80 spells are ported from their Lua: the
healing, harming and killing spells, the winds and storms, sleep, poison, paralysis, charm, curse, protection,
invisibility, fear and confusion, Light, Infravision, X-ray, Peer and Wizard Eye (the land seen from above), locking
and unlocking, trapping and untrapping, Detect Magic and Detect Trap, Telekinesis, Vanish and Reappear, Conjure,
Insect Swarm, Summon, Animate and Clone, the fire, poison, sleep and energy fields and Dispel Field, Web, Replicate,
Pickpocket and Enchant (choose from a list), Seance (cast on a body), Gate Travel (choose a phase of the moons),
Negate Magic, Eclipse, Wind Change, Slime, Time Stop, Tremor, Help, Resurrect and Armageddon. Their effects wear off
as in the original, poison bites now and then, and the charmed fight for the party. Torches can be lit and held, and
Light and torches widen the party's light at night.

**Harmful ground** (actor_map_dmg): once a turn, whoever stands in a swamp (without swamp boots) or a poison field is
poisoned, fire and fire fields burn, traps, spikes and force fields cut, sleep fields put to sleep, and webs hold -
unless they fly, are protected, or are aboard.

**Using things** follows Nuvie's U6UseCode.cpp: doors, ladders and containers; levers and switches that raise and
drop the portcullises and fields of their doorways; cranks that lower and raise drawbridges; keys and lock picks
(tap the door or chest; a pick may break); candles, candelabras, braziers, fireplaces and campfires; bells and pull
chains; wells and cows filling buckets, churns making butter, hives filling honey jars; fishing poles, shovels and
picks; potions (tap who drinks); all the food and drink; the sextant, clocks and sundials, mirrors, the peer gem,
instruments, fans and the rubber ducky. A tap on a lever, crank, fire, bell or well uses it where it stands.
The quest items work too: a rune with its shrine's mantra (typed) lifts the force field before the shrine; a
moonstone buried in grass or earth raises its moongate there; the quest barrier stops the party until the Avatar
has the quest; the gargish vocabulary teaches gargish; the vortex cube, at the Codex with both lenses and all eight
moonstones, ends the game: ending.lua's scenes told in its own words over the ending music, and how long the
quest took. The crystal ball shows a far place, a spellbook opens the spell list, cannons fire down
the way they face, and a lit powder keg blows up after a few turns (doors, kegs and anyone near).

**Rest** (the moon button): pass a turn, or camp 1-8 hours - not in towns, near foes or others, or on horseback.
Each member eats a meal if the party has food, and those fed heal, once in twelve hours. On a ship the crew mends
the hull instead.

**The Orb of the Moons** works as in Ultima VI once Lord British has told of it: use it from the Avatar's sheet,
tap a square near the party, and a red moongate opens there that leads where that square says; step in. Blue
moongates stand at the eight moonstones while either moon is in the sky, and lead where the moons' phases say.

**Boats and horses**: tap a ship, skiff or raft beside the party to board it (a ship whose deed the party holds);
tap water to sail, and land beside the boat to go ashore. Ships keep to open water and must have room to turn.
Tap a roaming horse to ride it, and the rider to get down.

**The balloon**: with the balloon plans, a mammoth silk bag, a balloon basket, a cauldron and a rope, use the plans
to make a balloon; use it to lay it out and fill it, and tap it to board. Aloft, the balloon goes where the wind
blows - any tap, or a pass, lets it drift a square - over land, water and walls alike. Tap the party to come down
beside it. The wind (shown by the clock while aboard) changes every half hour or so, as Weather.cpp has it; a fan
turns it a step round, and Wind Change sets it.

Great creatures take more than one square: ships, dragons (head, wings and tail), hydras (eight tentacles), the
two-square beasts, and the silver serpent, whose long body follows its head square by square and never turns back
over its neck (U6Actor's surrounding objects).

Not ported yet: the animated intro and ending pictures; Martian Dreams' and Savage Empire's music (Nuvie has none),
the rest of their usecode, and Savage Empire's fighting (Nuvie has none to port).

`tests/real.test.ts` runs on your copies put in `web/gamedata/ultima6/`, `savage/` and `martian/` (git-ignored).
For each it loads a new game, saves and restores it, and talks with everyone who has a conversation (199 people in
Ultima VI, 68 in Savage Empire, 99 in Martian Dreams). For Ultima VI it also hatches the opening gargoyles, fights a
troll to the death, readies and unreadies, casts spells, and goes through a red moongate.

Licensed as Nuvie is: GPL 2 or later. The music's synthesiser (@malvineous/opl) is GPL 3, so a build that
includes it is distributed under GPL 3.
