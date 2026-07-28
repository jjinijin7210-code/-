// ============================================================
// 채널(플랫폼) x 언어 조합마다 따로따로 작은 프롬프트를 호출한다.
// Luna One 시제품은 최대 8개 플랫폼 x 5개 언어를 한 번의 거대한 JSON 응답으로 요청했는데,
// 애니원에서 이미 겪은 문제(응답이 커지면 잘리거나 파싱 실패)를 피하려고 쪼갰다.
// 호출 수는 늘지만 각 호출은 작고 실패해도 그 한 조각만 재시도하면 된다.
// ============================================================

import { callClaudeJson } from './anthropicClient.js'
import { tryParseJsonLoose } from './jsonRepair.js'

export const LANGUAGE_NAMES = {
  ko: '한국어',
  ja: '일본어',
  en: '영어',
  zh: '중국어(간체)',
  es: '스페인어',
}

// 진희님이 첫 공개 버전 범위로 정한 채널: 블로그·인스타·틱톡·스레드 + 카드뉴스.
// 유튜브는 실제 영상 제작(음성·렌더링)까지는 범위 밖이지만, 대본 텍스트만은 2026-07-25에 추가.
export const PLATFORM_NAMES = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  threads: 'Threads',
  cards: '카드뉴스',
  googleBlog: 'Google Blog',
  naverBlog: 'Naver Blog',
  youtubeShorts: 'YouTube Shorts 대본',
  youtubeLong: 'YouTube 롱폼 대본',
}

const PLATFORM_RULES = {
  instagram: '인스타그램 캐러셀/피드용. 첫 문장은 강한 후킹, 짧은 문단, 자연스러운 이모지, 마지막에 질문과 해시태그 5~8개.',
  tiktok: '틱톡 게시문과 30~45초 세로영상 대본. 첫 2초 후킹, 짧은 장면 지시, 내레이션, 마지막 행동 유도.',
  threads: '스레드용 대화체. 5~10줄, 과장하지 말고 의견을 묻는 문장으로 마무리. 모델명·규격·수치를 나열하는 스펙시트 느낌은 절대 쓰지 말고(예: "C425: 2K 실외용" 같은 목록형 금지), 실제로 써봤거나 옆에서 들은 것처럼 "이래서 편하더라" 하는 일상 언어로 1~2가지 장점만 골라서 쉽게 풀어써. 제품 종류가 여러 개여도 전부 나열하지 말고 대표로 한둘만 자연스럽게 언급해.',
  cards: '카드뉴스. 표지 포함 지정 장수. 각 장은 headline과 body로 구성하며 body는 최대 두 문장.',
  googleBlog: '구글 블로그용 SEO 글. 제목, 도입, 소제목 3~5개, 본문, 요약.',
  naverBlog: '네이버 블로그용 친근한 정보 글. 검색형 제목, 공감 도입, 소제목, 핵심 요약, 태그 8~12개.',
  youtubeShorts: '유튜브 쇼츠 30~60초 대본(텍스트만, 실제 영상/음성 제작은 아님). 첫 2초 후킹, 5~8개 짧은 장면(화면 지시+내레이션+자막), 마지막 CTA.',
  youtubeLong: '유튜브 롱폼 5~20분 대본(텍스트만). 오프닝 훅, 목차, 본론(소제목별로 구성), 마무리 CTA.',
}

// 틱톡 대본/블로그처럼 분량이 긴 플랫폼은 maxTokens가 낮으면 JSON이 중간에 잘려서
// 파싱 자체가 깨진다 (control-char 이스케이프 문제가 아니라 순수 길이 부족) - 2026-07-25 확인.
const MAX_TOKENS_BY_PLATFORM = {
  instagram: 1600,
  threads: 1000,
  tiktok: 2200,
  googleBlog: 2400,
  naverBlog: 2400,
  youtubeShorts: 2200,
  youtubeLong: 3400,
}

