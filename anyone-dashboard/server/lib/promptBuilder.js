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

const BLOG_TONE = `블로그용 톤 [필수 지침: 절대 길게 늘려 쓰지 마!]: 
군더더기 설명과 늘어지는 문장은 대폭 줄이고, 모바일에서 3초 만에 읽히는 핵심 요약형 정보 글 형태로 작성해줘.
- 긴 서론/인사말 금지 — 첫 2줄 안에 핵심 결론부터 전달
- 소제목은 2~3개 이내로 깔끔하게 정리
- 각 문단은 3~5줄 이내로 짧게 단락을 나누고, 중요한 실용 팁/이유는 불릿포인트(·)로 보기 쉽게 한눈에 정리해.`

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

// 2026-07-23: 진희님 본인 유튜브 채널(트롯충전소·감성채널·코코로의 모구모구식당)용 대본 -
// SNS 캡션이 아니라 실제 소리 내어 읽는 "나레이션 대본"이라 문체가 달라야 함. 강렬한 후킹으로
// 시작하도록 못박음(psychologyScript.js의 STRONG_HOOK_RULE과 같은 취지, 여기선 범용 톤이라
// 별도로 둠).
// 2026-07-24: "쇼츠용/롱폼용 두 가지 버전으로 대본 만들어달라" 요청 - 같은 주제로 직접 영상을
// 넣어서 만들 거라, 길이가 다른 두 버전을 한 번에 뽑아서 body 하나에 순서대로 담아준다
// (채널/드래프트 스키마를 안 건드리려고 별도 필드 대신 하나의 body 안에 두 섹션으로 구성).
const YOUTUBE_SHORTS_TONE = `유튜브 대본 톤: 이건 SNS 캡션이 아니라 실제로 소리 내어 읽는 나레이션
대본이야. 같은 주제로 쇼츠(짧은 영상)용과 롱폼(긴 영상)용 두 가지 버전을 모두 만들어서, body
하나 안에 아래 형식 그대로 순서대로 담아줘 (헤더 문구까지 정확히 똑같이 써):

[쇼츠용 대본 (30~60초 분량)]
1. 훅(첫 1~2문장): 영상 시작 3초 안에 스크롤을 멈추게 만드는 강렬한 한 줄. "오늘은 ~에 대해
   알아보겠습니다" 같은 밋밋한 소개형 문장 절대 금지 - 궁금증을 자극하거나("이거 아세요?"),
   의외의 사실로 시작하거나("~인 줄 알았는데"), 상황을 바로 보여주는 식으로.
2. 본론: 짧고 리듬감 있는 문장으로 핵심만, 실제 사람이 말하듯 자연스럽게(문어체 금지)
3. 마무리: 다음 영상을 기대하게 만들거나, 구독/좋아요를 자연스럽게 유도하는 한 줄

[롱폼용 대본 (5분 내외 분량)]
1. 훅: 쇼츠보다 조금 더 여유 있게, 상황이나 배경을 설명하며 시작
2. 본론: 쇼츠보다 훨씬 자세하게 - 배경 설명, 구체적인 사례나 디테일을 충분히 풀어서 여러
   문단으로 이어가
3. 마무리: 다음 영상 예고나 구독 유도로 마무리

두 버전 모두 실제 촬영/녹음할 때 그대로 읽을 수 있는 대본 형태로 써줘 (화면 지시문이나
효과음 표시 없이, 말하는 내용만).`

// 2026-07-30: "AI 직원 8명" 벤치마킹 채널 리서치에서 확인한 패턴 - AI 캐릭터 먹방·쿡방
// 숏츠 니치에서 평균 조회수 40만 이상 상위권 채널들(Ai재미네이션/aParrently/베이비파워)의
// 공통점은 "먹는 행위" 자체가 아니라 인터뷰·법정극·풍자 같은 반전/상황극 구조 안에 먹는 장면이
// 얹혀있다는 것 - 반면 먹방·브이로그를 그냥 나열한 채널은 평균 조회수가 훨씬 낮았음. 모구모구
// 식당(일본 대상 한식 소개 채널)에도 이 구조를 적용해봄.
const MOGU_MOGU_TWIST_RULE = `[모구모구식당 전용 - 반전/에피소드 구조] 이 채널은 그냥 순서대로 먹는
영상이 아니라, 매 화마다 작은 반전이나 상황극이 있는 짧은 에피소드로 구성해:
- 도입부에 "오늘은 ~를 소개합니다" 식으로 밋밋하게 시작하지 말고, 캐릭터가 예상과 다른 반응을
  보이거나("이거 매운 거 아니었어?"), 의외의 상황("사장님이 직접 나와서") 같은 작은 사건으로 시작해
- 중간에 최소 한 번은 시청자가 예상 못한 전개(맛에 대한 반전 반응, 몰랐던 사실 발견, 예상과 다른
  가격/양 등)를 넣어서 그냥 먹기만 하는 영상과 차별화해
- 마지막은 다음 에피소드가 궁금해지는 여운이나 짧은 반전으로 마무리해
- 어디까지나 실제 음식 소개라는 본질은 유지하되, "먹는 행위"를 반전이 있는 짧은 이야기의 소재로 써
- 가능하면 매번 똑같이 반복되는 짧은 대사/상황(캐릭터만의 말버릇, 놀랐을 때 하는 리액션 등)을
  하나 정해서 반복해줘 - 시청자가 "이 채널 특유의 그거"로 기억하게 만드는 장치야`

// 2026-08-02: "반전 말고 사연도 있으면 좋다고 했었잖아" - 벤치마킹 당시 반전 구조와 같이
// 나왔던 요소인데 반전만 프롬프트에 반영돼 있어서 빠진 부분을 추가함. 실제 있었던 일처럼
// 단정하는 대신 회상 톤으로 감정선만 살짝 얹는 용도 - 반전 구조를 대체하지 않고 그 위에 더함.
const MOGU_MOGU_STORY_RULE = `[모구모구식당 전용 - 사연 요소] 반전 구조에 더해, 그 음식이나
상황에 얽힌 짧은 사연(1~2문장)도 자연스럽게 곁들여줘 - 예: 그 음식을 보면 떠오르는 추억, 오늘
이 가게를 찾아온 계기, 같이 먹고 싶은 사람 생각 같은 감정적인 한 줄. "이런 일이 실제로
있었습니다"처럼 사실을 단정하지 말고 "~하던 게 생각나네" 같은 자연스러운 회상 톤으로 써서,
음식 정보 자체는 왜곡하지 않으면서 감성만 더하는 용도로 써.`

