import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { LoadingView, ErrorView } from '../components/StateViews'
import StatusBadge from '../components/StatusBadge'
import PrincipleChecklist from '../components/PrincipleChecklist'
import { generateAiImage, generateDraft } from '../lib/apiClient'
import { getCategoryForChannel } from '../lib/contentPreview'

// 빠른 요청에서 고를 수 있는 글 채널 (AI 초안 생성이 되는 채널만)
const QUICK_TEXT_CHANNELS = ['스레드', '인스타/틱톡', '인스타/틱톡(영어)', '인스타/틱톡(일본어)']

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

  const [quickType, setQuickType] = useState('image') // 'image' | 'text'
  const [quickChannel, setQuickChannel] = useState(QUICK_TEXT_CHANNELS[0])
  const [quickPrompt, setQuickPrompt] = useState('')
  const [quickLoading, setQuickLoading] = useState(false)
  const [quickError, setQuickError] = useState(null)
  const [quickResult, setQuickResult] = useState(null) // { type, preview }

  const handleQuickRequest = async () => {
    if (!quickPrompt.trim()) return
    setQuickLoading(true)
    setQuickError(null)
    setQuickResult(null)
    try {
      if (quickType === 'image') {
        const { dataUrl } = await generateAiImage({ prompt: quickPrompt })
        const attachment = {
          id: crypto.randomUUID(),
          kind: 'image',
          filename: `ai-${Date.now()}.png`,
          mime_type: 'image/png',
          size: dataUrl.length,
          data_url: dataUrl,
          note: quickPrompt,
          created_at: new Date().toISOString(),
        }
        await drafts.insertRow({
          title: quickPrompt.slice(0, 60),
          platform: '인스타/틱톡',
          category: getCategoryForChannel('인스타/틱톡'),
          images: [attachment],
          status: '초안',
        })
        setQuickResult({ type: 'image', preview: dataUrl })
      } else {
        const draft = await generateDraft({ channel: quickChannel, topic: quickPrompt })
        await drafts.insertRow({
          title: draft.title,
          body: draft.body,
          hashtags: draft.hashtags,
          platform: quickChannel,
          category: getCategoryForChannel(quickChannel),
          status: '초안',
        })
        setQuickResult({ type: 'text', preview: draft })
      }
      setQuickPrompt('')
    } catch (err) {
      setQuickError(err.message)
    } finally {
      setQuickLoading(false)
    }
  }

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

      {/* 빠른 요청 - 상품이 아니어도(동물 게시물, 음악 영상용 이미지 등) 자유롭게 요청하면 바로 만들어줌 */}
      <section className="rounded-xl bg-paper-card p-4 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-ink/70">⚡ 빠른 요청</h2>
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => setQuickType('image')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              quickType === 'image' ? 'bg-stamp-amber text-white' : 'border border-ink/15 text-ink/60'
            }`}
          >
            🎨 이미지
          </button>
          <button
            type="button"
            onClick={() => setQuickType('text')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              quickType === 'text' ? 'bg-stamp-amber text-white' : 'border border-ink/15 text-ink/60'
            }`}
          >
            ✍️ 글(스레드·인스타·틱톡)
          </button>
          {quickType === 'text' && (
            <select
              className="rounded-md border border-ink/15 px-2 py-1.5 text-xs"
              value={quickChannel}
              onChange={(e) => setQuickChannel(e.target.value)}
            >
              {QUICK_TEXT_CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-[240px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
            placeholder={
              quickType === 'image'
                ? '예: 창밖 보는 강아지 사진, 우리 밴드 신곡 커버용 몽환적인 배경 이미지'
                : '예: 신곡 발매 소식 알리는 글, 오늘 산책하다 만난 고양이 이야기'
            }
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
          />
          <button
            type="button"
            disabled={quickLoading || !quickPrompt.trim()}
            onClick={handleQuickRequest}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {quickLoading ? '만드는 중...' : '만들기'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink/40">상품이 아니어도 괜찮아요 - 만들어지면 "콘텐츠 관리" 탭에 초안으로 자동 저장돼요.</p>

        {quickError && <p className="mt-2 text-xs text-stamp-reject">{quickError}</p>}

        {quickResult?.type === 'image' && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-ink/10 p-2">
            <img src={quickResult.preview} alt="" className="h-20 w-20 rounded object-cover" />
            <p className="text-xs text-ink/60">완성! 콘텐츠 관리 탭 초안에 저장했어요.</p>
          </div>
        )}
        {quickResult?.type === 'text' && (
          <div className="mt-3 rounded-lg border border-ink/10 p-3">
            <p className="text-sm font-semibold text-ink">{quickResult.preview.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-ink/60">{quickResult.preview.body}</p>
            <p className="mt-2 text-xs text-ink/40">완성! 콘텐츠 관리 탭 초안에 저장했어요.</p>
          </div>
        )}
      </section>

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
