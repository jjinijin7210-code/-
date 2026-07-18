// ============================================================
// AI 초안 생성 - 프롬프트 조립 (계획서 3장 "작성자 글쓰기 원칙" + "번역/현지화 원칙" 반영)
//
// 실제 Claude API 호출(네트워크)은 이 파일에서 하지 않습니다. 여기서는 API에 보낼
// 프롬프트 문자열을 조립하는 순수 함수만 다뤄서, 네트워크 없이도 Node.js에서 검증할 수 있게 했습니다.
// (테스트: scripts/test-prompt-builder.mjs)
// ============================================================

import { tryParseJsonLoose } from './jsonRepair.js'

const COMMON_TONE_RULES = `타겟 독자는 20대 초반이야. AI가 쓴 티 나는 딱딱한 문체는 절대 금지야.
- 첫 문장(후킹)이 가장 중요해 — 3초 안에 눈길을 잡아야 하니까, 궁금증을 자극하거나("이거 나만 몰랐던 거야?") 의외의 사실로 시작해("~인 줄 알았는데 사실 반대였음")
- 친근한 구어체 위주로 쓰고("~했는데", "~거든"), 어려운 전문용어는 쉬운 말로 풀어써
- 문장은 짧고 리듬감 있게 (한 문장 15자 내외를 기준으로 삼되, 자연스러움이 우선), 한 문단에 한 가지 얘기만
- "~것으로 보입니다", "~라 할 수 있습니다" 같은 AI 특유의 딱딱한 어미 반복 금지
- 자기 경험담처럼 느껴지는 디테일(예시, 비유, 감탄사)을 적절히 섞어
- 과도한 이모지·해시태그 남발 금지`

// 블로그는 SNS 캡션과 다르게 정보성 article 형태라 문장 길이 제약은 완화하고 정보 구조를 강조
const BLOG_TONE = `블로그용 톤: SNS 캡션이 아니라 정보성 글이야. 소제목(문단 구분)으로 구조를 나누고,
독자가 실제로 검색해서 들어올 만한 실용 정보(장소·팁·이유)를 구체적으로 담아줘. 문장은 SNS보다
길어도 되지만 여전히 쉽고 친근하게 - 딱딱한 정보 나열이 아니라 직접 다녀온 사람이 들려주는 느낌으로.`

const TRAVEL_BLOG_TONE = `[여행지 블로그 전용 지침] 소개하는 장소는 반드시 "덜 알려진 숨은 곳" 위주로 골라줘.
예를 들어 도쿄를 다룬다면 시부야·신주쿠 같은 이미 다 아는 도심 번화가 말고, 현지인만 아는 골목,
한적한 동네, 근교의 소도시처럼 "여기 가봤다"고 하면 놀랄 만한 장소를 소개해줘. 이미 너무 유명해서
어디서나 볼 수 있는 정보면 안 돼. 사진은 2장 정도 붙일 걸 염두에 두고, 대표 사진 2컷으로 이 장소의
매력이 잘 드러나도록 사진 설명(캡션에 들어갈 문구)도 자연스럽게 본문에 녹여줘.`

const CHANNEL_TONE = {
  스레드: '스레드용 톤: 블로그보다 훨씬 캐주얼하게, 짧고 리듬감 있게 써줘.',
  '블로그(네이버)-여행': `${BLOG_TONE}\n\n${TRAVEL_BLOG_TONE}`,
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
 * 이미 완성된 초안을 다른 언어 채널로 현지화(번역)하는 요청의 user prompt.
 * 직역이 아니라 그 언어권 20대 초반이 자연스럽게 느끼도록 다시 쓰는 것이 목표.
 * @param {object} params
 * @param {string} params.targetChannel - '인스타/틱톡(영어)' 등, 번역 대상 채널
 * @param {string} params.title
 * @param {string} params.body
 * @param {string} [params.hashtags]
 */
export function buildTranslateUserPrompt({ targetChannel, title, body, hashtags }) {
  const lang = getTargetLanguage(targetChannel)
  return `아래는 원본(한국어) 게시물이야. 이걸 ${lang}로 현지화해줘 - 단어 하나하나 직역하지 말고, 그 나라 20대 초반이 실제로 쓸 법한 자연스러운 표현으로 다시 써줘. 원본의 훅(첫 문장)과 전체 흐름, 감정선은 최대한 살려줘.

[원본 제목]
${title}

[원본 본문]
${body}

[원본 해시태그]
${hashtags || '(없음)'}

위 내용을 ${lang}로 현지화한 버전을 만들어줘. 해시태그도 그 언어권에서 실제로 쓰이는 것으로 바꿔줘.`
}

// 번역 전용 system prompt. buildDraftSystemPrompt()를 그대로 재사용하면 두 가지 문제가 있었음:
// (1) LOCALIZATION_RULES(해외 트렌드 "원문"을 그대로 번역하지 말라는 규칙)가 같이 붙는데, 그건
//     스크래핑한 남의 글 얘기고 여기는 우리 원본을 진짜로 번역하는 거라 정반대 지시라 섞이면 안 됨.
// (2) COMMON_TONE_RULES 안의 한국어 말투 예시("~했는데", "~거든")가 프롬프트 대부분을 차지해서,
//     뒤쪽의 "영어로만 써" 지시가 묻혀 실제로는 계속 한국어로 응답하는 문제가 실측 테스트에서 확인됨.
// 그래서 언어 지시를 맨 앞과 맨 뒤에 두 번 강조하고, 한국어 예시 문구는 아예 빼서 별도로 만듦.
function buildTranslateSystemPrompt(targetChannel) {
  const lang = getTargetLanguage(targetChannel)
  const parts = [
    `너는 애니원(AnyOne)의 번역/현지화 담당이야. [언어 지시 - 최우선] 지금부터 나오는 모든 응답(title/body/hashtags)은 반드시 ${lang}로만 작성해. 한국어를 단 한 글자도 섞지 마.`,
    '이미 완성된 원본 게시물을 다른 언어권 독자에게 자연스럽게 전달되도록 현지화 번역하는 게 목표야. 원본과 완전히 다른 새 글을 쓰지 말고, 원본의 내용·훅(첫 문장)·전체 흐름을 그대로 살려줘.',
    `타겟 독자는 그 언어권의 20대 초반이야. 딱딱한 번역투 말고, 그 나라 젊은 세대가 실제로 SNS에 쓸 법한 캐주얼하고 리듬감 있는 표현으로 써줘. 문장은 짧게, 과도한 이모지·해시태그는 피해.`,
    `[언어 지시 - 재확인] title/body/hashtags 전부 ${lang}로만. 예시로 든 문구나 설명이 한국어였다고 해서 응답까지 한국어로 쓰면 안 돼.`,
    '반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만): {"title": "제목", "body": "본문", "hashtags": "해시태그 공백으로 구분"}',
  ]
  return parts.join('\n\n')
}

export function buildTranslateMessages({ targetChannel, title, body, hashtags }) {
  return {
    system: buildTranslateSystemPrompt(targetChannel),
    messages: [{ role: 'user', content: buildTranslateUserPrompt({ targetChannel, title, body, hashtags }) }],
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
