import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { retryAutomationRun } from '../lib/apiClient'

function formatDuration(startedAt, finishedAt) {
  if (!finishedAt) return '진행 중...'
  const ms = new Date(finishedAt) - new Date(startedAt)
  if (ms < 0) return '-'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}초`
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`
}

// 자동 파이프라인(벤치마킹 수집 / 콘텐츠 생성)이 언제 돌았고 성공했는지 실패했는지 한눈에 확인하는 화면.
// 사람이 버튼을 안 눌러도 되는 무인 실행이라, 문제가 생겼을 때 여기서 원인을 봐야 함.
export default function AutomationLog() {
  const { rows, loading, error, refresh } = useSupabaseTable('automation_runs', { orderBy: 'started_at' })
  const [retrying, setRetrying] = useState({}) // runId -> 'loading' | error message

  const handleRetry = async (runId) => {
    setRetrying((prev) => ({ ...prev, [runId]: 'loading' }))
    try {
      await retryAutomationRun(runId)
      await refresh()
      setRetrying((prev) => ({ ...prev, [runId]: undefined }))
    } catch (err) {
      setRetrying((prev) => ({ ...prev, [runId]: err.message }))
    }
  }

  return (
    <div>
      <PageHeader
        title="자동화 실행 로그"
        emoji="🤖"
        description="벤치마킹 수집·콘텐츠 자동 생성이 언제 돌았고, 성공/실패했는지 확인해요"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyView label="아직 자동 실행 기록이 없어요. 크론 스케줄이 돌면 여기 쌓여요." />
      )}

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl bg-paper-card p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{row.run_type}</span>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
              <span>{new Date(row.started_at).toLocaleString('ko-KR')}</span>
              <span>·</span>
              <span>소요 {formatDuration(row.started_at, row.finished_at)}</span>
            </div>
            {row.summary && <p className="mt-1 text-xs text-ink/60">{row.summary}</p>}
            {row.error_message && <p className="mt-1 text-xs text-stamp-reject">⚠️ {row.error_message}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {row.draft_id && (
                <Link to={`/drafts?id=${row.draft_id}`} className="text-xs font-semibold text-stamp-amber hover:underline">
                  이 실행이 만든 초안 보기 →
                </Link>
              )}
              {row.status === '이슈발생' && row.endpoint && (
                <button
                  type="button"
                  onClick={() => handleRetry(row.id)}
                  disabled={retrying[row.id] === 'loading'}
                  className="rounded-md border border-ink/15 px-2.5 py-1 text-xs font-semibold text-ink/70 hover:bg-ink/5 disabled:opacity-50"
                >
                  {retrying[row.id] === 'loading' ? '재시도 중...' : '🔁 재시도'}
                </button>
              )}
            </div>
            {retrying[row.id] && retrying[row.id] !== 'loading' && (
              <p className="mt-1 text-xs text-stamp-reject">재시도 실패: {retrying[row.id]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