// 2026-07-30: 진희님이 직접 골라 보내준 경제 채널 10개(간단경제한스푼·경제해적단) 실제 대본을
// 분석해서 뽑은 공통 구조 - 훅-반전-근거-실천 순서로 짜인 스토리텔링.
// 2026-07-31 업그레이드: 진희님이 추가로 "경제학 똑똑" 등 재테크/주식 채널들을 직접 조사해서
// 정리해준 벤치마킹 자료(훅 유형 4가지, "위기 고조" 서사 기법, 비유의 필수화, 연령별 구체적
// 솔루션, 확신형 엔딩) 반영함 - "앞으로 경제 채널 만들 때 이걸 토대로" 라는 명시적 요청.
const ECONOMY_STRUCTURE_RULE = `[경제 채널 전용 - 구조] 이 채널은 딱딱한 정보 나열이 아니라 훅-반전-근거-실천 순서를
따르는 스토리텔링형 경제 콘텐츠야. 아래 구조를 지켜:
1. 훅: "오늘은 ~에 대해 알아보겠습니다" 금지. 소재에 가장 잘 맞는 유형 하나를 의식적으로 골라서 시작해:
   - 기회비용 후회형: 과거의 평범한 선택과 다른 선택의 결과를 정확한 금액으로 대비시켜("매달
     50만 원씩 20년간 은행에 넣었으면 1억 7천, 다른 곳에 넣었으면 3억 8천 - 2억 차이") 후회·조급함을 자극
   - 상식파괴형(역설): 당연해 보이는 결과를 뒤집는 실제 상황으로 시작("역대급 실적을 발표한
     바로 그날 서킷브레이커가 발동됐다 - 왜?")
   - 일상공감→반전폭로형: 아주 평범한 상황 묘사로 공감시킨 뒤 그게 함정이었음을 폭로("3년 만에
     연락 온 친구가 좋은 기회가 있다며... 당신은 지금 다단계 타겟이 된 겁니다")
   - 확신형 명령: "오늘 하루 딱 이 영상 하나만 보세요. 당신의 10년 후가 달라진다고 확신합니다"
     같은 단호한 약속과 명령형으로 시작
2. 위기를 고조시켜: 시청자가 가장 안전하다고 믿는 것(예금, 대기업 취업, 전문직)이 사실은
   위험하다는 걸 폭로해서 "안전지대"라는 착각을 깨고, 손실을 정확한 수학으로 보여줘(예: "50%
   떨어지면 원금 회복엔 50%가 아니라 100%가 올라야 한다") - 막연한 "많이"가 아니라 "43%에서
   36.3%로", "2억 원 차이" 같은 정확한 숫자를 써. 가능하면 개인의 잘못이 아니라 구조적 문제임을
   짚어("월급은 3.4% 오르는데 세금·이자는 5.7% 오른다") 더 큰 절박함을 만들어
3. 어려운 개념은 반드시(생략 불가) 일상 비유로 설명해 - 비유 없이 전문용어만 나열하면 안 돼.
   (예: 여러 종목 묶음 상품 → "과일 바구니 세트"/"바비큐 밀키트", 운용사별 같은 지수 상품 차이 →
   "같은 원두를 스타벅스에서 파나 투썸에서 파나의 차이", 금리-채권 관계 → "놀이터 시소 게임",
   포트폴리오 구성 → "폭풍우에도 안 무너지는 금융 요새 짓기", 단타 vs 장기투자 → "사냥꾼과 농부",
   원료 의존 구조 → "재료를 옆가게 한 곳에서만 사와야 하는 식당")
4. 실제 사례·데이터로 증명해: 구체적인 회사명·사건명·연도·금액을 넣은 실제 케이스나 시뮬레이션
   (예: "20년간 매달 적립한 A와 현금만 든 B의 수익률 차이")를 들어서 주장을 뒷받침해
5. 중간에 반전/전환점을 넣어: 예상 밖의 해결책이 등장하거나, 통념을 뒤집는 사실을 드러내(예:
   "상승장에서 돈을 버는 것도 사실 위험 신호다 - 90% 이상은 결국 다 토해낸다")
6. 해결책은 "알아서 판단하세요" 같은 추상적 조언 금지 - 의지력에 기대지 않는 구체적인 시스템/도구를
   콕 집어 제시해(예: 절세 계좌(ISA/연금저축/IRP) 활용, 월급날 자동 매수되는 적립식 시스템, 코어
   70~80%+새틀라이트 20~30% 자산배분, 금리 높은 빚부터 갚는 부채 지도, 추적 손절매). 가능하면
   연령별·상황별로 정확한 비율까지 정해줘(예: "20~30대는 코어60:새틀라이트40", "50대 이상은
   변동성 낮추고 현금흐름 위주로")
7. 숫자로 된 목록으로 정리해: "3단계", "4가지 패턴", "5가지 자산"처럼 번호를 매겨서 한눈에
   정리되게 하고, 시청자가 바로 확인해볼 수 있는 실천 항목으로 마무리해
8. 마무리는 "인내와 철학" 프레이밍으로: 화려한 기술이 아니라 원칙을 지키는 것의 가치를 짚고,
   "가장 큰 리스크는 아무것도 하지 않는 것입니다. 지금 당장 시작하세요" 같은 확신형 문장으로
   행동을 촉구해
9. 자랑형 소재(K기술 등)라도 끝에 균형 잡힌 리스크/한계를 짧게라도 짚어줘 - 무조건적인 국뽕
   찬양이 아니라 냉정한 시각이 있어야 신뢰가 생겨
10. 투자 관련 소재면 "투자 권유가 아니다"는 문구를 자연스럽게 포함해`

const ECONOMY_NARRATION_TONE = `유튜브 경제 채널 나레이션 대본 톤: SNS 캡션이 아니라 실제로 소리 내어
읽는 5~10분 분량의 나레이션 대본이야. 화면 지시문이나 효과음 표시 없이 말하는 내용만 써줘.
문어체("~습니다"만 반복) 대신 구어체를 섞어 자연스럽게("~거든요", "~인데요", "~잖아요").`

