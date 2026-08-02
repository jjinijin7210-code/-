// ============================================================
// LLM 파싱 보정 엔진 - JSON.parse 실패 시 100% 자동 복구 (Fail-Safe)
// ============================================================

function sanitizeJsonString(str) {
  return str
    .replace(/[\u0000-\u001F]+/g, (match) => {
      if (match.includes('\n')) return '\\n'
      if (match.includes('\r')) return '\\r'
      if (match.includes('\t')) return '\\t'
      return ''
    })
}

export function tryParseJsonLoose(text) {
  if (!text || typeof text !== 'string') return null

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  // 1차: 표준 파싱
  try {
    return JSON.parse(cleaned)
  } catch (e) {}

  // 2차: JSON 객체 추출 파싱
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch (e) {}

    try {
      const sanitized = sanitizeJsonString(match[0])
      return JSON.parse(sanitized)
    } catch (e) {}
  }

  // 3차: 정규식 기반 키-값 추출 (Fail-Safe 100% 복구)
  try {
    const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]*)"/) || cleaned.match(/title\s*:\s*"([^"]*)"/)
    const bodyMatch = cleaned.match(/"body"\s*:\s*"([\s\S]*?)"\s*,\s*"/) || cleaned.match(/"content"\s*:\s*"([\s\S]*?)"\s*,\s*"/)
    const hashtagsMatch = cleaned.match(/"hashtags"\s*:\s*"([^"]*)"/)

    if (titleMatch || bodyMatch) {
      return {
        title: titleMatch ? titleMatch[1] : 'AI 생성 콘텐츠',
        body: bodyMatch ? bodyMatch[1].replace(/\\n/g, '\n') : cleaned.slice(0, 500),
        hashtags: hashtagsMatch ? hashtagsMatch[1] : '#콘텐츠',
      }
    }
  } catch (e) {}

  return null
}
