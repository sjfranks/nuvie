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
default Avatar. The introduction can be watched first, in motion (below).

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


Touch: a tap acts, a finger held down walks; a thing within reach can be dragged - onto someone of the party to give it
to them, or onto a free square nearby to move it. Two fingers pinch the map out to see more (the usual zoom is the
closest; the Zoom button brings it back). The menu sets the battle speed (each fighter's turn is shown in turn), the
text size, the paper frame round the map, sounds and music. In a conversation the window holds only the current
exchange; a Continue comes before the topics, and topics already asked - or leading to an answer already heard - are
greyed and listed last. The app has its own red ankh icon for the Home Screen.

The journal's Map tab shows the world with a marker where the party stands (or last stood on the surface). It draws
the land from the game's files; or tap "Use a picture of the map" and choose a photo of the cloth map from the box -
kept in this browser, never shipped - and the marker is placed on it. The three games' maps are measured (MAP_CAL in
app.ts) for a photo of the whole map, frame and all.

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
steam, furnaces and lamps). Walking into a wheelbarrow, rail car or drill pushes it ahead (move_obj): barrows and
drills turn the way they go, rail cars keep to their track. The drill bores into the rock, ore or coal it faces and
leaves the spoil beside it; while the power runs, the mine's conveyor carries what lies on it east each turn until it
stops. Stairs and mine and cave mouths take the party where
map_entrance_tbl says (a rail car at a mine's mouth goes through too), the alien pods once they work; with the
power on, the mine's doors open for whoever comes near (update_objects_around_party). The dream machine works as
usecode.lua and dreamworld.lua have it: fit the headgear, power it with radium, sit in it and work its panel, and the
Avatar dreams alone - empty-handed, the party waiting - from teleporter to teleporter through the dream's stages (Your
Mother, the minotaur's pitcher shop); a dream quest done (Lowell's mirror, Twain's manuscript, Melies' door) or a
nightmare ends it, and the Avatar wakes at eight with the party and their things. A companion in the seat dreams
until dawn. The ruby slippers, clicked thrice, offer the way home, and the
ending's words follow (scenetxt.lzc); conversations run talk.lua's scripts - fixing the panels, opening the gates at
Olympus Mons and the dream machine's door, the monster footprints, the end, waking from a dream. A new game begins
with Freud's interview in the capsule (intro.lua's create_character): a name, father or mother, and the questions
whose answers set strength, dexterity and intelligence. The coal works run as worktype.lua has them (cokers dig coal onto the belt, stokers carry it to the furnace and,
with the belt mended, power the towers); the mended belt laid over bare rollers, broken track replaced, the tower's
cable fixed with pliers (rubber gloves on!), and the wrench on switches, drill and panels. The mid-game scenes
(midgameN.lzc: pictures with the Avatar as they are, and their words) play where the story calls for them - the
hatch, the power, the cable, the dream machine, the slippers. Mars itself as time passes (advance_time): by night on the surface those without warm enough clothes freeze; once
the air grows thin each needs oxium (a blob an hour) or gasps for air; radium outside its lead box poisons; ice melts;
the berries' powers fade; a tent keeps the party warm. In the dream, a step south off a cliff's edge is taken, wall or no, and the fall leaves the dreamer flat (crushing
Your Mother below); dream teleporters of the second kind set the dreamer walking on the walls, and back. Not yet: the
rest of what Nuvie left unfinished there (the direction-control squares).

A new game of Savage Empire begins in Intanya's hut (intro.lua's create_new_character): a name, then three of the
shaman's six questions, each answer adding to strength, dexterity or intelligence and choosing the next; its ending's
words are ready should the game be won. Savage Empire's usecode.lua has only a little in use, and that is ported:
corn from a corn stalk, clay with a digging stick, a soft pot shaped from clay, a branch pulled from a tree, and fish
caught with a pole beside deep water. Its containers (init.lua: mortars, grinding stones, jars, pouches, baskets and pots) hold
things, and looking at one on the ground searches it, as look.lua does: what it holds is tipped out beside it and
named.