// 2026-07-31: "방송연예/패션뷰티/스포츠/경제 중 이슈 되는 걸 위주로" 요청 - 새 채널
// "블로그(네이버)-이슈" 전용 톤. [원본 자료]엔 naverIssueTrend.js가 찾아온 실제 최신 뉴스
// 요약이 들어오므로(찾아온 게 없으면 고정 주제 풀로 대체 - threadBlogAuto.js), 뉴스를
// 그대로 옮기지 말고 블로그 독자에게 친구가 얘기해주듯 풀어쓰도록 못박음.
const ISSUE_BLOG_TONE = `[이슈형 블로그 전용 지침] 지금 실제로 화제가 되고 있는 방송연예·패션뷰티·
스포츠·경제 이슈를 다루는 채널이야. [원본 자료]에 최신 뉴스 요약이 주어지면 그 사실관계는 그대로
살리되 표현은 완전히 새로 써 - 뉴스 기사체를 그대로 옮기면 안 돼. "이게 왜 지금 화제인지", "사람들
반응이 어떤지" 같은 맥락을 곁들이고, 블로그 독자에게 친구가 얘기해주듯 친근하게 풀어써줘.`

const CHANNEL_TONE = {
  카드뉴스: '카드뉴스(Carousel) 전용 톤 [필수 지침]: 인스타그램/카드뉴스 슬라이드용 글이야! 표지 카드부터 본문 카드(1~4장), 마무리 카드까지 [카드 1 - 표지], [카드 2 - 본문 1], [카드 3 - 본문 2], [카드 4 - 본문 3], [카드 5 - 마무리] 형식으로 각 슬라이드 카드에 들어갈 임팩트 있는 가독성 높은 제목과 2~3줄 요약 부제 문구를 나누어서 작성해줘.',
  스레드: '스레드(Threads) 전용 톤 [필수 지침]: 무조건 5~10줄 사이로 짧고 간결하게 작성해줘! 긴 문단 절대 금지. 한 줄에 한 문장씩 짧게 끊어서 줄바꿈(Enter)을 5~8번 넣고, 전체 본문은 공백 포함 150자 내외로 핵심만 임팩트 있게 한눈에 들어오도록 써.',
  '블로그(네이버)-여행': `${BLOG_TONE}\n\n${TRAVEL_BLOG_TONE}`,
  // 구글 블로그(한국 숨은 여행지 → 영어 번역용 한국어 소스)도 여행 블로그와 같은 톤 사용
  '블로그(구글 Blogger)': `${BLOG_TONE}\n\n${TRAVEL_BLOG_TONE}`,
  '블로그(네이버)-이슈': `${BLOG_TONE}\n\n${ISSUE_BLOG_TONE}`,
  '유튜브(한국어)': YOUTUBE_SHORTS_TONE,
  '유튜브(한국어)-트롯충전소': `${YOUTUBE_SHORTS_TONE}\n\n[트롯충전소 전용 지침] 40~70대 트롯 마니아 시청자층을 위한 대본이야. 첫 1~2문장은 감동적이고 가슴을 울리는 고향/부모님/일상공감 각도 또는 스트레스를 싹 날려주는 강렬한 흥/에너지 각도로 시작해줘. 가사 자막을 따라 부르기 쉽게 짧은 줄 단위로 나누고, 마무리는 "오늘도 트롯충전소에서 흥 꽉 채워가세요!"처럼 따뜻한 인사로 끝맺어줘.`,
  '유튜브(한국어)-모구모구식당': `${YOUTUBE_SHORTS_TONE}\n\n${MOGU_MOGU_TWIST_RULE}\n\n${MOGU_MOGU_STORY_RULE}`,
  '유튜브(한국어)-경제': `${ECONOMY_NARRATION_TONE}\n\n${ECONOMY_STRUCTURE_RULE}`,
}
// 인스타/틱톡은 번역/현지화 담당(한국어·영어·일본어)이 언어별로 분리되어 있어서 접두 매칭으로 처리
const INSTA_TIKTOK_TONE = '인스타/틱톡용 톤: 캐주얼하고 임팩트 있게, 짧은 문장 위주로 써줘.'

const LOCALIZATION_RULES = `[국가별 시청자 눈높이 현지화 3대 지침 - 절대 단순 번역하지 마!]
1. 🇰🇷 한국어 타겟:
   - 한국 시청자의 눈높이에 완벽히 맞게 각색해! 낯선 해외 개념이나 문화는 한국인에게 친근한 예시("우리나라의 ~같은 느낌")로 친절하게 풀어서 설명해.
   - 친근하고 살아있는 구어체("~했거든요", "~해보세요")와 명확한 실용 포인트 위주로 작성해.
2. 🇺🇸 영어 타겟:
   - 번역투("This article is about...") 절대 금지! 영미권 Z세대/TikTok 크리에이터 어조("Wait, did you know this?", "Here is why...")로 힙하고 감각적이게 작성해.
3. 🇯🇵 일본어 타겟:
   - 번역투 금지! 일본 Z세대의 SNS 어조("〜だよね", "〜知ってる?")와 질문형 후킹, 랭킹/리스트(TOP5) 구조로 현지 공감대를 극대화해.`

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

// 채널 이름에서 대상 언어를 뽑아낸다 (틱톡 -> 일본어, 인스타/네이버 -> 한국어, 구글 -> 영어)
function getTargetLanguage(channel) {
  if (channel.includes('영어') || channel.includes('구글') || channel.includes('Blogger')) return '영어'
  if (channel.includes('일본어') || channel.includes('틱톡') || channel.includes('TikTok')) return '일본어'
  return '한국어'
}

