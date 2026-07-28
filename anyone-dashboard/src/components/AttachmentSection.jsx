import { useState } from 'react'
import { ATTACHMENT_KINDS as DEFAULT_KINDS, fileToAttachment } from '../lib/attachments'

function formatSize(bytes) {
  if (typeof bytes !== 'number') return null
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// attachments: 현재 첨부된 파일 배열, onChange: 배열이 바뀔 때마다 호출
// kinds: 첨부 종류 목록 (기본은 증거 첨부 5종류, June 캐릭터 화면에서는 앞/측/뒷면으로 재사용)
export default function AttachmentSection({
  attachments = [],
  onChange,
  kinds = DEFAULT_KINDS,
  onMarkAiImage,
  aiImageMarked = false,
}) {
  const [error, setError] = useState(null)
  const [zoomImage, setZoomImage] = useState(null)

  const handleFileSelect = async (kind, e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일 다시 선택 가능하도록
    if (!file) return
    setError(null)
    try {
      const attachment = await fileToAttachment(file, kind)
      onChange([...attachments, attachment])
    } catch (err) {
      setError(err.message)
    }
  }

  const handleRemove = (id) => {
    onChange(attachments.filter((a) => a.id !== id))
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-stamp-reject/10 p-2 text-xs text-stamp-reject">{error}</p>}
      {kinds.map(({ key, label }) => {
        const items = attachments.filter((a) => a.kind === key)
        return (
          <div key={key} className="rounded-lg border border-ink/10 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink/70">
                {label} <span className="text-ink/30">({items.length})</span>
              </span>
              <div className="flex items-center gap-2">
                {key === 'image' && onMarkAiImage && (
                  <button
                    type="button"
                    onClick={onMarkAiImage}
                    disabled={aiImageMarked}
                    className="rounded-md border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink/60 hover:bg-ink/5 disabled:opacity-40"
                  >
                    {aiImageMarked ? '✓ AI 이미지 문구 추가됨' : '🏷 AI 이미지예요 - 문구 추가'}
                  </button>
                )}
                <label className="cursor-pointer rounded-md border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink/60 hover:bg-ink/5">
                  + 파일 선택
                  <input type="file" className="hidden" onChange={(e) => handleFileSelect(key, e)} />
                </label>
              </div>
            </div>
            {items.length === 0 ? (
              <p className="text-[11px] text-ink/30">아직 첨부된 파일이 없어요.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((a) => (
                  <li key={a.id} className="space-y-1 text-[11px]">
                    {a.source_url && (
                      <a
                        href={a.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-ink/50 underline decoration-dotted hover:text-stamp-amber"
                      >
                        🔗 {a.source_url}
                      </a>
                    )}
                    {a.kind === 'video' && (
                      <video src={a.data_url} controls className="max-h-48 w-full rounded-md bg-black" />
                    )}
                    {a.kind === 'image' && (
                      <button
                        type="button"
                        onClick={() => setZoomImage(a)}
                        className="block w-full"
                        title="크게보기"
                      >
                        <img
                          src={a.data_url}
                          alt={a.filename}
                          className="max-h-48 w-full cursor-zoom-in rounded-md object-cover"
                        />
                      </button>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={a.data_url}
                        download={a.filename}
                        className="truncate text-ink/70 underline decoration-dotted hover:text-stamp-amber"
                      >
                        {a.filename}
                        {formatSize(a.size) && ` (${formatSize(a.size)})`}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleRemove(a.id)}
                        className="shrink-0 text-stamp-reject hover:underline"
                      >
                        제거
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-6"
          onClick={() => setZoomImage(null)}
        >
          <button
            type="button"
            onClick={() => setZoomImage(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
          >
            ✕ 닫기
          </button>
          <img
            src={zoomImage.data_url}
            alt={zoomImage.filename}
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={zoomImage.data_url}
            download={zoomImage.filename}
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg bg-stamp-amber px-5 py-2 text-sm font-bold text-white hover:bg-stamp-amber/90"
          >
            ⬇ 다운로드
          </a>
        </div>
      )}
    </div>
  )
}
