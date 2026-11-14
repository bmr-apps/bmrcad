// 3D 엔진 — 장면, 카메라, 선택, 변형 손잡이, 되돌리기, 내보내기
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { geometryFor, makeMaterial, SHAPE_BY_KIND, SHAPE_PALETTE, SAMPLE_MODELS } from './geometry.js';

const r3 = (n) => Math.round(n * 1000) / 1000;
const DEG = Math.PI / 180;
const SCENE_VERSION = 1;

export class CadEngine {
  constructor({ host, canvas, onChange, onSelect, onTransform, onHistory, onInteraction }) {
    this.host = host;
    this.canvas = canvas;
    this.onChange = onChange ?? (() => {});
    this.onSelect = onSelect ?? (() => {});
    this.onTransform = onTransform ?? (() => {});
    this.onHistory = onHistory ?? (() => {});
    this.onInteraction = onInteraction ?? (() => {});

    this.selected = null;
    this.mode = 'translate';
    this.snap = 0;
    this._seq = 0;
    this._undo = [];
    this._redo = [];
    this._editSnapshot = null;
    this._dragSnapshot = null;

    this._initScene();
    this._initControls();
    this._initEvents();
    this._loop();
    this._resize();
  }

  // ───────────────────────── 장면 ─────────────────────────
  _initScene() {
    const { canvas } = this;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eef2f6');

    // 금속·반투명 재질이 검게 죽지 않도록 작은 실내 환경 반사를 비춥니다 (외부 파일 없음)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._envRT = pmrem.fromScene(new RoomEnvironment(), 0.06);
    this.scene.environment = this._envRT.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.3, 9000);
    this.camera.position.set(190, 165, 230);

