// 별무리 캐드 — 화면과 엔진을 잇는 코드
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './style.css';
import { supabase } from './supabase.js';
import { loginWithGoogle, logout } from './auth.js';
import { applyAppInfo } from './app-info.js';
import { session } from './store.js';
import { CadEngine } from './cad/engine.js';
import { SHAPE_PALETTE, SAMPLE_MODELS, shapeIcon } from './cad/geometry.js';
import { Inspector, Outliner } from './cad/ui.js';
import { listProjects, saveProject, deleteProject, shortDate } from './cad/api.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  gate: $('#gate'),
  previewBar: $('#preview-bar'),
  who: $('#who'),
  account: $('#btn-account'),
  signout: $('#btn-signout'),
  saveState: $('#save-state'),
  shapeGrid: $('#shape-grid'),
  sampleList: $('#sample-list'),
  projectList: $('#project-list'),
  projectEmpty: $('#project-empty'),
  projTitle: $('#proj-title'),
  storeTag: $('#store-tag'),
  inspectorRoot: $('#inspector'),
  selTag: $('#sel-tag'),
  objectList: $('#object-list'),
  objectEmpty: $('#object-empty'),
  objCount: $('#obj-count'),
  emptyHint: $('#empty-hint'),
  viewBadge: $('#view-badge'),
  toastWrap: $('#toast-wrap'),
  statusCount: $('#st-count'),
  statusSel: $('#st-sel'),
  statusTri: $('#st-tri'),
  panelLeft: $('#panel-left'),
  panelRight: $('#panel-right'),
  mobileTabs: $('#mobile-tabs'),
  help: $('#help-sheet'),
  jsonFile: $('#json-file'),
};

const state = {
  user: null,
  projectId: null,
  projectStore: 'local',
  entered: false,
};

// ───────────────────────── 3D 엔진 ─────────────────────────
const engine = new CadEngine({
  host: $('#canvas-host'),
  canvas: $('#cad-canvas'),
  onChange: () => {
    outliner.render();
    updateStatus();
  },
  onSelect: (mesh) => {
    inspector.render(mesh);
    outliner.render();
    updateStatus();
    if (mesh && isSmall()) openPanel('inspect');
  },
  onTransform: () => {
    inspector.refresh();
    updateStatus();
  },
  onHistory: () => {
    const h = engine.historyState;
    $('#btn-undo').disabled = !h.undo;
    $('#btn-redo').disabled = !h.redo;
  },
  onInteraction: () => {},
});

const inspector = new Inspector({
  root: el.inspectorRoot,
  engine,
  tagEl: el.selTag,
  onChange: () => updateStatus(),
});

const outliner = new Outliner({
  list: el.objectList,
  empty: el.objectEmpty,
  countEl: el.objCount,
  engine,
});

// ───────────────────────── 도형 팔레트 · 예제 ─────────────────────────
el.shapeGrid.innerHTML = SHAPE_PALETTE.map((s) => `
  <button type="button" class="shape-btn" data-kind="${s.kind}" title="${s.label} 추가">
    <span class="sb-ico">${shapeIcon(s.kind)}</span>
    <span class="sb-label">${s.label}</span>
  </button>`).join('');
el.shapeGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-kind]');
  if (!btn) return;
  engine.addShape(btn.dataset.kind);
  const mesh = engine.selected;
  if (mesh) toast(`${mesh.userData.name} 추가`);
});

el.sampleList.innerHTML = SAMPLE_MODELS.map((s) => `
  <button type="button" class="sample-btn" data-sample="${s.id}">
    <span class="sm-emoji" aria-hidden="true">${s.emoji}</span>
    <span class="sm-txt"><b>${s.label}</b><small>${s.note}</small></span>
  </button>`).join('');
el.sampleList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sample]');
  if (!btn) return;
  const sample = SAMPLE_MODELS.find((s) => s.id === btn.dataset.sample);
  if (!sample) return;
  if (engine.stats().count && !confirm(`작업판에 있는 도형을 지우고 '${sample.label}'을(를) 불러올까요?`)) return;
  engine.loadSample(sample.id);
  el.projTitle.value = sample.label;
  state.projectId = null;
  toast(`${sample.emoji} ${sample.label} 불러왔어요`);
});

