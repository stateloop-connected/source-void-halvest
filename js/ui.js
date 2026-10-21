// ==================== UI MANAGEMENT ====================
import { updateHUD } from './ui-hud.js';
import { showLevelUpScreen } from './ui-levelup.js';
import { showGameOverStats } from './ui-gameover.js';
import { showMetaUpgrades, showResetConfirmation, performMetaReset } from './ui-meta.js';
import { showGuide } from './ui-modals.js';
import { showPauseScreen, resumeGame } from './ui-pause.js';
import { CustomGameUI } from './ui-custom.js';
import { DOMCache } from './DOMCache.js';
import * as THREE from 'three';

export class UIManager {
  constructor(game) {
    this.game = game;
    this.dom = new DOMCache();
    this.customGameUI = new CustomGameUI(game, this.dom);
    this.customSkills = {};
    this.customEnemies = {
      basic: true,
      fast: true,
      tank: true,
      shooter: true,
      ice: true
    };
    this.customBiome = { value: null };
    this.setupEventHandlers();
    this.setupSpeedControls();
    this.setupMainParallax();
    this.setupSpeedControls();
    this.setupMainParallax();
    this.updateMainMenuSouls();

    // Multiplayer Queue
    this.levelUpQueue = [];
    this.isLevelUpActive = false;
  }

  // ... (unchanged methods)

  // Replaced loose function calls with method calls
  renderCustomSkillSelection() {
    this.customGameUI.renderSkillSelection(this.customSkills, () => {
      this.renderCustomSkillSelection();
    });
  }

  renderCustomEnemySelection() {
    this.customGameUI.renderEnemySelection(this.customEnemies, () => {
      this.renderCustomEnemySelection();
    });
  }

  renderCustomBiomeSelection() {
    this.customGameUI.renderBiomeSelection(this.customBiome, () => {
      this.renderCustomBiomeSelection();
    });
  }

  setupSpeedControls() {
    // Initialize buttons based on current speed
    this.updateSpeedButtons(this.game.timeScale || 1.0);

    const speedBtns = document.querySelectorAll('.speed-btn');
    speedBtns.forEach(btn => {
      btn.onclick = (e) => {
        const speed = parseFloat(e.target.dataset.speed);
        this.game.timeScale = speed;

        // Save to persistence
        this.game.metaProgress.gameSpeed = speed;
        this.game.saveMetaProgress();

        this.updateSpeedButtons(speed);
      };
    });
  }

