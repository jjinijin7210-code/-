// ============================================================
// AI 초안 생성 - 프롬프트 조립 (계획서 3장 "작성자 글쓰기 원칙" + "번역/현지화 원칙" 반영)
//
// 실제 Claude API 호출(네트워크)은 이 파일에서 하지 않습니다. 여기서는 API에 보낼
// 프롬프트 문자열을 조립하는 순수 함수만 다뤄서, 네트워크 없이도 Node.js에서 검증할 수 있게 했습니다.
// (테스트: scripts/test-prompt-builder.mjs)
// ============================================================

import { tryParseJsonLoose } from './jsonRepair.js'

const COMMON_TONE_RULES = `타겟 독자는 20대 초반이야. AI가 쓴 티 나는 딱딱한 문체는 절대 금지야.
- 친근한 구어체 위주로 쓰고, 어려운 전문용어는 쉬운 말로 풀어써
- 문장은 짧고 리듬감 있게, 한 문단에 한 가지 얘기만
- "~것으로 보입니다", "~라 할 수 있습니다" 같은 AI 특유의 딱딱한 어미 반복 금지
- 자기 경험담처럼 느껴지는 디테일(예시, 비유, 감탄사)을 적절히 섞어
- 과도한 이모지·해시태그 남발 금지`

const CHANNEL_TONE = {
  스레드: '스레드용 톤: 블로그보다 훨씬 캐주얼하게, 짧고 리듬감 있게 써줘.',
}
// 인스타/틱톡은 번역/현지화 담당(한국어·영어·일본어)이 언어별로 분리되어 있어서 접두 매칭으로 처리
const INSTA_TIKTOK_TONE = '인스타/틱톡용 톤: 캐주얼하고 임팩트 있게, 짧은 문장 위주로 써줘.'

const LOCALIZATION_RULES = `[반드시 지킬 것 - 해외 트렌드 소재 재구성 원칙]
- 참고로 준 해외 트렌드 설명(원문)을 그대로 번역하지 마 — 2차적저작물 저작권 문제가 생길 수 있어
- "왜 인기 있는지, 어떤 포인트가 공감받았는지"만 참고해서 완전히 새로운 문장으로 다시 써줘
- 그 나라 언어권 20대 초반이 이해하기 쉽게, 배경지식이 필요한 부분은 설명을 더해줘`

// 채널 이름에서 대상 언어를 뽑아낸다 ('인스타/틱톡(일본어)' -> '일본어', 그 외는 '한국어')
function getTargetLanguage(channel) {
  if (channel.includes('영어')) return '영어'
  if (channel.includes('일본어')) return '일본어'
  return '한국어'
}

/**
 * 초안 생성 요청의 system prompt를 만듭니다.
 * @param {string} channel - '스레드' | '인스타/틱톡' 등
 */
export function buildDraftSystemPrompt(channel) {
  const parts = [
    '너는 애니원(AnyOne)의 콘텐츠 작성자야. 실제 사람이 쓴 것처럼 자연스러운 SNS 게시물 초안을 써줘.',
    COMMON_TONE_RULES,
  ]
  if (CHANNEL_TONE[channel]) parts.push(CHANNEL_TONE[channel])
  if (channel.startsWith('인스타/틱톡')) {
    parts.push(INSTA_TIKTOK_TONE)
    parts.push(LOCALIZATION_RULES)
    const lang = getTargetLanguage(channel)
    parts.push(`[언어] title/body/hashtags 전부 반드시 ${lang}로만 작성해. 다른 언어를 섞지 마.`)
  }
  parts.push(
    '반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만): {"title": "제목", "body": "본문", "hashtags": "해시태그 공백으로 구분"}'
  )
  return parts.join('\n\n')
}

/**
 * 초안 생성 요청의 user prompt를 만듭니다.
 * @param {object} params
 * @param {string} params.channel
 * @param {string} params.topic - 다루고 싶은 주제/키워드
 * @param {string} [params.referenceNote] - (인스타/틱톡 전용) 참고한 해외 트렌드에 대한 설명 - 원문 캡션이 아니라 "왜 인기 있는지" 설명이어야 함
 */
export function buildDraftUserPrompt({ channel, topic, referenceNote }) {
  const lines = [`채널: ${channel}`, `주제: ${topic}`]
  if (referenceNote && referenceNote.trim()) {
    lines.push(`참고한 해외 트렌드 포인트(그대로 번역 금지, 아이디어만 반영): ${referenceNote.trim()}`)
  }
  lines.push('위 내용으로 게시물 초안을 하나 작성해줘.')
  return lines.join('\n')
}

export function buildDraftMessages({ channel, topic, referenceNote }) {
  return {
    system: buildDraftSystemPrompt(channel),
    messages: [{ role: 'user', content: buildDraftUserPrompt({ channel, topic, referenceNote }) }],
  }
}

/**
 * 반려된 초안을 검수 반려 사유에 맞춰 고쳐 쓰는 요청의 user prompt.
 * @param {object} params
 * @param {string} params.channel
 * @param {string} params.title - 반려된 기존 제목
 * @param {string} params.body - 반려된 기존 본문
 * @param {string[]} params.reasons - 검수에서 지적된 반려 사유 목록
 */
export function buildReviseUserPrompt({ channel, title, body, reasons }) {
  const reasonLines = (reasons && reasons.length > 0 ? reasons : ['사유 미기재']).map((r) => `- ${r}`).join('\n')
  return `채널: ${channel}
기존 제목: ${title}
기존 본문:
${body}

[검수에서 반려된 이유]
${reasonLines}

위 반려 이유를 전부 해결하도록 제목과 본문을 다시 작성해줘. 원래 주제·톤·구조는 최대한 유지하되, 지적된 문제만 확실히 고쳐줘.`
}

export function buildReviseMessages({ channel, title, body, reasons }) {
  return {
    system: buildDraftSystemPrompt(channel),
    messages: [{ role: 'user', content: buildReviseUserPrompt({ channel, title, body, reasons }) }],
  }
}

/**
 * Claude 응답 텍스트(JSON 또는 ```json 코드펜스로 감싼 JSON)를 파싱해서
 * { title, body, hashtags } 형태로 돌려줍니다. 형식이 이상하면 명확한 에러를 던집니다.
 */
export function parseDraftResponse(text) {
  if (!text || !text.trim()) {
    throw new Error('AI가 빈 응답을 돌려줬어요. 다시 시도해주세요.')
  }
  // ```json ... ``` 코드펜스가 붙어있으면 제거
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  // 앞뒤 설명 문구나 본문 안 이스케이프 안 된 줄바꿈 때문에 순수 JSON.parse가 깨지는 경우를 보정
  const parsed = tryParseJsonLoose(cleaned)
  if (!parsed) {
    throw new Error('AI 응답을 JSON으로 해석하지 못했어요. 원문을 확인하고 다시 시도해주세요.')
  }

  if (!parsed.title || !parsed.body) {
    throw new Error('AI 응답에 제목 또는 본문이 없어요.')
  }

  return {
    title: String(parsed.title),
    body: String(parsed.body),
    hashtags: parsed.hashtags ? String(parsed.hashtags) : '',
  }
}
