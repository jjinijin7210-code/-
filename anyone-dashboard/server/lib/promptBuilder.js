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
매력이 잘 드러나도록 사진 설명(캡션에 들어갈 문구)도 자연스럽게 본문에 녹여줘.

[후킹 각도 - 장소 인지도에 따라 다르게] 다룰 장소(원본 자료나 주제에 나온 곳)가 정말 덜 알려진
숨은 곳이면, 기존처럼 "이런 곳이 있는지 몰랐다/발견했다" 각도로 후킹해도 좋아. 하지만 이미 어느
정도 이름이 알려진 곳(예: 북악산처럼 존재는 알려졌지만 다들 안 가본 곳)이라면, "몰랐던 곳 발견"
각도 대신 "알고는 있었는데 바빠서/시간 없어서 못 가봤었는데, 다시 보니/막상 가보니 훨씬 좋았다"
각도로 후킹해줘. 이게 훨씬 현실적이고 공감이 잘 됨 (2026-07-23 피드백).`

const CHANNEL_TONE = {
  // 2026-07-23: "스레드는 너무 길면 안 된다" 피드백 - 그냥 "짧게"만으로는 기준이 애매해서
  // 실제 글자 수 상한을 명확히 못박음 (스레드 실제 플랫폼 제한은 500자지만, 그거보다 훨씬
  // 짧게 써야 술술 읽힘)
  스레드: '스레드용 톤: 블로그보다 훨씬 캐주얼하게, 짧고 리듬감 있게 써줘. 본문은 공백 포함 200자를 넘기지 마 - 길게 늘어지면 안 됨, 핵심만 임팩트 있게.',
  '블로그(네이버)-여행': `${BLOG_TONE}\n\n${TRAVEL_BLOG_TONE}`,
  // 구글 블로그(한국 숨은 여행지 → 영어 번역용 한국어 소스)도 여행 블로그와 같은 톤 사용
  '블로그(구글 Blogger)': `${BLOG_TONE}\n\n${TRAVEL_BLOG_TONE}`,
}
// 인스타/틱톡은 번역/현지화 담당(한국어·영어·일본어)이 언어별로 분리되어 있어서 접두 매칭으로 처리
const INSTA_TIKTOK_TONE = '인스타/틱톡용 톤: 캐주얼하고 임팩트 있게, 짧은 문장 위주로 써줘.'

const LOCALIZATION_RULES = `[반드시 지킬 것 - 해외 트렌드 소재 재구성 원칙]
- 참고로 준 해외 트렌드 설명(원문)을 그대로 번역하지 마 — 2차적저작물 저작권 문제가 생길 수 있어
- "왜 인기 있는지, 어떤 포인트가 공감받았는지"만 참고해서 완전히 새로운 문장으로 다시 써줘
- 그 나라 언어권 20대 초반이 이해하기 쉽게, 배경지식이 필요한 부분은 설명을 더해줘`

// 일본 인스타/틱톡에서 실제로 잘 되는 콘텐츠를 조사해서(2026-07-18) 반영한 지침 -
// 번역투가 아니라 진짜 일본 크리에이터가 쓸 법한 캐주얼한 말투와 구조를 쓰도록 유도
const JAPANESE_NATURALNESS_RULES = `[일본어 자연스러움 지침 - 실제 인기 콘텐츠 패턴 반영]
- 딱딱한 표준어체(〜です/〜ます 남발) 대신, 일본 또래들이 SNS에 실제로 쓰는 캐주얼한 말투를 써
  (예: 〜だよね, 〜じゃない?, 〜かも, 문장 끝을 흐리는 표현 등)
- 첫 문장은 질문형 후킹이 잘 먹혀 ("〜って知ってる?", "〜だと思う?" 같은 구조)
- 상품·장소 추천류는 "TOP5", "〜選" 같은 랭킹/리스트 형식이 일본에서 특히 반응이 좋으니,
  주제가 맞으면 이런 구조를 적극 활용해
