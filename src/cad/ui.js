// 오른쪽 패널 UI — 선택 도형 속성(Inspector)과 오브젝트 목록(Outliner)
import { MATERIALS, SHAPE_BY_KIND, shapeIcon } from './geometry.js';

const PALETTE = [
  '#0abbee', '#ffdc1a', '#ff614a', '#02c245', '#7e65c1', '#ffffff',
  '#111111', '#f2f6f8', '#ff9f1c', '#e91e63', '#8d6e63', '#4a5568',
];

const fmt = (n) => {
  const v = Math.round(Number(n) * 10) / 10;
  return String(Object.is(v, -0) ? 0 : v);
};
const deg = (rad) => (rad * 180) / Math.PI;

const EYE_OPEN = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1.5 10S4.6 4.6 10 4.6 18.5 10 18.5 10 15.4 15.4 10 15.4 1.5 10 1.5 10Z" fill="#fff" stroke="#000" stroke-width="1.8"/><circle cx="10" cy="10" r="2.6" fill="#000"/></svg>';
const EYE_SHUT = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1.5 10S4.6 4.6 10 4.6 18.5 10 18.5 10 15.4 15.4 10 15.4 1.5 10 1.5 10Z" fill="#fff" stroke="#000" stroke-width="1.8"/><path d="M3 17 17 3" stroke="#000" stroke-width="2"/></svg>';

export class Inspector {
  constructor({ root, engine, tagEl, onChange }) {
    this.root = root;
    this.engine = engine;
    this.tagEl = tagEl;
    this.onChange = onChange ?? (() => {});
    this.mesh = null;
    this.fields = {};

    root.addEventListener('input', (e) => this._onInput(e));
    root.addEventListener('change', (e) => this._onInput(e, true));
    root.addEventListener('focusin', (e) => {
      if (e.target.matches('input[type="number"], input[type="text"]')) this.engine.beginEdit();
    });
    root.addEventListener('focusout', (e) => {
      if (e.target.matches('input[type="number"], input[type="text"]')) this.engine.commitEdit();
    });
    root.addEventListener('click', (e) => this._onClick(e));
  }

  render(mesh) {
    this.mesh = mesh ?? null;
    if (!mesh) {
      this.tagEl.textContent = '없음';
      this.root.innerHTML = '<p class="empty">도형을 클릭하면 여기에서 이름·위치·크기·색을 바꿀 수 있어요.</p>';
      this.fields = {};
      return;
    }
    const u = mesh.userData;
    const kindLabel = SHAPE_BY_KIND[u.kind]?.label ?? '도형';
    this.tagEl.textContent = kindLabel;
    this.root.innerHTML = `
      <div class="insp-head">
        <span class="chip" id="f-swatch"></span>
        <input type="text" id="f-name" class="insp-name" value="${escapeAttr(u.name)}" maxlength="60" aria-label="도형 이름">
      </div>

      <div class="field-group">
        <h3>위치 <small>mm</small></h3>
        <div class="tri">
          ${numHTML('px', 'X', mesh.position.x)}
          ${numHTML('py', 'Y', mesh.position.y)}
          ${numHTML('pz', 'Z', mesh.position.z)}
        </div>
      </div>

      <div class="field-group">
        <h3>회전 <small>°</small></h3>
        <div class="tri">
          ${numHTML('rx', 'X', deg(mesh.rotation.x))}
          ${numHTML('ry', 'Y', deg(mesh.rotation.y))}
          ${numHTML('rz', 'Z', deg(mesh.rotation.z))}
        </div>
      </div>

      <div class="field-group">
        <h3>크기 <small>mm</small></h3>
        <div class="tri">
          ${numHTML('sx', 'X', mesh.scale.x, 0.5)}
          ${numHTML('sy', 'Y', mesh.scale.y, 0.5)}
          ${numHTML('sz', 'Z', mesh.scale.z, 0.5)}
        </div>
      </div>

      <div class="field-group">
        <h3>색상</h3>
        <div class="swatches" role="group" aria-label="색상 고르기">
          ${PALETTE.map((c) => `<button type="button" class="sw${sameColor(c, u.color) ? ' on' : ''}" data-color="${c}" aria-label="색 ${c}" aria-pressed="${sameColor(c, u.color)}"></button>`).join('')}
        </div>
        <div class="color-row">
          <input type="color" id="f-color" value="${toHex6(u.color)}" aria-label="직접 색 고르기">
          <input type="text" id="f-hex" value="${escapeAttr(toHex6(u.color))}" maxlength="7" spellcheck="false" aria-label="색 코드">
        </div>
      </div>

      <div class="field-group">
        <h3>재질</h3>
        <div class="seg" role="group" aria-label="재질">
          ${Object.entries(MATERIALS).map(([k, v]) => `<button type="button" data-material="${k}" class="${k === u.material ? 'on' : ''}" aria-pressed="${k === u.material}">${v.label}</button>`).join('')}
        </div>
      </div>

      <div class="insp-actions">
        <button type="button" data-act="duplicate">복제</button>
        <button type="button" data-act="drop">바닥 정렬</button>
        <button type="button" data-act="delete" class="danger">삭제</button>
      </div>
    `;
    for (const key of ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz']) {
      this.fields[key] = this.root.querySelector(`#f-${key}`);
    }
    this.fields.name = this.root.querySelector('#f-name');
    this.fields.hex = this.root.querySelector('#f-hex');
    this.fields.color = this.root.querySelector('#f-color');
    this.fields.swatch = this.root.querySelector('#f-swatch');
    // 색은 마크업의 style 속성 대신 자바스크립트로 넣습니다 (CSP style-src 'self' 환경에서도 보이도록)
    if (this.fields.swatch) this.fields.swatch.style.background = u.color;
    this.root.querySelectorAll('.sw').forEach((b) => { b.style.background = b.dataset.color; });
  }

