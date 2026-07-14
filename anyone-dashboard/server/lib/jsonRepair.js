// ============================================================
// LLM에게 "JSON만 응답해"라고 지시해도 가끔 앞뒤에 설명을 덧붙이거나,
// 본문처럼 여러 줄인 문자열 값 안에 이스케이프 안 된 줄바꿈을 그대로 넣어서
// JSON.parse가 깨지는 경우가 있다. 이 파일은 그런 흔한 실패 패턴을 보정해서
// 최대한 파싱을 살려본다 (그래도 안 되면 null을 돌려주고, 호출부가 에러 처리).
// ============================================================

// 문자열 리터럴 안에 있는 raw 줄바꿈/탭만 이스케이프한다 (구조적 줄바꿈은 건드리지 않음)
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
  const candidates = [text]

  // 앞뒤에 설명 문구가 붙어있을 수 있으니 가장 바깥 {...} 부분만 추출해서도 시도
  const match = text.match(/\{[\s\S]*\}/)
  if (match && match[0] !== text) candidates.push(match[0])

  // 위 후보들 각각에 대해 raw 줄바꿈 보정판도 추가로 시도
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
