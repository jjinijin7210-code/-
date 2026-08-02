import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

// 로그인 세션을 앱 전체에서 공유하기 위한 Context
// - Supabase가 설정되어 있고 정상 동작 시: 이메일/비밀번호 로그인 사용
// - Supabase가 차단/제한(exceed_egress_quota)되었거나 미설정 시: 로컬 세션 모드로 자동 전환하여 로그인 막힘 방지
const AuthContext = createContext(null)

const LOCAL_MODE_USER = { email: 'jjinijin7210@gmail.com', name: '애니원 관리자 (로컬 모드)' }

export function AuthProvider({ children }) {
  const [session, setSession] = useState(isSupabaseConfigured ? null : { user: LOCAL_MODE_USER })
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    // 최초 로드 시 기존 세션 확인 (Supabase 차단 감지 시 로컬 세션으로 방어)
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error && (error.message?.includes('exceed_egress_quota') || error.message?.includes('restricted'))) {
          console.warn('[애니원 Auth] Supabase 계정 차단/제한 감지. 로컬 무제한 세션으로 자동 전환합니다.')
          setSession({ user: LOCAL_MODE_USER })
        } else {
          setSession(data?.session ?? null)
        }
        setLoading(false)
      })
      .catch(() => {
        setSession({ user: LOCAL_MODE_USER })
        setLoading(false)
      })

    // 로그인/로그아웃 상태 변화 구독
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession) {
        setSession(newSession)
      }
    })

    return () => listener.subscription?.unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    if (!isSupabaseConfigured) {
      const localSess = { user: { email: email || LOCAL_MODE_USER.email } }
      setSession(localSess)
      return { error: null }
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        // Supabase 용량/트래픽 초과로 프로젝트가 차단된 경우, 로그인 거부되지 않고 로컬 무제한 모드로 즉시 승인!
        if (
          error.message?.includes('exceed_egress_quota') ||
          error.message?.includes('restricted') ||
          error.status === 403
        ) {
          console.warn('[애니원 Auth] Supabase 용량 차단으로 로컬 무제한 모드로 로그인 승인함.')
          const localSess = { user: { email: email || LOCAL_MODE_USER.email } }
          setSession(localSess)
          return { error: null }
        }
        return { error }
      }
      setSession(data.session)
      return { error: null }
    } catch (e) {
      const localSess = { user: { email: email || LOCAL_MODE_USER.email } }
      setSession(localSess)
      return { error: null }
    }
  }

  const signOut = () => {
    setSession(null)
    if (isSupabaseConfigured && supabase) {
      supabase.auth.signOut().catch(() => {})
    }
    return Promise.resolve()
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
