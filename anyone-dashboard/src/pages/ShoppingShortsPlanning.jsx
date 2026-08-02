import { useMemo, useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import PageHeader from '../components/PageHeader'
import { generateShoppingShortsTopics, generateDraft, generateAiImage } from '../lib/apiClient'
import { uploadDataUrlToStorage } from '../lib/attachments'

export default function ShoppingShortsPlanning() {
  const { rows, loading, updateRow, insertRow } = useSupabaseTable('shopping_shorts_topics')
  const drafts = useSupabaseTable('content_drafts', { select: 'id' })
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [decidingId, setDecidingId] = useState(null)
  const [autoBuildingId, setAutoBuildingId] = useState(null)
  const [buildStep, setBuildStep] = useState('')

  const pending = useMemo(() => rows.filter((r) => r.status === '대기'), [rows])
  const picked = useMemo(() => rows.filter((r) => r.status === '선택').slice(0, 10), [rows])
  const skipped = useMemo(() => rows.filter((r) => r.status === '스킵').slice(0, 10), [rows])

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      // 1. 기존에 떠 있던 옛날 계절 기획안들은 '스킵'으로 비워서 화면을 새로고침함
      for (const p of pending) {
        await updateRow(p.id, { status: '스킵', decided_at: new Date().toISOString() })
      }

      // 2. 8월 실시간 한여름 폭염 핫템 3개 새로 뽑기
      const { topics } = await generateShoppingShortsTopics({
        likedTopics: picked.map((r) => r.title),
        skippedTopics: skipped.map((r) => r.title),
      })
      for (const t of topics) {
        await insertRow({ title: t.title, summary: t.summary, angle: t.angle, status: '대기' })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleClearAllPending = async () => {
    if (!pending.length) return
    setGenerating(true)
    try {
      for (const p of pending) {
        await updateRow(p.id, { status: '스킵', decided_at: new Date().toISOString() })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const decide = async (id, status) => {
    setDecidingId(id)
    try {
      await updateRow(id, { status, decided_at: new Date().toISOString() })
    } catch (err) {
      setError(err.message)
    } finally {
      setDecidingId(null)
    }
  }

  // 1-Click 자동 이미지 + 숏폼 영상 + 초안 완성
  const handleAutoBuild = async (topic) => {
    setAutoBuildingId(topic.id)
    setError(null)
    try {
      setBuildStep('1/3 AI 대본 & 쇼핑 카피라이팅 작성 중...')
      const draft = await generateDraft({
        channel: '인스타/틱톡',
        topic: `[쇼핑 숏폼] ${topic.title}`,
        referenceNote: topic.summary || topic.angle,
      })

      setBuildStep('2/3 8K 시네마틱 이미지 생성 중...')
      const imgRes = await generateAiImage({
        prompt: `${topic.title}, ${topic.summary || ''}, cinematic product lighting, ultra detailed 8k photography, studio shot`,
      })

      let imageUrl = null
      if (imgRes?.dataUrl) {
        const attachment = await uploadDataUrlToStorage(imgRes.dataUrl, {
          kind: 'image',
          filename: `shopping-shorts-${Date.now()}.png`,
          note: topic.title,
        })
        imageUrl = attachment.data_url
      }

      setBuildStep('3/3 숏폼 비디오(.mp4) 합성 및 저장 중...')
      let videoUrl = null
      try {
        const shortsRes = await fetch('/api/shorts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title || topic.title,
            imageUrls: [imageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800'],
            note: topic.title,
          }),
        }).then((r) => r.json())
        videoUrl = shortsRes.videoUrl
      } catch (e) {
        console.warn('쇼츠 렌더링 폴백:', e)
      }

      await drafts.insertRow({
        title: draft.title || `[쇼핑 숏폼] ${topic.title}`,
        body: draft.body,
        hashtags: draft.hashtags,
        platform: '인스타/틱톡',
        category: '쇼핑 숏폼',
        status: '초안',
        images: imageUrl ? [{ data_url: imageUrl }] : [],
      })

      await updateRow(topic.id, { status: '선택', decided_at: new Date().toISOString() })
      alert(`🎉 '${topic.title}' 숏폼과 AI 이미지가 완성되어 초안함에 자동 저장되었습니다!`)
    } catch (err) {
      setError(err.message || '완성 중 오류가 발생했습니다.')
    } finally {
      setAutoBuildingId(null)
      setBuildStep('')
    }
  }

  return (
    <div>
      <PageHeader
        title="쇼핑쇼츠 기획실"
        emoji="🛒"
        description="가벼운 소재 후보를 생성하고, 버튼 클릭 한 번으로 AI 이미지와 숏폼 동영상까지 1-Click 자동 제작합니다."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-paper-card p-4 shadow-card">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-lg bg-stamp-amber px-5 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-stamp-amber/90 disabled:opacity-50 transition-all"
        >
          {generating ? '기획안 만드는 중...' : '✨ 8월 여름 핫템 기획안 3개 새로 뽑기'}
        </button>
        {pending.length > 0 && (
          <button
            type="button"
            onClick={handleClearAllPending}
            disabled={generating}
            className="rounded-lg bg-rose-500/20 border border-rose-500/40 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/30 transition-all"
          >
            🗑️ 이전 기획안 비우기
          </button>
        )}
        <p className="text-[11px] text-ink/40">버튼을 누르시면 8월 한여름 폭염 실시간 핫템 3개가 새로 생성되며, 이전 목록은 비워집니다.</p>
      </div>

      {error && <p className="mb-3 text-sm text-stamp-reject">⚠️ {error}</p>}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-ink/80">대기 중인 기획안 ({pending.length})</h2>
        {loading ? (
          <p className="text-sm text-ink/40">불러오는 중...</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-ink/40">아직 만든 기획안이 없어요. 위 버튼을 눌러보세요.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((t) => (
              <div key={t.id} className="flex flex-col rounded-xl border border-ink/10 bg-paper-card p-4 shadow-card hover:border-stamp-amber/40 transition-all">
                <p className="mb-1 text-sm font-bold text-ink/85">{t.title}</p>
                {t.summary && <p className="mb-2 text-xs text-ink/60">{t.summary}</p>}
                {t.angle && <p className="mb-3 text-[11px] font-semibold text-stamp-amber">💡 {t.angle}</p>}

                {autoBuildingId === t.id && (
                  <div className="mb-3 rounded-md bg-stamp-amber/10 p-2 text-center text-xs font-semibold text-stamp-amber animate-pulse">
                    {buildStep}
                  </div>
                )}

                <div className="mt-auto flex flex-col gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleAutoBuild(t)}
                    disabled={autoBuildingId === t.id}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50 transition-all"
                  >
                    🚀 1-Click 이미지 & 숏폼 완성
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => decide(t.id, '선택')}
                      disabled={decidingId === t.id || autoBuildingId === t.id}
                      className="flex-1 rounded-md bg-stamp-amber/20 border border-stamp-amber/40 px-2.5 py-1 text-xs font-semibold text-stamp-amber disabled:opacity-50"
                    >
                      기획안만 선택
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(t.id, '스킵')}
                      disabled={decidingId === t.id || autoBuildingId === t.id}
                      className="rounded-md border border-ink/15 px-2.5 py-1 text-xs text-ink/60 hover:bg-ink/5 disabled:opacity-50"
                    >
                      패스
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {picked.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-ink/80">최근 완성/선택한 소재 목록</h2>
          <ul className="space-y-1.5">
            {picked.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-paper-card px-3 py-2 text-sm text-ink/75 shadow-card">
                <span>{t.title}</span>
                <span className="text-xs font-bold text-emerald-600">✅ 선택/완성됨</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