  updateSpeedButtons(activeSpeed) {
    document.querySelectorAll('.speed-btn').forEach(btn => {
      const btnSpeed = parseFloat(btn.dataset.speed);
      if (activeSpeed === btnSpeed) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  updateMainMenuSouls() {
    if (this.dom.mainSoulsDisplay && this.dom.mainSoulsCount) {
      const souls = this.game.totalSouls || 0;
      this.dom.setText(this.dom.mainSoulsCount, souls);
      this.dom.show(this.dom.mainSoulsDisplay);
    }
  }

  setupEventHandlers() {
    // Void Halvest: the main button opens the online co-op lobby.
    this.dom.startBtn.onclick = () => {
      this.dom.hide(this.dom.startScreen);
      this.game.ensureNet().hud.openLobby();
    };

    this.dom.metaBtn.onclick = () => {
      this.showMetaUpgrades();
    };

    this.dom.guideBtn.onclick = () => {
      this.showGuide();
    };

    this.dom.closeGuideBtn.onclick = () => {
      this.dom.hide(this.dom.guideModal);

      // Return to start screen
      if (this.game.state === 'start') {
        this.dom.show(this.dom.startScreen);
      }
    };

    this.dom.closeGuideX.onclick = () => {
      this.dom.hide(this.dom.guideModal);

      // Return to start screen
      if (this.game.state === 'start') {
        this.dom.show(this.dom.startScreen);
      }
    };

    this.dom.customBtn.onclick = () => {
      this.dom.hide(this.dom.startScreen);
      this.renderCustomEnemySelection();
      this.renderCustomSkillSelection();
      this.renderCustomBiomeSelection();
      this.dom.show(this.dom.customModal);
    };

    // The left pill now starts the original single-player run (not online).
    if (this.dom.multiplayerBtn) {
      this.dom.multiplayerBtn.onclick = () => {
        this.dom.hide(this.dom.startScreen);
        this.game.debugWeather = false;
        this.game.customEnemies = null;
        this.game.customSkills = null;
        this.game.customBiome = null;
        this.game.customSpawnRate = null;
        this.game.customMaxEnemies = null;
        this.game.playerColors = null;
        this.game.isMultiplayer = false;
        this.game.start();
      };
    }

    if (this.dom.startCoopBtn) {
      this.dom.startCoopBtn.onclick = () => {
        this.dom.hide(this.dom.lobbyModal);
        this.game.debugWeather = false;
        // Clear custom stuffs
        this.game.customEnemies = null;
        this.game.customSkills = null;
        this.game.customBiome = null;
        this.game.customSpawnRate = null;
        this.game.customMaxEnemies = null;

        // Enable Multiplayer Flag
        this.game.isMultiplayer = true;

        // Custom Colors
        const p1Color = document.getElementById('p1-color').value;
        const p2Color = document.getElementById('p2-color').value;
        this.game.playerColors = [p1Color, p2Color];

        // Remember the choices for the next session
        this.game.metaProgress.lobbyColors = [p1Color, p2Color];
        this.game.saveMetaProgress();

        this.game.start();
      };
    }

    if (this.dom.closeLobbyModal) {
      this.dom.closeLobbyModal.onclick = () => {
        if (this.game.net && this.game.net.room) this.game.net.leave();
        this.dom.hide(this.dom.lobbyModal);
        this.dom.show(this.dom.startScreen);
      };
    }

    this.dom.startCustomBtn.onclick = () => {
      this.dom.hide(this.dom.customModal);
      this.game.customEnemies = { ...this.customEnemies };
      this.game.customSkills = { ...this.customSkills }; // Pass selected skills
      this.game.customBiome = this.customBiome.value; // Pass selected biome
      this.game.debugWeather = this.dom.debugWeatherCheck.checked;

      // New Game Mode Flags
      const is2P = document.getElementById('custom-2p-check').checked;
      const friendlyFire = document.getElementById('custom-friendly-fire-check').checked;

      this.game.isMultiplayer = is2P;
      this.game.friendlyFire = is2P && friendlyFire;
      // Custom mode has no color pickers — don't inherit lobby colors
      this.game.playerColors = null;

      const rateVal = parseFloat(this.dom.customSpawnRateInput.value);
      this.game.customSpawnRate = isNaN(rateVal) ? null : rateVal;

      const maxVal = parseInt(this.dom.customMaxEnemiesInput.value);
      this.game.customMaxEnemies = isNaN(maxVal) ? null : maxVal;

      this.game.start();
    };

    // Toggle Friendly Fire based on 2P check
    const p2Check = document.getElementById('custom-2p-check');
    const ffCheck = document.getElementById('custom-friendly-fire-check');
    if (p2Check && ffCheck) {
      p2Check.onchange = () => {
        ffCheck.disabled = !p2Check.checked;
        if (!p2Check.checked) ffCheck.checked = false;
      };
    }

    // Close Button (X)
    if (this.dom.closeCustomModal) {
      this.dom.closeCustomModal.onclick = () => {
        this.dom.hide(this.dom.customModal);
        this.dom.show(this.dom.startScreen); // Return to start
      };
    }

    // Custom Game Speed Buttons are handled globally by setupSpeedControls()

    // Game Over Exit Buttons
    const exitGameOver = () => {
      this.dom.hide(this.dom.gameoverModal);
      this.game.reset();
      this.game.state = 'start';
      this.dom.show(this.dom.startScreen);
      this.updateMainMenuSouls();
    };

    if (this.dom.closeGameoverX) {
      this.dom.closeGameoverX.onclick = exitGameOver;
    }

    this.dom.resetMetaBtn.onclick = () => {
      this.showResetConfirmation();
    };

    this.dom.confirmResetBtn.onclick = () => {
      this.dom.hide(this.dom.resetConfirmModal);
      this.performMetaReset();
    };

    this.dom.cancelResetBtn.onclick = () => {
      this.dom.hide(this.dom.resetConfirmModal);
    };

    this.dom.closeMetaBtn.onclick = () => {
      this.dom.hide(this.dom.metaModal);
      this.updateMainMenuSouls(); // Update count on close

      // Return to appropriate screen
      if (this.game.state === 'gameover') {
        this.dom.show(this.dom.gameoverModal);
      } else if (this.game.state === 'start') {
        this.dom.show(this.dom.startScreen);
      }
    };

    // Pause screen buttons
    this.dom.resumeBtn.onclick = () => {
      this.resumeGame();
    };

    this.dom.restartPauseBtn.onclick = () => {
      this.dom.hide(this.dom.pauseModal);

      // If custom game, return to custom config screen
      if (this.game.customEnemies) {
        const wasCustom = this.game.customEnemies;
        const wasBiome = this.game.customBiome;
        this.game.reset();

        // Restore enemy selection
        this.customEnemies = { ...wasCustom };
        this.customBiome = { value: wasBiome };
        this.renderCustomEnemySelection();
        this.renderCustomSkillSelection();
        this.renderCustomBiomeSelection();

        this.dom.show(this.dom.customModal);
      } else {
        this.game.reset();
        this.game.start();
      }
    };

    this.dom.exitPauseBtn.onclick = () => {
      this.dom.hide(this.dom.pauseModal);
      this.game.reset();
      this.game.state = 'start';
      this.dom.show(this.dom.startScreen);
      this.updateMainMenuSouls(); // Update when returning to menu
    };

    // Keyboard Navigation (Escape to close overlays)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {

        // 1. Reset Confirmation (Highest Priority)
        if (this.dom.resetConfirmModal && !this.dom.resetConfirmModal.classList.contains('hidden')) {
          this.dom.hide(this.dom.resetConfirmModal);
          return;
        }

        // 2. Permanent Upgrades (Meta)
        if (this.dom.metaModal && !this.dom.metaModal.classList.contains('hidden')) {
          this.dom.hide(this.dom.metaModal);
          this.updateMainMenuSouls();

          if (this.game.state === 'gameover') {
            this.dom.show(this.dom.gameoverModal);
          } else if (this.game.state === 'start') {
            this.dom.show(this.dom.startScreen);
          }
          return;
        }

        // 3. Custom Game Config
        if (this.dom.customModal && !this.dom.customModal.classList.contains('hidden')) {
          this.dom.hide(this.dom.customModal);
          this.dom.show(this.dom.startScreen);
          return;
        }

        // 4. Guide Modal
        if (this.dom.guideModal && !this.dom.guideModal.classList.contains('hidden')) {
          this.dom.hide(this.dom.guideModal);
          if (this.game.state === 'start') {
            this.dom.show(this.dom.startScreen);
          }
          return;
        }

        // 5. Lobby Modal
        if (this.dom.lobbyModal && !this.dom.lobbyModal.classList.contains('hidden')) {
          this.dom.hide(this.dom.lobbyModal);
          this.dom.show(this.dom.startScreen);
          return;
        }

        // 6. Game Over Screen -> Main Menu
        if (this.dom.gameoverModal && !this.dom.gameoverModal.classList.contains('hidden')) {
          // Reuse the exit logic
          this.dom.hide(this.dom.gameoverModal);
          this.game.reset();
          this.game.state = 'start';
          this.dom.show(this.dom.startScreen);
          this.updateMainMenuSouls();
          return;
        }
      }
    });
  }

