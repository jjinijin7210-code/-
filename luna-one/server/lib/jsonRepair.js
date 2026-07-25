// ============================================================
// LLM에게 "JSON만 응답해"라고 지시해도 가끔 앞뒤에 설명을 덧붙이거나,
// 문자열 값 안에 이스케이프 안 된 줄바꿈을 그대로 넣어서 JSON.parse가 깨지는 경우가 있다.
// 이 파일은 그런 흔한 실패 패턴을 보정해서 최대한 파싱을 살려본다.
// (anyone-dashboard의 검증된 버전 그대로 재사용)
// ============================================================

function escapeRawControlCharsInStrings(str) {
  let result = ''
  let inString = false
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const prevChar = str[i - 1]
    if (char === '"' && prevChar !== '\\') {
      inString = !inString
      result += char
      continue
    }
    if (inString && (char === '\n' || char === '\r' || char === '\t')) {
      result += char === '\n' ? '\\n' : char === '\r' ? '\\r' : '\\t'
      continue
    }
    result += char
  }
  return result
}

export function tryParseJsonLoose(text) {
  // 가끔 ```json ... ``` 코드블록으로 감싸서 응답하는 경우가 있어 방어적으로 벗겨낸다
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const candidates = [text, unfenced]

  const match = unfenced.match(/\{[\s\S]*\}/)
  if (match && match[0] !== text) candidates.push(match[0])

  for (const candidate of [...candidates]) {
    candidates.push(escapeRawControlCharsInStrings(candidate))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // 다음 후보로 넘어감
    }
  }
  return null
}
