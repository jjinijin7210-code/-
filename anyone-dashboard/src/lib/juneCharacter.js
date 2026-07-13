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

// 화면/요청서에 보여줄 한 줄 요약 (얼굴/헤어/의상/표정/포즈/색상을 이어붙임)
export function buildJuneSummary(character) {
  if (!character) return ''
  const parts = [character.face, character.hair, character.outfit, character.expression, character.pose, character.color]
  return parts.filter(Boolean).join(' · ')
}

/**
 * "June 공식 캐릭터 기준 포함" 체크 시 요청서에 자동으로 반영하는 핵심 로직.
 * - details.character가 있는 필드 구조(이미지 요청)라면 요약을 채워넣음 (기존 값이 있으면 덮어쓰지 않고 뒤에 이어붙임)
 * - details.forbidden_elements가 있다면 캐릭터의 금지 요소를 함께 반영 (중복 방지)
 * - 어떤 요청 종류든 june_reference에 그 시점의 공식 기준 스냅샷을 남겨서, 나중에 기준이
 *   바뀌어도 "그때 적용된 기준"을 추적할 수 있게 함
 *
 * @param {object} request - { details: {...} } 형태의 루나 요청 폼 객체
 * @param {object} activeCharacter - getActiveVersion()으로 찾은 활성 버전
 * @returns {object} 갱신된 request 객체 (원본은 변경하지 않음)
 */
export function applyJuneReferenceToRequest(request, activeCharacter) {
  if (!activeCharacter) {
    throw new Error('현재 활성화된 June 공식 캐릭터 버전이 없어요. 먼저 June 캐릭터 관리실에서 버전을 활성화해주세요.')
  }

  const summary = buildJuneSummary(activeCharacter)
  const details = { ...(request.details || {}) }

  if ('character' in details) {
    details.character = details.character ? `${details.character} / June: ${summary}` : summary
  }
  if ('forbidden_elements' in details && activeCharacter.forbidden_elements) {
    const already = details.forbidden_elements || ''
    details.forbidden_elements = already.includes(activeCharacter.forbidden_elements)
      ? already
      : [already, activeCharacter.forbidden_elements].filter(Boolean).join(' / ')
  }

  return {
    ...request,
    details,
    june_reference: {
      version: activeCharacter.version,
      summary,
      base_prompt: activeCharacter.base_prompt || '',
      forbidden_elements: activeCharacter.forbidden_elements || '',
      applied_at: new Date().toISOString(),
    },
  }
}