  /** 손잡이로 끌거나 숫자를 바꿨을 때 값만 새로 고침 */
  refresh(mesh = this.mesh) {
    this.mesh = mesh ?? this.mesh;
    if (!this.mesh) return;
    const m = this.mesh;
    const active = document.activeElement;
    const set = (key, value) => {
      const el = this.fields[key];
      if (el && el !== active && document.activeElement !== el) el.value = value;
    };
    set('px', fmt(m.position.x));
    set('py', fmt(m.position.y));
    set('pz', fmt(m.position.z));
    set('rx', fmt(deg(m.rotation.x)));
    set('ry', fmt(deg(m.rotation.y)));
    set('rz', fmt(deg(m.rotation.z)));
    set('sx', fmt(m.scale.x));
    set('sy', fmt(m.scale.y));
    set('sz', fmt(m.scale.z));
    if (this.fields.swatch) this.fields.swatch.style.background = m.userData.color;
    if (this.fields.hex && this.fields.hex !== active) this.fields.hex.value = toHex6(m.userData.color);
    if (this.fields.color && this.fields.color !== active) this.fields.color.value = toHex6(m.userData.color);
  }

  _onInput(e, commit) {
    if (!this.mesh) return;
    const id = e.target.id;
    if (id === 'f-name') {
      this.engine.updateObject(this.mesh.userData.id, { name: e.target.value });
      if (commit) this.engine.commitEdit();
      return;
    }
    if (id === 'f-hex') {
      const c = normalizeHex(e.target.value);
      if (c) this._setColor(c, false);
      if (commit) this.engine.commitEdit();
      return;
    }
    if (id === 'f-color') {
      this._setColor(e.target.value, false);
      if (commit) this.engine.commitEdit();
      return;
    }
    if (!id.startsWith('f-')) return;
    const key = id.slice(2);
    const read = (k) => {
      const el = this.fields[k];
      const n = parseFloat(el?.value);
      return Number.isFinite(n) ? n : null;
    };
    const patch = {};
    if (key[0] === 'p') {
      patch.position = ['px', 'py', 'pz'].map((k, i) => read(k) ?? [this.mesh.position.x, this.mesh.position.y, this.mesh.position.z][i]);
    } else if (key[0] === 'r') {
      patch.rotationDeg = ['rx', 'ry', 'rz'].map((k, i) => read(k) ?? [deg(this.mesh.rotation.x), deg(this.mesh.rotation.y), deg(this.mesh.rotation.z)][i]);
    } else if (key[0] === 's') {
      patch.size = ['sx', 'sy', 'sz'].map((k, i) => read(k) ?? [this.mesh.scale.x, this.mesh.scale.y, this.mesh.scale.z][i]);
    }
    this.engine.updateObject(this.mesh.userData.id, patch);
    if (commit) this.engine.commitEdit();
  }