  // Delegate to imported functions
  updateHUD() {
    updateHUD(this.game, this.dom);
  }

  showLevelUpScreen(player) {
    if (!player) player = this.game.players ? this.game.players[0] : this.game.player;

    // Bled-out players level silently: no dust turn, no freeze — the
    // level/xp rollover already happened in addXP and that's all they get
    if (player && player.isBledOut) return;

    if (this.isLevelUpActive) {
      this.levelUpQueue.push(player);
      return;
    }

    this.isLevelUpActive = true;

    // Play the invigoration animation (freeze + heal-to-full sweep) first,
    // then present the skill choices.
    const beginFor = (p) => {
      // Downed players take their queue turn as the dust tribute —
      // no invigoration, no modal, no heal; the queue advances when
      // the dust scatters (so 2P level-ups still alternate cleanly)
      if (p.isDowned) {
        if (this.game.downedLevelUpDust) {
          this.game.downedLevelUpDust.play(p, onComplete);
        } else {
          onComplete();
        }
        return;
      }
      if (this.game.levelUpEffect) {
        this.game.levelUpEffect.play(p, () => showLevelUpScreen(this.game, this.dom, p, onComplete));
      } else {
        showLevelUpScreen(this.game, this.dom, p, onComplete);
      }
    };

    const onComplete = () => {
      if (this.levelUpQueue.length > 0) {
        const nextPlayer = this.levelUpQueue.shift();
        // Hide the previous player's choices during the next animation —
        // a lingering modal is clickable and a stray click would re-enter
        // onComplete with an empty queue and unfreeze the game mid-animation
        this.dom.hide(this.dom.levelupModal);
        // Small delay to prevent instant flash or allow UI update
        setTimeout(() => {
          beginFor(nextPlayer);
        }, 100);
      } else {
        this.isLevelUpActive = false;
        this.dom.hide(this.dom.levelupModal);

        // Resume ONLY if not paused by ESC
        if (this.game.state === 'paused' && this.dom.pauseModal.classList.contains('hidden')) {
          if (this.game.gameInputSystem) this.game.gameInputSystem.setFrozen(false);
          this.game.state = 'playing';
        }
      }
    };

    beginFor(player);
  }

