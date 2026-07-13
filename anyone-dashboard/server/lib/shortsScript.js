// ============================================================
// 상품 정보를 받아 쇼츠용 후크 문구/자막/내레이션 스크립트를 Claude로 생성
// ============================================================

export function buildShortsScriptMessages({ title, note, sceneCount }) {
  const system = `너는 인스타/틱톡/쇼츠용 상품 소개 영상 스크립트를 쓰는 카피라이터야.
"이게 있었네", "품절대란" 같은 발견형 후크 톤으로, 과장 광고 표현 없이 자연스럽게 써.
반드시 아래 JSON 형식으로만 답해 (다른 설명 붙이지 마):
{"hook": "3초 안에 시선 끄는 한 줄", "captions": ["씬1 자막", "씬2 자막", ...], "narration": "전체 내레이션 (구어체, 자연스럽게 이어지는 문단)"}
captions 배열은 정확히 ${sceneCount}개를 만들어.`

  const userText = `상품명: ${title}\n추가 정보: ${note || '없음'}`

  return {
    system,
    messages: [{ role: 'user', content: userText }],
  }
}

export function parseShortsScriptResponse(text) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Claude 응답에서 스크립트 JSON을 찾지 못했어요.')
  }
  const parsed = JSON.parse(match[0])
  if (!parsed.narration || !Array.isArray(parsed.captions)) {
    throw new Error('스크립트 응답 형식이 예상과 달라요 (hook/captions/narration 필요).')
  }
  return parsed
}