// 카드뉴스는 카드마다 AI 이미지를 새로 생성하지 않는다 (비용/속도 문제). 대신 사용자가 올린
// 실사진 2~3장을 카드마다 확대/블러/어둡게 등으로 재사용하고, 정보성 카드(이동 방법·공항 정보
// 같은)는 사진 대신 아이콘 배경을 쓴다 - 2026-07-25 사용자가 제안한 방식 (울릉도 카드뉴스 예시:
// 대표 사진 1장 + 아이콘 몇 개로 7장 구성).
export const CARD_ICONS = ['boat', 'plane', 'car', 'train', 'map', 'clock', 'calendar', 'ticket', 'money', 'star', 'question', 'camera', 'food', 'hotel']
export const CARD_TREATMENTS = ['normal', 'zoom', 'blur', 'dark', 'zoom-blur']

// anyone-dashboard의 검수 원칙과 동일하게: 원문 그대로 베끼지 않기, 없는 사실 지어내지 않기,
// 불확실한 정보(가격/운영시간/교통편 등)는 "확인 필요"로 표시하기.
// 글 구조는 기존에 합의된 공식(경험형 후킹 → 정보 → 의견 → CTA)을 기본값으로 고정 - 2026-07-25.
const CORE_PRINCIPLES = `당신은 원본 소재를 바탕으로 콘텐츠를 재구성하는 편집자입니다.
- 원문을 그대로 길게 베끼지 말고 핵심을 요약·재구성하세요.
- 원문에 없는 사실, 숫자, 인용을 지어내지 마세요.
- 가격/운영시간/교통편처럼 변할 수 있는 정보는 단정하지 말고 "확인 필요"로 표시하세요.
- 여러 사람의 후기·경험을 참고할 때는 그대로 복사하지 말고 공통된 패턴과 감정만 추출해 새롭게 쓰세요.
- 실제 사용자의 개인 경험인 것처럼 거짓 1인칭으로 단정하지 마세요.

글 구조는 이 순서를 기본으로 하세요 (플랫폼 특성에 맞게 분량만 조절):
1) 첫 문장(맨 앞)은 반드시 공감형·경험형 후킹으로 시작 - "~해봤는데", "~하다 보니" 같은 톤으로 읽는 사람이 자기 얘기처럼 느끼게.
2) 정보 - 원문의 핵심 내용을 정리.
3) 의견 - 그 정보에 대한 짧은 생각이나 느낀 점.
4) 마지막은 CTA(질문을 던지거나 다음 행동을 유도).
전체 말투는 20대가 편하게 읽을 수 있게 친근하고 자연스럽게 쓰세요 (딱딱한 존댓말이나 광고 문구처럼 쓰지 마세요).`

function buildOutputSchema(platform) {
  if (platform === 'cards') {
    return '{"title":"","cards":[{"page":1,"headline":"","body":"","visual":{"type":"photo 또는 icon","photoIndex":0,"treatment":"normal/zoom/blur/dark/zoom-blur 중 하나 (photo일 때만)","icon":"아이콘 이름 (icon일 때만)"}}]}'
  }
  return '{"title":"","content":""}'
}

function buildPhotoNote(photos) {
  if (!Array.isArray(photos) || !photos.length) {
    return `\n사용자가 올린 사진이 없습니다. 모든 카드의 visual.type을 "icon"으로 하고 아래 아이콘 중 어울리는 것을 고르세요: ${CARD_ICONS.join(', ')}.`
  }
  const list = photos.map((p, i) => `${i}: ${p.caption || '(설명 없음)'}`).join(' / ')
  return `\n사용자가 올린 사진 ${photos.length}장(인덱스와 설명): ${list}
카드마다 새 사진을 요구하지 말고 이 사진들을 최대한 재사용하세요 - 같은 사진이라도 treatment를 normal(원본)/zoom(확대)/blur(흐림)/dark(어둡게)/zoom-blur(확대+흐림)로 바꿔서 표지·본문·마무리 카드에 반복해서 써도 됩니다.
사진 설명과 실제로 어울리는 카드에만 photo를 쓰고, 이동 방법·공항 정보·요금처럼 사진보다 정보 전달이 중요한 카드는 icon을 쓰세요 (아이콘 목록: ${CARD_ICONS.join(', ')}).`
}

