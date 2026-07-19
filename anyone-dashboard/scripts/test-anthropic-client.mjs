// callClaudeJson()(anthropicClient.js)의 재시도 로직을 fetch를 흉내내서(네트워크 없이) 검증.
// 실행: node scripts/test-anthropic-client.mjs

import assert from 'node:assert/strict'

process.env.ANTHROPIC_API_KEY = 'test-key'

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}`)
    console.log(`     -> ${e.message}`)
    process.exitCode = 1
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ❌ ${name}`)
    console.log(`     -> ${e.message}`)
    process.exitCode = 1
  }
}

function mockFetchReturning(texts) {
  let call = 0
  global.fetch = async () => {
    const text = texts[Math.min(call, texts.length - 1)]
    call++
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text }] }),
    }
  }
  return () => call
}

const { callClaudeJson } = await import('../server/lib/anthropicClient.js')

console.log('=== callClaudeJson 재시도 ===')

await checkAsync('첫 시도에서 파싱 성공하면 재시도 없이 바로 반환', async () => {
  const getCalls = mockFetchReturning(['{"ok":true}'])
  const result = await callClaudeJson({ system: 's', messages: [], parse: (t) => JSON.parse(t) })
  assert.deepEqual(result, { ok: true })
  assert.equal(getCalls(), 1)
})

await checkAsync('첫 시도가 깨진 JSON이어도 재시도해서 두 번째에 성공하면 결과 반환', async () => {
  const getCalls = mockFetchReturning(['이건 JSON이 아님', '{"ok":true}'])
  const result = await callClaudeJson({ system: 's', messages: [], parse: (t) => JSON.parse(t) })
  assert.deepEqual(result, { ok: true })
  assert.equal(getCalls(), 2)
})

await checkAsync('maxRetries를 다 써도 실패하면 마지막 에러를 던짐', async () => {
  const getCalls = mockFetchReturning(['깨짐1', '깨짐2', '깨짐3'])
  await assert.rejects(
    () => callClaudeJson({ system: 's', messages: [], parse: (t) => JSON.parse(t), maxRetries: 2 }),
    /Unexpected token|not valid JSON/i
  )
  assert.equal(getCalls(), 3) // 최초 1회 + 재시도 2회
})

console.log(`\n총 ${passed}개 테스트 통과`)
