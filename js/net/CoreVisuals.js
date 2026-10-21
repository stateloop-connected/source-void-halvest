// Meshes for the online co-op objects: the Void Core (a bar with two handles),
// its drop zone, and teammate pings. Pure presentation of server state.
import * as THREE from 'three';

const CORE_LEN = 120;
// Marker beams stay well below the chase camera (a beam taller than the camera
// smears across the whole view in perspective).
const BEAM_H = 160;

export class CoreVisuals {
  constructor(scene) {
    this.scene = scene;
    this.coreGroup = null;
    this.zoneGroup = null;
    this.pings = [];
  }

  buildCore() {
    const g = new THREE.Group();
    const barMat = new THREE.MeshStandardMaterial({ color: 0x6a1bff, emissive: 0x7a2cff, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.4 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(CORE_LEN, 22, 30), barMat);
    bar.position.y = 22;
    bar.castShadow = true;
    g.add(bar);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(20, 1), new THREE.MeshStandardMaterial({ color: 0xd6b8ff, emissive: 0xb07cff, emissiveIntensity: 2.2 }));
    orb.position.y = 40;
    g.add(orb);
    this.handles = [-1, 1].map((s) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0x222222, emissiveIntensity: 1 }));
      m.position.set(s * (CORE_LEN / 2 + 6), 22, 0);
      g.add(m);
      return m;
    });
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4, BEAM_H, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xa070ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    beam.position.y = BEAM_H / 2;
    g.add(beam);
    const light = new THREE.PointLight(0x9a5cff, 400, 500, 2);
    light.position.y = 60;
    g.add(light);
    this.orb = orb;
    this.scene.add(g);
    return g;
  }

  buildZone(r) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 10, r, 64),
      new THREE.MeshBasicMaterial({ color: 0x33ffaa, transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 3;
    g.add(ring);
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(r - 10, 64),
      new THREE.MeshBasicMaterial({ color: 0x33ffaa, transparent: true, opacity: 0.22, side: THREE.DoubleSide, toneMapped: false }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 2;
    g.add(fill);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.08, r * 0.08, BEAM_H, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x33ffaa, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    beam.position.y = BEAM_H / 2;
    g.add(beam);
    this.zoneFill = fill;
    this.zoneRing = ring;
    this.scene.add(g);
    return g;
  }

  /** core = { o, x, y, yaw } | null, zone = { o } | null, players = state.players */
  update(core, zone, players, now) {
    if (core) {
      if (!this.coreGroup) this.coreGroup = this.buildCore();
      this.coreGroup.position.set(core.x, 0, core.y);
      this.coreGroup.rotation.y = -core.yaw;
      this.orb.rotation.y = now * 0.002;
      this.orb.position.y = 40 + Math.sin(now * 0.004) * 4;
      const byHandle = [null, null];
      core.o.attach.forEach((a, sid) => { byHandle[a.handle] = players.get(sid); });
      byHandle.forEach((p, i) => {
        const m = this.handles[i].material;
        const c = new THREE.Color(p ? p.color : '#888888');
        m.color.copy(c);
        m.emissive.copy(c);
        m.emissiveIntensity = p ? 2.5 : 0.4;
      });
    } else if (this.coreGroup) {
      this.scene.remove(this.coreGroup);
      this.coreGroup = null;
    }

    if (zone) {
      if (!this.zoneGroup) this.zoneGroup = this.buildZone(zone.o.r || 150);
      this.zoneGroup.position.set(zone.o.x, 0, zone.o.y);
      const p = zone.o.progress || 0;
      this.zoneFill.scale.setScalar(Math.max(0.02, p));
      this.zoneFill.material.opacity = 0.22 + 0.5 * p;
      this.zoneRing.material.opacity = zone.o.active ? 0.6 + 0.4 * Math.sin(now * 0.02) : 0.85;
    } else if (this.zoneGroup) {
      this.scene.remove(this.zoneGroup);
      this.zoneGroup = null;
    }

    for (let i = this.pings.length - 1; i >= 0; i--) {
      const pg = this.pings[i];
      const age = (now - pg.born) / 1000;
      if (age > 3) { this.scene.remove(pg.mesh); this.pings.splice(i, 1); continue; }
      pg.mesh.scale.setScalar(1 + (age % 1) * 1.5);
      pg.mesh.material.opacity = 0.9 * (1 - age / 3);
    }
  }

  addPing(x, y, color, now) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(18, 26, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color || '#ffffff'), transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 4, y);
    this.scene.add(mesh);
    this.pings.push({ mesh, born: now });
  }

  clear() {
    if (this.coreGroup) this.scene.remove(this.coreGroup);
    if (this.zoneGroup) this.scene.remove(this.zoneGroup);
    for (const p of this.pings) this.scene.remove(p.mesh);
    this.coreGroup = null;
    this.zoneGroup = null;
    this.pings = [];
  }
}
