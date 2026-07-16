import { useEffect, useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import PageHeader from '../components/PageHeader'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import { LoadingView, ErrorView } from '../components/StateViews'
import { buildBriefingText } from '../lib/briefing'

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10) // YYYY-MM-DD
}

export default function MorningBriefing() {
  const { rows: drafts, loading: l1 } = useSupabaseTable('content_drafts')
  const { rows: reviews, loading: l2 } = useSupabaseTable('review_log')
  const { rows: benchmarks, loading: l3 } = useSupabaseTable('benchmark_reports')
  const {
    rows: briefings,
    loading: l4,
    error,
    saveStatus,
    insertRow: insertBriefing,
    updateRow: updateBriefing,
  } = useSupabaseTable('briefings', { orderBy: 'briefing_date' })

  const [draftText, setDraftText] = useState(null)
  const [copyMessage, setCopyMessage] = useState(null)

  const loading = l1 || l2 || l3 || l4
  const today = new Date()
  const existingToday = briefings.find((b) => b.briefing_date === todayKey(today))

  const handleGenerate = () => {
    const text = buildBriefingText({ referenceDate: today, drafts, reviews, benchmarks })
    setDraftText(text)
    setCopyMessage(null)
  }

  const handleSave = async () => {
    const text = draftText ?? buildBriefingText({ referenceDate: today, drafts, reviews, benchmarks })
    if (existingToday) {
      await updateBriefing(existingToday.id, { content: text })
    } else {
      await insertBriefing({ briefing_date: todayKey(today), content: text })
    }
  }

  const handleCopy = async () => {
    const text = draftText ?? existingToday?.content
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyMessage('클립보드에 복사했어요.')
    } catch {
      setCopyMessage('복사에 실패했어요. 브라우저 권한을 확인해주세요.')
    }
  }

  // 오늘 아직 아무도 "생성" 버튼을 안 눌렀어도, 탭을 열자마자 바로 보이도록 자동 생성
  useEffect(() => {
    if (!loading && !existingToday && draftText === null) {
      handleGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, existingToday])

  const shownText = draftText ?? existingToday?.content

  return (
    <div>
      <PageHeader title="아침 브리핑" emoji="🌅" description="오늘 콘텐츠·검수·벤치마킹 현황을 한 번에 요약해요" />

      <div className="mb-4 rounded-lg border border-stamp-amber/30 bg-stamp-amber/5 p-3 text-xs text-ink/70">
        💡 여기서 만드는 브리핑은 버튼을 눌러야 생성·저장되는 <strong>1단계(수동)</strong> 기능이에요.
        계획서에 있는 "매일 오전 10시 자동 발송(이메일/카카오톡/슬랙)"은 크론잡 등 서버가 필요한{' '}
        <strong>별도 2단계</strong> 작업이라 아직 구현하지 않았습니다.
      </div>

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}

      {!loading && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={handleGenerate}
              className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90"
            >
              📋 오늘 브리핑 생성
            </button>
            <button
              onClick={handleSave}
              disabled={!shownText}
              className="rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-40"
            >
              💾 브리핑 저장
            </button>
            <button
              onClick={handleCopy}
              disabled={!shownText}
              className="rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-40"
            >
              📋 브리핑 복사
            </button>
            <SaveStatusIndicator status={saveStatus} />
          </div>

          {copyMessage && <p className="mb-2 text-xs text-stamp-pass">{copyMessage}</p>}

          {shownText ? (
            <pre className="whitespace-pre-wrap rounded-xl bg-paper-card p-4 text-xs leading-relaxed text-ink/80 shadow-card">
              {shownText}
            </pre>
          ) : (
            <p className="rounded-lg border border-dashed border-ink/15 py-10 text-center text-sm text-ink/40">
              "오늘 브리핑 생성"을 눌러보세요.
            </p>
          )}

          {briefings.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-bold text-ink/70">저장된 브리핑 이력</h2>
              <div className="space-y-2">
                {briefings
                  .slice()
                  .reverse()
                  .map((b) => (
                    <details key={b.id} className="rounded-lg bg-paper-card p-3 shadow-card">
                      <summary className="cursor-pointer text-sm font-medium">{b.briefing_date}</summary>
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-ink/60">{b.content}</pre>
                    </details>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
