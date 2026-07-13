// errorBoundaryLogic.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-error-boundary.mjs

import assert from 'node:assert/strict'
import { getErrorFallbackState, INITIAL_ERROR_STATE } from '../src/lib/errorBoundaryLogic.js'

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

console.log('=== Error Boundary 상태 계산 ===')
check('초기 상태는 hasError:false', () => {
  assert.equal(INITIAL_ERROR_STATE.hasError, false)
})
check('에러 객체가 있으면 그 메시지를 그대로 사용', () => {
  const state = getErrorFallbackState(new Error('테스트 오류 메시지'))
  assert.equal(state.hasError, true)
  assert.equal(state.message, '테스트 오류 메시지')
})
check('메시지가 없는 에러여도 사람이 읽을 기본 문구를 반환', () => {
  const state = getErrorFallbackState(new Error())
  assert.equal(state.hasError, true)
  assert.ok(state.message.length > 0)
})
check('error 자체가 null/undefined여도 죽지 않고 기본 문구 반환', () => {
  const state = getErrorFallbackState(null)
  assert.equal(state.hasError, true)
  assert.ok(state.message.length > 0)
})

console.log(`\n총 ${passed}개 테스트 통과`)
