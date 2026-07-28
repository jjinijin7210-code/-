import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import PageHeader from '../components/PageHeader'
import { scanYoutubeTrend, downloadVideoFromLink, deleteDownloadedVideo } from '../lib/apiClient'

const GENRE_OPTIONS = ['트로트', '감성음악', '감동사연', 'AI영상', '쇼핑쇼츠']

function TrendBadge({ children, tone = 'amber' }) {
  const toneClass =
    tone === 'red'
      ? 'border-stamp-reject text-stamp-reject bg-stamp-reject/5'
      : 'border-stamp-amber text-stamp-amber bg-stamp-amber/5'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{children}</span>
}

// 한국 개인 채널(트로트/감동사연/AI영상/쇼핑쇼츠) 기획용 - 장르별 급상승 영상을 상승 속도
// 기준으로 채점하고 AI가 감정/후킹 요소를 분석해서 리포트까지 만드는 화면.
export default function YoutubeTrend() {
  const { insertRow: insertScan } = useSupabaseTable('youtube_trend_scan')
  const { insertRow: insertReport } = useSupabaseTable('youtube_trend_report')

  const [genre, setGenre] = useState(GENRE_OPTIONS[0])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)

  const [dlUrl, setDlUrl] = useState('')
  const [dlLoading, setDlLoading] = useState(false)
  const [dlError, setDlError] = useState(null)
  const [dlHistory, setDlHistory] = useState([])
  const [deletingFile, setDeletingFile] = useState(null)

  const handleDownload = async () => {
    if (!dlUrl.trim()) return
    setDlLoading(true)
    setDlError(null)
    try {
      const data = await downloadVideoFromLink(dlUrl.trim())
      setDlHistory((prev) => [data, ...prev])
      setDlUrl('')
    } catch (err) {
      setDlError(err.message)
    } finally {
      setDlLoading(false)
    }
  }

  const handleDeleteDownload = async (fileName) => {
    setDeletingFile(fileName)
    try {
      await deleteDownloadedVideo(fileName)
      setDlHistory((prev) => prev.filter((v) => v.fileName !== fileName))
    } catch (err) {
      setDlError(err.message)
    } finally {
      setDeletingFile(null)
    }
  }

  const runScan = async () => {
    setLoading(true)
    setError(null)
    setWarning(null)
    setResult(null)
    setSaveMessage(null)
    try {
      const data = await scanYoutubeTrend({ genre, days })
      if (data.warning) setWarning(data.warning)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const saveResult = async () => {
    if (!result || !result.scoredVideos?.length) return
    setSaving(true)
    setSaveMessage(null)
    try {
      for (const v of result.scoredVideos) {
        await insertScan({
          genre: result.genre,
          video_id: v.videoId,
          title: v.title,
          description: v.description || null,
          thumbnail_url: v.thumbnail || null,
          channel_title: v.channelTitle || null,
          published_at: v.publishedAt || null,
          duration_seconds: v.durationSeconds || null,
          view_count: v.viewCount || 0,
          like_count: v.likeCount || 0,
          comment_count: v.commentCount || 0,
          hours_since_published: v.hoursSincePublished || null,
          views_per_hour: v.viewsPerHour || null,
          like_rate: v.likeRate || null,
          comment_rate: v.commentRate || null,
          trend_score: v.trendScore || null,
          is_rising_24h: Boolean(v.isRising24h),
          is_rising_7d: Boolean(v.isRising7d),
          is_low_view_fast_growth: Boolean(v.isLowViewFastGrowth),
          ai_emotion: v.emotion || null,
          ai_hook: v.hook || null,
          ai_topic: v.topic || null,
          ai_expected_audience: v.expectedAudience || null,
          video_url: v.url || null,
        })
      }
      if (result.report) {
        await insertReport({ genre: result.genre, report: result.report })
      }
      setSaveMessage('저장했어요 - 벤치마킹 리포트처럼 나중에 다시 볼 수 있어요.')
    } catch (err) {
      setSaveMessage(`저장 실패: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="유튜브 트렌드 분석"
        emoji="📊"
        description="한국 개인 채널 기획용 - 장르별 급상승 영상을 상승 속도 기준으로 채점하고 AI가 성공 패턴을 분석해요"
      />

      <div className="mb-4 rounded-xl bg-paper-card p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink/70">장르</label>
            <select
              className="rounded-md border border-ink/15 px-3 py-2 text-sm"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              {GENRE_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink/70">최근 며칠</label>
            <input
              type="number"
              min="1"
              max="30"
              className="w-20 rounded-md border border-ink/15 px-3 py-2 text-sm"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={runScan}
            disabled={loading}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {loading ? '분석 중... (1~2분 걸려요)' : '📊 스캔 시작'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink/40">
          📈 24시간/7일 급상승, ⚠️ 조회수는 적지만 성장 속도가 빠른 영상까지 같이 찾아요. 단순 누적 조회수가 아니라
          "게시 후 얼마나 빠르게 반응이 붙었는지"로 점수를 매겨요.
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
        <p className="mb-1 text-xs font-bold text-ink/70">🎬 해외 쇼핑쇼츠 벤치마킹 (도우인·웨이보·빌리비리 등)</p>
        <p className="mb-2 text-[11px] text-ink/40">
          링크를 넣으면 참고·벤치마킹용으로 영상을 받아와요. 그대로 재업로드하지 말고, 왜 잘됐는지 참고하는 용도로만 쓰세요.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="https://..."
            className="min-w-[240px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm"
            value={dlUrl}
            onChange={(e) => setDlUrl(e.target.value)}
          />
          <button
            type="button"
            onClick={handleDownload}
            disabled={dlLoading || !dlUrl.trim()}
            className="rounded-md bg-stamp-amber px-3 py-2 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {dlLoading ? '받는 중...' : '⬇️ 다운로드'}
          </button>
        </div>
        {dlError && <p className="mt-2 text-xs text-stamp-reject">⚠️ {dlError}</p>}
        {dlHistory.length > 0 && (
          <div className="mt-3 space-y-3">
            {dlHistory.map((v) => (
              <div key={v.fileName} className="rounded-lg bg-white p-3 shadow-card">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="text-xs text-ink/60">{v.title}</p>
                  <button
                    type="button"
                    onClick={() => handleDeleteDownload(v.fileName)}
                    disabled={deletingFile === v.fileName}
                    className="flex-shrink-0 text-xs text-stamp-reject hover:underline disabled:opacity-50"
                  >
                    {deletingFile === v.fileName ? '삭제 중...' : '🗑️ 삭제'}
                  </button>
                </div>
                <video src={v.videoUrl} controls className="w-full max-w-sm rounded-lg" />
                <a href={v.videoUrl} download className="mt-1 block text-xs font-semibold text-stamp-amber hover:underline">
                  파일로 저장하기
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-stamp-reject/30 bg-stamp-reject/5 p-3 text-sm text-stamp-reject">
          ⚠️ {error}
        </div>
      )}
      {warning && (
        <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-sm text-ink/60">{warning}</div>
      )}

      {result && result.scoredVideos?.length > 0 && (
        <>
          {result.report && (
            <div className="mb-4 whitespace-pre-wrap rounded-xl bg-paper-card p-4 text-sm leading-relaxed shadow-card">
              {result.report}
            </div>
          )}

          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink/70">영상 {result.scoredVideos.length}개 (트렌드 스코어 순)</span>
            <button
              type="button"
              onClick={saveResult}
              disabled={saving}
              className="rounded-md border border-stamp-amber px-3 py-1.5 text-xs font-semibold text-stamp-amber hover:bg-stamp-amber/10 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '💾 이 결과 저장하기'}
            </button>
          </div>
          {saveMessage && <p className="mb-2 text-xs text-ink/50">{saveMessage}</p>}

          <div className="space-y-2">
            {result.scoredVideos.map((v) => (
              <div key={v.videoId} className="rounded-lg border border-ink/10 p-3">
                <div className="flex items-start gap-3">
                  {v.thumbnail && <img src={v.thumbnail} alt="" className="h-16 w-28 flex-shrink-0 rounded object-cover" />}
                  <div className="min-w-0 flex-1">
                    <a href={v.url} target="_blank" rel="noreferrer" className="block text-sm font-medium text-ink hover:underline">
                      {v.title}
                    </a>
                    <p className="mt-0.5 text-xs text-ink/50">
                      {v.channelTitle} · 트렌드스코어 {v.trendScore} · 시간당 조회수 {v.viewsPerHour?.toLocaleString?.() ?? v.viewsPerHour} · {v.hoursSincePublished}시간 전
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {v.isRising24h && <TrendBadge>📈 24시간 급상승</TrendBadge>}
                      {v.isRising7d && !v.isRising24h && <TrendBadge>📈 7일 급상승</TrendBadge>}
                      {v.isLowViewFastGrowth && <TrendBadge tone="red">⚠️ 저조회수·고성장</TrendBadge>}
                    </div>
                    {(v.emotion || v.hook || v.topic) && (
                      <p className="mt-1.5 text-xs text-ink/60">
                        {v.emotion && <>감정: {v.emotion} · </>}
                        {v.hook && <>후킹: {v.hook} · </>}
                        {v.topic && <>주제: {v.topic}</>}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
