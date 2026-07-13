import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

// 로그인 세션을 앱 전체에서 공유하기 위한 Context
// - Supabase가 설정되어 있으면: 이메일/비밀번호 로그인 사용
// - 설정되어 있지 않으면(localStorage 모드): 로그인 없이 바로 사용 (개인 브라우저 데이터이므로)
const AuthContext = createContext(null)

const LOCAL_MODE_USER = { email: '로컬 모드 (로그인 없음)' }

export function AuthProvider({ children }) {
  const [session, setSession] = useState(isSupabaseConfigured ? null : { user: LOCAL_MODE_USER })
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return // 로컬 모드에서는 세션 확인 자체가 필요 없음

    // 최초 로드 시 기존 세션 확인
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    // 로그인/로그아웃 상태 변화 구독
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const signIn = (email, password) => {
    if (!isSupabaseConfigured) return Promise.resolve({ error: null }) // 로컬 모드에서는 사실상 호출되지 않음
    return supabase.auth.signInWithPassword({ email, password })
  }

  const signOut = () => {
    if (!isSupabaseConfigured) return Promise.resolve() // 로컬 모드에는 로그아웃 개념이 없음
    return supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, loading, signIn, signOut, isSupabaseConfigured }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 내부에서만 사용해야 합니다.')
  return ctx
}
