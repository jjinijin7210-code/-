// googleOAuth.js를 Node.js에서 실제로 실행해서 검증.
// 실행: node scripts/test-google-oauth.mjs

import assert from 'node:assert/strict'
import { buildGoogleAuthUrl, isValidTokenResponse, BLOGGER_SCOPE } from '../server/lib/googleOAuth.js'

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

console.log('=== 1. 구글 인증 URL 생성 ===')
check('필수 파라미터(client_id, redirect_uri, scope, response_type)가 전부 포함됨', () => {
  const url = buildGoogleAuthUrl({ clientId: 'abc123', redirectUri: 'http://localhost:3001/auth/google/callback' })
  const parsed = new URL(url)
  assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(parsed.searchParams.get('client_id'), 'abc123')
  assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:3001/auth/google/callback')
  assert.equal(parsed.searchParams.get('response_type'), 'code')
  assert.equal(parsed.searchParams.get('scope'), BLOGGER_SCOPE)
})
check('access_type=offline이 포함됨 (refresh_token을 받기 위해 꼭 필요)', () => {
  const url = buildGoogleAuthUrl({ clientId: 'abc', redirectUri: 'http://x' })
  assert.equal(new URL(url).searchParams.get('access_type'), 'offline')
})
check('state를 넘기면 URL에 포함되고, 안 넘기면 포함 안 됨', () => {
  const withState = new URL(buildGoogleAuthUrl({ clientId: 'a', redirectUri: 'http://x', state: 'xyz' }))
  assert.equal(withState.searchParams.get('state'), 'xyz')

  const withoutState = new URL(buildGoogleAuthUrl({ clientId: 'a', redirectUri: 'http://x' }))
  assert.equal(withoutState.searchParams.get('state'), null)
})
check('clientId가 없으면 명확한 에러', () => {
  assert.throws(() => buildGoogleAuthUrl({ redirectUri: 'http://x' }), /GOOGLE_CLIENT_ID/)
})
check('redirectUri가 없으면 명확한 에러', () => {
  assert.throws(() => buildGoogleAuthUrl({ clientId: 'a' }), /redirectUri/)
})

console.log('=== 2. 토큰 응답 형식 검증 ===')
check('access_token이 있는 정상 응답은 true', () => {
  assert.equal(isValidTokenResponse({ access_token: 'tok', expires_in: 3600 }), true)
})
check('access_token이 없거나 빈 문자열이면 false', () => {
  assert.equal(isValidTokenResponse({}), false)
  assert.equal(isValidTokenResponse({ access_token: '' }), false)
  assert.equal(isValidTokenResponse(null), false)
})

console.log(`\n총 ${passed}개 테스트 통과`)