  showGameOverStats(souls, isVictory = false) {
    showGameOverStats(this.game, this.dom, souls, isVictory);
  }

  showResetConfirmation() {
    showResetConfirmation(this.game, this.dom);
  }

  performMetaReset() {
    performMetaReset(this.game, this.dom);
  }

  showMetaUpgrades() {
    showMetaUpgrades(this.game, this.dom);
  }

  showPauseScreen() {
    // Hide status message immediately to prevent overlap
    if (this.dom.statusMessage) {
      this.dom.statusMessage.style.transition = 'none';
      this.dom.statusMessage.style.opacity = '0';
    }
    if (this.statusMessageTimer) {
      clearTimeout(this.statusMessageTimer);
      this.statusMessageTimer = null;
    }
    // Keep the death banner from floating over the pause menu
    if (this.dom.gameoverBanner) this.dom.gameoverBanner.style.visibility = 'hidden';
    showPauseScreen(this.game, this.dom);
  }

  hidePauseScreen() {
    this.dom.hide(this.dom.pauseModal);
  }

  resumeGame() {
    if (this.dom.gameoverBanner) this.dom.gameoverBanner.style.visibility = '';
    resumeGame(this.game, this.dom);
  }

  showGuide() {
    showGuide(this.dom);
  }

  showHint(message, duration = 3000) {
    if (this.game.weather) {
      this.game.weather.showWarning(message, duration);
    }
  }

  showStatusMessage(message, duration = 2000) {
    const el = this.dom.statusMessage;
    if (el) {
      el.style.transition = 'opacity 0.5s';
      el.textContent = message;
      el.style.opacity = '1';
      this.updateStatusMessagePosition();

      // Clear existing timer if any
      if (this.statusMessageTimer) clearTimeout(this.statusMessageTimer);

      this.statusMessageTimer = setTimeout(() => {
        el.style.opacity = '0';
      }, duration);
    }
  }

