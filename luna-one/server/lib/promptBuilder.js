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
  threads: '스레드용 대화체. 짧고 간단한 문장 위주로, 20대가 부담 없이 훑어볼 수 있게 써. 줄바꿈 기준 5~10줄 사이로만 쓰고(한 문단으로 길게 이어 쓰지 마, 짧은 줄 단위로 끊어서), 본문은 공백 포함 200자를 넘기지 마 - 실제 스레드 앱이 너무 긴 글은 등록 자체가 막힐 수 있음. 과장하지 말고 의견을 묻는 문장으로 마무리. 모델명·규격·수치를 나열하는 스펙시트 느낌은 절대 쓰지 말고(예: "C425: 2K 실외용" 같은 목록형 금지), 실제로 써봤거나 옆에서 들은 것처럼 "이래서 편하더라" 하는 일상 언어로 1~2가지 장점만 골라서 쉽게 풀어써. 제품 종류가 여러 개여도 전부 나열하지 말고 대표로 한둘만 자연스럽게 언급해.',
  cards: '카드뉴스. 표지 포함 지정 장수. 각 장은 headline(카드 이미지 위에 크게 얹을 짧은 문구)과 body(이미지 위에 함께 얹을 부제, 최대 두 문장)로 구성. 추가로 blogText(네이버 블로그 등에 카드 이미지 사이사이 붙여넣을 설명 문단)도 각 카드마다 따로 써 - headline/body보다 조금 더 자세하게 그 카드 내용을 풀어쓰되, 짧고 간단한 문장 2~3개(공백 포함 150자 이내)로만 써. 장황하게 늘어놓지 말고 핵심만.',
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

// ============================================================
// 2026-08-23 설계 문서 8장: 시스템 프롬프트 계층 구조.
//   1층(항상 적용)   - COMMON_STYLE_PRINCIPLES (공통 문체 원칙)
//   2층(채널별 자동)  - CHANNEL_KNOWHOW (선택된 콘텐츠 종류에 따라 삽입)
//   3층(장르 조건부)  - 역사 이야기 안전장치 (storyBuilder.js에서만 씀 - 이 파일의
//                      일반 플랫폼 생성에는 해당 없음)
//   4층(사용자 입력)  - 소재/배경, 톤, 분량
// 3층(사실관계 안전장치)은 1층(문체)보다 우선한다 - 문체는 자연스럽게 하되 사실은 못 바꾼다.
// ============================================================

// 8-1. 공통 문체 원칙 - 장르/톤 선택과 무관하게 모든 글쓰기 결과물에 항상 깔리는 레이어.
// 애니원 "작성자" 직원들에게 적용 중인 글쓰기 원칙을 루나원에도 공통으로 심음.
export const COMMON_STYLE_PRINCIPLES = `[글쓰기 공통 원칙 — 항상 적용]
1. AI가 쓴 티 나는 딱딱한 문체 금지. 실제 사람이 쓴 것 같은 자연스러운 글을 목표로 한다.
2. 친근한 구어체 위주로 쓰고, 어려운 전문용어는 쉬운 말로 풀어 쓴다.
3. 문장은 짧고 리듬감 있게 쓴다. 한 문단에는 한 가지 얘기만 담는다.
4. "~것으로 보입니다", "~라고 할 수 있습니다" 같은 AI 특유의 반복되는 어미를 지양한다.
5. 자기 경험담처럼 느껴지는 구체적 디테일을 적절히 섞는다.
6. 플랫폼별로 톤을 다르게 조절한다 (블로그는 차분하게, 스레드는 캐주얼하게, 쇼츠는 임팩트 있게).
(단, 사실관계 관련 별도 지침이 있는 경우 그 지침이 이 문체 원칙보다 우선한다 -
문체는 자연스럽게 하되 사실은 바꾸지 않는다.)`