function buildSmartEnhanceNote(smartEnhance) {
  if (!smartEnhance || (!smartEnhance.travel && !smartEnhance.time && !smartEnhance.caution)) return ''
  const items = []
  if (smartEnhance.travel) items.push('차편·이동 경로')
  if (smartEnhance.time) items.push('소요 시간·예약·주차')
  if (smartEnhance.caution) items.push('주의사항·여행 팁')
  if (!items.length) return ''
  return `\n여행 관련 소재라면 다음 실용 정보를 별도 섹션으로 보강하세요 (확인이 필요한 값은 "확인 필요"로 표시): ${items.join(', ')}.`
}

function buildExperienceNote(experienceMode, experienceText) {
  if (experienceMode === 'source' && !experienceText) return ''
  if (experienceText) {
    return `\n참고 후기/경험 메모(그대로 복사 금지, 공통 패턴만 반영): ${experienceText}`
  }
  if (experienceMode === 'experience' || experienceMode === 'balanced') {
    return '\n여러 사람의 후기에서 반복되는 감정과 만족/불편 포인트가 있다면 공통 패턴으로 자연스럽게 녹여내세요.'
  }
  return ''
}

export async function generatePiece({
  source,
  platform,
  language,
  cardCount = 7,
  tone = '친근하고 신뢰감 있게',
  experienceMode = 'balanced',
  experienceText = '',
  smartEnhance = {},
  photos = [],
}) {
  const langName = LANGUAGE_NAMES[language] || language
  const rule = PLATFORM_RULES[platform]
  if (!rule) throw new Error(`알 수 없는 플랫폼: ${platform}`)

  const system = `${CORE_PRINCIPLES}

대상 언어: ${langName} (반드시 이 언어로 작성. 단순 직역이 아니라 그 언어권 독자가 자연스럽게 읽도록 현지화)
대상 플랫폼: ${PLATFORM_NAMES[platform]}
플랫폼 규칙: ${rule}
말투: ${tone}
${platform === 'cards' ? `카드뉴스 장수: ${cardCount}` : ''}
${platform === 'cards' ? buildPhotoNote(photos) : ''}
${buildSmartEnhanceNote(smartEnhance)}${buildExperienceNote(experienceMode, experienceText)}

반드시 아래 JSON 형식만 출력하세요. 다른 설명은 붙이지 마세요.
${buildOutputSchema(platform)}`

  const userText = `[원본 제목]\n${source.title || '제목 없음'}\n\n[출처]\n${source.sourceUrl || '사용자 입력'}\n\n[원문]\n${source.text.slice(0, 12000)}`

  const photoCount = Array.isArray(photos) ? photos.length : 0

  return callClaudeJson({
    system,
    messages: [{ role: 'user', content: userText }],
    maxTokens: platform === 'cards' ? Math.min(4000, 300 + Number(cardCount) * 220) : (MAX_TOKENS_BY_PLATFORM[platform] || 1200),
    maxRetries: 2,
    parse: (text) => {
      const parsed = tryParseJsonLoose(text)
      if (!parsed) throw new Error('JSON 파싱 실패')
      if (platform === 'cards') {
        if (!Array.isArray(parsed.cards)) throw new Error('cards 배열이 없음')
        parsed.cards = parsed.cards.map((card) => normalizeCardVisual(card, photoCount))
      }
      if (platform !== 'cards' && typeof parsed.content !== 'string') throw new Error('content가 없음')
      return parsed
    },
  })
}

// Claude가 정해진 아이콘/트리트먼트 이름을 벗어나거나 사진이 없는데 photo를 고르는 경우를
// 방지 - 벗어나면 안전한 기본값(icon:question 또는 유효한 photoIndex 범위로 클램프)으로 보정.
function normalizeCardVisual(card, photoCount) {
  const v = card.visual || {}
  let type = v.type === 'photo' && photoCount > 0 ? 'photo' : 'icon'
  const result = { type }
  if (type === 'photo') {
    const idx = Number(v.photoIndex)
    result.photoIndex = Number.isInteger(idx) && idx >= 0 && idx < photoCount ? idx : 0
    result.treatment = CARD_TREATMENTS.includes(v.treatment) ? v.treatment : 'normal'
  } else {
    result.icon = CARD_ICONS.includes(v.icon) ? v.icon : 'star'
  }
  return { ...card, visual: result }
}
