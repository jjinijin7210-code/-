// ============================================================
// Supabase 서비스 롤 클라이언트 - 자동 파이프라인(server/routes/auto.js)이
// 로그인 세션 없이도 content_drafts/review_log에 쓸 수 있게 해준다.
// (RLS를 우회하므로 이 키는 절대 프론트엔드/클라이언트에 노출하면 안 됨)
// ============================================================

import { createClient } from '@supabase/supabase-js'

let client = null

export function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!client) {
    client = createClient(url, serviceKey, { auth: { persistSession: false } })
  }
  return client
}
