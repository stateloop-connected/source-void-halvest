# Void Halvest - Online Co-op

Void Halvest is an online two-player version of [Void Harvest](https://github.com/VictorZakharov/void-harvest-game) by Victor Zakharov (MIT licence). Two players, one harvest.

Changes from the original:

- **Online co-op on [Colyseus](https://colyseus.io) 0.18.** The server runs the whole simulation (`shared/sim/`) on a fixed 60 Hz step with seeded randomness. Browsers send inputs and draw the server's state. The local player's movement is predicted.
- **The Void Core.** A heavy bar with two handles. It moves only when both players hold a handle (hold E). Each carrier pushes their end; the core moves with the average and turns with the difference. Carry it into the green zone for XP, healing and score.
- **No pause online.** Level-up choices appear in a tray at the bottom (keys 1-4, R to reroll) while the game keeps running. XP is shared. Each player has their own cursor light.
- **Lobby.** Quick Match, private rooms with a 4-letter code, chat (Enter) and pings (G). The left menu button still starts the original single-player game.

## Running it locally

```bash
npm ci && npm run build            # client -> dist/
cd server && npm ci && npm start   # Colyseus on ws://localhost:2567
python3 -m http.server 8137 -d ../dist   # then open http://localhost:8137
```

The server accepts browser origins from `ALLOWED_ORIGINS` (default: the Stateloop play domains) plus `EXTRA_ORIGINS`.
`server/dev-server.sh` starts it in the background with `http://localhost:8137` allowed.
The client connects to `COOP_SERVER_URL` (set at build time). Only builds without it accept a `?COOP_SERVER_URL=` page parameter; the default is `ws://localhost:2567`.

Tests:

- `node shared/test/headless.mjs`: two scripted players play a full run in the simulation with no network; the same seed must give the same run.
- `cd server && node test/bots.mjs --seconds 60`: two network bots against a running server.
- `cd server && CODE=ABCD node test/partner-bot.mjs`: a bot partner that joins your room.

## Data

Online sessions are recorded by the Stateloop host as structured state (positions, holders, inputs, events, chat) for robot-learning research.
`stateloop.coop.json` and `levels/` describe units, shapes and goals for that conversion. The game code does not record anything itself.

---

*The original README follows.*

# Void Harvest - Roguelite (original)

A twin-stick shooter roguelite built with vanilla JavaScript and Three.js, featuring a full 3D world with dynamic lighting, instanced rendering, and 2-player local co-op.

**▶ [Play it in your browser](https://vhgame.netlify.app/)** — deployed automatically from the latest commit.

![Gameplay — surrounded by the swarm, mid-firefight](screenshots/gameplay.png)

<details>
<summary>Main menu</summary>

![Main menu](screenshots/menu.png)

</details>

## Documentation

- **[USER_GUIDE.md](USER_GUIDE.md)** - Complete gameplay guide with all stats and strategies
- **[CLAUDE.md](CLAUDE.md)** - Maintenance guide for AI assistants and developers
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical architecture, file map, and design patterns

## Features

- Twin-stick shooter mechanics (WASD + Mouse)
- 5 enemy types with unique behaviors (Basic, Fast, Tank, Shooter, Ice)
- 18 different skill upgrades with max levels
- Custom game mode with visual enemy and skill selection
- Status effects display for passive skills and debuffs
- Active skills HUD showing equipped abilities
- Meta-progression system with permanent unlocks
- Comprehensive stats tracking with run comparisons
- Wave-based difficulty scaling
- IMMERSIVE 3D VISUALS with dynamic lighting and matte aesthetic
- FREE ORBITAL CAMERA (Rotate & Zoom) with camera-relative movement
- PLANAR HEALTH BILLBOARDS for perfect readability
- Tactical QUICK FREEZE mode (Spacebar)
- Smart enemy spawning (off-screen guaranteed)
- Procedurally generated pixel art sprites
- HIGH-PERFORMANCE INSTANCED RENDERING (2500+ Enemies)
- AUTOSHOOT SYSTEM with manual override (Toggle 'Q')

## Controls

- **WASD** - Move (Camera Relative)
- **Mouse Left** - Aim and shoot
- **Mouse Right (Hold)** - Rotate Camera
- **Scroll Wheel** - Zoom In/Out
- **ESC** - Pause/Resume
- **SPACE** - Quick Freeze

## Development

### Setup

```bash
npm install
```

### Build Commands

```bash
# Development server on http://localhost:3000 with hot reload
npm run dev

# Production build (outputs to dist/ with content-hashed assets)
npm run build
```

The dev server includes:
- Hot module replacement (HMR) for instant updates
- Source maps for debugging
- Automatic browser opening
- Serves on http://localhost:3000

The production build creates:
- Minified JS and CSS
- Content-hashed filenames for cache busting
- Source maps for debugging
- Optimized bundle in `dist/` folder

### File Structure

For a complete and up-to-date file map with detailed descriptions, please refer to **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Game Systems

### Progression

1. **In-Run Leveling** - Kill enemies, gain XP, level up and choose skills
2. **Item Drops** - Collect XP orbs and health pickups
3. **Meta-Progression** - Spend Souls on permanent stat upgrades

### Skills

**Offensive:**
- Increased Damage, Rapid Fire, Multi-Shot, Piercing Shots
- Explosive Rounds (Splash Damage), Extended Range

**Defensive:**
- Max Health, Passive Heal, Armor
- Polar Vortex, Energy Shield, Deflect

**Survival & Utility:**
- Movement Speed, Freeze Chance, Magnet Range, Lucky Drops
- Light Radius, Personal Light (2P co-op), Extra Choice

Most skills level up to 3; Extra Choice, Energy Shield, and Personal Light are unique (max 1)

### Custom Game Mode

Test specific builds and enemy types with the custom game configuration:
- **Enemy Selection**: Choose which enemy types to spawn (visual card-based UI)
- **Skill Pre-selection**: Start with any skills at any level for testing
- **Visual Indicators**: Greyscale for starting skills, colored for earned skills
- Perfect for practice, testing, and learning enemy patterns

### Difficulty Scaling

- Waves increase every 15 seconds
- Enemy stats scale +10% per wave
- Additional scaling after wave 15 and 25
- Survive 10 minutes to win!

## Stats Tracking

The game tracks detailed stats including:
- Enemies killed by type
- Damage received by source
- Accuracy percentage
- Skills picked during run
- Run-to-run comparison with delta highlights

## License

[MIT](LICENSE)
