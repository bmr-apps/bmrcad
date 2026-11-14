// 도형 만들기 — 모든 도형은 '한 변 1' 크기의 기본 도형으로 만들어 두고,
// 화면에서는 scale 로 실제 mm 크기를 줍니다. 그래서 속성의 크기(X·Y·Z)가 곧 mm 이고,
// TransformControls 의 크기 손잡이로 늘린 값도 그대로 크기가 됩니다.
import * as THREE from 'three';

/** 기본 도형을 [-0.5, 0.5]³ 상자에 꼭 맞게 정리 (가운데 정렬 + 크기 1) */
function unitBox(geo) {
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  geo.boundingBox.getSize(size);
  geo.boundingBox.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  geo.scale(1 / (size.x || 1), 1 / (size.y || 1), 1 / (size.z || 1));
  geo.computeBoundingSphere();
  return geo;
}

const builders = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 40, 24),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 56),
  cone: () => new THREE.ConeGeometry(0.5, 1, 56),
  torus: () => new THREE.TorusGeometry(0.36, 0.14, 20, 64).rotateX(Math.PI / 2),
  prism: () => new THREE.CylinderGeometry(1, 1, 1, 3).rotateY(Math.PI / 6),
  pyramid: () => new THREE.CylinderGeometry(0, 1, 1, 4).rotateY(Math.PI / 4),
};

const geometryCache = new Map();

/** kind 에 맞는 기본 도형(공유). 크기는 scale 로 준다. */
export function geometryFor(kind) {
  const key = builders[kind] ? kind : 'box';
  if (!geometryCache.has(key)) geometryCache.set(key, unitBox(builders[key]()));
  return geometryCache.get(key);
}

/** 재질 이름 → MeshStandardMaterial 설정 */
export const MATERIALS = {
  matte: { label: '매트', roughness: 0.95, metalness: 0 },
  plastic: { label: '플라스틱', roughness: 0.42, metalness: 0.05 },
  metal: { label: '메탈', roughness: 0.24, metalness: 0.92 },
  glass: { label: '반투명', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.42 },
};

export function makeMaterial(color, materialName = 'plastic') {
  const preset = MATERIALS[materialName] ?? MATERIALS.plastic;
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: preset.roughness,
    metalness: preset.metalness,
    transparent: Boolean(preset.transparent),
    opacity: preset.opacity ?? 1,
    // 반투명은 앞뒤가 겹쳐 보이도록
    depthWrite: !preset.transparent,
    side: preset.transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (preset.transparent) m.flatShading = false;
  return m;
}

/** 왼쪽 팔레트에 놓이는 기본 도형들 */
export const SHAPE_PALETTE = [
  { kind: 'box', label: '큐브', size: [20, 20, 20], color: '#0abbee' },
  { kind: 'sphere', label: '구', size: [20, 20, 20], color: '#ff614a' },
  { kind: 'cylinder', label: '원기둥', size: [20, 20, 20], color: '#ffdc1a' },
  { kind: 'cone', label: '원뿔', size: [20, 20, 20], color: '#02c245' },
  { kind: 'torus', label: '도넛', size: [22, 22, 22], color: '#7e65c1' },
  { kind: 'prism', label: '삼각기둥', size: [22, 20, 22], color: '#0abbee' },
  { kind: 'pyramid', label: '피라미드', size: [22, 20, 22], color: '#ff614a' },
];

export const SHAPE_BY_KIND = Object.fromEntries(SHAPE_PALETTE.map((s) => [s.kind, s]));

/** 도형마다 다른 미리보기 아이콘 (24×24, 2px 검은 선 · 노란 면) */
export function shapeIcon(kind) {
  const common = 'fill="#ffdc1a" stroke="#000" stroke-width="2" stroke-linejoin="miter"';
  switch (kind) {
    case 'sphere':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" ${common}/><path d="M3 12a9 9 0 0 1 18 0" fill="none" stroke="#000" stroke-width="2"/><path d="M3 12a9 5 0 0 0 18 0" fill="none" stroke="#000" stroke-width="1.5"/></svg>`;
    case 'cylinder':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z" ${common}/><ellipse cx="12" cy="6" rx="8" ry="3" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
    case 'cone':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 15H4z" ${common}/><ellipse cx="12" cy="18" rx="8" ry="3" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
    case 'torus':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="13" rx="9" ry="6" ${common}/><ellipse cx="12" cy="13" rx="3.5" ry="2" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
    case 'prism':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 6v9l-9 3-9-3V9z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="miter"/><path d="M12 3l9 6-9 3-9-3z" fill="#ffdc1a" stroke="#000" stroke-width="2" stroke-linejoin="miter"/><path d="M12 12v9" stroke="#000" stroke-width="1.5"/></svg>`;
    case 'pyramid':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 15H3z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="miter"/><path d="M12 3l4 15H12z" fill="#ffdc1a" stroke="#000" stroke-width="2" stroke-linejoin="miter"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" fill="#ffdc1a" stroke="#000" stroke-width="2" stroke-linejoin="miter"/><path d="M3 7l9 4 9-4M12 11v10" fill="none" stroke="#000" stroke-width="2"/></svg>`;
  }
}