// 8-2. 채널별 노하우 - 선택된 콘텐츠 종류에 따라 자동으로 얹는 프롬프트 스니펫 딕셔너리.
// 나중에 채널이 늘어나면(예: 인스타 카드뉴스 노하우) 여기에 항목만 추가하면 됨.
export const CHANNEL_KNOWHOW = {
  threads: `[스레드 노하우]
- 첫 줄이 전부다 - "더보기" 없이도 계속 읽고 싶게 만드는 구체적인 훅으로 시작.
- 결론을 다 말하지 말고, 질문형이나 여지를 남기는 문장으로 끝내기 (댓글 유도).
- 3~5문장, 짧고 편한 반말/구어체.
- 외부 링크·광고 느낌 문구는 본문에 넣지 않기.`,
  naverBlog: `[네이버 블로그 노하우]
- 제목 맨 앞 핵심 키워드 1회만 (반복 금지).
- 첫 문단에 결론부터 (두괄식).
- 본문 1,500~3,000자, 문단은 모바일 기준 2~3줄로 끊기.
- 소제목은 질문형 + 리스트 구조.
- 실제 경험한 것처럼 구체적으로, 광고 티 나는 과장 표현 금지.`,
  youtubeShorts: `[유튜브 쇼츠 대본 노하우]
- 도입 3초: 질문형 훅 또는 충격적 사실/반전으로 시작 (뻔한 표현 금지).
- 3초 단위로 장면 전환되게 구성 (같은 화면 5초 이상 유지 금지).
- 엔딩 2~5초: 강렬한 마무리 + 부드러운 구독 유도 (강요하지 않는 톤).`,
  youtubeLong: `[유튜브 롱폼 대본 노하우]
- 0~15초: 결과물/핵심 궁금증을 먼저 보여주는 역순 구성 훅.
- 챕터 3~5개로 구조화, 챕터 전환마다 재훅(re-hook) 1줄.
- 한 영상에 메시지는 하나로 집중.`,
}

function buildChannelKnowhowNote(platform) {
  const knowhow = CHANNEL_KNOWHOW[platform]
  return knowhow ? `\n${knowhow}` : ''
}

// anyone-dashboard의 검수 원칙과 동일하게: 원문 그대로 베끼지 않기, 없는 사실 지어내지 않기,
// 불확실한 정보(가격/운영시간/교통편 등)는 "확인 필요"로 표시하기.
// 글 구조는 기존에 합의된 공식(경험형 후킹 → 정보 → 의견 → CTA)을 기본값으로 고정 - 2026-07-25.
const CORE_PRINCIPLES = `당신은 원본 소재를 바탕으로 콘텐츠를 재구성하는 편집자입니다.
- 원문을 그대로 길게 베끼지 말고 핵심을 요약·재구성하세요.
- 원문에 없는 사실, 숫자, 인용을 지어내지 마세요.
- [특히 중요] 원문에 이미 나온 고유명사·구체적 사실(지역명, 상호명, 음식/제품의 정확한 종류,
  가격, 시간 등)은 절대 다른 것으로 바꾸지 마세요 - 예를 들어 원문이 "제주 흑돼지"면 "근교
  삼겹살"처럼 다른 지역·다른 음식으로 슬쩍 바꿔 쓰면 안 됩니다. 표현을 자연스럽게 재구성하는
  것과 사실 자체를 바꾸는 것은 다릅니다. (자연스러움을 위해 원문에 없는 사소한 디테일 - 동행인,
  날씨, 감상 표현 등 - 을 자연스럽게 곁들이는 건 괜찮지만, 이미 명시된 사실을 다른 사실로
  대체하면 안 됩니다.)
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
    return '{"title":"","cards":[{"page":1,"headline":"","body":"","blogText":"블로그 본문용 설명 2~3문장, 150자 이내","visual":{"type":"photo 또는 icon","photoIndex":0,"treatment":"normal/zoom/blur/dark/zoom-blur 중 하나 (photo일 때만)","icon":"아이콘 이름 (icon일 때만)"}}]}'
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

// 소스 제목에서 뽑은 후보 키워드를 네이버 데이터랩으로 비교해서 더 검색되는 쪽을 알려주는 한 줄
// (server.js에서 compareSearchTrend 호출 결과로 만들어서 넘겨줌, 없으면 생략 - best-effort)
function buildTrendNote(trendNote) {
  if (!trendNote || !trendNote.trim()) return ''
  return `\n요즘 검색이 더 많이 되는 표현(참고만, 억지로 끼워 맞추지 말고 자연스러울 때만 반영): ${trendNote.trim()}`
}

// 2026-07-31: "돈벌쥐" 채널 AI 블로그 글쓰기 인터뷰 2건 벤치마킹(진희님 요청) - 게스트들이 공통으로
// 강조한 방법론을 블로그 계열(naverBlog/googleBlog)에만 반영함.
// (1) 정보만 나열한 글은 네이버가 덜 밀어주고, 도입부뿐 아니라 문단마다 필자의 경험/의견이
//     섞여야 노출이 잘 된다는 주장.
// (2) 제목은 감으로 짓지 말고 핵심 키워드+연관 검색어 조합으로, 그리고 이득형/위협형/궁금형/
//     비교형/반전형/실행형 6가지 후킹 유형 중 소재에 맞는 걸 의식적으로 골라서 짓는다는 방법론.
// (3) 원본 자료에 실제 질문(네이버 지식인 등)이 섞여 있으면, 막연한 주제 대신 그 구체적 질문을
//     소제목으로 삼는 게 검색 노출에 유리하다는 주장.
const BLOG_SECTION_HOOK_RULE = `[소제목마다 경험/의견 섞기] 도입부에서만 개인 경험을 쓰고 나머지는
정보 나열로 끝내지 마세요. 소제목으로 나뉘는 각 문단마다 최소 한 문장은 "직접 겪어보니/찾아보니"
같은 경험담이나 "~것 같다/~라고 생각한다" 같은 주관적 의견을 섞으세요. 순수 정보만 쭉 나열된
문단이 있으면 안 됩니다 - 이게 딱딱한 정보성 글과 검색 노출이 잘 되는 글의 차이입니다.`

const BLOG_TITLE_RULE = `[제목 작성법]
1. 먼저 이 글의 핵심 키워드(사람들이 실제로 검색할 단어)를 정하고, 거기에 자연스럽게 붙는 연관
   검색어 2~3개를 더해서 제목에 최대한 녹이세요 (예: "ESTP 특징 장점 단점 팩폭 여자 남자"처럼
   키워드를 나열하듯 이어붙이는 스타일도 검색 노출엔 실제로 효과적입니다). 감으로 멋있게 짓지 말고
   "이 제목으로 검색했을 때 뜨고 싶다"는 키워드 조합을 먼저 생각하세요.
