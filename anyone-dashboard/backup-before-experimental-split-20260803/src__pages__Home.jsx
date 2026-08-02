import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { LoadingView, ErrorView } from '../components/StateViews'
import StatusBadge from '../components/StatusBadge'
import PrincipleChecklist from '../components/PrincipleChecklist'
import OneClickShoppingShorts from '../components/OneClickShoppingShorts'
import LunaOneOneStop from '../components/LunaOneOneStop'
import WatermarkEraser from '../components/WatermarkEraser'
import CapCutOneStop from '../components/CapCutOneStop'
import EconomyBenchmarkGenerator from '../components/EconomyBenchmarkGenerator'
import { generateAiImage, generateDraft } from '../lib/apiClient'
import { getCategoryForChannel } from '../lib/contentPreview'
import { uploadDataUrlToStorage } from '../lib/attachments'

// 지금 사용자가 직접 확인·결정해야 하는 상태만 골라서, 무엇을 해야 하는지 문구까지 붙여줌
// (초안=아직 안 건드려도 됨, 발행완료=이미 끝남 → 둘 다 "확인 필요" 목록에서는 제외)
const ACTION_ORDER = { 반려: 0, 통과: 1, 검수중: 2 }
function nextActionFor(draft) {
  if (draft.status === '반려') return `반려 사유 확인: ${draft.reject_reason || '사유 미기재'}`
  if (draft.status === '통과') return '발행해주세요'
  if (draft.status === '검수중') return '검수 대기 중'
  return null
}

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

// 자동 파이프라인(benchmark.js)이 저장할 때 source에 "일본 벤치마킹 기반 자동 생성 (카테고리: X)"
// 형태로 남기므로, 여기서 카테고리명만 뽑아냄 (수동으로 만든 초안과 구분하기 위한 표식이기도 함)
const AUTO_SOURCE_MARK = '일본 벤치마킹 기반'
const CATEGORY_RE = /카테고리: ([^)]+)\)/
function extractCategory(source) {
  const m = CATEGORY_RE.exec(source || '')
  return m ? m[1] : '기타'
}

// 자동 파이프라인이 실제로 살아서 돌고 있는지 - "코드는 고쳤는데 실행이 안 되고 있었다"를
// 뒤늦게 GitHub Actions를 뒤져서 알아내는 대신 홈 화면에서 바로 보이게 함 (2026-07-20)
const STALE_HOURS = 3 // 자동 파이프라인은 9시~21시 사이 2시간 간격으로 도니, 3시간 넘게 조용하면 이상 신호
const RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000

// 파이프라인은 9~21시(KST)에만 도니, 자정 무렵 "12시간째 조용함"을 오탐지하지 않도록
// 활성 시간대인지부터 확인 (서버 타임존과 무관하게 KST 기준으로 계산)
function getKstHour(date = new Date()) {
  return Number(new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 13))
}

function computeAutomationHealth(runs) {
  if (!runs.length) return { status: 'none' }
  const latest = runs[0] // useSupabaseTable('automation_runs', { orderBy: 'started_at' })는 최신순 정렬
  const hoursSinceLast = (Date.now() - new Date(latest.started_at).getTime()) / (1000 * 60 * 60)
  const recentFailures = runs.filter(
    (r) => r.status === '이슈발생' && Date.now() - new Date(r.started_at).getTime() < RECENT_FAILURE_WINDOW_MS
  )
  const kstHour = getKstHour()
  const inActiveWindow = kstHour >= 9 && kstHour < 22
  const isStale = inActiveWindow && hoursSinceLast > STALE_HOURS
  return { status: isStale ? 'stale' : recentFailures.length > 0 ? 'failures' : 'ok', latest, hoursSinceLast, recentFailures }
}

