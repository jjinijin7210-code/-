// ============================================================
// 구글(Blogger + 유튜브 업로드) 토큰 저장소
//
// 2026-07-19: 기존엔 서버 로컬 JSON 파일에 저장했는데, Render 무료 플랜은 재배포/재시작마다
// 로컬 디스크가 초기화돼서 코드를 새로 배포할 때마다 구글 계정을 다시 연결해야 하는 문제가
// 있었다. Supabase의 google_tokens 테이블(migration_google_tokens.sql)로 옮겨서 배포와
// 무관하게 연결이 유지되게 함 - 혼자 쓰는 개인 도구라 user_id는 AUTO_TARGET_USER_ID를 그대로 쓴다.
// ============================================================

import { getSupabaseAdmin } from './supabaseAdmin.js'

// 저장할 행을 계산하는 순수 함수만 따로 뺌 - 네트워크 없이 병합 규칙(기존 refresh_token 유지 등)을
// 검증할 수 있게 (테스트: scripts/test-token-store.mjs). 실제 Supabase 호출은 save()에서만 함.
export function mergeTokenRow(userId, current, incoming) {
  return {
    user_id: userId,
    access_token: incoming.access_token ?? current?.access_token,
    refresh_token: incoming.refresh_token ?? current?.refresh_token,
    expires_at: incoming.expires_in
      ? new Date(Date.now() + incoming.expires_in * 1000).toISOString()
      : current?.expires_at ?? null,
    scope: incoming.scope ?? current?.scope ?? null,
    updated_at: new Date().toISOString(),
  }
}

export function createTokenStore(userId) {
  async function read() {
    if (!userId) return null
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.from('google_tokens').select('*').eq('user_id', userId).maybeSingle()
    if (error) {
      console.error('[tokenStore] 토큰 읽기 실패:', error.message)
      return null
    }
    return data
  }

  async function save(tokens) {
    if (!userId) throw new Error('AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.')
    const supabase = getSupabaseAdmin()
    const current = await read()
    const merged = mergeTokenRow(userId, current, tokens)
    const { data, error } = await supabase.from('google_tokens').upsert(merged, { onConflict: 'user_id' }).select().single()
    if (error) throw new Error(`구글 토큰 저장 실패: ${error.message}`)
    return data
  }

  async function clear() {
    if (!userId) return
    const supabase = getSupabaseAdmin()
    await supabase.from('google_tokens').delete().eq('user_id', userId)
  }

  async function isConnected() {
    const tokens = await read()
    return Boolean(tokens && tokens.access_token)
  }

  return { read, save, clear, isConnected }
}
