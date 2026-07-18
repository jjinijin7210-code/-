import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: err } = await signIn(email, password)
    if (err) setError(`로그인에 실패했어요: ${err.message || '이메일/비밀번호를 확인해주세요.'}`)
    setSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-xl bg-paper-card p-8 shadow-card">
        <p className="font-mono text-[11px] tracking-widest text-stamp-amber">ANYONE OPS</p>
        <h1 className="mb-1 text-xl font-bold text-ink">애니원 대시보드 로그인</h1>
        <p className="mb-6 text-sm text-ink/50">AI 직원팀 운영 현황에 접속합니다.</p>

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
            required
            placeholder="비밀번호"
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

        <p className="mt-5 text-[11px] leading-relaxed text-ink/40">
          계정이 없다면 Supabase 대시보드 &gt; Authentication &gt; Users 에서
          본인 이메일로 사용자를 직접 추가해서 사용하세요. (개인 도구이므로 별도
          회원가입 화면은 만들지 않았어요.)
        </p>
      </div>
    </div>
  )
}
