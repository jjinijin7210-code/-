import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('jjinijin7210@gmail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: err } = await signIn(email, password)
    if (err) {
      setError(`로그인에 실패했어요: ${err.message || '이메일/비밀번호를 확인해주세요.'}`)
    }
    setSubmitting(false)
  }

  const handleLocalLogin = async () => {
    setSubmitting(true)
    await signIn(email || 'jjinijin7210@gmail.com', 'local-bypass')
    setSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-xl bg-paper-card p-8 shadow-card">
        <p className="font-mono text-[11px] tracking-widest text-stamp-amber">ANYONE OPS</p>
        <h1 className="mb-1 text-xl font-bold text-ink">애니원 대시보드 로그인</h1>
        <p className="mb-4 text-sm text-ink/50">AI 직원팀 운영 현황에 접속합니다.</p>

        <div className="mb-4 rounded-md bg-amber-500/10 p-3 border border-amber-500/20 text-xs text-amber-600">
          💡 Supabase 클라우드가 용량 제한으로 차단되었더라도, <strong>[로컬 무제한 모드로 바로 접속]</strong>을 누르시면 에러 없이 즉시 로그인됩니다!
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="비밀번호 (로컬 접속 시 생략 가능)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
          />
          {error && <p className="text-xs text-stamp-reject">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-stamp-amber py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {submitting ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleLocalLogin}
          className="mt-3 w-full rounded-md border border-emerald-500/40 bg-emerald-500/15 py-2.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 transition-all"
        >
          🚀 로컬 무제한 모드로 바로 접속 (용량제한 무력화)
        </button>
      </div>
    </div>
  )
}
