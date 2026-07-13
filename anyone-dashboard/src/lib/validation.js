// ============================================================
// 오류와 사용성 (계획서 10장)
// 필수 항목 검증, 중복 요청 감지를 위한 순수 함수 모음.
// (URL 검증은 8단계에서 만든 src/lib/contentPreview.js의 isValidUrl을 그대로 재사용합니다.)
// ============================================================

/**
 * 값 객체(values)에서 requiredFields에 정의된 필드들이 비어있는지 확인합니다.
 * @param {object} values - 폼 상태 객체
 * @param {{key: string, label: string}[]} requiredFields - 필수 필드 정의
 * @returns {string[]} 비어있는 필드의 라벨 목록 (다 채워져 있으면 빈 배열)
 */
export function findMissingRequired(values, requiredFields) {
  const missing = []
  for (const f of requiredFields) {
    const value = values?.[f.key]
    const isEmpty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
    if (isEmpty) missing.push(f.label)
  }
  return missing
}

/**
 * 목록(list) 안에 field 값이 대소문자/공백을 무시하고 이미 존재하는지 확인 (수정 중인 항목 제외)
 * @param {object[]} list - 기존 레코드 배열
 * @param {string} field - 비교할 필드명
 * @param {string} value - 새로 입력한 값
 * @param {string} [excludeId] - 지금 수정 중인 레코드의 id (자기 자신과는 비교하지 않음)
 * @returns {boolean}
 */
export function isDuplicate(list, field, value, excludeId) {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return false
  return (list || []).some(
    (item) => item.id !== excludeId && (item[field] || '').trim().toLowerCase() === normalized
  )
}
