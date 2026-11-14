// 모델 저장소 — 로그인했으면 서버(bmrcad-fn → bmrcad.projects), 아니면 이 브라우저(localStorage)
import { supabase, FN_URL } from '../supabase.js';
import { local } from '../store.js';

const LOCAL_KEY = 'projects';

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? '';
}

export function isLocalId(id) {
  return typeof id === 'string' && id.startsWith('local-');
}

/** 로그인 상태면 'cloud', 아니면 'local' */
export async function storeKind() {
  return (await accessToken()) ? 'cloud' : 'local';
}

function readLocal() {
  const rows = local.get(LOCAL_KEY, []);
  return Array.isArray(rows) ? rows : [];
}
function writeLocal(rows) {
  local.set(LOCAL_KEY, rows.slice(0, 60));
}

/** 내 모델 목록 (서버가 안 되면 이 브라우저 것으로) */
export async function listProjects() {
  const token = await accessToken();
  if (token) {
    try {
      const r = await fetch(`${FN_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const body = await r.json();
        if (Array.isArray(body.projects)) return { kind: 'cloud', projects: body.projects };
      }
    } catch { /* 서버가 아직 준비되지 않았으면 아래로 */ }
  }
  return { kind: 'local', projects: readLocal() };
}

/**
 * 모델 저장. id 가 있으면 그 모델을 덮어씁니다.
 * @returns {{kind:'cloud'|'local', project: object}}
 */
export async function saveProject({ id = null, title, data, isPublic = false }) {
  const token = await accessToken();
  const name = String(title || '').trim().slice(0, 60) || '제목 없는 모델';
  if (token) {
    try {
      const r = await fetch(`${FN_URL}/projects`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: isLocalId(id) ? null : (Number(id) || null),
          title: name,
          data,
          is_public: Boolean(isPublic),
        }),
      });
      if (r.ok) {
        const body = await r.json();
        if (body?.project) return { kind: 'cloud', project: body.project };
      }
    } catch { /* 아래 이 브라우저 저장으로 */ }
  }
  const rows = readLocal();
  const now = new Date().toISOString();
  const existing = !isLocalId(id) && id != null ? rows.find((p) => String(p.id) === String(id)) : rows.find((p) => p.id === id);
  const row = {
    id: existing?.id ?? (isLocalId(id) ? id : `local-${Date.now().toString(36)}`),
    title: name,
    data,
    is_public: Boolean(isPublic),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  writeLocal([row, ...rows.filter((p) => p.id !== row.id)]);
  return { kind: 'local', project: row };
}

export async function deleteProject(id) {
  const token = await accessToken();
  if (token && !isLocalId(id)) {
    try {
      const r = await fetch(`${FN_URL}/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) return { kind: 'cloud' };
    } catch { /* 아래 이 브라우저 저장으로 */ }
  }
  writeLocal(readLocal().filter((p) => p.id !== id && String(p.id) !== String(id)));
  return { kind: 'local' };
}

/** 목록에 보여 줄 날짜 (한국 시간, 짧게) */
export function shortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (same) return `오늘 ${hh}:${mm}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
