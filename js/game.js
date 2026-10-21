// ==================== GAME CLASS ====================
import {
  CANVAS_WIDTH, CANVAS_HEIGHT, GAME_DURATION, BASE_CAMERA_HEIGHT,
  WAVE_DURATION, INITIAL_SPAWN_RATE, MIN_SPAWN_RATE, SPAWN_RATE_DECREASE,
  PARTICLE_COUNT_HIT, PARTICLE_COUNT_DEATH,
  WEATHER_DURATION, WEATHER_FADE_TIME, WEATHER_WARNING_TIME,
  WEATHER_INTERVAL_MIN, WEATHER_INTERVAL_MAX, WEATHER_SLOW_AMOUNT,
  HEALTH_DROP_BASE_RATE, HEALTH_RESTORE_AMOUNT,
  POLAR_VORTEX_RADIUS, GAMEOVER_DOWNED_DELAY
} from './constants.js';
import { BIOMES, WEATHER_TYPES, DEFAULT_FOG_DENSITY } from './biomes.js';
import { Player } from './entities/Player.js';
import { Enemy } from './entities/Enemy.js';
import { EnemySpawner } from './entities/enemy-spawner.js';
import { BulletManager } from './entities/bullet-manager.js';
import { ItemManager } from './entities/item-manager.js';
import { ParticleManager } from './entities/particle-manager.js';
import { Item } from './entities/Item.js';
import { Particle } from './particles.js';
import { TextureGenerator } from './texture-generator.js';
import { WeatherSystem } from './weather-system.js';
import { InputHandler } from './input.js';
import { META_UPGRADES, SKILLS } from './skills.js';
import { UIManager } from './ui.js';
import { StatsManager } from './stats.js';
import * as THREE from 'three';

import { RenderingManager } from './RenderingManager.js';
import { EnemyInstancedRenderer } from './entities/EnemyInstancedRenderer.js';
import { HealthBarSystem } from './ui/HealthBarSystem.js';
import { MinimapSystem } from './ui/MinimapSystem.js';
import { PlayerOverheadUI } from './ui/PlayerOverheadUI.js';
import { LightingManager } from './LightingManager.js';
import { PersistenceManager } from './PersistenceManager.js';
import { WeatherManager } from './WeatherManager.js';
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { SpatialHash } from './systems/SpatialHash.js';
import { TargetingSystem } from './systems/TargetingSystem.js';
import { ResurrectionSystem } from './systems/ResurrectionSystem.js';
import { CameraSystem } from './systems/CameraSystem.js';
import { GameInputSystem } from './systems/GameInputSystem.js';
import { LevelUpEffectSystem } from './systems/LevelUpEffectSystem.js';
import { SkillCardEffectSystem } from './systems/SkillCardEffectSystem.js';
import { DownedLevelUpDustSystem } from './systems/DownedLevelUpDustSystem.js';
import { GameSessionManager } from './GameSessionManager.js';
import { EnemyManager } from './entities/EnemyManager.js';
import { NetSession } from './net/NetSession.js';