2. 아래 6가지 후킹 유형 중 이 글 소재에 가장 자연스럽게 맞는 유형 하나를 의식적으로 골라서
   제목을 지으세요: 이득형(얻는 게 명확: "~하면 좋은 이유"), 위협형(안 하면 손해: "~안 하면
   이렇게 됩니다"), 궁금형(궁금증 유발: "~인 진짜 이유"), 비교형(둘을 비교: "A vs B, 뭐가
   나을까"), 반전형(통념 뒤집기: "~인 줄 알았는데 사실은"), 실행형(행동 유도: "지금 바로 ~하는
   법"). 억지로 안 맞는 유형에 끼워 맞추지 말고, 소재에 가장 클릭하고 싶어지는 유형으로.`

const BLOG_QUESTION_SEED_RULE = `[실제 질문을 소제목으로] 원문 안에 물음표로 끝나는 문장이나 "~는지",
"~일까요" 같은 질문형 문장(네이버 지식인 등에서 실제로 사람들이 물어본 질문)이 있으면, 그 큰
주제를 막연하게 다루지 말고 그 구체적인 질문 자체를 소제목으로 삼아서 직접 답하세요 - 막연한
주제보다 실제 사람들이 물어본 세부 질문에 답하는 글이 검색 노출과 클릭에 훨씬 유리합니다.`

// 2026-07-31: "네이버가 몰래 바꾼 블로그 규칙" 영상 벤치마킹(진희님 요청) - 네이버 검색 결과
// 위에 "AI 브리핑"(AI 요약)이 뜨는 게 늘면서, 이제 검색 순위보다 "AI가 얼마나 잘 추출해가는가"가
// 더 중요해졌다는 주장(272건 데이터 분석 + 네이버 공식 가이드 인용). anyone-dashboard의
// promptBuilder.js와 동일한 5가지 규칙을 그대로 가져옴.
const BLOG_OPENING_RULE = `[도입부 - AI 요약에서 안 잘리려면] "안녕하세요"나 날씨·안부 얘기로 시작하지
마세요. 첫 2~3문장 안에 바로 이 글의 핵심 주제와 숫자·근거를 밝히세요(예: "2년차가 알려주는
월매출 1천만원 만든 방법 세 가지"). 인사말이나 잡담으로 시작하면 AI 요약이 3줄 안에 이 글을
건너뛰어서 노출 기회 자체를 잃습니다.`

const BLOG_STRUCTURE_DENSITY_RULE = `[소제목 밀도] 본문이 1500자를 넘으면 소제목을 최소 3~4개는
넣어서 구조를 명확히 나눠주세요 - 소제목 하나 없이 쭉 이어지는 긴 글은 안 됩니다.`

const BLOG_NUMBER_RULE = `[막연한 표현 금지] "맛있었어요", "좋았어요" 같은 막연한 형용사만 쓰지 말고,
가능한 모든 문장에 실제 숫자(가격·시간·수량·퍼센트 등)를 붙이세요(예: "맛있었어요" 대신 "2인
기준 32,000원, 웨이팅 평일 10분/주말 40분"). 숫자가 구체적일수록 AI와 독자 모두에게 신뢰를 줍니다.`

const BLOG_PHOTO_TEXT_RULE = `[사진-텍스트 비율] AI는 사진을 못 읽습니다. 사진을 여러 장 언급하거나
전제로 하는 글이면, 사진 개수만큼 그에 대응하는 설명 문장도 충분히 써서 사진 없이 텍스트만
읽어도 내용이 다 이해되게 만드세요 - 사진에 설명을 떠넘기지 마세요.`

const BLOG_AI_TONE_BAN_RULE = `[AI 티 나는 문구 금지] "다양한 측면에서 살펴보겠습니다", "~라고 할 수
있습니다", "종합적으로 고려했을 때" 같은 전형적인 AI 리스트형 문구는 네이버가 감지해서 감점하니
절대 쓰지 마세요. 그 대신 실제 사람이 쓴 것처럼 구체적이고 개성 있는 표현을 쓰세요.`

function buildBlogMethodNote(platform) {
  if (platform !== 'naverBlog' && platform !== 'googleBlog') return ''
  return `\n${BLOG_SECTION_HOOK_RULE}\n\n${BLOG_TITLE_RULE}\n\n${BLOG_QUESTION_SEED_RULE}\n\n${BLOG_OPENING_RULE}\n\n${BLOG_STRUCTURE_DENSITY_RULE}\n\n${BLOG_NUMBER_RULE}\n\n${BLOG_PHOTO_TEXT_RULE}\n\n${BLOG_AI_TONE_BAN_RULE}`
}

// 2026-07-31 요청: "루나원 대본에도 기사를 넣었을 때 경제로 인식되면 이렇게 대본 짤 수 있게
// 해줄 수 있어?" - anyone-dashboard의 "유튜브(한국어)-경제" 채널 전용 구조
// (promptBuilder.js ECONOMY_STRUCTURE_RULE, 진희님이 직접 조사한 "경제학 똑똑" 등 벤치마킹
// 반영)를 그대로 가져오되, 루나원엔 전용 채널이 따로 없어서(원본 소재 하나로 여러 플랫폼을
// 한 번에 만드는 구조) 유튜브 대본(youtubeShorts/youtubeLong) 플랫폼에만, 그리고 AI가 원문을
// 보고 경제/재테크 관련 내용이라고 판단할 때만 조건부로 적용되게 함 - 여행/후기 등 다른 소재로
// 대본을 만들 때는 이 지침이 끼어들면 안 되므로.
// 2026-08-01 요청: "경제 역사 등은 이 구조로 만들고 드라마 스타일은 제외" - 적용 범위를
// 경제/재테크 단독에서 역사(역사적 사건·경제사) 같은 정보성 소재까지 넓히고, 드라마·소설 같은
// 이야기(픽션) 스타일 콘텐츠는 명시적으로 제외함.
const ECONOMY_SCRIPT_RULE = `[경제·역사 정보성 소재일 때만 - 구조] 위 원문이 경제·재테크·주식·
부동산·금리 또는 역사(역사적 사건·경제사) 같은 정보성 내용이라고 판단되면, 아래 구조를 반드시
따라 대본을 쓰세요. 반대로 드라마·소설처럼 이야기(픽션)를 들려주는 스타일의 콘텐츠면 이 구조를
적용하지 말고 평소 구조로 쓰세요.
1. 훅: "오늘은 ~에 대해 알아보겠습니다" 금지. 소재에 가장 잘 맞는 유형 하나를 골라 시작하세요:
   - 기회비용 후회형: 과거의 평범한 선택과 다른 선택의 결과를 정확한 금액으로 대비시켜("매달
     50만 원씩 20년간 은행에 넣었으면 1억 7천, 다른 곳에 넣었으면 3억 8천 - 2억 차이") 후회를 자극
   - 상식파괴형(역설): 당연해 보이는 결과를 뒤집는 실제 상황으로 시작("역대급 실적을 발표한
     바로 그날 서킷브레이커가 발동됐다 - 왜?")
   - 일상공감→반전폭로형: 평범한 상황 묘사로 공감시킨 뒤 그게 함정이었음을 폭로
   - 확신형 명령: "오늘 하루 딱 이 영상 하나만 보세요" 같은 단호한 약속과 명령형으로 시작
2. 위기를 고조시키세요: 안전하다고 믿는 것(예금, 대기업 취업 등)이 사실 위험하다는 걸 폭로하고,
   손실을 정확한 수학으로 보여주세요(예: "50% 떨어지면 회복엔 100%가 올라야 한다") - 막연한
   "많이"가 아니라 정확한 숫자를 쓰세요.
3. 어려운 개념은 반드시(생략 불가) 일상 비유로 설명하세요 - 비유 없이 전문용어만 나열하면 안
   됩니다 (예: 여러 종목 묶음 상품 → "과일 바구니 세트", 금리-채권 관계 → "놀이터 시소 게임",
   포트폴리오 구성 → "폭풍우에도 안 무너지는 금융 요새 짓기").
4. 실제 사례·데이터로 증명하고, 중간에 통념을 뒤집는 반전을 넣으세요.
5. 해결책은 "알아서 판단하세요" 같은 추상적 조언 금지 - 의지력에 기대지 않는 구체적 시스템/도구를
   콕 집어 제시하세요(절세 계좌, 자동 적립식 투자, 자산배분 비율, 부채 상환 순서 등). 가능하면
   연령별·상황별로 정확한 비율까지 정해주세요.
6. 숫자로 된 목록으로 정리해 실천 항목으로 마무리하고, 끝은 "인내와 철학" 프레이밍 + "가장 큰
   리스크는 아무것도 하지 않는 것입니다" 같은 확신형 문장으로 행동을 촉구하세요.
7. 투자 관련 소재면 "투자 권유가 아니다"는 문구를 자연스럽게 포함하세요.`

function buildEconomyScriptNote(platform) {
  if (platform !== 'youtubeShorts' && platform !== 'youtubeLong') return ''
  return `\n${ECONOMY_SCRIPT_RULE}`
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
  trendNote = '',
}) {
  const langName = LANGUAGE_NAMES[language] || language
  const rule = PLATFORM_RULES[platform]
  if (!rule) throw new Error(`알 수 없는 플랫폼: ${platform}`)

  // 계층 순서(설계 문서 8-3): 1층 공통 문체 → 2층 채널 노하우 → 4층 사용자 입력/기존 규칙
  const system = `${COMMON_STYLE_PRINCIPLES}

${CORE_PRINCIPLES}
${buildChannelKnowhowNote(platform)}

대상 언어: ${langName} (반드시 이 언어로 작성. 단순 직역이 아니라 그 언어권 독자가 자연스럽게 읽도록 현지화)
대상 플랫폼: ${PLATFORM_NAMES[platform]}
플랫폼 규칙: ${rule}
말투: ${tone}
${platform === 'cards' ? `카드뉴스 장수: ${cardCount}` : ''}
${platform === 'cards' ? buildPhotoNote(photos) : ''}
${buildSmartEnhanceNote(smartEnhance)}${buildExperienceNote(experienceMode, experienceText)}${buildTrendNote(trendNote)}${buildBlogMethodNote(platform)}${buildEconomyScriptNote(platform)}

반드시 아래 JSON 형식만 출력하세요. 다른 설명은 붙이지 마세요.
${buildOutputSchema(platform)}`

  const userText = `[원본 제목]\n${source.title || '제목 없음'}\n\n[출처]\n${source.sourceUrl || '사용자 입력'}\n\n[원문]\n${source.text.slice(0, 12000)}`

  const photoCount = Array.isArray(photos) ? photos.length : 0

  return callClaudeJson({
    system,
    messages: [{ role: 'user', content: userText }],
    // 2026-08-02: blogText(카드마다 3~4문장 블로그용 설명) 필드 추가로 카드당 출력량이 늘어서
    // 장수당 예산을 220→380으로, 상한도 4000→6000으로 올림 (안 그러면 카드 많을 때 JSON이 잘림).
    maxTokens: platform === 'cards' ? Math.min(6000, 300 + Number(cardCount) * 380) : (MAX_TOKENS_BY_PLATFORM[platform] || 1200),
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
