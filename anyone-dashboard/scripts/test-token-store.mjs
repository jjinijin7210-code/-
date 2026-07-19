// mergeTokenRow()(tokenStore.js) 병합 규칙을 네트워크 없이 검증.
// 2026-07-19: 토큰 저장을 로컬 파일 -> Supabase(google_tokens)로 옮기면서, 실제 DB 호출은
// 네트워크가 필요해 여기서 테스트할 수 없음 - 병합 로직만 순수 함수로 뽑아서 검증함.
// 실행: node scripts/test-token-store.mjs

import assert from 'node:assert/strict'
import { mergeTokenRow } from '../server/lib/tokenStore.js'

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

console.log('=== 토큰 저장소 병합 규칙 (mergeTokenRow) ===')

check('기존 값이 없으면 들어온 값 그대로 user_id와 함께 저장됨', () => {
  const row = mergeTokenRow('user-1', null, { access_token: 'tok-123', refresh_token: 'refresh-abc' })
  assert.equal(row.user_id, 'user-1')
  assert.equal(row.access_token, 'tok-123')
  assert.equal(row.refresh_token, 'refresh-abc')
  assert.ok(row.updated_at)
})

check('refresh_token이 새로 안 오면 기존 값을 유지함 (구글은 재발급 시 보통 refresh_token을 안 줌)', () => {
  const current = { access_token: 'old-token', refresh_token: 'refresh-abc' }
  const row = mergeTokenRow('user-1', current, { access_token: 'new-token' })
  assert.equal(row.access_token, 'new-token')
  assert.equal(row.refresh_token, 'refresh-abc')
})

check('expires_in이 오면 expires_at을 미래 시각으로 계산함', () => {
  const before = Date.now()
  const row = mergeTokenRow('user-1', null, { access_token: 'tok', expires_in: 3600 })
  const expiresAt = new Date(row.expires_at).getTime()
  assert.ok(expiresAt > before + 3500 * 1000 && expiresAt <= before + 3700 * 1000)
})

check('expires_in이 없으면 기존 expires_at을 유지함', () => {
  const current = { expires_at: '2026-01-01T00:00:00.000Z' }
  const row = mergeTokenRow('user-1', current, { access_token: 'tok' })
  assert.equal(row.expires_at, '2026-01-01T00:00:00.000Z')
})

check('scope도 같은 방식으로 새 값이 없으면 기존 값 유지', () => {
  const current = { scope: 'blogger youtube.upload' }
  const row = mergeTokenRow('user-1', current, { access_token: 'tok' })
  assert.equal(row.scope, 'blogger youtube.upload')
})

console.log(`\n총 ${passed}개 테스트 통과`)
