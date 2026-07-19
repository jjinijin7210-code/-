// ============================================================
// 구글 Blogger 연동 - OAuth 인증 URL 생성 (계획서 요청 4번)
//
// 실제 "인증 코드 → 토큰 교환"은 네트워크가 필요해서 server/routes/auth.js 에서
// fetch로 처리합니다. 여기서는 순수하게 "인증 URL을 어떻게 만드는지"만 다뤄서
// 네트워크 없이 Node.js에서 검증할 수 있게 했습니다.
// (테스트: scripts/test-google-oauth.mjs)
// ============================================================

export const BLOGGER_SCOPE = 'https://www.googleapis.com/auth/blogger'
// 2026-07-19: 유튜브 영상 자동 업로드 기능 추가하면서 같은 구글 계정 연결 흐름에 업로드 권한도
// 같이 요청하게 함 - 사용자가 "구글 계정 연결하기"를 한 번만 눌러도 블로거+유튜브 둘 다 되게.
export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
export const GOOGLE_SCOPES = `${BLOGGER_SCOPE} ${YOUTUBE_UPLOAD_SCOPE}`
const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * 사용자를 구글 로그인/동의 화면으로 보낼 URL을 만듭니다.
 * @param {object} params
 * @param {string} params.clientId
 * @param {string} params.redirectUri
 * @param {string} [params.state] - CSRF 방지용 랜덤 문자열 (선택)
 */
export function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID가 설정되지 않았어요.')
  if (!redirectUri) throw new Error('redirectUri가 필요해요.')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline', // refresh_token을 받기 위해 필요
    prompt: 'consent',
  })
  if (state) params.set('state', state)

  return `${GOOGLE_AUTH_BASE}?${params.toString()}`
}

// 토큰 응답이 최소한의 형태를 갖추고 있는지 확인 (네트워크 응답을 그대로 믿지 않기 위함)
export function isValidTokenResponse(data) {
  return Boolean(data && typeof data.access_token === 'string' && data.access_token.length > 0)
}
