export class GameInputSystem {
    constructor(game) {
        this.game = game;
        this.input = game.input;
        this.ui = game.ui;

        // Freeze State Tracking
        this.manualFreeze = false;
        this.ignoreKeys = new Set();
        this.ignoreMouse = false;
    }

    update(dt) {
        // Level-up / card-pick animations own the screen: swallow pause/freeze toggles
        const levelUpAnimating =
            (this.game.levelUpEffect && this.game.levelUpEffect.isPlaying()) ||
            (this.game.skillCardEffect && this.game.skillCardEffect.isPlaying()) ||
            (this.game.downedLevelUpDust && this.game.downedLevelUpDust.isPlaying());

        // Online co-op never pauses: the shared world keeps running
        if (this.game.netMode) {
            this.input.escapePressed = false;
            this.input.spacePressed = false;
        }

        // 1. Toggle Pause (ESC)
        if (this.input.escapePressed) {
            this.input.escapePressed = false;
            if (!levelUpAnimating) this.togglePause();
        }

        // 2. Toggle Freeze (SPACE)
        if (this.input.spacePressed) {
            this.input.spacePressed = false;
            if (!levelUpAnimating) this.toggleFreeze();
        }

        // 3. Handle Frozen Logic
        if (this.game.state === 'frozen') {
            this.handleFrozenState();
        }

        // 4. Toggle Autoshoot (Q)
        if (!this.game.trainingMode && (this.input.keys['q'] || this.input.keys['Q'])) {
            if (!this.game.lastQ) {
                this.game.autoshootEnabled = !this.game.autoshootEnabled;
                this.game.metaProgress.autoshootEnabled = this.game.autoshootEnabled;
                this.game.saveMetaProgress();

                const msg = this.game.autoshootEnabled ? "[Q] Autoshoot: ON" : "[Q] Autoshoot: OFF";
                if (this.ui.showStatusMessage) this.ui.showStatusMessage(msg, 2000);
            }
            this.game.lastQ = true;
        } else {
            this.game.lastQ = false;
        }

        // 5. Manual Override Timer (Mouse Down)
        if (this.input.mouseDown) {
            this.game.autoshootOverrideTimer = 2.0;
        } else if (this.game.autoshootOverrideTimer > 0) {
            this.game.autoshootOverrideTimer -= dt / 1000;
        }
    }

    togglePause() {
        if (this.game.state === 'playing') {
            this.game.state = 'paused';
            this.ui.showPauseScreen();
            // Hide Revive Prompt
            if (this.game.resurrectionSystem) this.game.resurrectionSystem.hidePrompt();
            // Hide Weather Warning
            if (this.game.weather) this.game.weather.hideWarning();
        } else if (this.game.state === 'paused') {
            this.game.state = 'playing';
            this.ui.hidePauseScreen();
        } else if (this.game.state === 'frozen') {
            this.game.state = 'paused';
            this.ui.showPauseScreen();
            this.ui.showFrozenMessage(false);
            // Hide Weather Warning
            if (this.game.weather) this.game.weather.hideWarning();
        }
    }

    toggleFreeze() {
        if (this.game.state === 'playing') {
            this.setFrozen(true);
            this.manualFreeze = true;
            this.ignoreKeys = new Set();
            ['w', 'a', 's', 'd'].forEach(k => {
                if (this.input.keys[k]) this.ignoreKeys.add(k);
            });
            this.ignoreMouse = this.input.mouseDown;
        } else if (this.game.state === 'frozen') {
            this.setFrozen(false);
            this.manualFreeze = false;
        }
    }

    setFrozen(frozen) {
        if (frozen) {
            // Hide Revive Prompt when frozen
            if (this.game.resurrectionSystem) this.game.resurrectionSystem.hidePrompt();
            // Hide Weather Warning
            if (this.game.weather) this.game.weather.hideWarning();
            this.game.state = 'frozen';
            this.ui.showFrozenMessage(true);
            this.game.lastTime = performance.now();
        } else {
            this.unfreeze();
        }
    }

    unfreeze() {
        this.game.state = 'playing';
        this.manualFreeze = false;
        this.ui.showFrozenMessage(false);
        this.game.lastTime = performance.now();
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

    reset() {
        this.manualFreeze = false;
        this.ignoreKeys = new Set();
        this.ignoreMouse = false;
        if (this.input) this.input.mouseDown = false;
    }
}
