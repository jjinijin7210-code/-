// ============================================================
// 콘텐츠 상세 편집 (계획서 8장)
//
// 해시태그 파싱, 수정 이력 추가, 플랫폼별 미리보기용 데이터 가공을 담당하는 순수 함수 모음.
// (테스트: scripts/test-content-preview.mjs)
// ============================================================

// 콘텐츠 관리 화면의 "채널" 선택지 (요청사항 반영: 네이버 블로그 카테고리별 분리 + 구글 블로그 신규 + 인스타/틱톡 통합)
// 인스타/틱톡은 번역/현지화 담당(한국어·영어·일본어, 계획서 2장 조직도) 3명이 각자 맡을 수 있게
// 언어별로 채널을 분리해뒀음 - 일본/영어 채널 확장(해외 벤치마킹 → 현지화) 대비.
export const PREVIEW_PLATFORMS = [
  '블로그(네이버)-인테리어/생활',
  '블로그(네이버)-푸드',
  '블로그(네이버)-여행',
  '블로그(구글 Blogger)',
  '스레드',
  '인스타/틱톡',
  '인스타/틱톡(영어)',
  '인스타/틱톡(일본어)',
  '유튜브(일본어)',
]

// 플랫폼별 미리보기 스타일 힌트 (본문 길이 제한, 비율 등 - 실제 각 서비스 사양의 대략적인 참고값)
export const PLATFORM_PREVIEW_SPECS = {
  '블로그(네이버)-인테리어/생활': { bodyMaxLen: 400, aspect: 'article', showHashtagsInline: false },
  '블로그(네이버)-푸드': { bodyMaxLen: 400, aspect: 'article', showHashtagsInline: false },
  '블로그(네이버)-여행': { bodyMaxLen: 400, aspect: 'article', showHashtagsInline: false },
  '블로그(구글 Blogger)': { bodyMaxLen: 400, aspect: 'article', showHashtagsInline: false },
  스레드: { bodyMaxLen: 120, aspect: 'square', showHashtagsInline: true },
  '인스타/틱톡': { bodyMaxLen: 100, aspect: 'vertical', showHashtagsInline: true },
  '인스타/틱톡(영어)': { bodyMaxLen: 100, aspect: 'vertical', showHashtagsInline: true },
  '인스타/틱톡(일본어)': { bodyMaxLen: 100, aspect: 'vertical', showHashtagsInline: true },
  '유튜브(일본어)': { bodyMaxLen: 150, aspect: 'vertical', showHashtagsInline: false },
}

// 채널별로 어떤 카테고리(기존 CS링크/벤치마킹 등에서 쓰는 인테리어·생활 / 푸드쇼핑 구분)에 해당하는지
export function getCategoryForChannel(channel) {
  if (channel === '블로그(네이버)-푸드') return '푸드쇼핑'
  if (channel === '블로그(네이버)-여행') return '여행지'
  if (channel === '유튜브(일본어)') return '심리학'
  return '인테리어/생활용품'
}

// "AI로 초안 생성" 버튼을 보여줄 채널인지 - 스레드·인스타/틱톡(전 언어)에 이어 여행 블로그도 추가
// (긴 글이라 promptBuilder.js의 블로그 전용 톤 규칙이 적용됨)
export function isAiDraftChannel(channel) {
  return channel === '스레드' || channel === '블로그(네이버)-여행' || channel.startsWith('인스타/틱톡')
}

// 해외 트렌드 소재 재구성 원칙(원문 그대로 번역 금지)이 적용되는 채널인지
export function isLocalizationChannel(channel) {
  return channel.startsWith('인스타/틱톡')
}

// 구글 Blogger로 실제 발행 가능한 채널인지
export function isBloggerChannel(channel) {
  return channel === '블로그(구글 Blogger)'
}

// 자유롭게 입력한 해시태그 문자열(쉼표/공백/줄바꿈 혼용)을 "#태그" 배열로 정리
// - 중복 제거, 앞에 #이 없으면 붙여줌, 빈 값 제거
export function parseHashtags(raw) {
  if (!raw) return []
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
  return [...new Set(tokens)]
}

// 긴 본문을 미리보기용으로 자름 (단어 중간이 아니라 최대한 자연스럽게 끝에 ... 붙임)
export function truncate(text, maxLen) {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '...'
}

// 간단한 URL 형식 검증 (http/https로 시작하는지만 확인 - 완벽한 RFC 검증은 아님)
export function isValidUrl(value) {
  if (!value) return true // 비어있는 건 "아직 안 채움"이라 에러로 취급하지 않음
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// 수정 이력에 새 항목 추가 (메모가 비어있으면 추가하지 않음 - 아무 의미없는 빈 기록 방지)
export function appendRevision(history, note, editor = '') {
  const trimmed = (note || '').trim()
  if (!trimmed) return history
  return [...(history || []), { note: trimmed, editor, edited_at: new Date().toISOString() }]
}

// 콘텐츠 초안 + 플랫폼을 받아서 미리보기 화면에 바로 쓸 수 있는 데이터 모델 생성
export function getPreviewModel(draft, platform) {
  const spec = PLATFORM_PREVIEW_SPECS[platform] || PLATFORM_PREVIEW_SPECS[PREVIEW_PLATFORMS[0]]
  const hashtags = parseHashtags(draft.hashtags)
  const firstImage = (draft.images || [])[0] || null

  return {
    platform,
    title: draft.title || '(제목 없음)',
    bodyPreview: truncate(draft.body || '', spec.bodyMaxLen),
    hashtags,
    showHashtagsInline: spec.showHashtagsInline,
    aspect: spec.aspect,
    firstImage,
  }
}
