import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import { generateCardNews, renderCardNewsImages } from '../lib/apiClient'
import { uploadFileToStorage } from '../lib/attachments'

// 보관함 목록은 카드/이미지(base64) 같은 무거운 컬럼을 빼고 가볍게 조회 - content_drafts에서
// 이미 확인된 문제(무거운 컬럼 포함 select가 느려짐)를 피하기 위함 (useSupabaseTable.js 참고)
const LIST_SELECT = 'id, title, topic, card_count, created_at'

// 카드뉴스 전용 - AttachmentSection은 "증거 첨부" 카테고리 전용이라 재사용하지 않고,
// 사진 여러 장을 자유롭게 올리는 간단한 그리드를 새로 만듦.
function PhotoPicker({ photos, onChange }) {
  const [error, setError] = useState(null)

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setError(null)
    try {
      const added = await Promise.all(
        files.map(async (file) => {
          const attachment = await uploadFileToStorage(file, 'photo')
          return { dataUrl: attachment.data_url, caption: '' }
        })
      )
      onChange([...photos, ...added])
    } catch (err) {
      setError(err.message)
    }
  }

  const updateCaption = (idx, caption) => {
    onChange(photos.map((p, i) => (i === idx ? { ...p, caption } : p)))
  }

  const removePhoto = (idx) => {
    onChange(photos.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink/70">참고 사진 (선택)</label>
      <input type="file" accept="image/*" multiple onChange={handleFiles} className="text-xs" />
      {error && <p className="mt-1 text-xs text-stamp-reject">⚠️ {error}</p>}
      {photos.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((p, idx) => (
            <div key={idx} className="rounded-lg border border-ink/10 p-2">
              <img src={p.dataUrl} alt="" className="mb-1 h-20 w-full rounded object-cover" />
              <input
                type="text"
                placeholder="사진 설명 (선택)"
                value={p.caption}
                onChange={(e) => updateCaption(idx, e.target.value)}
                className="w-full rounded border border-ink/15 px-1.5 py-1 text-[11px]"
              />
              <button type="button" onClick={() => removePhoto(idx)} className="mt-1 text-[11px] text-stamp-reject hover:underline">
                제거
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CardNews() {
  const { rows, loading: listLoading, insertRow, deleteRow } = useSupabaseTable('card_news_drafts', { select: LIST_SELECT })
  const confirm = useConfirm()

  const [topic, setTopic] = useState('')
  const [sourceArticle, setSourceArticle] = useState('')
  const [cardCount, setCardCount] = useState(7)
  const [photos, setPhotos] = useState([])
  const [decoration, setDecoration] = useState('none')
  const [template, setTemplate] = useState('neon')

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null) // { title, cards, trendNote }

  const [rendering, setRendering] = useState(false)
  const [images, setImages] = useState([]) // PNG data URL 배열, cards와 순서 동일

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [copyMessage, setCopyMessage] = useState(null)

  const handleGenerate = async () => {
    if (!topic.trim() && !sourceArticle.trim()) {
      setError('주제 또는 원본 자료 중 하나는 입력해주세요.')
      return
    }
    setGenerating(true)
    setError(null)
    setDraft(null)
    setImages([])
    setSaveMessage(null)
    try {
      const result = await generateCardNews({ topic, sourceArticle, cardCount, photos })
      setDraft(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleRenderImages = async () => {
    if (!draft?.cards?.length) return
    setRendering(true)
    setError(null)
    try {
      const { images: rendered } = await renderCardNewsImages({ cards: draft.cards, photos, decoration, template })
      setImages(rendered)
    } catch (err) {
      setError(err.message)
    } finally {
      setRendering(false)
    }
  }

  // Storage URL은 앱과 다른 도메인이라 <a download>가 무시되고 그냥 새 탭에서 열려버림(브라우저
  // 보안 정책 - cross-origin 링크는 download 속성이 안 먹힘). blob으로 직접 받아서 같은 문서
  // 안의 blob: URL로 바꿔야 다운로드가 확실히 됨.
  const downloadImage = async (url, idx) => {
    const blob = await fetch(url).then((r) => r.blob())
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `${(draft?.title || '카드뉴스').replace(/[\\/:*?"<>|]/g, '')}-${idx + 1}.png`
    a.click()
    URL.revokeObjectURL(blobUrl)
  }

  const downloadAllImages = () => {
    images.forEach((dataUrl, idx) => downloadImage(dataUrl, idx))
  }

  // 2026-07-31 요청: "카드마다 사진 지정, 어디 넣는지 직관적으로 보이게" - AI가 자동으로 고른
  // 사진/아이콘을 카드별로 클릭 한 번에 바꿔 지정할 수 있게 함 (luna-one과 동일 패턴).
  const setCardVisual = (idx, visual) => {
    setDraft((d) => ({ ...d, cards: d.cards.map((c, i) => (i === idx ? { ...c, visual } : c)) }))
  }

  // 2026-08-02 요청: "카드뉴스 중간중간 설명을 넣어줄 수 있어?" - 네이버 블로그에 카드 이미지를
  // 붙여넣을 때 이미지 사이사이에 넣을 설명(blogText)을 이미지 넣을 위치와 함께 복사할 수 있게 함.
  const handleCopyText = async () => {
    if (!draft?.cards?.length) return
    const text = draft.cards
      .map((c) => `[카드 ${c.page} 이미지를 여기에 넣으세요]\n\n${c.blogText || c.body || ''}`)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopyMessage('블로그용 문구를 복사했어요.')
    } catch {
      setCopyMessage('복사에 실패했어요. 브라우저 권한을 확인해주세요.')
    }
  }

  const handleSave = async () => {
    if (!draft?.cards?.length) return
    setSaving(true)
    setSaveMessage(null)
    try {
      await insertRow({
        title: draft.title,
        topic: topic || null,
        cards: draft.cards,
        photos,
        images,
        card_count: cardCount,
      })
      setSaveMessage('보관함에 저장했어요.')
    } catch (err) {
      setSaveMessage(`저장 실패: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    const ok = await confirm('이 카드뉴스를 보관함에서 삭제할까요?')
    if (!ok) return
    setDeletingId(id)
    try {
      await deleteRow(id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <PageHeader title="카드뉴스" emoji="🗞️" description="주제나 원본 자료를 넣으면 표지 포함 여러 장의 카드뉴스를 만들고, 실제 PNG 이미지로 받을 수 있어요" />

      <div className="mb-4 space-y-3 rounded-xl bg-paper-card p-4 shadow-card">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/70">주제</label>
          <input
            type="text"
            placeholder="예: 울릉도 당일치기 여행 코스"
            className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/70">원본 자료 (선택 - 기사/후기 등)</label>
          <textarea
            rows={4}
            placeholder="참고할 원본 텍스트가 있으면 붙여넣어주세요 (없어도 주제만으로 생성돼요)"
            className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm"
            value={sourceArticle}
            onChange={(e) => setSourceArticle(e.target.value)}
          />
        </div>
        <div id="card-photo-picker-section">
          <PhotoPicker photos={photos} onChange={setPhotos} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink/70">카드 장수</label>
            <input
              type="number"
              min="3"
              max="12"
              className="w-20 rounded-md border border-ink/15 px-3 py-2 text-sm"
              value={cardCount}
              onChange={(e) => setCardCount(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {generating ? '생성 중...' : '🤖 카드뉴스 생성'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-stamp-reject/30 bg-stamp-reject/5 p-3 text-sm text-stamp-reject">⚠️ {error}</div>
      )}

      {draft && (
        <div className="mb-6 rounded-xl bg-paper-card p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-ink">{draft.title}</h2>
            <div className="flex gap-2">
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 focus:border-stamp-amber focus:outline-none"
              >
                <option value="neon">네온 그라데이션</option>
                <option value="minimal">미니멀 화이트</option>
                <option value="magazine">매거진 볼드</option>
                <option value="pastel">파스텔 소프트</option>
                <option value="navy">다크 네이비</option>
                <option value="mint">민트 프레시</option>
                <option value="coral">코랄 팝</option>
              </select>
              <select
                value={decoration}
                onChange={(e) => setDecoration(e.target.value)}
                className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 focus:border-stamp-amber focus:outline-none"
              >
                <option value="none">장식 없음</option>
                <option value="hearts">🩷 네온 하트</option>
                <option value="stars">🌟 파스텔 별</option>
                <option value="ribbon">🎀 리본 큐트</option>
                <option value="gold">✨ 골드 럭셔리</option>
              </select>
              <button
                type="button"
                onClick={handleRenderImages}
                disabled={rendering}
                className="rounded-md border border-stamp-amber px-3 py-1.5 text-xs font-semibold text-stamp-amber hover:bg-stamp-amber/10 disabled:opacity-50"
              >
                {rendering ? '이미지 만드는 중...' : '🖼️ 이미지로 만들기'}
              </button>
              {images.length > 0 && (
                <button type="button" onClick={downloadAllImages} className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 hover:bg-ink/5">
                  ⬇️ 전체 다운로드
                </button>
              )}
              <button type="button" onClick={handleCopyText} className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 hover:bg-ink/5">
                📋 블로그용 문구 복사
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 hover:bg-ink/5 disabled:opacity-50"
              >
                {saving ? '저장 중...' : '💾 보관함 저장'}
              </button>
            </div>
          </div>
          {draft.trendNote && <p className="mb-3 text-[11px] text-ink/40">반영된 트렌드: {draft.trendNote}</p>}
          {saveMessage && <p className="mb-3 text-xs text-ink/50">{saveMessage}</p>}
          {copyMessage && <p className="mb-3 text-xs text-ink/50">{copyMessage}</p>}

          {photos.length === 0 && (
            <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-stamp-amber/50 bg-stamp-amber/5 px-3 py-2 text-xs text-stamp-amber">
              📷 사진을 올리면 카드마다 원하는 사진을 직접 골라 넣을 수 있어요.
              <button
                type="button"
                onClick={() => document.getElementById('card-photo-picker-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="rounded-md border border-stamp-amber px-2 py-1 text-[11px] font-semibold text-stamp-amber hover:bg-stamp-amber/10"
              >
                사진 올리러 가기 ↑
              </button>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {draft.cards.map((card, idx) => {
              const v = card.visual || {}
              return (
                <div key={idx} className="overflow-hidden rounded-lg border border-ink/10">
                  {images[idx] ? (
                    <img src={images[idx]} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full flex-col justify-end bg-ink/90 p-3 text-white">
                      <p className="mb-1 text-[10px] font-bold text-white/60">POINT {idx + 1}</p>
                      <p className="text-xs font-bold leading-snug">{card.headline}</p>
                      <p className="mt-1 text-[10px] leading-snug text-white/70">{card.body}</p>
                    </div>
                  )}
                  {images[idx] && (
                    <button type="button" onClick={() => downloadImage(images[idx], idx)} className="w-full bg-ink/5 py-1 text-[11px] text-ink/70 hover:bg-ink/10">
                      다운로드
                    </button>
                  )}
                  {photos.length > 0 && (
                    <div className="flex flex-wrap gap-1 border-t border-ink/10 bg-ink/5 p-1.5">
                      <button
                        type="button"
                        title="아이콘 사용"
                        onClick={() => setCardVisual(idx, { ...v, type: 'icon' })}
                        className={`flex h-6 w-6 items-center justify-center rounded border text-xs ${v.type !== 'photo' ? 'border-stamp-amber ring-1 ring-stamp-amber' : 'border-ink/15'}`}
                      >
                        ⭐
                      </button>
                      {photos.map((p, pi) => (
                        <button
                          key={pi}
                          type="button"
                          title={`사진 ${pi + 1} 쓰기`}
                          onClick={() => setCardVisual(idx, { ...v, type: 'photo', photoIndex: pi })}
                          className={`h-6 w-6 overflow-hidden rounded border ${v.type === 'photo' && v.photoIndex === pi ? 'border-stamp-amber ring-1 ring-stamp-amber' : 'border-ink/15'}`}
                        >
                          <img src={p.dataUrl} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                  {card.blogText && (
                    <p className="border-t border-ink/10 bg-ink/5 p-1.5 text-[10px] leading-snug text-ink/60">📝 {card.blogText}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <h2 className="mb-2 text-sm font-bold text-ink/70">보관함</h2>
      {listLoading ? (
        <p className="text-xs text-ink/40">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink/40">저장된 카드뉴스가 없어요.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-ink/10 p-3">
              <div>
                <p className="text-sm font-medium text-ink">{r.title}</p>
                <p className="text-xs text-ink/40">
                  {r.card_count}장 · {new Date(r.created_at).toLocaleString('ko-KR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(r.id)}
                disabled={deletingId === r.id}
                className="text-xs text-stamp-reject hover:underline disabled:opacity-50"
              >
                {deletingId === r.id ? '삭제 중...' : '🗑️ 삭제'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