// ─────────────────────────── 예제 모델 ───────────────────────────
// 조각(primitive)만으로 만든 예시. 불러온 뒤 그대로 고치거나 STL 로 내보낼 수 있습니다.
// part(도형, 이름, 크기[mm], 위치[mm], 회전[도], 색, 재질)
const part = (kind, name, size, position, rotation, color, material = 'plastic') => ({
  kind, name, size, position, rotation, color, material,
});

/** 로켓 부품을 중심에서 띄우는 각도(도) */
function finParts() {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const deg = i * 120;
    const rad = (deg * Math.PI) / 180;
    out.push(part('box', `로켓 날개 ${i + 1}`, [6, 28, 20], [Math.sin(rad) * 14, 15, Math.cos(rad) * 14], [0, deg, 0], '#ff614a', 'plastic'));
  }
  return out;
}

export const SAMPLE_MODELS = [
  {
    id: 'rocket',
    label: '미니 로켓',
    emoji: '🚀',
    note: '몸통·노즈·날개 6조각',
    parts: [
      part('cylinder', '로켓 몸통', [26, 64, 26], [0, 32, 0], [0, 0, 0], '#f2f6f8', 'plastic'),
      part('cone', '로켓 노즈', [26, 34, 26], [0, 64 + 17, 0], [0, 0, 0], '#ff614a', 'plastic'),
      part('torus', '창틀', [18, 18, 18], [0, 46, 13], [90, 0, 0], '#0abbee', 'metal'),
      part('sphere', '창', [11, 11, 11], [0, 46, 14], [0, 0, 0], '#e5f7fc', 'glass'),
      part('cone', '분사구', [20, 14, 20], [0, 1, 0], [180, 0, 0], '#7e65c1', 'metal'),
      ...finParts(),
      part('cylinder', '받침대', [44, 4, 44], [0, 2, 0], [0, 0, 0], '#ffdc1a', 'matte'),
    ],
  },
  {
    id: 'pencup',
    label: '연필꽂이',
    emoji: '✏️',
    note: '컵 하나 + 연필 세 자루',
    parts: [
      part('cylinder', '연필꽂이 컵', [62, 62, 62], [0, 31, 0], [0, 0, 0], '#0abbee', 'plastic'),
      part('torus', '컵 테두리', [62, 62, 62], [0, 62, 0], [0, 0, 0], '#ffdc1a', 'plastic'),
      part('cylinder', '연필 1', [7, 74, 7], [-14, 88, 6], [0, 0, 6], '#ffdc1a', 'matte'),
      part('cone', '연필 1 심', [7, 12, 7], [-14, 131, 6], [0, 0, 6], '#ff614a', 'matte'),
      part('cylinder', '연필 2', [7, 66, 7], [13, 84, -4], [0, 0, -7], '#02c245', 'matte'),
      part('cone', '연필 2 심', [7, 12, 7], [13, 123, -4], [0, 0, -7], '#ff614a', 'matte'),
      part('cylinder', '연필 3', [7, 58, 7], [2, 80, 14], [0, 0, 2], '#7e65c1', 'matte'),
      part('cone', '연필 3 심', [7, 12, 7], [2, 115, 14], [0, 0, 2], '#ff614a', 'matte'),
      part('cylinder', '받침', [74, 4, 74], [0, 2, 0], [0, 0, 0], '#fff', 'matte'),
    ],
  },
  {
    id: 'school',
    label: '미니 별무리관',
    emoji: '🏠',
    note: '벽·지붕·문·창 9조각',
    parts: [
      part('box', '마당', [176, 6, 136], [0, 3, 0], [0, 0, 0], '#02c245', 'matte'),
      part('box', '본관 벽', [140, 56, 84], [0, 6 + 28, 0], [0, 0, 0], '#f7f9fa', 'matte'),
      part('pyramid', '지붕', [158, 46, 102], [0, 6 + 56 + 23, 0], [0, 45, 0], '#ff614a', 'matte'),
      part('box', '문', [26, 36, 4], [0, 6 + 18, 43], [0, 0, 0], '#7e65c1', 'plastic'),
      part('box', '창 1', [20, 18, 4], [-46, 6 + 34, 43], [0, 0, 0], '#0abbee', 'glass'),
      part('box', '창 2', [20, 18, 4], [46, 6 + 34, 43], [0, 0, 0], '#0abbee', 'glass'),
      part('box', '창 3', [20, 18, 4], [-46, 6 + 34, -43], [0, 0, 0], '#0abbee', 'glass'),
      part('box', '창 4', [20, 18, 4], [46, 6 + 34, -43], [0, 0, 0], '#0abbee', 'glass'),
      part('cylinder', '깃대', [3, 46, 3], [72, 6 + 23, 0], [0, 0, 0], '#fff', 'metal'),
      part('box', '깃발', [18, 12, 2], [81, 6 + 40, 0], [0, 0, 0], '#ffdc1a', 'matte'),
    ],
  },
];
