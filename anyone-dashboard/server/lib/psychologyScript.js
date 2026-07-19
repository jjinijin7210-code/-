// ============================================================
// 심리학 유튜브 영상용 스크립트 생성 - 여러 개의 "포인트"(예: 심리학 사실 하나씩)로 나눠서
// 만들어야 씬별로 내레이션을 따로 입힐 수 있다 (쇼츠는 짧게 몇 개, 롱폼은 더 많이).
// ============================================================

export function buildPsychologyScriptMessages({ topic, pointCount }) {
  const system = `너는 심리학 유튜브 채널의 대본 작가야. 사람들이 끝까지 보게 만드는 흥미로운
심리학 사실/현상을 다루되, 실제로 근거가 있는 내용만 써 (지어내거나 과장하지 마).
말투는 담담하고 신뢰가 가는 내레이션 톤, 각 포인트는 짧고 명확하게.
반드시 아래 JSON 형식으로만 답해 (다른 설명 붙이지 마):
{
  "title": "영상 제목",
  "hook": "영상 시작 3초 안에 시선 끄는 한 줄",
  "points": [
    { "caption": "화면에 보일 짧은 자막 문구", "narration": "이 포인트를 설명하는 내레이션 문장(구어체)" }
  ]
}
points 배열은 정확히 ${pointCount}개를 만들어.`

  const userText = `주제: ${topic}`

  return {
    system,
    messages: [{ role: 'user', content: userText }],
  }
}

export function parsePsychologyScriptResponse(text) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Claude 응답에서 스크립트 JSON을 찾지 못했어요.')
  }
  const parsed = JSON.parse(match[0])
  if (!parsed.title || !Array.isArray(parsed.points) || parsed.points.length === 0) {
    throw new Error('스크립트 응답 형식이 예상과 달라요 (title/points 필요).')
  }
  return parsed
}