export class Game {
  constructor() {
    this.persistence = new PersistenceManager();
    this.metaProgress = this.persistence.loadMetaProgress();


    // Robust Initialization of Souls
    let loadedSouls = Number(this.metaProgress.souls);
    if (isNaN(loadedSouls)) loadedSouls = 0;
    this.totalSouls = loadedSouls;

    // Load Game Speed (Default 0.85 = Fast). Clamp legacy saves — Fast
    // used to be 1.0; snap them onto the current Fast button.
    const savedSpeed = this.metaProgress.gameSpeed !== undefined ? this.metaProgress.gameSpeed : 0.85;
    this.timeScale = Math.min(savedSpeed, 0.85);
    // Transient multiplier on top of timeScale (0..1), used by the skill
    // card cinematic to ramp gameplay speed back up after a level-up freeze
    this.timeDilation = 1.0;

    // SP death sequence: downed animation plays before the game over screen
    this.gameOverPending = false;
    this.gameOverTimer = 0;

    this.ui = new UIManager(this);
    this.canvas = this.ui.dom.gameCanvas;
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    this.input = new InputHandler(this.ui.dom.gameCanvas);
    this.state = 'start'; // start, playing, paused, gameover
    this.gameLoopRunning = false;

    // Initialize stats early for managers
    this.stats = this.persistence.stats;

    // Initialize Managers
    this.rendering = new RenderingManager(this.canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.scene = this.rendering.scene; // Helper reference

    this.lighting = new LightingManager(this.scene);
    // Initialize Instanced Renderer
    // Capacity 15000 to handle high spawn rate stress tests without buffer overflow
    this.spatialHash = new SpatialHash(150); // Cell size approx max enemy size + speed buffer
    this.physicsSystem = new PhysicsSystem(this); // Physics & Collision

    // Phase 3 Managers
    this.sessionManager = new GameSessionManager(this);
    this.enemyManager = new EnemyManager(this);

    this.init3D();

    this.sessionManager.reset();
  }

  init3D() {
    // Create Ground
    const groundGeometry = new THREE.PlaneGeometry(10000, 10000);
    this.groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x224422,
      roughness: 0.8,
      metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Initialize Weather System
    this.weatherSystem = new WeatherSystem(this.scene);
    this.weather = new WeatherManager(this.weatherSystem, this.ui.dom);

    // Field Boundaries
    const boundaryGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(CANVAS_WIDTH, 2, 0),
      new THREE.Vector3(CANVAS_WIDTH, 2, CANVAS_HEIGHT),
      new THREE.Vector3(0, 2, CANVAS_HEIGHT),
      new THREE.Vector3(0, 2, 0)
    ]);
    const boundaryMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2, toneMapped: false });
    const boundaryLine = new THREE.Line(boundaryGeo, boundaryMat);
    this.scene.add(boundaryLine);

    // Initialize lists
    this.enemies = [];

    // MANAGERS
    this.particleManager = new ParticleManager(this.scene);
    this.instancedRenderer = new EnemyInstancedRenderer(this.scene, 15000); // Support up to 3000 enemies
    this.healthBarSystem = new HealthBarSystem(this.scene);
    this.overheadUI = new PlayerOverheadUI(this.scene);
    this.minimap = new MinimapSystem(this, this.ui.dom.minimapContainer, this.ui.dom.minimapCanvas);

    this.enemySpawner = new EnemySpawner(this.scene, this.enemies, this.healthBarSystem);
    this.targetingSystem = new TargetingSystem(this.spatialHash, this.lighting);
    this.resurrectionSystem = new ResurrectionSystem(this.particleManager);
    this.cameraSystem = new CameraSystem(this.rendering, this.input);
    this.gameInputSystem = new GameInputSystem(this);
    this.levelUpEffect = new LevelUpEffectSystem(this, this.scene);
    this.skillCardEffect = new SkillCardEffectSystem(this);
    this.downedLevelUpDust = new DownedLevelUpDustSystem(this);

    this.bulletManager = new BulletManager(this.scene, this.stats, this.spatialHash, {
      createParticles: (x, y, c, count) => this.particleManager.create(x, y, c, count),
      createExplosion: (x, y, c, r) => this.particleManager.createExplosion(x, y, c, r),
      onGameOver: () => {
        if (this.isMultiplayer && this.players) {
          // Check if ALL players are dead/downed
          const allDead = this.players.every(p => p.isDowned || p.health <= 0);
          if (allDead) this.gameOver();
        } else {
          this.gameOver();
        }
      },
      onCameraShake: (amount) => {
        this.cameraSystem.addShake(amount);
      },
      onEnemyDeath: (enemy) => this.onEnemyDeath(enemy),
      onEnemyHit: (enemy, damage) => { /* Optional hook */
      }
    });

    this.itemManager = new ItemManager(this.scene, this.player, this.metaProgress, {
      // All level-ups go through the UIManager queue so 2P turns stay
      // sequential; downed players get the dust tribute turn instead of
      // the invigoration + pick (decided in showLevelUpScreen's beginFor)
      onLevelUp: (player) => this.ui.showLevelUpScreen(player)
    });
  }

  reset(commitHistory = false) {
    // Clear existing objects
    if (this.levelUpEffect) this.levelUpEffect.cancel();
    if (this.skillCardEffect) this.skillCardEffect.cancel();
    if (this.downedLevelUpDust) this.downedLevelUpDust.cancel();
    this.timeDilation = 1.0;
    this.gameOverPending = false;
    this.gameOverTimer = 0;
    if (this.skipDeathWaitListener) {
      window.removeEventListener('pointerdown', this.skipDeathWaitListener);
      this.skipDeathWaitListener = null;
    }
    if (this.ui && this.ui.hideGameOverBanner) this.ui.hideGameOverBanner();

    // 1. Standard Cleanup via References
    if (this.players) {
      this.players.forEach(p => {
        if (p && p.visuals) p.visuals.dispose();
      });
    } else if (this.player && this.player.visuals) {
      this.player.visuals.dispose();
    }

    // 2. Robust Safety Sweep (Fixes "Ghost Players" and Texture Warnings)
    // Find any remaining Player Groups that leaked (e.g. from previous bugs)
    if (this.scene) {
      for (let i = this.scene.children.length - 1; i >= 0; i--) {
        const child = this.scene.children[i];
        if (child.name === 'PlayerGroup') {
          this.scene.remove(child);
        }
      }
    }

    if (this.enemies) {
      this.enemies.forEach(e => this.scene.remove(e.mesh));
      this.enemies.length = 0;
    }
    if (this.bulletManager) this.bulletManager.clear();
    if (this.itemManager) this.itemManager.clear();
    if (this.particleManager) this.particleManager.clear();
    if (this.healthBarSystem) this.healthBarSystem.clear();
    if (this.overheadUI) this.overheadUI.clear();

    // Reset players array
    this.players = [];

    // Select Biome
    if (this.customBiome) {
      this.currentBiome = BIOMES[this.customBiome.toUpperCase()] || BIOMES.NEUTRAL;
    } else {
      let keys = Object.keys(BIOMES);
      const lastId = this.metaProgress.lastBiomeId;
      if (lastId) {
        const filtered = keys.filter(k => BIOMES[k].id !== lastId);
        if (filtered.length > 0) keys = filtered;
      }
      const randomKey = keys[Math.floor(Math.random() * keys.length)];
      this.currentBiome = BIOMES[randomKey];
    }

    // Only save history if this is a REAL game start
    if (commitHistory && !this.customBiome) {
      this.metaProgress.lastBiomeId = this.currentBiome.id;
      this.persistence.saveMeta(this.metaProgress);
    }

    this.applyBiomeVisuals();

    // Weather System
    if (this.weather) {
      this.weather.weatherState = 'none';
      this.weather.weatherTimer = 0;
      this.weather.nextWeatherTimer = Math.random() * (WEATHER_INTERVAL_MAX - WEATHER_INTERVAL_MIN) + WEATHER_INTERVAL_MIN;
    }
    this.baseFogDensity = DEFAULT_FOG_DENSITY;

    if (this.weatherSystem) {
      this.weatherSystem.stopWeather();
    }

    // Create players
    if (this.isMultiplayer) {
      // P1: Left, P2: Right
      // P1: Left, P2: Right
      const c1 = this.playerColors ? this.playerColors[0] : '#00ffff';
      const c2 = this.playerColors ? this.playerColors[1] : '#0088ff';
      const p1 = new Player(CANVAS_WIDTH / 2 - 60, CANVAS_HEIGHT / 2, this.scene, 0, c1); // ID 0
      const p2 = new Player(CANVAS_WIDTH / 2 + 60, CANVAS_HEIGHT / 2, this.scene, 1, c2); // ID 1
      p1.canBeRevived = true;
      p2.canBeRevived = true;
      this.players = [p1, p2];
    } else {
      // Single Player (ID 0)
      const c1 = this.playerColors ? this.playerColors[0] : '#00ffff';
      const p1 = new Player(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, this.scene, 0, c1);
      this.players = [p1];
    }

    if (this.overheadUI) {
      this.overheadUI.clear();
      this.players.forEach(p => this.overheadUI.register(p));
    }

    // Legacy support / Primary player ref
    this.player = this.players[0];

    // Update managers with new player instance(s)
    // Managers needing single player ref might default to P1
    if (this.itemManager) this.itemManager.players = this.players; // Update ItemManager to handle array

    // Update managers with new player instance
    if (this.itemManager) this.itemManager.player = this.player;

    this.applyMetaUpgrades();

    // Reset all game timers and counters
    this.spawnTimer = 0;
    this.spawnRate = INITIAL_SPAWN_RATE;
    this.difficultyTimer = 0;
    this.gameTime = 0;
    this.kills = 0;
    this.frameCount = 0;
    this.wave = 1;

    // Reset camera
    if (this.cameraSystem) this.cameraSystem.reset();

    // Sync minimap visibility with current state (hides it on exit to menu)
    if (this.minimap) this.minimap.update();

    // Reset input state
    if (this.gameInputSystem) this.gameInputSystem.reset();

    // Initialize stats
    this.persistence.resetRunStats();
    this.stats = this.persistence.stats;
    if (this.bulletManager) this.bulletManager.stats = this.stats;

    // Trigger debug weather
    if (this.debugWeather && this.weather) {
      this.weather.triggerWeather(this.currentBiome);
    }

    // Training Mode Check
    this.trainingMode = false;
    if (this.customEnemies) {
      // Check if any enemy is enabled
      const anyEnabled = Object.values(this.customEnemies).some(e => e === true);
      if (!anyEnabled) {
        this.trainingMode = true;
      }
    }
  }

  applyMetaUpgrades() {
    this.sessionManager.applyMetaUpgrades();
  }

  applyCustomSkills() {
    this.sessionManager.applyCustomSkills();
  }

  applyBiomeVisuals() {
    this.sessionManager.applyBiomeVisuals();
  }

  start() {
    this.netMode = false;
    this.sessionManager.start();
  }

  /** The online co-op session (created on first use). */
  ensureNet() {
    if (!this.net) this.net = new NetSession(this);
    return this.net;
  }

  gameLoop() {
    const now = performance.now();
    const dt = now - this.lastTime;
    this.lastTime = now;

    // --- FPS Calculation ---
    if (!this.fpsTime) this.fpsTime = now;
    if (!this.frames) this.frames = 0;

    this.frames++;
    if (now >= this.fpsTime + 1000) {
      this.fps = this.frames; // Update FPS property for debug dump
      if (this.ui && this.ui.updateFPS) this.ui.updateFPS(this.frames); // Update UI if method exists
      else if (this.ui && this.ui.dom && this.ui.dom.fpsCounter) this.ui.dom.setText(this.ui.dom.fpsCounter, 'FPS: ' + this.frames);

      this.frames = 0;
      this.fpsTime = now;
    }
    // -----------------------



    // --- Input System Update ---
    if (this.gameInputSystem) {
      this.gameInputSystem.update(dt);
    }

    // Initialize perf stats if missing
    if (!this.perfStats) this.perfStats = { logic: 0, render: 0, count: 0 };

    let t1, t2, t3;

    if (this.netMode && this.net) {
      // Online co-op: the server simulates; we send inputs and mirror its state.
      // The shared world keeps running, so one bad frame must not stop the loop.
      try {
        t1 = performance.now();
        this.net.frame(now, dt);
        t2 = performance.now();
        if (this.state !== 'start') {
          this.render3D(dt);
          t3 = performance.now();
        }
      } catch (err) {
        if (!this._netFrameErr) console.error('[online] frame error', err);
        this._netFrameErr = (this._netFrameErr || 0) + 1;
      }
    } else if (this.state === 'playing') {
      t1 = performance.now();
      this.update(dt);
      t2 = performance.now();
    }

    if (!this.netMode && this.state !== 'start') {
      if (!t2) t2 = performance.now(); // Handle case where update wasn't called (paused)
      this.render3D(dt);
      t3 = performance.now();
    }

    // Accumulate stats if playing (ignore paused frames for stats usually, but here we capture everything)
    if (t1 && t3) {
      this.perfStats.logic += (t2 - t1);
      this.perfStats.render += (t3 - t2);
      this.perfStats.count++;
    }

    // FPS Calculation
    this.frameCount++;
    this.fpsTimer = (this.fpsTimer || 0) + dt;
    if (this.fpsTimer >= 500) { // Update every 500ms
      const fps = Math.round((this.frameCount * 1000) / this.fpsTimer);
      if (this.ui && this.ui.dom && this.ui.dom.fpsCounter) {
        this.ui.dom.fpsCounter.textContent = `FPS: ${fps}`;
      }
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    requestAnimationFrame(() => this.gameLoop());
  }

  handleFrozenState() {
    let hasResumeInput = false;
    ['w', 'a', 's', 'd'].forEach(k => {
      if (this.input.keys[k]) {
        const ignored = this.manualFreeze && this.ignoreKeys && this.ignoreKeys.has(k);
        if (!ignored) hasResumeInput = true;
      } else {
        if (this.manualFreeze && this.ignoreKeys) this.ignoreKeys.delete(k);
      }
    });

    if (this.input.mouseDown) {
      const ignored = this.manualFreeze && this.ignoreMouse;
      if (!ignored) hasResumeInput = true;
    } else {
      if (this.manualFreeze) this.ignoreMouse = false;
    }

    if (hasResumeInput) {
      this.unfreeze();
    } else {
      if (this.ui) this.ui.showFrozenMessage(true);
    }
  }

  /**
   * Updates game state, including player, enemies, spawning, and weather.
   * @param {number} dt - Time since last frame in milliseconds.
   */
  update(dt) {
    // Apply time scaling to the entire update step
    // Standardize to ~144 FPS (6.94ms) to restore original fast paced feel
    // (Previous logic was implicit 144hz dependent, so we target that baseline)
    const TARGET_DT = 6.944;
    const safeDt = Math.min(dt, 100); // Cap at 100ms
    const dtFactor = safeDt / TARGET_DT;

    // Effective Scale = TimeScale (User setting) * Dilation (resume ramp) * DT Correction
    const effectiveScale = this.timeScale * this.timeDilation * dtFactor;

    // Advance game time by the scaled amount
    this.gameTime += effectiveScale;

    // SP catch-all: any damage source can down the player (e.g. the freeze
    // DoT bypasses the collision game-over checks), so detect it centrally.
    if (!this.isMultiplayer && this.player && this.player.isDowned) {
      this.gameOver();
    }

    // SP death sequence: the world keeps running while the downed animation
    // plays, then the game over screen appears. Fast mode shortens the wait
    // (game time), but slow mode never stretches it past real time.
    if (this.gameOverPending) {
      this.gameOverTimer -= Math.max(dtFactor, effectiveScale);
      if (this.gameOverTimer <= 0) {
        this.gameOverPending = false;
        this.sessionManager.gameOver();
        return;
      }
    }

    if (this.weather) {
      const newFog = this.weather.update(this.player, this.currentBiome, DEFAULT_FOG_DENSITY, effectiveScale);
      if (newFog !== null) this.baseFogDensity = newFog;
    }

    if (this.gameTime >= GAME_DURATION * 60) {
      this.win();
      return;
    }

    const target = this.rendering.getMouseWorldPosition(this.input.mouseX, this.input.mouseY);



    let aimX = target.x;
    let aimZ = target.z;
    let autoFiring = false;

    // Autoshoot Targeting
    if (this.autoshootEnabled && this.autoshootOverrideTimer <= 0) {
      const nearest = this.targetingSystem.findTarget(this.player);

      if (nearest) {
        aimX = nearest.x + nearest.width / 2;
        aimZ = nearest.y + nearest.height / 2;
        autoFiring = true;
      }
    }

    // Lighting Update (Follows P1 Mouse)
    const targetForLighting = this.rendering.getMouseWorldPosition(this.input.mouseX, this.input.mouseY);

    // Pass P1 for lighting bonuses if available
    // Pass P1 and P2 for lighting
    const p1 = this.players[0] || this.player;
    const p2 = this.players[1];
    this.lighting.update(targetForLighting, p1, p2);

    // Player Updates
    // Player Updates
    this.players.forEach((p, index) => {
      // Pass global input to all players. Player class handles ID-based key filtering.

      // Determine Aim Target
      let pAimX, pAimZ;
      let targetFound = false;

      if (index === 0) {
        // P1 uses calculated aim (Mouse or Auto-Aim)
        pAimX = aimX;
        pAimZ = aimZ;
      } else {
        // P2 uses Auto-Aim ONLY (Nearest Enemy)
        const nearestP2 = this.targetingSystem.findTarget(p);

        if (nearestP2) {
          pAimX = nearestP2.x + nearestP2.width / 2;
          pAimZ = nearestP2.y + nearestP2.height / 2;
          targetFound = true;
        } else {
          // No target: Aim forward or keep last?
          // Default aim direction: Movement direction or forward.
          pAimX = p.x;
          pAimZ = p.y - 100; // Default up
          targetFound = false;
        }
      }

      p.update(this.input, pAimX, pAimZ, this.rendering.camYaw || 0, effectiveScale);

      // Shooting
      // P1: Manual or Auto (Inherits from Q toggle)
      if (index === 0) {
        // autoFiring is true if Autoshoot system found a target and is enabled
        if (p.shoot(this.input.mouseDown || autoFiring)) {
          this.bulletManager.createPlayerBullets(p);
        }
      }

      // P2 Always Autoshoots at Nearest Enemy
      if (index === 1 && !p.isDowned && p.health > 0 && targetFound) {
        if (p.shoot(true)) {
          this.bulletManager.createPlayerBullets(p);
        }
      }
    });

    // Resurrection Logic (Multiplayer Only)
    // Delegated to ResurrectionSystem
    if (this.isMultiplayer && this.state === 'playing') {
      this.resurrectionSystem.update(this.players, this.input, effectiveScale);
    }

    // Camera Logic (Average Position or P1?)
    // "Two players will appear on screen... close enough to share light".
    // Camera should probably center on midpoint.



    if (this.gameOverPending) {
      // Death sequence: no new enemies while the world is frozen
    } else if (this.trainingMode) {
      // Training Mode: Maintain constant dummy population
      this.enemySpawner.updateTrainingMode(this.player);
    } else {
      // Normal Wave Logic
      this.spawnTimer += effectiveScale;
      if (this.spawnTimer >= this.spawnRate) {
        this.spawnTimer = 0;

        // Check max enemies limit (corpses don't count against the cap)
        const maxEnemies = this.customMaxEnemies || 9999;
        let aliveCount = 0;
        for (const e of this.enemies) {
          if (!e.isDying) aliveCount++;
        }
        if (aliveCount < maxEnemies) {
          this.enemySpawner.spawn(this.wave, this.player, this.customEnemies);
        }
      }
    }

    this.difficultyTimer += effectiveScale;
    // Only increase difficulty (spawn rate decrease) if NOT using custom spawn rate
    if (this.difficultyTimer >= WAVE_DURATION) {
      this.difficultyTimer = 0;
      this.wave++;

      if (!this.customSpawnRate) {
        this.spawnRate = Math.max(MIN_SPAWN_RATE, this.spawnRate - SPAWN_RATE_DECREASE);
      }
    }

    const playerBounds = this.player.getBounds();
    let speedMod = (this.weather && this.weather.weatherState === 'active') ? (1 - WEATHER_SLOW_AMOUNT) : 1;

    if (this.player.triggerShockwave) {
      this.physicsSystem.handleShockwave();
    }

    // Populate Spatial Hash

    this.spatialHash.clear();
    for (const enemy of this.enemies) {
      // Dying corpses are visual-only: no collisions, bullets, or targeting
      if (!enemy.isDying) this.spatialHash.insert(enemy);
    }

    // --- Enemy Updates (Delegate to Manager) ---
    this.enemyManager.update(effectiveScale, playerBounds, speedMod);

    // --- System Updates ---
    // Update physics simulation with scaled delta time to maintain consistency during slow-motion.
    this.physicsSystem.update(dt * this.timeScale * this.timeDilation);

    // Update game systems (Bullets, Items, Particles) with the effective time scale (including DT correction).
    this.bulletManager.update(this.players, this.enemies, effectiveScale, this.friendlyFire);
    this.itemManager.update(effectiveScale);
    this.particleManager.update();

    this.ui.updateHUD();
  }



  /**
   * Renders the 3D scene, updating fog, camera, and all visible meshes.
   */
  render3D(dt = 16) {
    this.rendering.updateFog(this.baseFogDensity, 800, DEFAULT_FOG_DENSITY);


    // Camera System Update
    if (this.cameraSystem) {
      // Online each client follows its own player (the partner may be far away)
      let camPlayers = this.players;
      if (this.netMode && this.player) {
        camPlayers = (!this.player.isBledOut) ? [this.player] : this.players;
      }
      this.cameraSystem.update(dt, camPlayers, this.state);
    }

    const target = this.lighting.getCursorTarget();

    // Calculate animation delta (0 if paused/frozen)
    const animDelta = (this.state === 'playing' ? this.timeScale * this.timeDilation : 0) * dt;
    // Update mesh for ALL players
    this.players.forEach(p => p.updateMesh(animDelta));

    // Level-up invigoration runs on real time while gameplay is frozen.
    // Must run after updateMesh so its body glow overrides the restore pass.
    if (this.levelUpEffect) this.levelUpEffect.update(dt);

    // Skill card pick cinematic (DOM clone + overlay particles + resume ramp)
    if (this.skillCardEffect) this.skillCardEffect.update(dt);

    // Downed player's level-up dust (orbit + scatter, no invigoration)
    if (this.downedLevelUpDust) this.downedLevelUpDust.update(dt);

    // Keep the status toast ([Q] Autoshoot etc.) anchored under the player
    if (this.ui && this.ui.updateStatusMessagePosition) this.ui.updateStatusMessagePosition();

    // Keep the GAME OVER banner anchored above the downed player
    if (this.ui && this.ui.updateGameOverBannerPosition) this.ui.updateGameOverBannerPosition();

    // 2P: "PLAYER X IS DOWN" rescue call above a downed teammate
    if (this.ui && this.ui.updateDownedBanner) this.ui.updateDownedBanner();

    // Update Instanced Renderer (Batches all enemies)
    // We pass player and cursorTarget for visibility/culling logic (Fog of War)
    const cursorTargetForCull = this.lighting.getCursorTarget();
    this.instancedRenderer.update(this.enemies, animDelta, this.player, cursorTargetForCull);

    // Bullet logic runs once per tick in update() — a second update here
    // would advance bullets per render frame (frame-rate dependent speed).

    // Update Overlay Visuals (Heath Bars)
    this.healthBarSystem.update(this.rendering.camera3D, this.player, cursorTargetForCull, this.enemies);
    if (this.overheadUI) this.overheadUI.update();

    this.bulletManager.updateMeshes();
    this.itemManager.updateMeshes();
    if (this.minimap) this.minimap.update();
    // Shake applied in CameraSystem update() now, but needs to be called per frame? 
    // Wait, update() does logic. render3D does interpolate.
    // The cameraSystem.update() includes applyShake().
    this.rendering.render();
  }

  onEnemyDeath(enemy) {
    // Guard against double-kills in the same frame (pierce + splash, etc.)
    if (enemy.isDying) return;

    if (enemy.type === 'tank') {
      this.cameraSystem.addShake(5);
    }
    this.kills++;
    this.stats.enemiesKilled[enemy.type]++;
    this.particleManager.create(enemy.x, enemy.y, '#ff0000', PARTICLE_COUNT_DEATH);
    this.itemManager.spawnXP(enemy.x, enemy.y, enemy.xpValue);

    this.runSouls = (this.runSouls || 0) + (enemy.soulsValue || 0);

    // The corpse topples and fades; EnemyManager removes it when done.
    this.healthBarSystem.unregister(enemy);
    enemy.startDeath();
  }

  gameOver() {
    if (this.state === 'gameover' || this.gameOverPending) return;

    // Single player: don't cut straight to the modal — let the downed
    // animation play out first (delay handled in update()).
    if (!this.isMultiplayer) {
      this.gameOverPending = true;
      this.gameOverTimer = GAMEOVER_DOWNED_DELAY;

      // Cinematic: GAME OVER banner slams in above the downed player
      if (this.ui && this.ui.showGameOverBanner) this.ui.showGameOverBanner();
      if (this.cameraSystem) this.cameraSystem.addShake(8);

      // A click during the wait skips ahead to the menu scaffold (the
      // hand-off animation still plays — the click only cuts the wait).
      // mousedown (not held state) so the fire button held at death
      // doesn't insta-skip; the player must click fresh.
      this.skipDeathWaitListener = () => {
        if (this.gameOverPending) this.gameOverTimer = 0;
        this.skipDeathWaitListener = null;
      };
      window.addEventListener('pointerdown', this.skipDeathWaitListener, { once: true });
      return;
    }

    this.sessionManager.gameOver();
  }

  win() {
    this.sessionManager.win();
  }

  // Input/State methods (togglePause, toggleFreeze, handleFrozenState, etc) 
  // have been moved to GameInputSystem. Checks in update() call them. 
  // However, `win`, `gameOver`, `win` still manipulate state directly.
  // We can keep specific helpers if needed, but the bulk logic is extracted.


  updateGlobalLights() {
    this.lighting.updateGlobalLights(this.player);
  }

  loadPreviousStats() {
    return this.persistence.loadPreviousStats();
  }

  saveCurrentStats() {
    this.persistence.saveRun(this.player.level);
  }

  loadMetaProgress() {
    return this.persistence.loadMetaProgress();
  }

  saveMetaProgress() {
    this.persistence.saveMeta(this.metaProgress);
  }

  getRunSouls() {
    return Math.floor(this.kills / 5) + Math.max(0, (this.player.level - 1) * 2);
  }

}