  /**
   * Anchors the status message just below the player so it never sits on
   * top of HUD elements. Called every frame from render3D while visible.
   */
  updateStatusMessagePosition() {
    const el = this.dom.statusMessage;
    if (!el || el.style.opacity !== '1') return;

    const p = this.game.player;
    const cam = this.game.rendering && this.game.rendering.camera3D;
    if (!p || !cam || !this.game.canvas) return;

    // Project the player's feet to screen space
    const v = new THREE.Vector3(p.x + p.width / 2, 0, p.y + p.height / 2);
    v.project(cam);
    const rect = this.game.canvas.getBoundingClientRect();
    const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;

    el.style.left = `${x}px`;
    el.style.top = `${y + 36}px`;
    el.style.transform = 'translate(-50%, 0)';
  }


  // ==================== GAME OVER BANNER ====================
  // Cinematic SP death sequence: "GAME OVER" slams in above the downed
  // player, tracks them during the death wait, then glides down into the
  // modal's title slot (see showGameOverStats in ui-gameover.js).

  showGameOverBanner() {
    const el = this.dom.gameoverBanner;
    if (!el) return;
    // Reset leftover glide styling from a previous run
    el.classList.remove('glide');
    el.style.cssText = '';
    this.gameOverBannerGliding = false;
    this.updateGameOverBannerPosition(true);
    el.classList.add('show');
  }

  isGameOverBannerVisible() {
    return !!(this.dom.gameoverBanner && this.dom.gameoverBanner.classList.contains('show'));
  }

  /**
   * Anchors the banner above the downed player's head. Called every
   * frame from render3D while visible; stops once the glide hand-off
   * to the modal begins.
   */
  updateGameOverBannerPosition(force = false) {
    const el = this.dom.gameoverBanner;
    if (!el || this.gameOverBannerGliding) return;
    if (!force && !el.classList.contains('show')) return;

    const p = this.game.player;
    const cam = this.game.rendering && this.game.rendering.camera3D;
    if (!p || !cam || !this.game.canvas) return;

    const v = new THREE.Vector3(p.x + p.width / 2, 0, p.y + p.height / 2);
    v.project(cam);
    const rect = this.game.canvas.getBoundingClientRect();
    const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;

    el.style.left = `${x}px`;
    el.style.top = `${y - 130}px`;
  }