// ───────────────────────── 상태 표시 ─────────────────────────
function updateStatus() {
  const { count, tris } = engine.stats();
  const nf = new Intl.NumberFormat('ko-KR');
  el.statusCount.textContent = `도형 ${count}개`;
  el.statusTri.textContent = `삼각형 ${nf.format(tris)}`;
  el.emptyHint.hidden = count > 0;
  const sel = engine.selected;
  el.statusSel.textContent = sel ? `${sel.userData.name}` : '선택 없음';
}

// ───────────────────────── 툴바 ─────────────────────────
function setPressed(groupSel, attr, value) {
  document.querySelectorAll(groupSel).forEach((b) => b.classList.toggle('on', b.dataset[attr] === value));
}

document.querySelectorAll('[data-view]').forEach((b) => {
  b.addEventListener('click', () => {
    engine.setView(b.dataset.view);
    if (b.dataset.view !== 'focus') setPressed('[data-view]', 'view', b.dataset.view);
    setViewBadge(b.dataset.view);
  });
});
function setViewBadge(name) {
  const label = { iso: '홈 · 등각', top: '위에서', front: '앞에서', right: '옆에서', focus: '선택 확대' }[name] ?? '홈 · 등각';
  el.viewBadge.textContent = label;
}

document.querySelectorAll('[data-mode]').forEach((b) => {
  b.addEventListener('click', () => {
    engine.setMode(b.dataset.mode);
    setPressed('[data-mode]', 'mode', b.dataset.mode);
  });
});

document.querySelectorAll('[data-snap]').forEach((b) => {
  b.addEventListener('click', () => {
    engine.setSnap(Number(b.dataset.snap));
    setPressed('[data-snap]', 'snap', b.dataset.snap);
    const mm = Number(b.dataset.snap);
    toast(mm ? `격자 ${mm}mm 에 맞춰 움직입니다` : '격자 맞춤 꺼짐');
  });
});