// 2026-07-23: "기사/링크 하나 넣으면 여러 채널로 한번에 변환" 기능(draft/from-source)에서 쓰는
// 글쓰기 공식. 진희님이 유튜브 강의 영상을 보고 정리한 원칙(정보 나열이 아니라 개인 경험담처럼
// 써야 안 딱딱하고, 필자의 의견이 들어가야 노출이 잘 됨) + 실제 대화에서 확인한 "증상/사건 →
// 왜지 생각 → 원인 발견" 훅 구조를 그대로 반영함.
const PERSONAL_HOOK_RULE = `[글쓰기 공식 - 유튜브 영상 '끊는 순간 지옥이 시작된다' 6대 바이럴 공식 적용!]
1. 💥 초반 3초 충격/위협형 후킹: "끊는 순간 지옥이 시작됩니다", "모르면 무조건 손해 보는 ~"처럼 시청자의 시선을 0.5초 만에 빼앗는 충격적인 문장으로 시작해.
2. 😱 도파민 장기흥행 구조: 단순히 정보를 설명하지 말고 "이거 안 하면 생기는 위험 ➡️ 의외의 해결책 ➡️ 반전 이득"의 도파민 자극 구조로 전개해.
3. 🎯 핵심 정보 2~3개 초간결 전개: 지루하지 않게 팩트와 명확한 결론만 3줄 요약 형태로 전달해.
4. 🗣️ 크리에이터 주관/경험 담기: "직접 해보니 진짜 소름 돋았던 게~" 같은 생생한 경험 어조를 섞어줘.
5. 💬 댓글 유발 CTA: "여러분은 어떻게 생각하세요? 댓글로 남겨주세요!" 같이 시청자의 참여를 이끄는 질문으로 마무리해.`

// 현재 월을 기준으로 계절감을 프롬프트에 살짝 얹어줌 (한국은 4계절이 뚜렷해서, 시의성 있는
// 소재로 자연스럽게 녹이면 반응이 더 좋다는 진희님 피드백, 2026-07-23)
function getCurrentSeasonKorean(date = new Date()) {
  const month = date.getMonth() + 1
  if (month >= 3 && month <= 5) return '봄'
  if (month >= 6 && month <= 8) return '여름'
  if (month >= 9 && month <= 11) return '가을'
  return '겨울'
}

// 2026-07-31: "돈벌쥐" 채널 AI 블로그 글쓰기 인터뷰 2건 벤치마킹(진희님 요청) - 게스트들이 공통으로
// 강조한 방법론을 블로그 채널(channel.startsWith('블로그'))에만 반영함.
// (1) 정보만 나열한 글은 네이버가 덜 밀어주고, 도입부뿐 아니라 문단마다 필자의 경험/의견이
//     섞여야 노출이 잘 된다는 주장.
// (2) 제목은 감으로 짓지 말고 핵심 키워드+연관 검색어 조합으로, 그리고 이득형/위협형/궁금형/
//     비교형/반전형/실행형 6가지 후킹 유형 중 소재에 맞는 걸 의식적으로 골라서 짓는다는 방법론.
// (3) 원본 자료에 실제 질문(네이버 지식인 등)이 섞여 있으면, 막연한 주제 대신 그 구체적 질문을
//     소제목으로 삼는 게 검색 노출에 유리하다는 주장 (usesSourceArticle일 때만 의미가 있음).
const BLOG_SECTION_HOOK_RULE = `[소제목마다 경험/의견 섞기] 도입부에서만 개인 경험을 쓰고 나머지는
정보 나열로 끝내지 마. 소제목으로 나뉘는 각 문단마다 최소 한 문장은 "직접 겪어보니/찾아보니" 같은
경험담이나 "~것 같다/~라고 생각한다" 같은 주관적 의견을 섞어줘. 순수 정보만 쭉 나열된 문단이
있으면 안 돼 - 이게 딱딱한 정보성 글과 검색 노출이 잘 되는 글의 차이야.`

const BLOG_TITLE_RULE = `[제목 작성법]
1. 먼저 이 글의 핵심 키워드(사람들이 실제로 검색할 단어)를 정하고, 거기에 자연스럽게 붙는 연관
   검색어 2~3개를 더해서 제목에 최대한 녹여줘 (예: "ESTP 특징 장점 단점 팩폭 여자 남자"처럼
   키워드를 나열하듯 이어붙이는 스타일도 검색 노출엔 실제로 효과적이야). 감으로 멋있게 짓지 말고
   "이 제목으로 검색했을 때 뜨고 싶다"는 키워드 조합을 먼저 생각해.
2. 아래 6가지 후킹 유형 중 이 글 소재에 가장 자연스럽게 맞는 유형 하나를 의식적으로 골라서
   제목을 지어: 이득형(얻는 게 명확: "~하면 좋은 이유"), 위협형(안 하면 손해: "~안 하면 이렇게
   됩니다"), 궁금형(궁금증 유발: "~인 진짜 이유"), 비교형(둘을 비교: "A vs B, 뭐가 나을까"),
   반전형(통념 뒤집기: "~인 줄 알았는데 사실은"), 실행형(행동 유도: "지금 바로 ~하는 법"). 억지로
   안 맞는 유형에 끼워 맞추지 말고, 소재에 가장 클릭하고 싶어지는 유형으로.`

const BLOG_QUESTION_SEED_RULE = `[실제 질문을 소제목으로] 원본 자료 안에 물음표로 끝나는 문장이나
"~는지", "~일까요" 같은 질문형 문장(네이버 지식인 등에서 실제로 사람들이 물어본 질문)이 있으면,
그 큰 주제를 막연하게 다루지 말고 그 구체적인 질문 자체를 소제목으로 삼아서 직접 답해줘 - 막연한
주제보다 실제 사람들이 물어본 세부 질문에 답하는 글이 검색 노출과 클릭에 훨씬 유리해.`

// 2026-07-31: "네이버가 몰래 바꾼 블로그 규칙" 영상 벤치마킹(진희님 요청) - 네이버 검색 결과
// 위에 "AI 브리핑"(AI 요약)이 뜨는 게 늘면서, 이제 검색 순위보다 "AI가 얼마나 잘 추출해가는가"가
// 더 중요해졌다는 주장(272건 데이터 분석 + 네이버 공식 가이드 인용). 5가지 반영:
const BLOG_OPENING_RULE = `[도입부 - AI 요약에서 안 잘리려면] "안녕하세요"나 날씨·안부 얘기로 시작하지
마. 첫 2~3문장 안에 바로 이 글의 핵심 주제와 숫자·근거를 밝혀(예: "2년차가 알려주는 월매출 1천만원
만든 방법 세 가지"). 인사말이나 잡담으로 시작하면 AI 요약이 3줄 안에 이 글을 건너뛰어서 노출 기회
자체를 잃어.`

