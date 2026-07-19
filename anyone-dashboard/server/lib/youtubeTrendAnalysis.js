// ============================================================
// 유튜브 트렌드 분석 직원 - 점수 매겨진 영상들을 AI가 분석해서
// (1) 영상별 제목 감정요소/후킹표현/주제/예상 시청자층, (2) 성공요인만 뽑은 종합 리포트를 만든다.
// 썸네일은 이미지 자체를 분석하진 않고(비전 모델 미연동) URL만 참고용으로 저장한다.
// ============================================================

import { callClaude } from './anthropicClient.js'

export function buildVideoAnalysisMessages({ videos }) {
  const system = `너는 유튜브 트렌드를 분석하는 콘텐츠 전략가야. 아래 영상들의 제목/설명을 보고
각 영상마다 왜 반응이 좋은지 분석해줘. 실제로 근거가 있는 것만 쓰고 지어내지 마.
반드시 아래 JSON 배열 형식으로만 답해 (다른 설명 붙이지 마):
[
  {
    "videoId": "영상ID",
    "emotion": "제목에서 느껴지는 감정 요소 (예: 놀라움, 공감, 궁금증)",
    "hook": "제목의 후킹 표현/패턴",
    "topic": "주제 한 줄 요약",
    "expectedAudience": "예상 시청자층"
  }
]
입력된 영상 개수와 정확히 같은 개수의 항목을 만들고, videoId는 입력값 그대로 써.`

  const userText = videos
    .map((v) => `videoId: ${v.videoId}\n제목: ${v.title}\n설명: ${(v.description || '').slice(0, 200)}`)
    .join('\n\n')

  return {
    system,
    messages: [{ role: 'user', content: userText }],
  }
}

export function parseVideoAnalysisResponse(text) {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) {
    throw new Error('Claude 응답에서 분석 JSON 배열을 찾지 못했어요.')
  }
  return JSON.parse(match[0])
}

// 영상별 분석까지 나온 뒤, 장르 전체를 관통하는 공통 패턴/신규 아이디어를 뽑는 종합 리포트
export function buildDailyReportMessages({ genre, scoredVideos, analyses }) {
  const system = `너는 유튜브 채널 기획자야. 아래 "${genre}" 장르의 급상승 영상들과 그 분석 결과를 보고,
성공 요인과 감정 구조만 추출해서(영상 내용을 그대로 베끼지 말고) 콘텐츠 기획에 바로 쓸 수 있는
리포트를 써줘. 반드시 한국어로, 아래 형식의 순수 텍스트로 답해 (JSON 아님):

📈 오늘의 급상승 주제
-

🎬 주목할 영상
-

🔑 공통 성공 패턴
-

💡 신규 콘텐츠 아이디어
-`

  const userText = scoredVideos
    .map((v, i) => {
      const a = analyses[i] || {}
      return `[${i + 1}] "${v.title}" (트렌드스코어 ${v.trendScore}, 시간당조회수 ${v.viewsPerHour}, ${v.hoursSincePublished}시간 전 게시)
감정: ${a.emotion || '-'} / 후킹: ${a.hook || '-'} / 주제: ${a.topic || '-'} / 예상 시청자: ${a.expectedAudience || '-'}`
    })
    .join('\n\n')

  return {
    system,
    messages: [{ role: 'user', content: userText }],
  }
}

export async function analyzeAndReport({ genre, scoredVideos }) {
  const topVideos = scoredVideos.slice(0, 10)

  const { system: vaSystem, messages: vaMessages } = buildVideoAnalysisMessages({ videos: topVideos })
  const vaText = await callClaude({ system: vaSystem, messages: vaMessages, maxTokens: 2048 })
  const analyses = parseVideoAnalysisResponse(vaText)

  const { system: drSystem, messages: drMessages } = buildDailyReportMessages({ genre, scoredVideos: topVideos, analyses })
  const report = await callClaude({ system: drSystem, messages: drMessages, maxTokens: 1024 })

  return { topVideos, analyses, report }
}