$('#btn-grid').addEventListener('click', (e) => {
  const on = !e.currentTarget.classList.contains('on');
  engine.setGridVisible(on);
  e.currentTarget.classList.toggle('on', on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
});

$('#btn-undo').addEventListener('click', () => { if (!engine.undo()) toast('되돌릴 것이 없습니다'); });
$('#btn-redo').addEventListener('click', () => { if (!engine.redo()) toast('다시 실행할 것이 없습니다'); });
$('#btn-delete').addEventListener('click', () => {
  if (!engine.deleteSelected()) toast('먼저 도형을 선택하세요');
});

// ───────────────────────── 파일: 내보내기 · 백업 ─────────────────────────
function fileBase() {
  const t = (el.projTitle.value || '별무리캐드').trim().replace(/[\\/:*?"<>|]+/g, '').slice(0, 40) || '별무리캐드';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${t}-${stamp}`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

$('#btn-stl').addEventListener('click', () => {
  try {
    const out = engine.exportSTL({ binary: true });
    let blob;
    if (out instanceof ArrayBuffer) blob = new Blob([out], { type: 'model/stl' });
    else if (out?.buffer) blob = new Blob([out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)], { type: 'model/stl' });
    else blob = new Blob([out], { type: 'model/stl' });
    download(blob, `${fileBase()}.stl`);
    toast('STL 파일을 내려받았습니다 — 슬라이서에 넣어 보세요', 3600);
  } catch (err) {
    toast(err?.message || 'STL 내보내기에 실패했습니다');
  }
});

$('#btn-glb').addEventListener('click', async () => {
  const btn = $('#btn-glb');
  btn.disabled = true;
  try {
    const buf = await engine.exportGLB();
    download(new Blob([buf], { type: 'model/gltf-binary' }), `${fileBase()}.glb`);
    toast('GLB 파일을 내려받았습니다');
  } catch (err) {
    toast(err?.message || 'GLB 내보내기에 실패했습니다');
  } finally {
    btn.disabled = false;
  }
});

$('#btn-json-save').addEventListener('click', () => {
  const data = engine.serialize();
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBase()}.json`);
  toast('JSON 백업 파일을 내려받았습니다');
});

$('#btn-json-load').addEventListener('click', () => el.jsonFile.click());
el.jsonFile.addEventListener('change', async () => {
  const file = el.jsonFile.files?.[0];
  el.jsonFile.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data?.objects)) throw new Error('별무리 캐드 JSON 파일이 아닙니다.');
    if (engine.stats().count && !confirm('지금 작업판을 지우고 이 파일을 열까요?')) return;
    const n = engine.load(data);
    el.projTitle.value = file.name.replace(/\.json$/i, '').slice(0, 60);
    state.projectId = null;
    toast(`도형 ${n}개를 불러왔습니다`);
  } catch (err) {
    toast(err?.message || '파일을 열지 못했습니다', 4000);
  }
});

$('#btn-new').addEventListener('click', () => {
  if (!engine.stats().count) { toast('작업판이 이미 비어 있어요'); return; }
  if (!confirm('작업판의 도형을 모두 지우고 새로 시작할까요? (되돌리기로 살릴 수 있습니다)')) return;
  engine.clearObjects();
  el.projTitle.value = '';
  state.projectId = null;
  toast('새 작업판으로 시작합니다');
});

// ───────────────────────── 내 모델 (클라우드 · 이 기기) ─────────────────────────
async function refreshProjects() {
  const { kind, projects } = await listProjects();
  state.projectStore = kind;
  el.storeTag.textContent = kind === 'cloud' ? '계정' : '이 기기';
  el.saveState.textContent = kind === 'cloud' ? '계정에 저장' : '이 기기에 저장';
  el.projectEmpty.hidden = projects.length > 0;
  el.projectList.innerHTML = projects.map((p) => {
    const n = Array.isArray(p.data?.objects) ? p.data.objects.length : 0;
    return `<li class="proj-row" data-id="${String(p.id)}">
      <button type="button" class="proj-main" data-open>
        <b>${escapeHTML(p.title || '제목 없는 모델')}</b>
        <small>${shortDate(p.updated_at || p.created_at)} · 도형 ${n}개</small>
      </button>
      <button type="button" class="proj-del" data-del aria-label="${escapeHTML(p.title || '모델')} 삭제">×</button>
    </li>`;
  }).join('');
}

el.projectList.addEventListener('click', async (e) => {
  const row = e.target.closest('[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('[data-del]')) {
    if (!confirm('이 모델을 지울까요? 되돌릴 수 없습니다.')) return;
    await deleteProject(id);
    if (String(state.projectId) === String(id)) state.projectId = null;
    await refreshProjects();
    toast('모델을 지웠습니다');
    return;
  }
  if (e.target.closest('[data-open]')) {
    const { projects } = await listProjects();
    const p = projects.find((x) => String(x.id) === String(id));
    if (!p) { toast('모델을 찾지 못했습니다'); return; }
    if (engine.stats().count && !confirm(`'${p.title}'을(를) 열까요? 지금 작업판은 지워집니다.`)) return;
    engine.load(p.data ?? { objects: [] });
    state.projectId = p.id;
    el.projTitle.value = p.title ?? '';
    toast(`'${p.title}' 불러왔어요`);
  }
});

$('#btn-save').addEventListener('click', async () => {
  const btn = $('#btn-save');
  if (!engine.stats().count) { toast('저장할 도형이 없습니다'); return; }
  btn.disabled = true;
  try {
    const { kind, project } = await saveProject({
      id: state.projectId,
      title: el.projTitle.value,
      data: engine.serialize(),
    });
    state.projectId = project.id;
    if (!el.projTitle.value) el.projTitle.value = project.title;
    await refreshProjects();
    toast(kind === 'cloud' ? '계정에 저장했습니다' : '이 브라우저에 저장했습니다');
  } catch (err) {
    toast(err?.message || '저장하지 못했습니다', 4000);
  } finally {
    btn.disabled = false;
  }
});

// ───────────────────────── 로그인 / 미리보기 ─────────────────────────
function enterStudio(mode) {
  state.entered = true;
  el.gate.hidden = true;
  document.body.classList.remove('gated');
  el.previewBar.hidden = mode !== 'preview';
  session.set('entered', mode);
}

function showGate() {
  el.gate.hidden = false;
  document.body.classList.add('gated');
}

function setUser(user) {
  state.user = user ?? null;
  const on = Boolean(user);
  el.who.hidden = !on;
  el.account.hidden = on;
  el.signout.hidden = !on;
  if (on) {
    const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || '나';
    el.who.innerHTML = `<span class="avatar" aria-hidden="true">${escapeHTML(String(name).trim().charAt(0) || '나')}</span><span class="who-txt"><b>${escapeHTML(String(name).slice(0, 20))}</b><small>계정에 저장</small></span>`;
  } else {
    el.who.innerHTML = '';
  }
}

const params = new URLSearchParams(location.search);
if (params.get('preview') === '1') enterStudio('preview');

$('#btn-google').addEventListener('click', () => loginWithGoogle());
$('#btn-preview').addEventListener('click', () => enterStudio('preview'));
$('#btn-preview-login').addEventListener('click', () => loginWithGoogle());
el.account.addEventListener('click', () => showGate());
$('#btn-signout').addEventListener('click', async () => {
  await logout();
  setUser(null);
  enterStudio('preview');
  await refreshProjects();
  toast('로그아웃했습니다. 모델은 이 브라우저에만 저장됩니다');
});

function bootDone() {
  const boot = $('#boot');
  if (boot) boot.remove();
}

supabase.auth.getSession()
  .then(({ data }) => {
    const user = data.session?.user ?? null;
    setUser(user);
    if (user) enterStudio('user');
    // 이 탭에서 이미 들어왔으면 로그인 화면을 다시 띄우지 않습니다
    else if (session.get('entered')) enterStudio(session.get('entered'));
    else showGate();
    refreshProjects();
  })
  .catch(() => {
    if (params.get('preview') === '1') enterStudio('preview');
    else showGate();
    refreshProjects();
  })
  .finally(bootDone);

supabase.auth.onAuthStateChange((_event, sess) => {
  setUser(sess?.user ?? null);
  if (sess?.user) {
    enterStudio('user');
    refreshProjects();
  }
});

// ───────────────────────── 단축키 ─────────────────────────
const typing = (t) => t && (t.matches('input, textarea, select') || t.isContentEditable);

window.addEventListener('keydown', (e) => {
  if (typing(e.target)) return;
  if (!state.entered) return;
  const meta = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (meta && k === 'z' && !e.shiftKey) { e.preventDefault(); engine.undo(); return; }
  if (meta && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); engine.redo(); return; }
  if (meta && k === 'd') { e.preventDefault(); engine.duplicateSelected(); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); engine.deleteSelected(); return; }
  if (k === 'w') { engine.setMode('translate'); setPressed('[data-mode]', 'mode', 'translate'); return; }
  if (k === 'e') { engine.setMode('rotate'); setPressed('[data-mode]', 'mode', 'rotate'); return; }
  if (k === 'r') { engine.setMode('scale'); setPressed('[data-mode]', 'mode', 'scale'); return; }
  if (k === 'f') { engine.setView('focus'); setViewBadge('focus'); return; }
  if (k === 'home') { engine.setView('iso'); setViewBadge('iso'); setPressed('[data-view]', 'view', 'iso'); return; }
  if (k === 'escape') { engine.selectNone(); return; }
  if (k === '?') { openHelp(true); }
});

// ───────────────────────── 도움말 · 알림 · 패널 ─────────────────────────
function openHelp(open) {
  el.help.hidden = !open;
}
$('#btn-help').addEventListener('click', () => openHelp(true));
$('#btn-help-close').addEventListener('click', () => openHelp(false));
el.help.addEventListener('click', (e) => {
  if (e.target === el.help) openHelp(false);
});

let toastTimer = null;
function toast(message, ms = 2400) {
  el.toastWrap.textContent = '';
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = message;
  el.toastWrap.appendChild(div);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 260); }, ms);
}

const isSmall = () => window.matchMedia('(max-width: 900px)').matches;

function openPanel(which, toggle = false) {
  const side = which === 'left' ? el.panelLeft : el.panelRight;
  const other = which === 'left' ? el.panelRight : el.panelLeft;
  const sameTab = el.mobileTabs.querySelector('.on')?.dataset.tab === which;
  const close = toggle && side.classList.contains('open') && sameTab;
  other.classList.remove('open');
  side.classList.toggle('open', !close);
  el.mobileTabs.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', !close && b.dataset.tab === which));
  if (!close && which !== 'left') {
    const pane = document.getElementById(which === 'objects' ? 'pane-objects' : 'pane-inspect');
    if (pane) requestAnimationFrame(() => pane.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
}

el.mobileTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (tab === 'left') openPanel('left', true);
  else if (tab === 'inspect') openPanel('inspect', true);
  else openPanel('objects', true);
});

window.addEventListener('resize', () => {
  if (!isSmall()) {
    el.panelLeft.classList.remove('open');
    el.panelRight.classList.remove('open');
  }
});

// ───────────────────────── 시작 ─────────────────────────
applyAppInfo(' · 3D 모델링');
outliner.render();
updateStatus();
engine.onHistory();
setViewBadge('iso');
refreshProjects();
window.bmrCad = { engine, toast };

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