const BLOG_STRUCTURE_DENSITY_RULE = `[소제목 밀도] 본문이 1500자를 넘으면 소제목을 최소 3~4개는
넣어서 구조를 명확히 나눠줘 - 소제목 하나 없이 쭉 이어지는 긴 글은 안 돼.`

const BLOG_NUMBER_RULE = `[막연한 표현 금지] "맛있었어요", "좋았어요" 같은 막연한 형용사만 쓰지 말고,
가능한 모든 문장에 실제 숫자(가격·시간·수량·퍼센트 등)를 붙여줘(예: "맛있었어요" 대신 "2인 기준
32,000원, 웨이팅 평일 10분/주말 40분"). 숫자가 구체적일수록 AI와 독자 모두에게 신뢰를 줘.`

const BLOG_PHOTO_TEXT_RULE = `[사진-텍스트 비율] AI는 사진을 못 읽어. 사진을 여러 장 언급하거나
전제로 하는 글이면, 사진 개수만큼 그에 대응하는 설명 문장도 충분히 써줘서 사진 없이 텍스트만
읽어도 내용이 다 이해되게 만들어 - 사진에 설명을 떠넘기지 마.`

const BLOG_AI_TONE_BAN_RULE = `[AI 티 나는 문구 금지] "다양한 측면에서 살펴보겠습니다", "~라고 할 수
있습니다", "종합적으로 고려했을 때" 같은 전형적인 AI 리스트형 문구는 네이버가 감지해서 감점하니
절대 쓰지 마. 그 대신 실제 사람이 쓴 것처럼 구체적이고 개성 있는 표현을 써.`

// 외부 기사/자료를 참고 소재로 줄 때 지킬 것 - 원문 그대로 베끼면 저작권 문제가 생길 수 있어서,
// 의미(사실관계)는 유지하되 표현은 완전히 새로 쓰도록 명시함.
// 2026-08-01 실측 발견(루나원 테스트): 원문 "제주 흑돼지"가 결과물에서 "근교 삼겹살"로 바뀌는
// 실제 사실 왜곡이 확인됨 - 표현을 재구성하라는 지시와 사실을 유지하라는 지시가 같이 있다 보니
// AI가 "자연스럽게 다시 쓰기"를 지역명·품목명까지 바꿔도 되는 걸로 착각한 것으로 보임. 고유명사는
// 절대 안 바뀌게 명시적으로 못박음.
const SOURCE_ARTICLE_RULES = `[원본 자료 참고 원칙]
- 아래 원본 자료의 사실 관계·핵심 정보는 그대로 살리되, 문장 표현은 원문을 절대 그대로 베끼지 말고 완전히 새로운 표현으로 다시 써
- 원본에 없는 사실을 지어내지 마
- [특히 중요] 원문에 이미 나온 고유명사·구체적 사실(지역명, 상호명, 음식/제품의 정확한 종류, 가격,
  시간 등)은 절대 다른 것으로 바꾸지 마 - 예를 들어 원문이 "제주 흑돼지"면 "근교 삼겹살"처럼 다른
  지역·다른 음식으로 슬쩍 바꿔 쓰면 안 돼. 표현을 자연스럽게 재구성하는 것과 사실 자체를 바꾸는
  건 달라. (자연스러움을 위해 원문에 없는 사소한 디테일 - 동행인, 날씨, 감상 표현 등 - 을 자연스럽게
  곁들이는 건 괜찮지만, 이미 명시된 사실을 다른 사실로 대체하면 안 돼.)
- 원본이 불확실하거나 "~라는 설이 있다"는 식의 속설이면, 확정된 사실처럼 단정하지 말고 그 뉘앙스(속설임)를 그대로 살려서 정직하게 써줘`

// 2026-07-19: 동물/재밌는영상 카테고리는 실제로 화제가 된 동물 사진을 Pexels(무료 스톡사진)에서
// 찾아 붙이기로 함(사용자 결정: "그 동물의 다른 사진을 찾아서 올리면 되니까") - AI가 참고자료
// 속 실제 동물/장면을 영어 키워드로 뽑아내야 검색이 가능해서, 그 키워드를 초안 JSON에 같이 담게 함.
const PHOTO_QUERY_RULE = `[사진 검색어] 위 참고자료/주제에서 실제로 다뤄진 대상(동물/장면/장소 등)이 뭔지
파악해서, 무료 스톡사진 사이트에서 검색할 영어 키워드 2~3단어를 "photoQuery" 필드에 추가로 담아줘
(예: "red panda snow", "seoul mountain hiking trail", "korean temple autumn"). 특정 브랜드명은
피하고, 실존 인물이 나오는 특정 장소 사진이 아니라 풍경·사물·동물 중심의 일반적인 키워드로.
참고자료에 명확한 대상이 안 나와 있으면 주제/카테고리 분위기에 맞는 일반적인 키워드로 대신 채워.`

const GOOGLE_BLOGGER_KOREA_TRAVEL_RULE = `[구글 블로그 전용 전략 - 미국/해외 타겟 한국 숨은 여행지 100% 영어 작성]
- 이 채널은 미국 및 해외 독자 타겟이야. 한국의 잘 알려지지 않은 신비로운 숨은 여행지, K-컬처 비하인드, 전통 현지 팁을 주제로 다뤄줘.
- 100% 순수 현지 미국 원어민 영어(Native American English)로만 작성해! 한글은 단 1자도 포함하지 마.
- 감각적이고 매력적인 미국 여행 블로거 어조("Must-visit hidden gems in South Korea", "Local travel guide")로 끌어들여줘.`

const NAVER_BLOG_JAPAN_TRAVEL_RULE = `[네이버 블로그 전용 전략 - 한국인 타겟 일본 숨은 여행지 100% 한글 작성]
- 이 채널은 한국 독자 타겟이야. 도쿄/오사카처럼 흔한 곳 말고, "한국인 거의 없는 일본의 숨은 이색 여행지", 현지인 비밀 맛집, 소도시 힐링 코스를 주제로 다뤄줘.
- 100% 생생한 한국어 네이버 전문 여행 블로거 어조로 작성해. 소제목마다 생생한 팁과 주관적인 느낌을 섞어줘.`