**Combat** follows Ultima VI's rules as Nuvie's Lua has them: the hit roll (dexterity, or strength for clubs and
maces, against the foe's dexterity), weapon damage less a roll against readied armour, half damage for the creatures
that take it, poison, experience for evil foes slain, bodies that hold what was carried, ammunition, missile walls,
and death - the Avatar wakes in Lord British's castle with the fallen raised. Turns go by movement points, as
actor_update_all has them: each fighter gets their dexterity in points a turn, a step costs five (ten on the
diagonal) and a blow ten, and whoever has the most for their dexterity goes next - so the quick act more often than
the slow, the Avatar included. Each fights its own way (actor_wt_front, rear, flank, berserk, retreat, assault): the
front line forms between the party and its foes, the rear keeps behind it, flankers go round the side, the berserk
make for the strongest foe. Each companion's way is chosen on their sheet ("In a fight"); one set to Command is the
player's to move on their turn (the map follows them, and the log says whose turn it is). Thrown spears, axes and
daggers land where they were thrown, to be picked up again; a flask of oil bursts into flame; the triple crossbow
looses three bolts; a wand now and then vanishes. A ship whose hull gives out breaks up, leaving the party on a raft.
Monsters that know spells (mages, liches, dragons,
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
Magic things: a readied staff lets loose the spell charged into it (aim it if the spell needs aiming); an
invisibility ring hides whoever wears it; the storm cloak brings a rain that stills all magic for a while; the
amulet of submission will not come off once worn; and a fountain grants a wish, now and then, if the wish is for
food, mutton, wine, fruit or mead. Looking at a holy brazier names its flame: truth, love or courage.
A trapped door or chest springs its trap when opened - acid, poison, a fire blast or gas about the opener - unless
Detect Trap found it first and Untrap took it away.

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

Martian Dreams and Savage Empire have their music too (midi.ts): their MIDI songs (music.lzc) through a port of
Nuvie's OriginFXAdLibDriver with the games' own instruments (md.tim, savage.tim) - one of the longer songs at a time,
another when it ends, since Nuvie never chose among them in play.

The endings show their pictures with their words, in the ending's own palette (cutscene.ts reads the .shp and .lzc
image libraries and the .lbm, .pal and .int palettes). Ultima VI's and Martian Dreams' endings move as their ending.lua
scripts play them (anim.ts draws the sprites as ScriptCutscene does: hot spots, scaling, clipping, fading, the
palette turning): in Ultima VI the red gates rise from the floor with the stones' colours cycling, the kings come
and raise their lenses, the wall fades to streaming stars and the Codex wavers into view and opens; in Martian Dreams
the capsule rockets from Mars and bobs in the sea, the photographer's flash goes off by the moongate, and the dust
storm blows. Savage Empire's ending is still pictures, as its script has it.

Ultima VI's introduction can be watched before the gypsy ("Watch the introduction first"): intro.lua's words, a page
each, over its scenes in motion as the script plays them (u6intro.ts): the lounge, its television running through its
programmes and the clock telling the real time; the storm at the window, with clouds, rain, lightning and the bolt
among the stones, and the doors opening on it; the stones, the hand and the obsidian stone, the red gate rising and
quivering and the Avatar walking into it; then the altar, the gargoyles closing in and swaying, the priest and his
dagger, the gate in the dark, the rescue and the gate sinking. Each page goes on until Continue.

Martian Dreams offers its introduction before Freud, in motion as run_introduction plays it (mdintro.ts): one film
on its own clock, scenetxt.lzc's words changing beneath it in each speaker's colour - Spector's study and the
letter, the crosshairs marching across the map, the hike, Spector's lab with the moongate rising and the two
stepping through, and Tesla's lab in 1895 with its sparks, Freud's blood, Mr Garrett and Nellie. Savage Empire offers
its title in motion (seintro.ts: the two logos, the title rising over the jungle, the jungle sliding by in three
layers under the credits), then its story so far before Intanya (ten pictures from create.lzc, still as its script
has them).

Not ported yet: the rest of Martian Dreams' and Savage Empire's usecode (what Nuvie leaves commented out), and Savage Empire's fighting (Nuvie has none to port).

`tests/real.test.ts` runs on your copies put in `web/gamedata/ultima6/`, `savage/` and `martian/` (git-ignored).
For each it loads a new game, saves and restores it, and talks with everyone who has a conversation (199 people in
Ultima VI, 68 in Savage Empire, 99 in Martian Dreams). For Ultima VI it also hatches the opening gargoyles, fights a
troll to the death, readies and unreadies, casts spells, and goes through a red moongate.

Licensed as Nuvie is: GPL 2 or later. The music's synthesiser (@malvineous/opl) is GPL 3, so a build that
includes it is distributed under GPL 3.