  /**
   * Flies the banner from its spot above the player into the modal's
   * title slot, morphing size/spacing/color to match the target h2.
   */
  glideGameOverBanner(targetEl) {
    const el = this.dom.gameoverBanner;
    if (!el || !targetEl) return;
    this.gameOverBannerGliding = true;

    const rect = targetEl.getBoundingClientRect();
    const cs = getComputedStyle(targetEl);

    // Kill the slam keyframes (may still be mid-flight on a skip click)
    // so the glide transition owns transform/letter-spacing.
    el.style.animation = 'none';
    void el.offsetWidth; // Flush so the transition starts from here
    el.classList.add('glide');
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top + rect.height / 2}px`;
    el.style.fontSize = cs.fontSize;
    el.style.letterSpacing = cs.letterSpacing;
    el.style.color = cs.color;
    el.style.textShadow = cs.textShadow;
  }

  hideGameOverBanner() {
    const el = this.dom.gameoverBanner;
    if (!el) return;
    el.classList.remove('show', 'glide');
    el.style.cssText = '';
    this.gameOverBannerGliding = false;
  }

  /**
   * 2P rescue call: floats "PLAYER X IS DOWN" above a downed teammate.
   * Driven entirely from render3D each frame — shows while a revivable
   * player is down mid-run, hides itself in every other state.
   */
  updateDownedBanner() {
    const el = this.dom.downedBanner;
    if (!el) return;
    const g = this.game;
    // Online, the downed player gets their own prompt; this banner is for the partner
    const downed = (g.isMultiplayer && g.state === 'playing' && g.players)
      ? g.players.find(p => p.isDowned && p.canBeRevived && !(g.netMode && p === g.player))
      : null;

    if (!downed) {
      if (el.classList.contains('show')) {
        el.classList.remove('show');
        this.downedBannerId = null;
      }
      return;
    }

    // (Re)build content when the banner appears or the downed player
    // changes (e.g. P1 revived just as P2 falls)
    if (!el.classList.contains('show') || this.downedBannerId !== downed.id) {
      this.downedBannerId = downed.id;
      // Online both players use E; the partner is named (escaped: it is their text)
      const keyName = (g.netMode || downed.id === 0) ? 'E' : 'R-CTRL';
      const netName = g.netMode && g.net && g.net.state ? g.net.state.players.get(downed.netSid)?.name : '';
      const who = netName
        ? netName.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
        : `Player ${downed.id + 1}`;
      el.innerHTML = `
        <div class="downed-title">${who} is down</div>
        <div class="downed-sub">Come revive — hold [${keyName}]</div>
        <div class="downed-chevron">&#10095;</div>`;
      el.classList.add('show');
    }

    // Track above the downed player (same feet-projection as the toast)
    const cam = g.rendering && g.rendering.camera3D;
    if (!cam || !g.canvas) return;
    const v = new THREE.Vector3(downed.x + downed.width / 2, 0, downed.y + downed.height / 2);
    v.project(cam);
    const rect = g.canvas.getBoundingClientRect();
    const rawX = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    // High enough to clear the overhead health bar sprite
    const rawY = rect.top + (-v.y * 0.5 + 0.5) * rect.height - 160;

    // If the downed player is off-screen, pin the banner to the nearest
    // screen edge and point a chevron toward them
    const x = Math.max(rect.left + 150, Math.min(rect.right - 150, rawX));
    const y = Math.max(rect.top + 80, Math.min(rect.bottom - 30, rawY));
    const offscreen = (Math.abs(x - rawX) > 1 || Math.abs(y - rawY) > 1);

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.toggle('offscreen', offscreen);

    if (offscreen) {
      const chev = el.querySelector('.downed-chevron');
      if (chev) {
        // Orbit the chevron around the label, pointing off-screen
        const ang = Math.atan2(rawY - y, rawX - x);
        chev.style.left = `calc(50% + ${Math.round(Math.cos(ang) * 110)}px)`;
        chev.style.top = `calc(50% + ${Math.round(Math.sin(ang) * 45)}px)`;
        chev.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
      }
    }
  }

  showFrozenMessage(show) {
    if (this.dom.frozenMessage) {
      if (show) this.dom.show(this.dom.frozenMessage);
      else this.dom.hide(this.dom.frozenMessage);
    }
  }

  setupMainParallax() {
    // List of modals in priority order (Foreground -> Background)
    // The system will only apply parallax to the FIRST visible modal found.
    const parallaxTargets = [
      'reset-confirm-modal', // Topmost
      'guide-modal',
      'meta-modal',
      'gameover-modal',
      'pause-modal',
      'custom-modal',
      'lobby-modal',
      'start-screen'          // Bottom (Main Menu)
    ];

    // Cache elements
    const modals = {};
    parallaxTargets.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const content = el.querySelector('.modal-content');
        if (content) {
          // Init styles
          content.style.transformStyle = 'preserve-3d';
          content.style.transition = 'transform 0.1s ease-out';
          modals[id] = { el, content };
        }
      }
    });

    let rafId = null;

    document.addEventListener('mousemove', (e) => {
      if (rafId) return;

      rafId = requestAnimationFrame(() => {
        // Find the active modal (highest priority visible)
        let activeTarget = null;
        for (const id of parallaxTargets) {
          const m = modals[id];
          if (m && m.el && !m.el.classList.contains('hidden')) {
            activeTarget = m;
            break; // Stop at the first visible one
          }
        }

        if (activeTarget) {
          const { clientX, clientY } = e;
          const { innerWidth, innerHeight } = window;

          // Normalized position (-1 to 1)
          const cx = innerWidth / 2;
          const cy = innerHeight / 2;
          const nx = (clientX - cx) / cx;
          const ny = (clientY - cy) / cy;

          const maxTilt = 5;
          const rx = -ny * maxTilt;
          const ry = nx * maxTilt;

          activeTarget.content.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg)`;
        }

        rafId = null;
      });
    });
  }
}