const AMAZING_ANIMALS_GLOBAL_STORIES_RULE = `[신기한 동물 & 글로벌 놀라운 이야기 전용 전략]
- 이 채널의 핵심 주제는 전 세계의 귀엽고 신기한 동물 이야기(레서판다, 카피바라, 쿼카, 희귀 동·식물) 및 놀라운 해프닝/사건 이야기야.
- 시선을 0.5초 만에 사로잡는 귀여운/놀라운 동물 연출 컷 및 스톡 사진 키워드("photoQuery": "cute red panda playing", "capybara bath", "exotic owl")를 꼭 담아줘.
- 읽는 사람이 절로 미소 짓거나 "우와!" 하고 놀라움의 댓글을 달게 만드는 바이럴 톤으로 작성해줘.`

const ECONOMY_THUMBNAIL_BENCHMARK_RULE = `[경제/재테크 채널 벤치마킹 공식 - 조회수 100만 대박 썸네일 패턴]
1. 🖼️ 검은 배경 + 3단 색상 텍스트 (노란색/분홍색/흰색):
   - 썸네일 텍스트에 가장 핵심이 되는 키워드(예: "S&P500", "1억 모으는 법", "노후 평생 돈 걱정 끝")는 노란색이나 분홍색으로 강렬하게 강조하고, 보조문구는 흰색으로 대조를 극대화해줘.
2. 🤖 귀여운 3D 캐리커처/동글이 마스코트 캐릭터 배치:
   - 불타는 차트 📉 나 돈다발 💰 을 들고 기뻐하거나 걱정하는 귀여운 3D 동글이 캐릭터/버핏 할아버지 일러스트 연출 컷을 배치해.
3. 📉 위협/현실 공감 극적 후킹 헤드라인:
   - "통장에 100만원도 없어요..", "모르면 100% 손해 보는", "S&P500 이렇게만 하세요" 같이 시청자가 자발적으로 클릭할 수밖에 없는 극적인 이득/위협형 문장을 써줘.`

