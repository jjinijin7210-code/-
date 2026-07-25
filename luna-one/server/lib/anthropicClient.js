// ============================================================
// Claude API 호출 래퍼 - anyone-dashboard의 검증된 버전을 그대로 재사용
// (fetch만 사용, 별도 SDK 불필요)
// ============================================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

export async function callClaude({ system, messages, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Claude API 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json()
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

  return text
}

// JSON 파싱 실패 시 같은 프롬프트로 재시도 (애니원에서 검증된 패턴: 대부분 그날그날의
// 응답 변동이라 재시도하면 성공하는 경우가 많음)
export async function callClaudeJson({ system, messages, maxTokens = 1024, parse, maxRetries = 2 }) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const text = await callClaude({ system, messages, maxTokens })
    try {
      return parse(text)
    } catch (err) {
      lastErr = err
      console.error(`[callClaudeJson] 파싱 실패 (시도 ${attempt + 1}/${maxRetries + 1}):`, err.message)
      console.error(`[callClaudeJson] 원문 응답(앞 500자):`, text.slice(0, 500))
    }
  }
  throw lastErr
}
