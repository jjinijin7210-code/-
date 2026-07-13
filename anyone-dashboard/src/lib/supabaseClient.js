import { createClient } from '@supabase/supabase-js'

// .env 파일에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 설정하면 Supabase(진짜 DB)를 씁니다.
// 설정하지 않으면 앱이 죽지 않고 자동으로 브라우저 localStorage 모드로 동작합니다.
// (src/hooks/useSupabaseTable.js 에서 이 값을 보고 백엔드를 선택합니다.)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[애니원] Supabase 환경변수가 설정되지 않았습니다. 지금은 브라우저 localStorage 모드로 동작합니다. ' +
      '실제 DB를 쓰려면 .env 파일을 채워주세요 (.env.example 참고).'
  )
}

// 설정 안 됐을 땐 createClient 자체를 호출하지 않음 (잘못된 URL로 인한 예외 방지)
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null
