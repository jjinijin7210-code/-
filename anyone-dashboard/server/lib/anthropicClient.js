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

// 2026-07-19: "초안작성 직원 혼자 하니까 이슈 발생하면 초안이 아예 안 나온다"는 피드백 -
// AI 응답이 JSON으로 안 잡히는 건 대부분 그날그날의 응답 변동(가끔 설명을 덧붙이거나 형식을
// 깨뜨림)이라, 같은 프롬프트로 다시 한번 물어보면 성공하는 경우가 많음. parse가 실패하면
// maxRetries만큼 새로 호출해서 재시도하고, 그래도 안 되면 마지막 에러를 그대로 던짐 - 자동
// 파이프라인 한 슬롯이 파싱 실패 한 번으로 통째로 날아가는 걸 줄이기 위함.
export async function callClaudeJson({ system, messages, maxTokens = 1024, parse, maxRetries = 2 }) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const text = await callClaude({ system, messages, maxTokens })
    try {
      return parse(text)
    } catch (err) {
      lastErr = err
      console.error(`[callClaudeJson] 파싱 실패 (시도 ${attempt + 1}/${maxRetries + 1}):`, err.message)
    }
  }
  throw lastErr
}

// 검수 단계(reviewParser.js의 parseReviewResponse)는 파싱 실패 시 예외를 던지는 대신
// "반려 + parseError:true" fallback을 반환하는 fail-safe 설계라, callClaudeJson과 같은
// try/catch 재시도 방식이 통하지 않는다 (실패해도 정상 값을 리턴하니 catch가 안 걸림).
// 2026-07-20: 실사용에서 1차/교차 검수가 같은 초안에 대해 동시에 파싱 실패로 반려되는 사례를
// 발견 - draft-generation 쪽엔 이미 재시도가 있는데(2026-07-19) 검수 쪽엔 없었던 게 원인.
// parse가 반환한 값의 parseError 플래그를 보고 재시도하도록 별도 래퍼로 분리.
export async function callClaudeWithParseRetry({ system, messages, maxTokens = 1024, parse, maxRetries = 2 }) {
  let result
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const text = await callClaude({ system, messages, maxTokens })
    result = parse(text)
    if (!result?.parseError) return result
    console.error(`[callClaudeWithParseRetry] 파싱 실패 (시도 ${attempt + 1}/${maxRetries + 1})`)
  }
  return result // 재시도까지 다 실패하면 마지막 fallback(반려)을 그대로 반환 - 애매하면 반려하는 기존 원칙 유지
}
