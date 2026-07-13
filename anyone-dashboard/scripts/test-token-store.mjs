// tokenStore.js를 Node.js에서 실제 파일 I/O로 실행해서 검증.
// 실행: node scripts/test-token-store.mjs

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTokenStore } from '../server/lib/tokenStore.js'

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

const tmpDir = mkdtempSync(path.join(tmpdir(), 'token-store-'))
const filePath = path.join(tmpDir, 'nested', 'google-tokens.json')

console.log('=== 토큰 저장소 (실제 파일 I/O) ===')

check('파일이 아직 없으면 read()는 null, isConnected()는 false', () => {
  const store = createTokenStore(filePath)
  assert.equal(store.read(), null)
  assert.equal(store.isConnected(), false)
})

check('save() 하면 중첩 폴더까지 자동으로 만들어지고 실제 파일에 저장됨', () => {
  const store = createTokenStore(filePath)
  store.save({ access_token: 'tok-123', refresh_token: 'refresh-abc' })
  const read = store.read()
  assert.equal(read.access_token, 'tok-123')
  assert.equal(read.refresh_token, 'refresh-abc')
  assert.ok(read.updated_at)
})

check('save()는 기존 값과 병합됨 (refresh_token은 유지하고 access_token만 갱신 가능)', () => {
  const store = createTokenStore(filePath)
  store.save({ access_token: 'new-token' })
  const read = store.read()
  assert.equal(read.access_token, 'new-token')
  assert.equal(read.refresh_token, 'refresh-abc') // 이전 값 유지됨
})

check('저장 후 isConnected()는 true', () => {
  const store = createTokenStore(filePath)
  assert.equal(store.isConnected(), true)
})

check('clear() 하면 다시 연결 안 된 상태로 돌아감', () => {
  const store = createTokenStore(filePath)
  store.clear()
  assert.equal(store.isConnected(), false)
})

rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n총 ${passed}개 테스트 통과`)