- 이모지는 문장 사이사이 자연스럽게 섞어 쓰되(✨🔥☔️ 등), 나열식으로 몰아넣지 마
- 가능하면 막연한 표현보다 구체적인 디테일(왜 좋은지, 어떤 상황에 쓰는지)을 짧게라도 넣어줘 -
  다만 실제로 확인 안 된 특정 브랜드명·매장명을 지어내진 마, 일반적인 표현으로 대체해`

// 채널 이름에서 대상 언어를 뽑아낸다 ('인스타/틱톡(일본어)' -> '일본어', 그 외는 '한국어')
function getTargetLanguage(channel) {
  if (channel.includes('영어')) return '영어'
  if (channel.includes('일본어')) return '일본어'
  return '한국어'
}

// 2026-07-23: "기사/링크 하나 넣으면 여러 채널로 한번에 변환" 기능(draft/from-source)에서 쓰는
// 글쓰기 공식. 진희님이 유튜브 강의 영상을 보고 정리한 원칙(정보 나열이 아니라 개인 경험담처럼
// 써야 안 딱딱하고, 필자의 의견이 들어가야 노출이 잘 됨) + 실제 대화에서 확인한 "증상/사건 →
// 왜지 생각 → 원인 발견" 훅 구조를 그대로 반영함.
const PERSONAL_HOOK_RULE = `[글쓰기 공식 - 반드시 이 구조로] 정보를 나열하듯 시작하지 말고, 아래 순서로 써:
1. 개인 경험 훅: "어제 ~하다가 ~했는데 왜 그런가 했더니" 같은 증상/사건 → 궁금증 → 원인 발견 흐름으로 시작해
2. 그 경험과 자연스럽게 연결지어서 핵심 정보 2~3개를 풀어줘 (나열이 아니라 "찾아보니 ~더라고" 식으로)
3. 필자의 주관적인 생각이나 다짐을 한 마디 넣어줘 (AI가 쓴 것 같은 객관적 정보 나열만 하면 안 됨)
4. 마지막은 CTA로 마무리해`

// 현재 월을 기준으로 계절감을 프롬프트에 살짝 얹어줌 (한국은 4계절이 뚜렷해서, 시의성 있는
// 소재로 자연스럽게 녹이면 반응이 더 좋다는 진희님 피드백, 2026-07-23)
function getCurrentSeasonKorean(date = new Date()) {
  const month = date.getMonth() + 1
  if (month >= 3 && month <= 5) return '봄'
  if (month >= 6 && month <= 8) return '여름'
  if (month >= 9 && month <= 11) return '가을'
  return '겨울'
}

// 외부 기사/자료를 참고 소재로 줄 때 지킬 것 - 원문 그대로 베끼면 저작권 문제가 생길 수 있어서,
// 의미(사실관계)는 유지하되 표현은 완전히 새로 쓰도록 명시함.
const SOURCE_ARTICLE_RULES = `[원본 자료 참고 원칙]
- 아래 원본 자료의 사실 관계·핵심 정보는 그대로 살리되, 문장 표현은 원문을 절대 그대로 베끼지 말고 완전히 새로운 표현으로 다시 써
- 원본에 없는 사실을 지어내지 마
- 원본이 불확실하거나 "~라는 설이 있다"는 식의 속설이면, 확정된 사실처럼 단정하지 말고 그 뉘앙스(속설임)를 그대로 살려서 정직하게 써줘`

// 2026-07-19: 동물/재밌는영상 카테고리는 실제로 화제가 된 동물 사진을 Pexels(무료 스톡사진)에서
// 찾아 붙이기로 함(사용자 결정: "그 동물의 다른 사진을 찾아서 올리면 되니까") - AI가 참고자료
// 속 실제 동물/장면을 영어 키워드로 뽑아내야 검색이 가능해서, 그 키워드를 초안 JSON에 같이 담게 함.
const PHOTO_QUERY_RULE = `[사진 검색어] 위 참고자료에서 실제로 다뤄진 동물/장면이 뭔지 파악해서, 무료
스톡사진 사이트에서 검색할 영어 키워드 2~3단어를 "photoQuery" 필드에 추가로 담아줘
(예: "red panda snow", "golden retriever puppy", "capybara hot spring"). 특정 브랜드·장소 이름
없이 동물 종류·행동 중심으로. 참고자료에 특정 동물이 안 나와 있으면 카테고리 분위기에 맞는
일반적인 키워드로 대신 채워.`

/**
 * 초안 생성 요청의 system prompt를 만듭니다.
 * @param {string} channel - '스레드' | '인스타/틱톡' 등
 * @param {object} [opts]
 * @param {boolean} [opts.needsPhotoQuery] - true면 JSON 응답에 photoQuery 필드도 요구함
 * @param {boolean} [opts.usesSourceArticle] - true면 원본 자료 기반 재구성 원칙 + 개인 경험 훅 공식을 추가함
 */
export function buildDraftSystemPrompt(channel, { needsPhotoQuery = false, usesSourceArticle = false } = {}) {
  const parts = [
    '너는 애니원(AnyOne)의 콘텐츠 작성자야. 실제 사람이 쓴 것처럼 자연스러운 SNS 게시물 초안을 써줘.',
    COMMON_TONE_RULES,
  ]
  if (CHANNEL_TONE[channel]) {
    parts.push(CHANNEL_TONE[channel])
  } else if (channel.startsWith('블로그')) {
    // CHANNEL_TONE에 개별 등록 안 된 블로그 하위 카테고리(예: 블로그(네이버)-푸드)도 기본 블로그 톤은 적용
    parts.push(BLOG_TONE)
  }
  if (channel.startsWith('인스타/틱톡')) {
    parts.push(INSTA_TIKTOK_TONE)
    parts.push(LOCALIZATION_RULES)
  }
  // 언어 지시는 채널명에 "영어"/"일본어"가 들어간 모든 채널에 공통 적용 (인스타/틱톡뿐 아니라
  // 유튜브(일본어) 같은 채널도 해당 - 2026-07-23, from-source 기능으로 대상 채널이 넓어지며 발견)
  const lang = getTargetLanguage(channel)
  if (lang !== '한국어') {
    parts.push(`[언어] title/body/hashtags 전부 반드시 ${lang}로만 작성해. 다른 언어를 섞지 마.`)
    if (lang === '일본어') parts.push(JAPANESE_NATURALNESS_RULES)
  }
  if (usesSourceArticle) {
    parts.push(SOURCE_ARTICLE_RULES)
    parts.push(PERSONAL_HOOK_RULE)
  }
  if (needsPhotoQuery) parts.push(PHOTO_QUERY_RULE)
  parts.push(
    `반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만): {"title": "제목", "body": "본문", "hashtags": "해시태그 공백으로 구분"${needsPhotoQuery ? ', "photoQuery": "영어 검색 키워드"' : ''}}`
  )
  return parts.join('\n\n')
}

/**
 * 초안 생성 요청의 user prompt를 만듭니다.
 * @param {object} params
 * @param {string} params.channel
 * @param {string} [params.topic] - 다루고 싶은 주제/키워드 (sourceArticle이 있으면 생략 가능)
 * @param {string} [params.referenceNote] - (인스타/틱톡 전용) 참고한 해외 트렌드에 대한 설명 - 원문 캡션이 아니라 "왜 인기 있는지" 설명이어야 함
 * @param {string} [params.sourceArticle] - 기사/링크 등 원본 소재 전문 (있으면 이걸 바탕으로 재구성)
 * @param {boolean} [params.includeSeasonWeather] - true면 오늘 계절+날씨 컨텍스트를 함께 전달
 * @param {string} [params.weatherNote] - "맑음 28도"처럼 미리 조회해둔 오늘 날씨 한 줄 (없으면 계절만 전달)
 */
export function buildDraftUserPrompt({ channel, topic, referenceNote, sourceArticle, includeSeasonWeather, weatherNote }) {
  const lines = [`채널: ${channel}`]
  if (topic && topic.trim()) lines.push(`주제: ${topic.trim()}`)
  if (includeSeasonWeather) {
    const season = getCurrentSeasonKorean()
    lines.push(`오늘 계절/날씨: ${season}${weatherNote ? ` · ${weatherNote}` : ''} (자연스럽게 어울릴 때만 살짝 녹여줘, 억지로 끼워 넣지 마)`)
  }
  if (referenceNote && referenceNote.trim()) {
    lines.push(`참고한 해외 트렌드 포인트(그대로 번역 금지, 아이디어만 반영): ${referenceNote.trim()}`)
  }
  if (sourceArticle && sourceArticle.trim()) {
    lines.push(`[원본 자료]\n${sourceArticle.trim()}`)
  }
  lines.push('위 내용으로 게시물 초안을 하나 작성해줘.')
  return lines.join('\n')
}

export function buildDraftMessages({ channel, topic, referenceNote, needsPhotoQuery, sourceArticle, includeSeasonWeather, weatherNote }) {
  const usesSourceArticle = Boolean(sourceArticle && sourceArticle.trim())
  return {
    system: buildDraftSystemPrompt(channel, { needsPhotoQuery, usesSourceArticle }),
    messages: [
      {
        role: 'user',
        content: buildDraftUserPrompt({ channel, topic, referenceNote, sourceArticle, includeSeasonWeather, weatherNote }),
      },
    ],
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
  ]
  if (lang === '일본어') parts.push(JAPANESE_NATURALNESS_RULES)
  parts.push('반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만): {"title": "제목", "body": "본문", "hashtags": "해시태그 공백으로 구분"}')
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
 * { title, body, hashtags, photoQuery } 형태로 돌려줍니다. photoQuery는 needsPhotoQuery로 요청한
 * 경우에만 채워지고, 그 외엔 빈 문자열입니다. 형식이 이상하면 명확한 에러를 던집니다.
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
    photoQuery: parsed.photoQuery ? String(parsed.photoQuery) : '',
  }
}
