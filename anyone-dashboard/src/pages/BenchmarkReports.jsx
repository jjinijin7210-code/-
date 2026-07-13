import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { searchYoutubeVideos } from '../lib/apiClient'

const DURATION_OPTIONS = [
  { value: '', label: '전체 길이' },
  { value: 'short', label: '쇼츠(4분 미만)' },
  { value: 'long', label: '롱폼(20분 이상)' },
]
const REGION_OPTIONS = [
  { value: '', label: '전체 지역' },
  { value: 'US', label: '해외(미국)' },
  { value: 'KR', label: '국내(한국)' },
]

function formatCount(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`
  return String(n)
}

const PLATFORM_OPTIONS = ['블로그', '스레드', '유튜브']
const SOURCE_OPTIONS = ['공식 API', '트렌드 도구']
const CATEGORY_OPTIONS = ['인테리어/생활용품', '푸드쇼핑']

const emptyForm = {
  keyword: '',
  platform: PLATFORM_OPTIONS[0],
  source_type: SOURCE_OPTIONS[0],
  category: CATEGORY_OPTIONS[0],
  popularity_score: '',
  note: '',
}

export default function BenchmarkReports() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('benchmark_reports', {
    orderBy: 'collected_at',
  })
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const [query, setQuery] = useState('')
  const [duration, setDuration] = useState('')
  const [region, setRegion] = useState('US')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [results, setResults] = useState(null)

  const runSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearchError('')
    try {
      const videos = await searchYoutubeVideos({ query, minLikes: 10000, regionCode: region || undefined, videoDuration: duration || undefined })
      setResults(videos)
    } catch (err) {
      setSearchError(err.message)
      setResults(null)
    } finally {
      setSearching(false)
    }
  }

  const addVideoToReport = (video) => {
    setEditing(null)
    setForm({
      keyword: video.title,
      platform: '유튜브',
      source_type: '공식 API',
      category: CATEGORY_OPTIONS[0],
      popularity_score: video.viewCount,
      note: `채널: ${video.channelTitle} · 조회수 ${formatCount(video.viewCount)} · 좋아요 ${formatCount(video.likeCount)} · ${video.url}`,
    })
    setModalOpen(true)
  }

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="벤치마킹 리포트"
        emoji="🔍"
        description="리서처가 찾은 인기 키워드·주제 (매일 오전 10시 리포트 대상)"
        onAddClick={openAdd}
        addLabel="리포트 추가"
      />

      {/* 유튜브 인기 영상 검색 (조회수순, 좋아요 1만 개 이상만) */}
      <div className="mb-4 rounded-xl bg-paper-card p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-ink">🔎 유튜브 인기 영상 검색</h2>
        <form onSubmit={runSearch} className="flex flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
            placeholder="검색어 (예: winter home decor)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rounded-md border border-ink/15 px-2 py-2 text-sm"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            {REGION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className="rounded-md border border-ink/15 px-2 py-2 text-sm"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            {DURATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={searching}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {searching ? '검색 중...' : '검색'}
          </button>
        </form>
        <p className="mt-2 text-[11px] text-ink/40">좋아요 1만 개 이상인 영상만 조회수 순으로 보여줘요.</p>

        {searchError && <p className="mt-3 text-xs text-stamp-reject">{searchError}</p>}

        {results && results.length === 0 && !searchError && (
          <p className="mt-3 text-xs text-ink/40">조건에 맞는 영상이 없어요 (좋아요 1만 개 이상 기준).</p>
        )}

        {results && results.length > 0 && (
          <div className="mt-3 space-y-2">
            {results.map((v) => (
              <div key={v.videoId} className="flex items-center gap-3 rounded-lg border border-ink/10 p-2">
                {v.thumbnail && <img src={v.thumbnail} alt="" className="h-12 w-20 flex-shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <a href={v.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:underline">
                    {v.title}
                  </a>
                  <p className="truncate text-xs text-ink/50">
                    {v.channelTitle} · 조회수 {formatCount(v.viewCount)} · 좋아요 {formatCount(v.likeCount)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addVideoToReport(v)}
                  className="flex-shrink-0 rounded-md border border-stamp-amber px-3 py-1.5 text-xs font-semibold text-stamp-amber hover:bg-stamp-amber/10"
                >
                  + 리포트에 추가
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView />}

      {/* 푸드 카테고리 이미지 소싱 원칙 리마인더 */}
      <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-ink/60">
        💡 푸드 상품 후보는 도매 사이트(1688, 도매꾹 등)·도우인 이미지만 참고하고, 한국 사이트 이미지는 사용하지 않아요.
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{row.keyword}</span>
              {row.popularity_score != null && (
                <span className="stamp-badge border-stamp-amber text-stamp-amber bg-stamp-amber/5">
                  인기도 {row.popularity_score}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
              <span>{row.platform}</span>
              <span>·</span>
              <span>{row.source_type}</span>
              <span>·</span>
              <span>{row.category}</span>
            </div>
            {row.note && <p className="mt-1 text-xs text-ink/60">{row.note}</p>}
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '리포트 수정' : '리포트 추가'}>
        <form onSubmit={handleSave}>
          <FormField label="키워드" required value={form.keyword} onChange={(v) => setForm({ ...form, keyword: v })} />
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="플랫폼"
              type="select"
              options={PLATFORM_OPTIONS}
              value={form.platform}
              onChange={(v) => setForm({ ...form, platform: v })}
            />
            <FormField
              label="수집 방식"
              type="select"
              options={SOURCE_OPTIONS}
              value={form.source_type}
              onChange={(v) => setForm({ ...form, source_type: v })}
            />
          </div>
          <FormField
            label="카테고리"
            type="select"
            options={CATEGORY_OPTIONS}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <FormField
            label="인기도 점수"
            type="number"
            value={form.popularity_score}
            onChange={(v) => setForm({ ...form, popularity_score: v })}
          />
          <FormField label="메모" type="textarea" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 리포트를 삭제할까요? 휴지통으로 이동해요.')
                  if (!ok) return
                  await deleteRow(editing.id)
                  setModalOpen(false)
                }}
                className="text-sm text-stamp-reject hover:underline"
              >
                삭제
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <SaveStatusIndicator status={saveStatus} />
              <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