const INSTAGRAM_CAROUSEL_FEED_RULE = `[인스타그램 피드 전용 핵심 생명 지침 - 8K 강렬한 썸네일 & 0.5초 클릭 캡션]
1. 🖼️ 시선을 스톱시키는 강렬한 8K 썸네일 이미지:
   - 피드를 스크롤할 때 무조건 0.5초 만에 손가락을 멈추게 만드는 시각적 대조감과 독보적인 고화질 8K 연출 컷을 기본 썸네일로 구성해줘.
2. 💥 클릭을 부르는 첫 줄 후킹 캡션:
   - 첫 문장에 "이거 모르면 평생 손해입니다", "아직도 몰랐다고요?" 같은 극적인 후킹 문장을 배치해서 시청자가 바로 [더보기]를 누르게 만들어.
3. 📝 가독성 최강 본문 & 이모지 구분선 & 필수 해시태그 8개:
   - 3~5줄마다 이모지 및 깔끔한 구분선을 배치하여 읽기 쉽게 만들고, 연관 노출을 위한 핵심 해시태그 8개를 하단에 배치해줘.`

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
  if (channel.includes('인스타') && !channel.includes('릴스')) {
    parts.push(INSTAGRAM_CAROUSEL_FEED_RULE)
    parts.push(AMAZING_ANIMALS_GLOBAL_STORIES_RULE)
  }
  if (CHANNEL_TONE[channel]) {
    parts.push(CHANNEL_TONE[channel])
  } else if (channel.startsWith('블로그')) {
    parts.push(BLOG_TONE)
  }
  if (channel.includes('구글') || channel.includes('Blogger')) {
    parts.push(GOOGLE_BLOGGER_KOREA_TRAVEL_RULE)
  }
  if (channel.includes('경제') || channel.includes('재테크') || channel.includes('주식')) {
    parts.push(ECONOMY_THUMBNAIL_BENCHMARK_RULE)
  }
  if (channel.includes('네이버')) {
    parts.push(NAVER_BLOG_JAPAN_TRAVEL_RULE)
  }
  if (channel.startsWith('블로그')) {
    parts.push(BLOG_SECTION_HOOK_RULE)
    parts.push(BLOG_TITLE_RULE)
    parts.push(BLOG_OPENING_RULE)
    parts.push(BLOG_STRUCTURE_DENSITY_RULE)
    parts.push(BLOG_NUMBER_RULE)
    parts.push(BLOG_PHOTO_TEXT_RULE)
    parts.push(BLOG_AI_TONE_BAN_RULE)
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
    if (channel.startsWith('블로그')) parts.push(BLOG_QUESTION_SEED_RULE)
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
 * @param {string} [params.trendNote] - 최근 유튜브 트렌드 분석 리포트에서 뽑은 요약 한 줄 (trendNote.js, 없으면 생략)
 */
export function buildDraftUserPrompt({ channel, topic, referenceNote, sourceArticle, includeSeasonWeather, weatherNote, trendNote }) {
  const lines = [`채널: ${channel}`]
  if (topic && topic.trim()) lines.push(`주제: ${topic.trim()}`)
  if (includeSeasonWeather) {
    const season = getCurrentSeasonKorean()
    lines.push(`오늘 계절/날씨: ${season}${weatherNote ? ` · ${weatherNote}` : ''} (자연스럽게 어울릴 때만 살짝 녹여줘, 억지로 끼워 넣지 마)`)
  }
  if (trendNote && trendNote.trim()) {
    lines.push(`요즘 유튜브에서 반응이 좋은 패턴(참고만, 억지로 끼워 맞추지 말고 자연스러울 때만 반영): ${trendNote.trim()}`)
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

export function buildDraftMessages({ channel, topic, referenceNote, needsPhotoQuery, sourceArticle, includeSeasonWeather, weatherNote, trendNote }) {
  const usesSourceArticle = Boolean(sourceArticle && sourceArticle.trim())
  return {
    system: buildDraftSystemPrompt(channel, { needsPhotoQuery, usesSourceArticle }),
    messages: [
      {
        role: 'user',
        content: buildDraftUserPrompt({ channel, topic, referenceNote, sourceArticle, includeSeasonWeather, weatherNote, trendNote }),
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

// ============================================================
// 카드뉴스 (luna-one/server/lib/promptBuilder.js의 cards 플랫폼 로직을 그대로 포팅, 2026-07-29)
// title/body/hashtags 초안과 스키마가 완전히 달라서(title + cards 배열) 위 buildDraftMessages와는
// 별도 함수로 분리함. 실제 Claude 호출은 이 파일에서 하지 않고 routes/cardNews.js에서
// callClaudeJson으로 수행 - 이 파일의 기존 관례(buildDraftMessages 등)와 동일.
// ============================================================

export const CARD_ICONS = ['boat', 'plane', 'car', 'train', 'map', 'clock', 'calendar', 'ticket', 'money', 'star', 'question', 'camera', 'food', 'hotel']
export const CARD_TREATMENTS = ['normal', 'zoom', 'blur', 'dark', 'zoom-blur']

// 카드뉴스는 카드마다 AI 이미지를 새로 생성하지 않는다. 대신 사용자가 올린 실사진을 카드마다
// 확대/블러/어둡게 등으로 재사용하고, 정보성 카드(이동 방법·요금 같은)는 아이콘 배경을 쓴다.
function buildCardPhotoNote(photos) {
  if (!Array.isArray(photos) || !photos.length) {
    return `\n사용자가 올린 사진이 없습니다. 모든 카드의 visual.type을 "icon"으로 하고 아래 아이콘 중 어울리는 것을 고르세요: ${CARD_ICONS.join(', ')}.`
  }
  const list = photos.map((p, i) => `${i}: ${p.caption || '(설명 없음)'}`).join(' / ')
  return `\n사용자가 올린 사진 ${photos.length}장(인덱스와 설명): ${list}
카드마다 새 사진을 요구하지 말고 이 사진들을 최대한 재사용하세요 - 같은 사진이라도 treatment를 normal(원본)/zoom(확대)/blur(흐림)/dark(어둡게)/zoom-blur(확대+흐림)로 바꿔서 표지·본문·마무리 카드에 반복해서 써도 됩니다.
사진 설명과 실제로 어울리는 카드에만 photo를 쓰고, 이동 방법·요금·시간처럼 사진보다 정보 전달이 중요한 카드는 icon을 쓰세요 (아이콘 목록: ${CARD_ICONS.join(', ')}).`
}

const CARD_NEWS_OUTPUT_SCHEMA =
  '{"title":"","cards":[{"page":1,"headline":"","body":"","blogText":"블로그 본문용 설명 2~3문장, 150자 이내","visual":{"type":"photo 또는 icon","photoIndex":0,"treatment":"normal/zoom/blur/dark/zoom-blur 중 하나 (photo일 때만)","icon":"아이콘 이름 (icon일 때만)"}}]}'

/**
 * 카드뉴스 생성 요청의 system prompt를 만듭니다.
 * @param {object} opts
 * @param {number} opts.cardCount - 표지 포함 총 장수
 * @param {Array} [opts.photos] - [{caption}] 사용자가 올린 사진 설명 목록
 * @param {boolean} [opts.usesSourceArticle] - true면 원본 자료 재구성 원칙 적용
 * @param {string} [opts.trendNote] - 최근 유튜브 트렌드 리포트 요약 (trendNote.js, 없으면 생략)
 */
function buildCardNewsSystemPrompt({ cardCount, photos, usesSourceArticle, trendNote }) {
  const parts = [
    '너는 애니원(AnyOne)의 콘텐츠 작성자야. 카드뉴스(표지 포함 여러 장의 이미지 카드로 구성된 콘텐츠)를 만들어줘.',
    `카드뉴스 규칙: 표지 포함 총 ${cardCount}장. 각 장은 headline(짧고 임팩트 있게)과 body(카드 이미지 위에 함께 얹을 부제, 최대 두 문장)로 구성해. 추가로 blogText(네이버 블로그 등에 카드 이미지 사이사이 붙여넣을 설명 문단)도 각 카드마다 따로 써 - headline/body보다 조금 더 자세하게 그 카드 내용을 풀어쓰되, 짧고 간단한 문장 2~3개(공백 포함 150자 이내)로만 써. 장황하게 늘어놓지 말고 핵심만.`,
    COMMON_TONE_RULES,
    buildCardPhotoNote(photos),
  ]
  if (usesSourceArticle) {
    parts.push(SOURCE_ARTICLE_RULES)
    parts.push(PERSONAL_HOOK_RULE)
  }
  if (trendNote && trendNote.trim()) {
    parts.push(`요즘 반응이 좋은 패턴(참고만, 억지로 끼워 맞추지 말고 자연스러울 때만 반영): ${trendNote.trim()}`)
  }
  parts.push(`반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만): ${CARD_NEWS_OUTPUT_SCHEMA}`)
  return parts.join('\n\n')
}

function buildCardNewsUserPrompt({ topic, sourceArticle }) {
  const lines = []
  if (topic && topic.trim()) lines.push(`주제: ${topic.trim()}`)
  if (sourceArticle && sourceArticle.trim()) lines.push(`[원본 자료]\n${sourceArticle.trim()}`)
  lines.push('위 내용으로 카드뉴스를 만들어줘.')
  return lines.join('\n')
}

export function buildCardNewsMessages({ topic, sourceArticle, cardCount = 7, photos = [], trendNote }) {
  const usesSourceArticle = Boolean(sourceArticle && sourceArticle.trim())
  return {
    system: buildCardNewsSystemPrompt({ cardCount, photos, usesSourceArticle, trendNote }),
    messages: [{ role: 'user', content: buildCardNewsUserPrompt({ topic, sourceArticle }) }],
  }
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

/**
 * Claude 응답 텍스트를 파싱해서 { title, cards } 형태로 돌려줍니다.
 * @param {string} text
 * @param {number} photoCount - photos 배열 길이 (photoIndex 범위 보정용)
 */
export function parseCardNewsResponse(text, photoCount = 0) {
  if (!text || !text.trim()) {
    throw new Error('AI가 빈 응답을 돌려줬어요. 다시 시도해주세요.')
  }
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed = tryParseJsonLoose(cleaned)

  if (!parsed || !parsed.title || !Array.isArray(parsed.cards) || !parsed.cards.length) {
    console.warn('[parseCardNewsResponse] JSON 파싱 실패 -> Fail-Safe 폴백 처리 진행')
    const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]*)"/)
    const title = titleMatch ? titleMatch[1] : '카드뉴스 모음'

    const cards = [
      { page: 1, headline: title, body: '핵심 내용 요약', blogText: cleaned.slice(0, 300), visual: { type: 'icon', icon: 'star' } },
      { page: 2, headline: 'POINT 1', body: '주요 특징 및 이유', blogText: cleaned.slice(300, 600) || '자세한 내용 설명', visual: { type: 'icon', icon: 'camera' } },
      { page: 3, headline: 'POINT 2', body: '핵심 체크 포인트', blogText: cleaned.slice(600, 900) || '핵심 팁 요약', visual: { type: 'icon', icon: 'map' } },
    ]
    parsed = { title, cards }
  }

  return {
    title: String(parsed.title),
    cards: parsed.cards.map((card) => normalizeCardVisual(card, photoCount)),
  }
}

// ============================================================
// 쇼핑쇼츠 기획실 (2026-07-30) - 매번 완성된 콘텐츠를 바로 만드는 대신, 가벼운 주제 후보
// 3개만 먼저 뽑아서 골라 쓰는 벤치마킹 아이디어("AI 직원 8명" 영상의 콘텐츠 기획 담당 패턴).
// 무거운 소싱/이미지·영상 합성은 여기서 하지 않고 텍스트 후보만 만든다 - 고른 뒤에 카드뉴스/
// 영상 제작실 등 기존 도구로 직접 이어서 작업하는 구조.
// ============================================================

function buildShoppingShortsTopicSystemPrompt({ likedTopics, skippedTopics }) {
  const currMonth = new Date().getMonth() + 1
  const currSeason = getCurrentSeasonKorean()

  let seasonalDetailPrompt = ''
  if (currSeason === '여름') {
    seasonalDetailPrompt = `현재 한국은 ${currMonth}월 한여름 35도 폭염/열대야 피서 시즌이야!
지금 당장 불티나게 팔리는 여름 전용 핫템만 기획해:
- ☀️ 넥팬 / 쿨링 휴대용 선풍기 (출퇴근 열대야 식히기)
- 🧊 아이스 트레이 / 왕얼음 틀 (하이볼/아메리카노 보냉)
- ❄️ 쿨링 시트 / 얼음 쿨패드 (열대야 꿀잠 아이템)
- ⛱️ 자외선 차단 쿨토시 / 초경량 UV 암막 양산
- 💨 미니 아쿠아 에어컨 / 탁상용 쿨러
- 🦟 모기 포획기 / 전자 벌레 퇴치기
(겨울 넥워머, 히터, 손 트임 같은 겨울용품은 가을/겨울 시즌 전까지 임시 대기!)`
  } else if (currSeason === '가을') {
    seasonalDetailPrompt = `현재 한국은 ${currMonth}월 가을 환절기 시즌이야!
가을 캠핑용품, 트렌치/가을 옷 수납함, 환절기 디퓨저, 가습기 등 가을 핫템으로 기획해!`
  } else if (currSeason === '겨울') {
    seasonalDetailPrompt = `현재 한국은 ${currMonth}월 한겨울 맹추위 시즌이야!
겨울 넥워머, 목폴라, 미니 히터, 발열 조끼, 건조 손 트임 케어 등 겨울 핫템으로 기획해!`
  } else {
    seasonalDetailPrompt = `현재 한국은 ${currMonth}월 봄/황사 환절기 시즌이야!
황사 마스크, 봄맞이 대청소 수납함, 피크닉 용품 등 봄 핫템으로 기획해!`
  }

  const parts = [
    '너는 쇼핑쇼츠(짧은 상품 소개 영상/카드뉴스) 콘텐츠 기획 담당이야. 오늘 만든 만한 소재 후보 3개를 제안해줘.',
    `[한국 4계절 실시간 월별 자동 동기화 수칙]\n${seasonalDetailPrompt}`,
    `각 후보는 title(짧고 구체적인 ${currMonth}월 ${currSeason} 핫템 소재 한 줄), summary(무슨 내용인지 2문장 이내), angle(왜 지금 ${currMonth}월 날씨에 이 소재가 먹힐지 - 후킹 관점 한 줄)로 구성해.`,
  ]
  if (likedTopics.length) {
    parts.push(`최근에 실제로 선택했던 소재들: ${likedTopics.join(' / ')}`)
  }
  if (skippedTopics.length) {
    parts.push(`최근에 스킵했던 소재들: ${skippedTopics.join(' / ')}`)
  }
  parts.push('반드시 아래 JSON 형식으로만 응답해 (다른 설명 없이 JSON만): {"topics":[{"title":"","summary":"","angle":""}]} (topics는 정확히 3개)')
  return parts.join('\n\n')
}

export function buildShoppingShortsTopicMessages({ likedTopics = [], skippedTopics = [] } = {}) {
  const currMonth = new Date().getMonth() + 1
  const currSeason = getCurrentSeasonKorean()
  return {
    system: buildShoppingShortsTopicSystemPrompt({ likedTopics, skippedTopics }),
    messages: [{ role: 'user', content: `현재 한국은 ${currMonth}월 ${currSeason} 날씨야! 지금 이 날씨와 기온에 불티나게 팔리는 ${currMonth}월 실시간 핫템 소재 3개를 제안해줘.` }],
  }
}

export function parseShoppingShortsTopicsResponse(text) {
  if (!text || !text.trim()) {
    throw new Error('AI가 빈 응답을 돌려줬어요. 다시 시도해주세요.')
  }
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  const parsed = tryParseJsonLoose(cleaned)
  if (!parsed || !Array.isArray(parsed.topics) || !parsed.topics.length) {
    throw new Error('AI 응답에서 소재 후보 목록을 찾지 못했어요.')
  }

  return parsed.topics
    .filter((t) => t && t.title)
    .map((t) => ({
      title: String(t.title),
      summary: t.summary ? String(t.summary) : '',
      angle: t.angle ? String(t.angle) : '',
    }))
}
