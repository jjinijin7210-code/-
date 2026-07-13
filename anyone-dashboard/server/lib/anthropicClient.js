// ============================================================
// Claude API 호출 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// 이 파일은 실제 네트워크 호출을 담당하므로, 이 프로젝트를 만든 환경(네트워크 차단)에서는
// 직접 실행해서 검증하지 못했습니다. 로직은 Anthropic 공식 Messages API 스펙을 따릅니다.
// ============================================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
// 모델명은 Anthropic이 새 모델을 낼 때마다 바뀔 수 있어서 .env(ANTHROPIC_MODEL)로 바꿀 수 있게 해둠
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
