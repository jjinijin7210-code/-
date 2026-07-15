import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'

// content_drafts.images 배열 안에 kind:'video'로 저장된 항목들을 전부 모아서
// 초안 하나하나를 열어보지 않아도 만든 영상을 한 화면에서 다 볼 수 있게 해요.
export default function VideoVault() {
  const { rows: drafts, loading, error } = useSupabaseTable('content_drafts')
  const [filterPlatform, setFilterPlatform] = useState('전체')

  const videos = useMemo(() => {
    const list = []
    for (const draft of drafts) {
      for (const img of draft.images || []) {
        if (img.kind !== 'video') continue
        list.push({
          id: img.id || `${draft.id}-${img.data_url}`,
          url: img.data_url,
          filename: img.filename,
          note: img.note,
          createdAt: img.created_at || draft.created_at,
          draftId: draft.id,
          draftTitle: draft.title,
          platform: draft.platform,
          status: draft.status,
        })
      }
    }
    return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  }, [drafts])

  const platforms = useMemo(() => ['전체', ...new Set(videos.map((v) => v.platform).filter(Boolean))], [videos])
  const filtered = filterPlatform === '전체' ? videos : videos.filter((v) => v.platform === filterPlatform)

  return (
    <div>
      <PageHeader
        title="영상 보관함"
        emoji="🎬"
        description="콘텐츠 관리에서 자동 제작된 영상들을 한 화면에 모아서 볼 수 있어요"
      />

      <div className="mb-4 rounded-lg border border-stamp-amber/30 bg-stamp-amber/5 p-3 text-xs text-ink/60">
        ⚠️ 영상은 서버 디스크에 임시 저장돼요. 재배포·재시작되면 사라질 수 있으니, 마음에 드는 영상은 다운로드해서 따로 보관해주세요.
      </div>

      {platforms.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <select
            value={filterPlatform}
            onChange={(e) => setFilterPlatform(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-xs"
          >
            {platforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && filtered.length === 0 && (
        <EmptyView label="아직 만들어진 영상이 없어요. 콘텐츠 관리에서 영상을 생성해보세요." />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((v) => (
          <div key={v.id} className="overflow-hidden rounded-xl bg-paper-card shadow-card">
            <video src={v.url} controls className="aspect-[9/16] w-full bg-black object-contain" />
            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <Link to="/drafts" className="truncate text-sm font-semibold hover:text-stamp-amber">
                  {v.draftTitle || '(제목 없음)'}
                </Link>
                <StatusBadge status={v.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ink/50">
                <span>{v.platform}</span>
                {v.createdAt && (
                  <>
                    <span>·</span>
                    <span>{new Date(v.createdAt).toLocaleString('ko-KR')}</span>
                  </>
                )}
              </div>
              <a
                href={v.url}
                download={v.filename}
                className="mt-2 inline-block text-[11px] text-ink/60 underline decoration-dotted hover:text-stamp-amber"
              >
                다운로드
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
