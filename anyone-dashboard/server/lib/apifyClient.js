// ============================================================
// Apify Actor 실행 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// run-sync-get-dataset-items 엔드포인트로 Actor를 동기 실행하고 결과를 바로 받는다.
// ============================================================

const APIFY_BASE_URL = 'https://api.apify.com/v2'

// Actor 실행은 몇 초~몇 분 걸릴 수 있어서 넉넉하게 타임아웃을 둔다.
const RUN_TIMEOUT_MS = 120_000

export async function runApifyActor(actorId, input) {
  const token = process.env.APIFY_TOKEN
  if (!token) {
    throw new Error('APIFY_TOKEN이 서버 .env에 설정되어 있지 않아요.')
  }

  const url = `${APIFY_BASE_URL}/acts/${actorId}/run-sync-get-dataset-items?token=${token}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Apify Actor 실행 오류 (${res.status}): ${errText.slice(0, 300)}`)
    }
    return res.json()
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Apify Actor 실행이 시간 초과되었어요 (2분).')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
