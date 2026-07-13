import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { LoadingView, ErrorView } from '../components/StateViews'
import StatusBadge from '../components/StatusBadge'
import PrincipleChecklist from '../components/PrincipleChecklist'

function isToday(dateStr) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export default function Home() {
  const employees = useSupabaseTable('employee_status', { orderBy: 'updated_at' })
  const drafts = useSupabaseTable('content_drafts')

  if (employees.loading || drafts.loading) return <LoadingView />
  if (employees.error) return <ErrorView message={employees.error} />
  if (drafts.error) return <ErrorView message={drafts.error} />

  const todayDrafts = drafts.rows.filter(
    (d) => isToday(d.created_at) || isToday(d.published_at)
  )
  const statusCounts = todayDrafts.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink md:text-2xl">홈</h1>
        <p className="mt-1 text-sm text-ink/60">
          오늘 ({new Date().toLocaleDateString('ko-KR')}) 발행 현황과 직원팀 작업 상태예요.
        </p>
      </div>

      {/* 안전 원칙 - 전체 버전으로 홈 화면 상단에 크게 노출 */}
      <PrincipleChecklist />

      {/* 오늘의 발행 현황 요약 카드 */}
      <section>
        <h2 className="mb-3 text-sm font-bold text-ink/70">📤 오늘의 콘텐츠 현황</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {['초안', '검수중', '통과', '발행완료'].map((status) => (
            <div key={status} className="rounded-xl bg-paper-card p-4 shadow-card">
              <p className="text-2xl font-bold text-ink">{statusCounts[status] || 0}</p>
              <p className="mt-1 text-xs text-ink/50">{status}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI 직원별 작업 상태 */}
      <section>
        <h2 className="mb-3 text-sm font-bold text-ink/70">🧑‍💼 AI 직원팀 작업 상태</h2>
        {employees.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink/15 py-8 text-center text-sm text-ink/40">
            등록된 직원이 없어요. "직원 현황" 탭에서 추가해보세요.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {employees.rows.map((emp) => (
              <div key={emp.id} className="rounded-xl bg-paper-card p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    <span aria-hidden>{emp.role_emoji || '🤖'}</span>
                    {emp.role_name}
                  </span>
                  <StatusBadge status={emp.status} />
                </div>
                {emp.current_task && (
                  <p className="mt-2 text-xs text-ink/60">{emp.current_task}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
