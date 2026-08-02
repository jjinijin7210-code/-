import { useState } from 'react'
import { generateAiImage, generateDraft } from '../lib/apiClient'
import { uploadDataUrlToStorage } from '../lib/attachments'
import { useSupabaseTable } from '../hooks/useSupabaseTable'

export default function OneClickShoppingShorts() {
  const drafts = useSupabaseTable('content_drafts', { select: 'id' })
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('') // 'analyzing' | 'script' | 'image' | 'video' | ''
  const [result, setResult] = useState(null) // { title, body, hashtags, videoUrl, imageUrl }
  const [error, setError] = useState(null)

  const handleGenerate = async () => {
    if (!topic.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      // Step 1: AI 대본 & 카피라이팅 생성
      setStep('1/3 AI가 상품 특징 분석 및 시네마틱 숏폼 대본 작성 중...')
      const draft = await generateDraft({
        channel: '인스타/틱톡',
        topic: `[쇼핑 숏폼] ${topic}`,
        referenceNote: '시청 지속 시간이 긴 임팩트 있는 오프닝 후킹과 쇼핑 구매욕을 자극하는 구어체 카피라이팅',
      })

      // Step 2: AI 연출 컷 이미지 생성
      setStep('2/3 AI 시네마틱 대표 이미지 렌더링 중...')
      const imgRes = await generateAiImage({
        prompt: `${topic}, cinematic product lighting, ultra detailed 8k photography, studio shot, masterpiece`,
      })

      let imageUrl = null
      if (imgRes?.dataUrl) {
        const attachment = await uploadDataUrlToStorage(imgRes.dataUrl, {
          kind: 'image',
          filename: `shopping-shorts-${Date.now()}.png`,
          note: topic,
        })
        imageUrl = attachment.data_url
      }

      // Step 3: 쇼츠 동영상 렌더링 호출
      setStep('3/3 비디오 엔진으로 숏폼 동영상(.mp4) 합성 중...')
      let videoUrl = null;
      try {
        const shortsRes = await fetch('/api/shorts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title || topic,
            imageUrls: [imageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800'],
            note: topic,
          }),
        }).then(r => r.json())
        videoUrl = shortsRes.videoUrl
      } catch (e) {
        console.warn('쇼츠 렌더링 폴백:', e)
      }

      // DB 초안 등록 (content_drafts)
      await drafts.insertRow({
        title: draft.title || `[쇼핑 숏폼] ${topic}`,
        body: draft.body,
        hashtags: draft.hashtags,
        platform: '인스타/틱톡',
        category: '쇼핑 숏폼',
        status: '초안',
        images: imageUrl ? [{ data_url: imageUrl }] : [],
      })

      setResult({
        title: draft.title || topic,
        body: draft.body,
        hashtags: draft.hashtags,
        imageUrl,
        videoUrl: videoUrl || imageUrl,
      })

      setTopic('')
    } catch (err) {
      console.error(err)
      setError(err.message || '쇼핑 쇼츠 생성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
      setStep('')
    }
  }

  return (
    <section className="rounded-xl border border-stamp-amber/30 bg-gradient-to-br from-paper-card via-paper-card to-amber-500/5 p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stamp-amber text-white font-bold">
            🛍️
          </span>
          <div>
            <h2 className="text-base font-bold text-ink">1-Click 쇼핑 숏폼 원스톱 생성기</h2>
            <p className="text-xs text-ink/50">상품명이나 키워드 하나로 대본, AI 이미지, 숏폼 영상까지 1분 만에 완성합니다.</p>
          </div>
        </div>
        <span className="rounded-full border border-stamp-amber/40 bg-stamp-amber/10 px-2.5 py-1 text-[11px] font-bold text-stamp-amber">
          ⚡ 100% 원스톱 자동화
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="예: 쿠팡 무선 저소음 가습기, 감성 캠핑 램프, 스마트 텀블러"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
          className="flex-1 rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !topic.trim()}
          className="flex items-center justify-center gap-2 rounded-lg bg-stamp-amber px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-stamp-amber/90 disabled:opacity-50 transition-all"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
              <span>생성 중...</span>
            </>
          ) : (
            <>
              <span>🚀 1-Click 숏폼 생성</span>
            </>
          )}
        </button>
      </div>

      {loading && (
        <div className="mt-4 rounded-lg bg-stamp-amber/10 p-3 text-center text-xs font-semibold text-stamp-amber animate-pulse">
          {step}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-stamp-reject/10 p-3 text-xs font-semibold text-stamp-reject">
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div className="mt-5 rounded-lg border border-ink/10 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-ink/10 pb-2">
            <span className="text-xs font-bold text-emerald-600">✅ 숏폼 대본 & 미디어 생성 완료!</span>
            <span className="text-[11px] text-ink/40">콘텐츠 초안함에 자동 저장됨</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-bold text-sm text-ink mb-1">{result.title}</h4>
              <p className="text-xs text-ink/80 whitespace-pre-line leading-relaxed bg-ink/5 p-3 rounded-md max-h-48 overflow-y-auto">
                {result.body}
              </p>
              {result.hashtags && (
                <p className="mt-2 text-xs font-medium text-stamp-amber">{result.hashtags}</p>
              )}
            </div>

            <div className="flex flex-col items-center justify-center bg-black/5 rounded-md p-2">
              {result.videoUrl?.endsWith('.mp4') || result.videoUrl?.endsWith('.webm') ? (
                <video src={result.videoUrl} controls autoPlay loop className="max-h-56 rounded shadow-md" />
              ) : (
                <img src={result.imageUrl || result.videoUrl} alt="AI 숏폼 연출 컷" className="max-h-56 rounded object-cover shadow-md" />
              )}
              <span className="mt-2 text-[11px] text-ink/50">생성된 숏폼 미디어 프리뷰</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
