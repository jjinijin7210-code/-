// ============================================================
// June 캐릭터 관리실 (계획서 6장)
//
// June 공식 캐릭터 정보(외형/금지요소/기준 프롬프트)를 버전 단위로 관리하고,
// "June 요청 시 공식 캐릭터 기준이 자동으로 요청서에 포함"되는 로직을 담당합니다.
// 순수 함수로 작성해서 Node.js에서도 그대로 테스트할 수 있습니다.
// (테스트: scripts/test-june-character.mjs)
// ============================================================

// 앞면/측면/뒷면 - 캐릭터 레퍼런스 이미지 첨부 종류 (AttachmentSection의 kinds로 사용)
export const JUNE_VIEW_KINDS = [
  { key: 'front', label: '앞면' },
  { key: 'side', label: '측면' },
  { key: 'back', label: '뒷면' },
]

// 텍스트로 관리하는 캐릭터 속성 필드
export const JUNE_TEXT_FIELDS = [
  { key: 'face', label: '얼굴', type: 'text' },
  { key: 'hair', label: '헤어', type: 'text' },
  { key: 'outfit', label: '의상', type: 'text' },
  { key: 'expression', label: '표정', type: 'text' },
  { key: 'pose', label: '포즈', type: 'text' },
  { key: 'color', label: '색상', type: 'text' },
  { key: 'forbidden_elements', label: '금지 요소', type: 'textarea' },
  { key: 'base_prompt', label: '기준 프롬프트', type: 'textarea' },
]

export function getEmptyJuneCharacter() {
  const base = { version: '', is_active: false, views: [], note: '' }
  for (const f of JUNE_TEXT_FIELDS) base[f.key] = ''
  return base
}

// 버전 목록 중 지금 "공식"으로 지정된 버전 하나를 찾음 (없으면 null)
export function getActiveVersion(versions) {
  return versions.find((v) => v.is_active) || null
}

// 특정 버전을 활성화하면 나머지는 전부 비활성화되도록 - 항상 활성 버전이 최대 1개가 되게 보장
export function setActiveVersion(versions, targetId) {
  return versions.map((v) => ({ ...v, is_active: v.id === targetId }))
}

// 화면에 보여줄 한 줄 요약 (얼굴/헤어/의상/표정/포즈/색상을 이어붙임)
export function buildJuneSummary(character) {
  if (!character) return ''
  const parts = [character.face, character.hair, character.outfit, character.expression, character.pose, character.color]
  return parts.filter(Boolean).join(' · ')
}
