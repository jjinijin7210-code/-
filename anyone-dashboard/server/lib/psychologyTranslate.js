// ============================================================
// 심리학 대본(한국어로 작성됨)을 일본어로 번역 - 일본 채널이므로 실제 내레이션/자막은
// 반드시 일본어여야 함(2026-07-19 피드백: "일본이라면서 음성은 한국말로 나와").
// 직역이 아니라 일본어 구어체로 자연스럽게 다시 쓰되, 심리학 사실 자체는 바꾸지 않는다.
// ============================================================

export function buildPsychologyTranslateMessages({ script }) {
  const system = `너는 심리학 콘텐츠를 일본어로 옮기는 전문 번역가야. 문장을 기계적으로 직역하지 말고,
일본 시청자에게 자연스럽게 들리는 구어체 내레이션으로 다시 써. 심리학적 사실/근거 자체는
절대 바꾸거나 왜곡하지 마 - 표현만 자연스러운 일본어로.
반드시 아래 JSON 형식으로만 답해 (다른 설명 붙이지 마):
{
  "title": "일본어 제목",
  "hook": "일본어 후크 문장",
  "points": [
    { "caption": "일본어 자막", "narration": "일본어 내레이션 (자연스러운 구어체)" }
  ]
}
points 배열은 원본과 정확히 같은 순서로 ${script.points.length}개를 만들어.`

  const userText = `[번역할 원본 - 한국어]
제목: ${script.title}
후크: ${script.hook}
${script.points.map((p, i) => `포인트${i + 1} - 자막: ${p.caption} / 내레이션: ${p.narration}`).join('\n')}`

  return {
    system,
    messages: [{ role: 'user', content: userText }],
  }
}

export function parsePsychologyTranslateResponse(text, expectedCount) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Claude 응답에서 번역 JSON을 찾지 못했어요.')
  }
  const parsed = JSON.parse(match[0])
  if (!parsed.title || !parsed.hook || !Array.isArray(parsed.points) || parsed.points.length !== expectedCount) {
    throw new Error(`번역 응답 형식이 예상과 달라요 (title/hook/points ${expectedCount}개 필요).`)
  }
  return parsed
}
