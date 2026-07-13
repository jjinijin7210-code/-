// ============================================================
// 구글 OAuth 토큰 교환 - 실제 네트워크 호출
// (이 프로젝트를 만든 환경은 네트워크가 막혀 있어 직접 실행 검증하지 못했습니다.
//  구글 공식 OAuth 2.0 토큰 엔드포인트 스펙을 따릅니다.)
// ============================================================

import { isValidTokenResponse } from './googleOAuth.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

// 인증 코드(code)를 access_token/refresh_token으로 교환
export async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json()
  if (!res.ok || !isValidTokenResponse(data)) {
    throw new Error(`구글 토큰 교환 실패: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return data
}

// refresh_token으로 access_token 갱신 (access_token은 보통 1시간 후 만료됨)
export async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok || !isValidTokenResponse(data)) {
    throw new Error(`구글 토큰 갱신 실패: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return data
}