  _onClick(e) {
    const sw = e.target.closest('[data-color]');
    if (sw && this.mesh) {
      this.engine.beginEdit();
      this._setColor(sw.dataset.color, true);
      this.engine.commitEdit();
      return;
    }
    const mat = e.target.closest('[data-material]');
    if (mat && this.mesh) {
      this.engine.beginEdit();
      this.engine.updateObject(this.mesh.userData.id, { material: mat.dataset.material });
      this.engine.commitEdit();
      this.render(this.mesh);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'duplicate') this.engine.duplicateSelected();
    else if (act === 'drop') this.engine.dropSelected();
    else if (act === 'delete') this.engine.deleteSelected();
    this.onChange();
  }

  _setColor(color, rerender) {
    this.engine.updateObject(this.mesh.userData.id, { color });
    if (this.fields.swatch) this.fields.swatch.style.background = color;
    if (this.fields.hex && document.activeElement !== this.fields.hex) this.fields.hex.value = toHex6(color);
    if (this.fields.color && document.activeElement !== this.fields.color) this.fields.color.value = toHex6(color);
    this.root.querySelectorAll('.sw').forEach((b) => {
      const on = sameColor(b.dataset.color, color);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (rerender) this.render(this.mesh);
  }
}

export class Outliner {
  constructor({ list, empty, countEl, engine }) {
    this.list = list;
    this.empty = empty;
    this.countEl = countEl;
    this.engine = engine;
    list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('[data-eye]')) {
        const mesh = this.engine.objects.children.find((o) => o.userData.id === id);
        if (mesh) this.engine.setObjectVisible(id, !mesh.visible);
        return;
      }
      this.engine.toggleSelect(id);
    });
  }

  render() {
    const meshes = this.engine.objects.children.filter((o) => o.isMesh);
    this.countEl.textContent = `${meshes.length}개`;
    this.empty.hidden = meshes.length > 0;
    const selId = this.engine.selectedId();
    this.list.innerHTML = meshes.map((m) => {
      const u = m.userData;
      const kindLabel = SHAPE_BY_KIND[u.kind]?.label ?? '도형';
      return `
        <li class="obj-row${u.id === selId ? ' on' : ''}${m.visible ? '' : ' hidden-obj'}" data-id="${u.id}">
          <button type="button" class="eye" data-eye aria-label="${escapeAttr(u.name)} ${m.visible ? '숨기기' : '보이기'}" aria-pressed="${m.visible}">${m.visible ? EYE_OPEN : EYE_SHUT}</button>
          <span class="obj-ico" aria-hidden="true">${shapeIcon(u.kind)}</span>
          <span class="obj-name">${escapeHTML(u.name)}</span>
          <span class="obj-kind">${kindLabel}</span>
        </li>`;
    }).join('');
  }

  scrollToSelected() {
    this.list.querySelector('.obj-row.on')?.scrollIntoView({ block: 'nearest' });
  }
}

function numHTML(id, label, value, step = 1) {
  return `<label class="nf"><span>${label}</span><input type="number" id="f-${id}" value="${fmt(value)}" step="${step}" inputmode="decimal"></label>`;
}

function normalizeHex(v) {
  const s = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.toLowerCase()}`;
  return null;
}
function toHex6(c) {
  const s = String(c || '#000').replace('#', '');
  if (s.length === 3) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase();
  return `#${s.slice(0, 6).toLowerCase()}`;
}
function sameColor(a, b) {
  return toHex6(a) === toHex6(b);
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHTML(s);
}