    // 조명 — 부드러운 그림자 + 위아래 색이 다른 하늘빛
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4c4cf, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.95);
    key.position.set(150, 260, 170);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -190;
    key.shadow.camera.right = 190;
    key.shadow.camera.top = 190;
    key.shadow.camera.bottom = -190;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 900;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.7;
    key.shadow.radius = 3;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.85);
    fill.position.set(-170, 120, -150);
    this.scene.add(fill);

    // 작업판 — 200 × 200 mm, 2mm 잔격자 + 10mm 굵은 격자
    this.grid = new THREE.Group();
    const minor = new THREE.GridHelper(200, 100, 0xdde5ea, 0xdde5ea);
    minor.position.y = 0.01;
    minor.material.transparent = true;
    minor.material.opacity = 0.95;
    const major = new THREE.GridHelper(200, 20, 0xa9b6bf, 0xa9b6bf);
    major.position.y = 0.02;
    major.material.transparent = true;
    major.material.opacity = 0.9;
    this.grid.add(minor, major);

    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-100, 0.04, -100), new THREE.Vector3(100, 0.04, -100),
        new THREE.Vector3(100, 0.04, 100), new THREE.Vector3(-100, 0.04, 100),
      ]),
      new THREE.LineBasicMaterial({ color: 0x8d9aa3 }),
    );
    this.grid.add(border);

    // 축 표시 — X(산호), Z(시안)
    const axisMat = (c) => new THREE.LineBasicMaterial({ color: c });
    this.grid.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(36, 0.06, 0)]),
      axisMat(0xff614a),
    ));
    this.grid.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0, 0.06, 36)]),
      axisMat(0x0abbee),
    ));
    this.scene.add(this.grid);

    // 그림자 받는 바닥 (격자 아래)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 도형이 들어가는 그릇
    this.objects = new THREE.Group();
    this.objects.name = 'objects';
    this.scene.add(this.objects);

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._fly = null;
    this._frame = 0;
  }

  _initControls() {
    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.target.set(0, 22, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.09;
    this.orbit.rotateSpeed = 0.85;
    this.orbit.zoomSpeed = 0.9;
    this.orbit.panSpeed = 0.85;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 22;
    this.orbit.maxDistance = 1600;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.update();

    this.transform = new TransformControls(this.camera, this.canvas);
    this.transform.setSize(0.8);
    this.transform.setSpace('world');
    const helper = typeof this.transform.getHelper === 'function' ? this.transform.getHelper() : this.transform;
    this.transformHelper = helper;
    this.scene.add(helper);

    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (e.value) {
        this._dragSnapshot = this.serialize();
        this.onInteraction(true);
      } else {
        this.onInteraction(false);
        if (this._dragSnapshot && this._dragSnapshot !== JSON.stringify(this.serialize())) {
          this._push(this._dragSnapshot);
        }
        this._dragSnapshot = null;
        this._updateBoxHelper();
        this.onTransform(this.selected);
      }
    });
    this.transform.addEventListener('objectChange', () => {
      this._updateBoxHelper();
      this.onTransform(this.selected);
    });

    this.bbox = null;
  }

  _initEvents() {
    this._onResize = () => this._resize();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.host);
    }
    window.addEventListener('resize', this._onResize);

    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 700;
      down = null;
      if (moved > 6 || !quick || this.transform.dragging) return;
      this._pick(e);
    });
  }

  _resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop = () => {
    this._raf = requestAnimationFrame(this._loop);
    this._frame++;
    this._tickFly();
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  _tickFly() {
    const f = this._fly;
    if (!f) return;
    const t = Math.min(1, (performance.now() - f.t0) / f.ms);
    const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
    this.orbit.target.lerpVectors(f.fromTarget, f.toTarget, k);
    this.camera.up.lerpVectors(f.fromUp, f.toUp, k).normalize();
    if (t >= 1) this._fly = null;
  }

  // ───────────────────────── 선택 ─────────────────────────
  _pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const meshes = this.objects.children.filter((o) => o.isMesh && o.visible);
    const hit = this._raycaster.intersectObjects(meshes, false)[0];
    this.select(hit ? hit.object : null);
  }

  select(mesh) {
    if (mesh && mesh.parent !== this.objects) mesh = null;
    this.selected = mesh ?? null;
    if (this.selected) {
      this.transform.attach(this.selected);
      this._attachBoxHelper(this.selected);
    } else {
      this.transform.detach();
      this._clearBoxHelper();
    }
    this.onSelect(this.selected);
  }

  selectNone() { this.select(null); }

  selectById(id) {
    const mesh = this.objects.children.find((o) => o.userData.id === id) ?? null;
    if (mesh) this.select(mesh);
    return mesh;
  }

  selectedId() { return this.selected?.userData.id ?? null; }

  _attachBoxHelper(mesh) {
    if (this.bbox) {
      this.scene.remove(this.bbox);
      this.bbox.geometry.dispose();
      this.bbox.material.dispose();
    }
    this.bbox = new THREE.BoxHelper(mesh, 0x0a8fd6);
    this.bbox.material.depthTest = false;
    this.bbox.material.transparent = true;
    this.bbox.material.opacity = 0.95;
    this.bbox.renderOrder = 12;
    this.bbox.visible = mesh.visible;
    this.scene.add(this.bbox);
  }

  _clearBoxHelper() {
    if (!this.bbox) return;
    this.scene.remove(this.bbox);
    this.bbox.geometry.dispose();
    this.bbox.material.dispose();
    this.bbox = null;
  }

  _updateBoxHelper() {
    if (!this.bbox || !this.selected) return;
    this.bbox.visible = this.selected.visible;
    if (this.selected.visible) this.bbox.update();
  }

  // ───────────────────────── 도형 ─────────────────────────
  _uniqueName(base) {
    const names = new Set(this.objects.children.map((o) => o.userData.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  _makeMesh(spec) {
    const kind = SHAPE_BY_KIND[spec.kind] ? spec.kind : 'box';
    const color = validColor(spec.color) ? spec.color : (SHAPE_BY_KIND[kind]?.color ?? '#0abbee');
    const material = spec.material in MATERIALS_KEYS ? spec.material : 'plastic';
    const mesh = new THREE.Mesh(geometryFor(kind), makeMaterial(color, material));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const size = (spec.size ?? SHAPE_BY_KIND[kind]?.size ?? [20, 20, 20]).map((n) => Math.max(0.5, Number(n) || 1));
    mesh.scale.set(size[0], size[1], size[2]);
    const pos = spec.position ?? [0, size[1] / 2, 0];
    mesh.position.set(Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0);
    if (spec.rotation) mesh.rotation.set((spec.rotation[0] || 0) * DEG, (spec.rotation[1] || 0) * DEG, (spec.rotation[2] || 0) * DEG);
    const id = spec.id || `o${Date.now().toString(36)}${(this._seq++).toString(36)}`;
    mesh.userData = {
      id,
      kind,
      name: String(spec.name || SHAPE_BY_KIND[kind]?.label || '도형').slice(0, 60),
      color,
      material,
    };
    mesh.visible = spec.visible !== false;
    mesh.name = mesh.userData.name;
    return mesh;
  }

  addShape(kind, opts = {}) {
    const spec = SHAPE_BY_KIND[kind] ?? SHAPE_PALETTE[0];
    this.pushHistory();
    const mesh = this._makeMesh({
      kind,
      name: this._uniqueName(opts.name ?? spec.label),
      size: opts.size ?? spec.size,
      color: opts.color ?? spec.color,
      material: opts.material ?? 'plastic',
      // 새 도형은 작업판 가운데, 살짝 비껴 놓아 겹치지 않게
      position: opts.position ?? jitterPosition(this.objects.children.length, (opts.size ?? spec.size)[1]),
      rotation: opts.rotation,
    });
    this.objects.add(mesh);
    this.select(mesh);
    this._afterObjectsChanged();
    return mesh;
  }

  addParts(parts) {
    const added = [];
    for (const p of parts) {
      const mesh = this._makeMesh({
        ...p,
        name: this._uniqueName(String(p.name || SHAPE_BY_KIND[p.kind]?.label || '도형')),
      });
      this.objects.add(mesh);
      added.push(mesh);
    }
    return added;
  }

  loadSample(sampleId) {
    const sample = SAMPLE_MODELS.find((s) => s.id === sampleId);
    if (!sample) return [];
    this.pushHistory();
    this.clearObjects(false);
    const added = this.addParts(sample.parts);
    this.select(added[0] ?? null);
    this._afterObjectsChanged();
    this.setView('iso');
    return added;
  }

  clearObjects(recordHistory = true) {
    if (recordHistory) this.pushHistory();
    for (const mesh of [...this.objects.children]) this._removeMesh(mesh);
    this.select(null);
    if (recordHistory) this._afterObjectsChanged();
  }

  _removeMesh(mesh) {
    this.objects.remove(mesh);
    mesh.material?.dispose?.();
    if (this.selected === mesh) this.select(null);
  }

  deleteSelected() {
    if (!this.selected) return false;
    this.pushHistory();
    this._removeMesh(this.selected);
    this._afterObjectsChanged();
    return true;
  }

  duplicateSelected() {
    if (!this.selected) return false;
    const src = this.selected;
    this.pushHistory();
    const copy = this._makeMesh({
      kind: src.userData.kind,
      name: this._uniqueName(`${src.userData.name} 복사`),
      size: [src.scale.x, src.scale.y, src.scale.z],
      color: src.userData.color,
      material: src.userData.material,
      position: [src.position.x + 12, src.position.y, src.position.z + 12],
      rotation: [src.rotation.x / DEG, src.rotation.y / DEG, src.rotation.z / DEG],
      visible: src.visible,
    });
    this.objects.add(copy);
    this.select(copy);
    this._afterObjectsChanged();
    return true;
  }

  dropSelected() {
    if (!this.selected) return false;
    this.pushHistory();
    const box = new THREE.Box3().setFromObject(this.selected);
    this.selected.position.y -= box.min.y;
    this.selected.updateMatrixWorld(true);
    this._updateBoxHelper();
    this._afterObjectsChanged();
    return true;
  }

  updateSelected(patch) {
    if (!this.selected) return;
    this.updateObject(this.selected.userData.id, patch);
  }

  updateObject(id, patch = {}) {
    const mesh = this.objects.children.find((o) => o.userData.id === id);
    if (!mesh) return null;
    let structural = false;
    if (patch.name != null) {
      const name = String(patch.name).slice(0, 60);
      if (name && name !== mesh.userData.name) { mesh.userData.name = name; mesh.name = name; structural = true; }
    }
    if (Array.isArray(patch.position)) mesh.position.set(num(patch.position[0]), num(patch.position[1]), num(patch.position[2]));
    if (Array.isArray(patch.rotationDeg)) mesh.rotation.set(num(patch.rotationDeg[0]) * DEG, num(patch.rotationDeg[1]) * DEG, num(patch.rotationDeg[2]) * DEG);
    if (Array.isArray(patch.size)) mesh.scale.set(Math.max(0.5, num(patch.size[0], 1)), Math.max(0.5, num(patch.size[1], 1)), Math.max(0.5, num(patch.size[2], 1)));
    if (patch.color && validColor(patch.color) && patch.color !== mesh.userData.color) {
      mesh.userData.color = patch.color;
      mesh.material.color.set(patch.color);
      structural = true;
    }
    if (patch.material && patch.material !== mesh.userData.material && patch.material in MATERIALS_KEYS) {
      mesh.userData.material = patch.material;
      const color = mesh.userData.color;
      mesh.material.dispose();
      mesh.material = makeMaterial(color, patch.material);
      structural = true;
    }
    if (patch.visible != null && Boolean(patch.visible) !== mesh.visible) {
      mesh.visible = Boolean(patch.visible);
      structural = true;
    }
    mesh.updateMatrixWorld(true);
    this._updateBoxHelper();
    if (structural) this._afterObjectsChanged(); else this.onTransform(mesh);
    return mesh;
  }

  setObjectVisible(id, visible) { this.updateObject(id, { visible }); }

  toggleSelect(id) {
    if (this.selected?.userData.id === id) this.select(null);
    else this.selectById(id);
  }

  // ───────────────────────── 도구 ─────────────────────────
  setMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this.mode = mode;
    this.transform.setMode(mode);
  }

  setSnap(mm) {
    this.snap = Number(mm) || 0;
    this.transform.setTranslationSnap(this.snap || null);
  }

  setGridVisible(visible) { this.grid.visible = Boolean(visible); }

  setView(name) {
    const sel = this.selected;
    let box;
    if (name === 'focus' && sel) box = new THREE.Box3().setFromObject(sel);
    else box = this._contentBox();
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 14);
    const pad = name === 'focus' ? 1.7 : 1.15;
    const dist = radius / Math.sin((this.camera.fov * DEG) / 2) * pad + radius * 0.55;
    const dir = new THREE.Vector3(0.9, 0.74, 1.12).normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (name === 'top') { dir.set(0, 1, 0.0001); up = new THREE.Vector3(0, 0, -1); }
    else if (name === 'front') dir.set(0, 0, 1);
    else if (name === 'right') dir.set(1, 0, 0);
    else if (name === 'focus' && sel) dir.copy(this.camera.position).sub(this.orbit.target).normalize();
    if (dir.lengthSq() < 0.001) dir.set(0.9, 0.74, 1.12).normalize();
    const pos = center.clone().add(dir.multiplyScalar(dist));
    this._flyTo(pos, center, up, name === 'focus' ? 420 : 560);
  }

  _contentBox() {
    const meshes = this.objects.children.filter((o) => o.isMesh && o.visible);
    const box = new THREE.Box3();
    if (!meshes.length) {
      box.min.set(-100, 0, -100);
      box.max.set(100, 0, 100);
      box.expandByPoint(new THREE.Vector3(0, 60, 0));
      return box;
    }
    for (const m of meshes) box.expandByObject(m);
    box.expandByPoint(new THREE.Vector3(box.min.x, 0, box.min.z));
    return box;
  }

  _flyTo(pos, target, up, ms) {
    this._fly = {
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.orbit.target.clone(),
      toTarget: target,
      fromUp: this.camera.up.clone(),
      toUp: up ?? new THREE.Vector3(0, 1, 0),
      t0: performance.now(),
      ms,
    };
  }

  // ───────────────────────── 되돌리기 ─────────────────────────
  pushHistory() {
    this._push(JSON.stringify(this.serialize()));
  }

  _push(snapshot) {
    if (this._undo[this._undo.length - 1] !== snapshot) this._undo.push(snapshot);
    if (this._undo.length > 80) this._undo.shift();
    this._redo = [];
    this.onHistory();
  }

  beginEdit() {
    if (!this._editSnapshot) this._editSnapshot = JSON.stringify(this.serialize());
  }

  commitEdit() {
    const snap = this._editSnapshot;
    this._editSnapshot = null;
    if (!snap) return;
    if (snap !== JSON.stringify(this.serialize())) this._push(snap);
  }

  undo() {
    if (!this._undo.length) return false;
    this._redo.push(JSON.stringify(this.serialize()));
    const snap = this._undo.pop();
    this._restore(snap);
    this.onHistory();
    return true;
  }

  redo() {
    if (!this._redo.length) return false;
    this._undo.push(JSON.stringify(this.serialize()));
    const snap = this._redo.pop();
    this._restore(snap);
    this.onHistory();
    return true;
  }

  get historyState() { return { undo: this._undo.length, redo: this._redo.length }; }

  _restore(snapshotText) {
    const keepId = this.selectedId();
    const data = typeof snapshotText === 'string' ? JSON.parse(snapshotText) : snapshotText;
    this.clearObjects(false);
    const added = this.addParts(data.objects ?? []);
    this.select(keepId ? (added.find((m) => m.userData.id === keepId) ?? null) : null);
    this._afterObjectsChanged();
  }

  // ───────────────────────── 저장 · 내보내기 ─────────────────────────
  serialize() {
    return {
      app: 'bmrcad',
      version: SCENE_VERSION,
      objects: this.objects.children.filter((o) => o.isMesh).map((o) => ({
        id: o.userData.id,
        kind: o.userData.kind,
        name: o.userData.name,
        position: [r3(o.position.x), r3(o.position.y), r3(o.position.z)],
        rotation: [r3(o.rotation.x / DEG), r3(o.rotation.y / DEG), r3(o.rotation.z / DEG)],
        size: [r3(o.scale.x), r3(o.scale.y), r3(o.scale.z)],
        color: o.userData.color,
        material: o.userData.material,
        visible: o.visible !== false,
      })),
    };
  }

  load(data) {
    const objects = Array.isArray(data?.objects) ? data.objects.slice(0, 400) : [];
    this.clearObjects(false);
    this._undo = [];
    this._redo = [];
    this.addParts(objects);
    this.select(null);
    this._afterObjectsChanged();
    this.onHistory();
    return objects.length;
  }

  stats() {
    let tris = 0;
    let count = 0;
    for (const mesh of this.objects.children) {
      if (!mesh.isMesh) continue;
      count++;
      const g = mesh.geometry;
      const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      tris += Math.round(n);
    }
    return { count, tris };
  }

  _exportGroup() {
    this.objects.updateMatrixWorld(true);
    const group = new THREE.Group();
    for (const mesh of this.objects.children) {
      if (!mesh.isMesh || !mesh.visible) continue;
      const clone = mesh.clone();
      clone.castShadow = false;
      clone.receiveShadow = false;
      clone.matrixAutoUpdate = false;
      clone.matrix.copy(mesh.matrixWorld);
      group.add(clone);
    }
    group.updateMatrixWorld(true);
    return group;
  }

  /** 3D 프린터용 STL. binary=true 면 작은 이진 파일, false 면 사람이 읽는 ASCII. */
  exportSTL({ binary = true } = {}) {
    if (!this.stats().count) throw new Error('내보낼 도형이 없습니다.');
    const group = this._exportGroup();
    const out = new STLExporter().parse(group, { binary });
    return out;
  }

  /** 색·재질까지 담은 GLB (ArrayBuffer) */
  async exportGLB() {
    if (!this.stats().count) throw new Error('내보낼 도형이 없습니다.');
    const group = this._exportGroup();
    const exporter = new GLTFExporter();
    return await exporter.parseAsync(group, { binary: true, onlyVisible: true });
  }

  _afterObjectsChanged() {
    this._updateBoxHelper();
    this.onChange();
    // 바닥 정렬처럼 값이 바뀌는 동작 뒤에 속성 패널 숫자도 함께 새로 고침
    this.onTransform(this.selected);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    window.removeEventListener('resize', this._onResize);
    this._clearBoxHelper();
    this.transform.detach();
    this.transform.dispose?.();
    this.orbit.dispose();
    this._envRT?.dispose();
    this.renderer.dispose();
  }
}

const MATERIALS_KEYS = { matte: 1, plastic: 1, metal: 1, glass: 1 };

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function validColor(c) {
  if (typeof c !== 'string') return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

function jitterPosition(index, height) {
  if (!index) return [0, Math.max(height, 1) / 2, 0];
  const ring = Math.floor((index - 1) / 6) + 1;
  const step = (index - 1) % 6;
  const angle = (step * Math.PI) / 3 + ring * 0.4;
  const radius = 36 * ring;
  return [Math.cos(angle) * radius, Math.max(height, 1) / 2, Math.sin(angle) * radius];
}