export default function Home() {
  const employees = useSupabaseTable('employee_status', { orderBy: 'updated_at' })
  // 2026-07-26: content_drafts는 images 컬럼에 사진을 base64로 통째로 담고 있어서, 데이터가
  // 쌓일수록 select('*')가 매번 수십MB를 불러오다 statement timeout까지 나는 걸 실측 확인함
  // (useSupabaseTable.js의 select 옵션은 이걸 위해 만들어져 있었는데 이 화면만 안 쓰고 있었음).
  // 홈 화면은 목록 요약용이라 무거운 컬럼(images/body/hashtags 등) 없이 필요한 것만 가져옴.
  const drafts = useSupabaseTable('content_drafts', {
    select: 'id,title,platform,status,reject_reason,source,created_at,published_at',
  })
  const automationRuns = useSupabaseTable('automation_runs', { orderBy: 'started_at' })

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
        const attachment = await uploadDataUrlToStorage(dataUrl, {
          kind: 'image',
          filename: `ai-${Date.now()}.png`,
          note: quickPrompt,
        })
        await drafts.insertRow({
          title: quickPrompt.slice(0, 60),
          platform: '인스타/틱톡',
          category: getCategoryForChannel('인스타/틱톡'),
          images: [attachment],
          status: '초안',
        })
        setQuickResult({ type: 'image', preview: attachment.data_url })
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

  const automationHealth = computeAutomationHealth(automationRuns.rows)
  const sinceLabel =
    automationHealth.hoursSinceLast != null
      ? automationHealth.hoursSinceLast < 1
        ? `${Math.round(automationHealth.hoursSinceLast * 60)}분 전`
        : `${Math.floor(automationHealth.hoursSinceLast)}시간 전`
      : null

  const todayDrafts = drafts.rows.filter(
    (d) => isToday(d.created_at) || isToday(d.published_at)
  )
  const statusCounts = todayDrafts.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1
    return acc
  }, {})

  // 오늘 만들어진 것만이 아니라, 자동 파이프라인이 만들어 놓고 아직 사용자 확인을 못 받은 것 전부
  const needsAction = drafts.rows
    .filter((d) => nextActionFor(d) !== null)
    .sort((a, b) => (ACTION_ORDER[a.status] ?? 9) - (ACTION_ORDER[b.status] ?? 9))

  // 오늘 자동 파이프라인이 만든 것만 따로 - 몇 개를 어느 카테고리로, 통과/반려 몇 개인지 한눈에
  const automatedToday = todayDrafts.filter((d) => d.source?.includes(AUTO_SOURCE_MARK))
  const categoryCounts = {}
  let autoPassedCount = 0
  let autoRejectedCount = 0
  automatedToday.forEach((d) => {
    const cat = extractCategory(d.source)
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
    if (d.status === '통과' || d.status === '발행완료') autoPassedCount++
    else if (d.status === '반려') autoRejectedCount++
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink md:text-2xl">홈</h1>
        <p className="mt-1 text-sm text-ink/60">
          오늘 ({new Date().toLocaleDateString('ko-KR')}) 발행 현황과 직원팀 작업 상태예요.
        </p>
      </div>

      {/* 자동화 상태 - "코드는 고쳤는데 실행이 조용히 멈춰 있었다"를 뒤늦게 GitHub까지 뒤져서
          알아내는 일이 없도록, 마지막 실행 시각/최근 실패를 홈 화면에서 바로 보여줌 */}
      {!automationRuns.loading && automationHealth.status !== 'none' && (
        <section
          className={`rounded-xl p-4 shadow-card ${
            automationHealth.status === 'ok' ? 'bg-paper-card' : 'border border-stamp-reject/40 bg-stamp-reject/5'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-ink/70">🤖 자동화 상태</span>
            <Link to="/automation-log" className="text-xs font-semibold text-stamp-amber hover:underline">
              실행 로그 보기 →
            </Link>
          </div>
          {automationHealth.status === 'ok' && (
            <p className="mt-1 text-xs text-ink/50">정상 작동 중 · 마지막 실행 {sinceLabel}</p>
          )}
          {automationHealth.status === 'stale' && (
            <p className="mt-1 text-xs font-semibold text-stamp-reject">
              ⚠️ 자동화가 {sinceLabel}째 실행되지 않았어요. GitHub Actions 스케줄 또는 서버 상태를 확인해주세요.
            </p>
          )}
          {automationHealth.status === 'failures' && (
            <p className="mt-1 text-xs font-semibold text-stamp-reject">
              ⚠️ 최근 24시간 안에 자동 실행이 {automationHealth.recentFailures.length}건 실패했어요.
            </p>
          )}
        </section>
      )}

      {/* 안전 원칙 - 전체 버전으로 홈 화면 상단에 크게 노출 */}
      <PrincipleChecklist />

      {/* 🚀 1단계: 1-Click 쇼핑 숏폼 원스톱 생성기 */}
      <OneClickShoppingShorts />

      {/* 👑 3대 시스템 통합: 루나원 + 애니원 + 애니비드 원스톱 연동기 */}
      <LunaOneOneStop />

      {/* 🧹 AI 워터마크 & 불필요한 글자 지우개 모듈 */}
      <WatermarkEraser />

      {/* 🎬 1-Click CapCut(캡컷) 대본 & 자막 연동 모듈 */}
      <CapCutOneStop />

      {/* 📊 100만 뷰 경제/재테크 썸네일 & 숏폼 전용 엔진 */}
      <EconomyBenchmarkGenerator />

      {/* 오늘 자동 생성 현황 - 몇 개를 어느 카테고리로 만들었는지, 통과/반려 몇 개인지 한눈에 */}
      <section className="rounded-xl bg-paper-card p-4 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-ink/70">📊 오늘 자동 생성 현황</h2>
        {automatedToday.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink/15 py-6 text-center text-sm text-ink/40">
            오늘은 아직 자동으로 만들어진 게 없어요. (하루 5번, 오전 9시부터 순서대로 돌아요)
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-bold text-ink">{automatedToday.length}개</span>
              <span className="text-xs text-ink/50">
                오늘 자동 생성됨 · 통과 {autoPassedCount}개 · 반려 {autoRejectedCount}개
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(categoryCounts).map(([cat, count]) => (
                <span
                  key={cat}
                  className="rounded-full border border-stamp-amber/30 bg-stamp-amber/5 px-3 py-1 text-xs text-stamp-amber"
                >
                  {cat} {count}개
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 지금 확인이 필요한 것 - 자동 파이프라인이 만든 초안 중 사용자 확인/발행이 필요한 것만 상품별로 나열 */}
      <section>
        <h2 className="mb-3 text-sm font-bold text-ink/70">🔔 지금 확인이 필요해요 ({needsAction.length})</h2>
        {needsAction.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink/15 py-6 text-center text-sm text-ink/40">
            지금 확인이 필요한 항목이 없어요.
          </p>
        ) : (
          <div className="space-y-2">
            {needsAction.map((d) => (
              <Link
                key={d.id}
                to={`/drafts?id=${d.id}`}
                className="block rounded-xl bg-paper-card p-3 shadow-card transition hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{d.title || '(제목 없음)'}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
                  <span>{d.platform}</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-stamp-amber">{nextActionFor(d)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

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
