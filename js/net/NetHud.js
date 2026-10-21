// Online co-op UI: the lobby (quick match, private room codes), in-game prompts,
// a non-blocking skill tray (the world never pauses online), chat, pings,
// off-screen markers for the core and the zone, and the end-of-run screen.
import * as THREE from 'three';
import { SKILLS } from '../skills.js';

const CSS = `
#net-hud { position: fixed; inset: 0; pointer-events: none; z-index: 40; font-family: 'Rajdhani', sans-serif; color: #e8f6ff; }
#net-hud .nh-prompt { position: absolute; left: 50%; top: 142px; transform: translateX(-50%); padding: 8px 16px; border-radius: 8px;
  background: rgba(5,12,20,.72); border: 1px solid rgba(0,255,255,.35); font: 600 18px 'Orbitron', sans-serif; letter-spacing: .04em; text-align: center; }
#net-hud .nh-prompt.hidden, #net-hud .hidden { display: none; }
#net-hud .nh-prompt .bar { height: 4px; margin-top: 6px; background: rgba(255,255,255,.15); border-radius: 2px; overflow: hidden; }
#net-hud .nh-prompt .bar > i { display: block; height: 100%; background: #00ffaa; width: 0; }
#net-hud .nh-tray { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 10px; pointer-events: auto; }
#net-hud .nh-card { width: 150px; padding: 10px; border-radius: 10px; background: rgba(5,12,20,.86); border: 1px solid rgba(0,255,255,.4); cursor: pointer; }
#net-hud .nh-card:hover { border-color: #00ffff; }
#net-hud .nh-card .k { font: 700 12px 'Orbitron', sans-serif; color: #00ffff; }
#net-hud .nh-card .n { font-weight: 700; font-size: 16px; margin: 4px 0 2px; }
#net-hud .nh-card .d { font-size: 13px; opacity: .8; }
#net-hud .nh-card svg { width: 26px; height: 26px; }
#net-hud .nh-traytitle { position: absolute; left: 50%; bottom: 128px; transform: translateX(-50%); font: 700 14px 'Orbitron', sans-serif; color: #00ff88; text-shadow: 0 0 8px #00ff88; }
#net-hud .nh-chat { position: absolute; left: 16px; bottom: 120px; width: 320px; font-size: 15px; }
#net-hud .nh-chat .line { background: rgba(5,12,20,.6); padding: 3px 8px; border-radius: 6px; margin-top: 4px; }
#net-hud .nh-chatin { position: absolute; left: 16px; bottom: 88px; width: 320px; pointer-events: auto; padding: 6px 8px; border-radius: 6px;
  border: 1px solid #00ffff; background: rgba(5,12,20,.9); color: #fff; font: 15px 'Rajdhani', sans-serif; }
#net-hud .nh-top { position: absolute; left: 50%; top: 104px; transform: translateX(-50%); font: 700 15px 'Orbitron', sans-serif; padding: 4px 14px;
  border-radius: 8px; background: rgba(5,12,20,.6); border: 1px solid rgba(160,112,255,.6); color: #d6b8ff; }
#net-hud .nh-toast { position: absolute; left: 50%; top: 196px; transform: translateX(-50%); font: 700 18px 'Orbitron', sans-serif; text-shadow: 0 0 10px #000; }
#net-hud .nh-arrow { position: absolute; width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-bottom: 22px solid #b07cff; transform-origin: 50% 70%; }
#net-hud .nh-arrow.zone { border-bottom-color: #33ffaa; }
#net-end { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 60; background: rgba(0,0,0,.55); font-family: 'Rajdhani', sans-serif; color: #e8f6ff; }
#net-end.hidden { display: none; }
#net-end .box { min-width: 420px; max-width: 560px; padding: 24px 28px; border-radius: 14px; background: rgba(6,14,24,.95); border: 1px solid rgba(0,255,255,.45); }
#net-end h2 { font: 800 28px 'Orbitron', sans-serif; margin: 0 0 6px; }
#net-end table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 16px; }
#net-end td, #net-end th { padding: 4px 6px; text-align: left; }
#net-end .stars button { background: none; border: none; font-size: 26px; cursor: pointer; color: #556; }
#net-end .stars button.on { color: #ffd34d; }
#net-end .row { display: flex; gap: 10px; margin-top: 14px; }
/* The shared .btn style lifts buttons with 3D transforms (translateZ + preserve-3d);
   inside these flex rows that made the first click land on the row instead. */
.online-lobby .btn, .online-lobby .btn:hover, .online-lobby .btn:active,
#net-end .btn, #net-end .btn:hover, #net-end .btn:active { transform: none; transform-style: flat; }
.online-lobby .ol-row { display: flex; gap: 10px; align-items: center; justify-content: center; margin: 12px 0; flex-wrap: wrap; }
.online-lobby input[type=text] { padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(0,255,255,.5); background: rgba(5,12,20,.8); color: #fff; font: 16px 'Rajdhani', sans-serif; }
.online-lobby #ol-code { width: 90px; text-transform: uppercase; letter-spacing: .2em; text-align: center; font-family: 'Orbitron', sans-serif; }
.online-lobby .ol-code-line { font: 700 20px 'Orbitron', sans-serif; margin: 10px 0; }
.online-lobby #ol-room-code { color: #00ffff; letter-spacing: .25em; }
.online-lobby #ol-players { display: flex; gap: 12px; justify-content: center; margin: 10px 0; }
.online-lobby .ol-p { padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.2); min-width: 140px; }
.online-lobby #ol-status { margin: 8px 0; font-size: 18px; }
.online-lobby #ol-error { color: #ff7777; min-height: 20px; }
.online-lobby .ol-controls { margin-top: 14px; font-size: 14px; opacity: .8; line-height: 1.5; }
`;

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class NetHud {
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.offers = [];
    this.chatLines = [];
    this.rated = 0;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('div', '', document.body);
    this.root.id = 'net-hud';
    this.root.classList.add('hidden');
    this.top = el('div', 'nh-top', this.root, '');
    this.toast = el('div', 'nh-toast hidden', this.root, '');
    this.prompt = el('div', 'nh-prompt hidden', this.root, '<span></span><div class="bar"><i></i></div>');
    this.trayTitle = el('div', 'nh-traytitle hidden', this.root, '');
    this.tray = el('div', 'nh-tray', this.root);
    this.chat = el('div', 'nh-chat', this.root);
    this.chatIn = el('input', 'nh-chatin hidden', this.root);
    this.chatIn.maxLength = 200;
    this.chatIn.placeholder = 'Say something to your partner (Enter to send)';
    this.arrows = { core: el('div', 'nh-arrow hidden', this.root), zone: el('div', 'nh-arrow zone hidden', this.root) };

    this.end = el('div', 'hidden', document.body, '<div class="box"></div>');
    this.end.id = 'net-end';

    window.addEventListener('keydown', (e) => this.onKey(e));
    this.chatIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.chatIn.value.trim();
        if (text) this.net.chat(text);
        this.chatIn.value = '';
        this.chatIn.blur();
        this.chatIn.classList.add('hidden');
      } else if (e.key === 'Escape') {
        this.chatIn.blur();
        this.chatIn.classList.add('hidden');
      }
    });
    this.wireLobby();
  }

  // ---- lobby ---------------------------------------------------------------------------
  wireLobby() {
    const $ = (id) => document.getElementById(id);
    this.lobby = {
      modal: $('lobby-modal'), setup: $('ol-setup'), room: $('ol-room'), code: $('ol-room-code'),
      players: $('ol-players'), status: $('ol-status'), error: $('ol-error'),
      name: $('ol-name'), color: $('ol-color'), codeIn: $('ol-code'),
    };
    const L = this.lobby;
    if (!L.modal) return;
    const saved = this.game.metaProgress.online || {};
    if (L.name) L.name.value = saved.name || '';
    if (L.color && saved.color) L.color.value = saved.color;
    const busy = (on) => ['ol-quick', 'ol-create', 'ol-join'].forEach((id) => { const b = $(id); if (b) b.disabled = on; });
    const go = async (fn) => {
      L.error.textContent = '';
      const name = (L.name.value || '').trim().slice(0, 16) || 'Harvester';
      const color = L.color.value;
      this.game.metaProgress.online = { name, color };
      this.game.saveMetaProgress();
      busy(true);
      L.status.textContent = 'Connecting...';
      try {
        await fn(name, color);
      } catch (err) {
        L.error.textContent = this.explainError(err);
        L.status.textContent = '';
      } finally {
        busy(false);
      }
    };
    $('ol-quick').onclick = () => go((n, c) => this.net.quickMatch(n, c));
    $('ol-create').onclick = () => go((n, c) => this.net.createRoom(n, c));
    $('ol-join').onclick = () => {
      const code = (L.codeIn.value || '').trim();
      if (code.length !== 4) { L.error.textContent = 'Enter the 4-letter room code.'; return; }
      go((n, c) => this.net.joinCode(code, n, c));
    };
    $('ol-leave').onclick = () => this.net.leave();
  }

  explainError(err) {
    const msg = String(err?.message || err || '');
    if (/not found|locked|full/i.test(msg)) return 'That room is full or does not exist.';
    if (/fetch|network|ECONN|Failed/i.test(msg)) return 'Cannot reach the co-op server right now. Try again in a moment.';
    return msg || 'Something went wrong.';
  }

  openLobby() {
    const L = this.lobby;
    L.setup.classList.remove('hidden');
    L.room.classList.add('hidden');
    L.error.textContent = '';
    L.status.textContent = '';
    this.game.ui.dom.show(L.modal);
  }

  onJoined(room) {
    const L = this.lobby;
    L.setup.classList.add('hidden');
    L.room.classList.remove('hidden');
    L.code.textContent = room.roomId;
    this.onState(room.state);
  }

  onLeft(code) {
    this.setSoulsVisible(true);
    this.root.classList.add('hidden');
    this.end.classList.add('hidden');
    const g = this.game;
    g.netMode = false;
    g.state = 'start';
    g.ui.dom.show(g.ui.dom.startScreen);
    if (code && code !== 4000 && code !== 1000) {
      this.openLobby();
      this.lobby.error.textContent = 'Disconnected from the co-op server.';
    }
  }

  onState(st) {
    const L = this.lobby;
    if (!L.modal || !this.net.room || !st || !st.players) return; // state arrives with the first patch
    const list = [...st.players.entries()].sort((a, b) => a[1].seat - b[1].seat);
    L.players.innerHTML = list.map(([sid, p]) =>
      `<div class="ol-p" style="border-color:${p.color}"><b style="color:${p.color}">${escapeHtml(p.name)}</b>${sid === this.net.sid ? ' (you)' : ''}<br>${p.connected ? (p.ready ? 'ready' : '') : 'reconnecting...'}</div>`).join('');
    if (st.phase === 'lobby') {
      const waiting = this.net.isPrivate ? 'Waiting for your partner. Send them the room code.' : 'Looking for another player...';
      L.status.textContent = list.length < 2 ? waiting : 'Starting...';
    }
    else if (st.phase === 'countdown') L.status.textContent = `Starting in ${Math.ceil(st.countdown)}...`;
    if (st.phase === 'countdown') this.end.classList.add('hidden');
    if (st.phase === 'playing') this.game.ui.dom.hide(L.modal);
    if (st.phase === 'lobby' && !this.net.active && this.game.netMode) {
      // partner left after a run: back to the lobby panel
      this.end.classList.add('hidden');
      this.root.classList.add('hidden');
      this.game.ui.dom.show(L.modal);
    }
  }

  // ---- episode ----------------------------------------------------------------------------
  /** Souls feed the solo meta upgrades; online runs do not earn them. */
  setSoulsVisible(on) {
    const souls = document.getElementById('souls-stats');
    if (!souls) return;
    souls.style.display = on ? '' : 'none';
    const div = souls.previousElementSibling;
    if (div && div.classList.contains('hud-divider')) div.style.display = on ? '' : 'none';
  }

  onEpisodeStart() {
    this.setSoulsVisible(false);
    this.root.classList.remove('hidden');
    this.end.classList.add('hidden');
    this.game.ui.dom.hide(this.lobby.modal);
    this.game.ui.dom.hide(this.game.ui.dom.startScreen);
    this.rated = 0;
    this.flash('Carry the Void Core together. Hold E on a handle.', 4000);
  }

  onEpisodeEnd(m) {
    this.clearOffers();
    this.prompt.classList.add('hidden');
    const ok = m.outcome === 'success';
    const title = ok ? 'HARVEST COMPLETE' : m.outcome === 'abandon' ? 'PARTNER LEFT' : 'THE VOID WON';
    const st = this.net.state;
    const rows = (m.players || []).map((p) => {
      const s = st?.players.get(p.seat);
      const name = s ? escapeHtml(s.name) : 'player';
      return `<tr><td style="color:${s?.color || '#fff'}">${name}</td><td>${p.level}</td><td>${p.kills}</td><td>${p.revives}</td><td>${p.deliveries}</td></tr>`;
    }).join('');
    const box = this.end.querySelector('.box');
    box.innerHTML = `<h2 style="color:${ok ? '#00ffaa' : '#ff6b6b'}">${title}</h2>
      <div>Wave ${m.wave} · ${m.kills} kills · ${m.cores} cores delivered</div>
      <table><tr><th>Player</th><th>Level</th><th>Kills</th><th>Revives</th><th>Cores</th></tr>${rows}</table>
      <div>How good a partner was your teammate?</div>
      <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}">★</button>`).join('')}</div>
      <div class="row"><button class="btn btn-large" id="ne-again">Play again</button><button class="btn" id="ne-leave">Leave</button></div>
      <div id="ne-wait" style="margin-top:8px;opacity:.8"></div>`;
    box.querySelectorAll('.stars button').forEach((b) => {
      b.onclick = () => {
        const n = Number(b.dataset.n);
        this.rated = n;
        this.net.rate(n);
        box.querySelectorAll('.stars button').forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= n));
      };
    });
    box.querySelector('#ne-again').onclick = () => {
      this.net.ready();
      box.querySelector('#ne-wait').textContent = 'Waiting for your partner...';
    };
    box.querySelector('#ne-leave').onclick = () => this.net.leave();
    this.end.classList.remove('hidden');
  }

  // ---- skills ------------------------------------------------------------------------------
  addOffer(offer) {
    const i = this.offers.findIndex((o) => o.level === offer.level);
    if (i >= 0) this.offers[i] = offer; else this.offers.push(offer);
    this.renderTray();
  }

  clearOffers() { this.offers = []; this.renderTray(); }

  renderTray() {
    const o = this.offers[0];
    this.tray.innerHTML = '';
    if (!o) { this.trayTitle.classList.add('hidden'); return; }
    this.trayTitle.classList.remove('hidden');
    this.trayTitle.textContent = `LEVEL ${o.level} · pick a skill (1-${o.choices.length})${o.rerollUsed ? '' : ' · R to reroll'}${this.offers.length > 1 ? ` · +${this.offers.length - 1} more` : ''}`;
    const me = this.net.state?.players.get(this.net.sid);
    o.choices.forEach((id, idx) => {
      const s = SKILLS.find((x) => x.id === id);
      if (!s) return;
      const lvl = me?.skills.get(id) || 0;
      const card = el('div', `nh-card ${s.category || ''}`, this.tray,
        `<div class="k">[${idx + 1}]</div>${s.icon || ''}<div class="n">${s.name}${lvl ? ` ${lvl + 1}` : ''}</div><div class="d">${s.description}</div>`);
      card.onclick = () => this.pickIndex(idx);
    });
  }

  pickIndex(idx) {
    const o = this.offers[0];
    if (!o || !o.choices[idx]) return;
    this.net.pick(o.level, o.choices[idx]);
    this.offers.shift();
    this.renderTray();
  }

  // ---- input ---------------------------------------------------------------------------------
  isTyping() { return document.activeElement === this.chatIn; }

  onKey(e) {
    if (!this.net.active || this.isTyping()) return;
    if (e.key >= '1' && e.key <= '4') this.pickIndex(Number(e.key) - 1);
    else if ((e.key === 'r' || e.key === 'R') && this.offers[0] && !this.offers[0].rerollUsed) {
      this.net.reroll(this.offers[0].level);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.chatIn.classList.remove('hidden');
      this.chatIn.focus();
    } else if (e.key === 'g' || e.key === 'G') {
      const g = this.game;
      const aim = g.rendering.getMouseWorldPosition(g.input.mouseX, g.input.mouseY);
      if (Number.isFinite(aim.x)) this.net.ping(aim.x, aim.z, 'here');
    }
  }

  showChat(m) {
    const p = this.net.state?.players.get(m.from);
    const line = el('div', 'line', this.chat, `<b style="color:${p?.color || '#fff'}">${escapeHtml(p?.name || '?')}:</b> ${escapeHtml(m.text)}`);
    this.chatLines.push([line, performance.now()]);
    while (this.chatLines.length > 6) this.chatLines.shift()[0].remove();
  }

  showPing(m) {
    const p = this.net.state?.players.get(m.from);
    this.net.core.addPing(m.x, m.y, p?.color, performance.now());
  }

  onFx(name, d) {
    const st = this.net.state;
    const who = st?.players.get(d.seat);
    const me = d.seat === this.net.sid;
    if (name === 'downed') this.flash(me ? 'You are down! Your partner can revive you.' : `${who?.name || 'Partner'} is down! Hold E next to them.`, 3500, '#ff6b6b');
    else if (name === 'revived') this.flash(me ? 'Revived!' : `${who?.name || 'Partner'} is back up`, 2500, '#00ffaa');
    else if (name === 'bledout') this.flash(me ? 'You bled out.' : `${who?.name || 'Partner'} bled out.`, 3000, '#ff6b6b');
    else if (name === 'wave') this.flash(`Wave ${d.wave}`, 1500, '#ffd34d');
  }

  flash(text, ms = 2500, color = '#e8f6ff') {
    this.toast.textContent = text;
    this.toast.style.color = color;
    this.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.add('hidden'), ms);
  }

  // ---- per frame -----------------------------------------------------------------------------
  frame(now) {
    for (const [line, t] of this.chatLines) line.style.opacity = now - t > 15000 ? '0.35' : '1';
    const st = this.net.state;
    if (!st || !this.net.active) return;
    const me = st.players.get(this.net.sid);
    if (!me) return;
    let core = null, zone = null;
    st.objects.forEach((o) => { if (o.type === 'core') core = o; else if (o.type === 'drop_zone') zone = o; });
    this.top.textContent = `CORES DELIVERED ${st.score}${core ? (core.heldBy.length === 2 ? ' · CARRYING' : ' · CORE WAITING') : ''}`;

    // prompts
    let text = '', progress = -1;
    const partner = [...st.players.entries()].find(([sid]) => sid !== this.net.sid)?.[1];
    if (me.downed) {
      text = me.bledOut ? 'You bled out' : `Down! ${Math.ceil(me.downedTimer / 122.4)}s until you bleed out`;
      progress = me.reviveProgress / 120;
    } else if (partner && partner.downed && !partner.bledOut && Math.hypot(partner.x - me.x, partner.y - me.y) < 100) {
      text = 'HOLD [E] TO REVIVE';
      progress = partner.reviveProgress / 120;
    } else if (core) {
      const holding = core.heldBy.includes(this.net.sid);
      const both = core.heldBy.length === 2;
      if (holding && !both) text = 'Holding the core: keep [E] held and wait for your partner';
      else if (holding && both) text = 'Carry it to the green zone together';
      else {
        const ax = Math.cos(core.yaw), ay = Math.sin(core.yaw);
        const near = [-1, 1].some((s) => Math.hypot(core.x + s * ax * 60 - me.x, core.y + s * ay * 60 - me.y) < 58);
        if (near) text = 'HOLD [E] TO GRAB A HANDLE';
      }
      if (zone && zone.progress > 0) progress = zone.progress;
    }
    if (text) {
      this.prompt.querySelector('span').textContent = text;
      const bar = this.prompt.querySelector('.bar');
      bar.style.display = progress >= 0 ? 'block' : 'none';
      bar.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
      this.prompt.classList.remove('hidden');
    } else {
      this.prompt.classList.add('hidden');
    }

    this.updateArrow(this.arrows.core, core);
    this.updateArrow(this.arrows.zone, zone);
  }

  updateArrow(arrow, o) {
    if (!o) { arrow.classList.add('hidden'); return; }
    const cam = this.game.rendering.camera3D;
    const v = new THREE.Vector3(o.x, 20, o.y).project(cam);
    const w = window.innerWidth, h = window.innerHeight;
    const onScreen = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95;
    if (onScreen) { arrow.classList.add('hidden'); return; }
    let x = v.x, y = v.y;
    if (v.z > 1) { x = -x; y = -y; }
    const ang = Math.atan2(-y, x);
    const m = 0.9;
    const s = Math.max(Math.abs(x), Math.abs(y)) || 1;
    const px = (x / s * m + 1) / 2 * w, py = (-y / s * m + 1) / 2 * h;
    arrow.style.left = `${px - 10}px`;
    arrow.style.top = `${py - 11}px`;
    arrow.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
    arrow.classList.remove('hidden');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
