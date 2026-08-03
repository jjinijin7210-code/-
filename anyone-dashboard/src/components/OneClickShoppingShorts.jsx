import { useState } from 'react'
import { generateAiImage, generateDraft, generateDraftsFromSource, extractUrlContent } from '../lib/apiClient'
import { uploadDataUrlToStorage } from '../lib/attachments'
import { useSupabaseTable } from '../hooks/useSupabaseTable'

export default function OneClickShoppingShorts() {
  const drafts = useSupabaseTable('content_drafts', { select: 'id' })
  const [topic, setTopic] = useState('')
  const [productUrl, setProductUrl] = useState('')
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
      // 2026-08-03 요청: "링크도 확인될 수 있게" - 상품 링크를 넣으면 실제 페이지 내용을 가져와서
      // 그걸 근거로 쓰게 함(안 그러면 AI가 상품명만 보고 스펙/가격을 지어낼 위험이 있었음).
      // 링크 내용을 못 가져왔거나(사이트 차단 등) 너무 짧으면 그 내용을 AI한테 그대로
      // 넘기지 않고 키워드만으로 만드는 쪽으로 안전하게 폴백함(쿠팡 등 봇 차단이 걸린
      // 사이트에서 "Access Denied" 같은 엉뚱한 텍스트가 대본에 섞이는 걸 막기 위함).
      let sourceArticle = null
      if (productUrl.trim()) {
        setStep('1/3 상품 링크 내용 확인 중...')
        try {
          const extracted = await extractUrlContent(productUrl.trim())
          const candidate = `${extracted.title || ''}\n\n${extracted.text || ''}`.trim()
          const looksBlocked = /access denied|403 forbidden|접근이? 거부|권한이 없습니다/i.test(candidate)
          if (candidate.length >= 50 && !looksBlocked) {
            sourceArticle = candidate
          } else {
            console.warn('[쇼핑숏폼] 링크 내용을 제대로 못 가져와서 키워드만으로 진행:', candidate.slice(0, 100))
          }
        } catch (e) {
          console.warn('[쇼핑숏폼] 링크 확인 실패, 키워드만으로 진행:', e.message)
        }
      }

      let draft
      if (sourceArticle) {
        setStep('1/3 AI가 상품 특징 분석 및 시네마틱 숏폼 대본 작성 중...')
        const { results } = await generateDraftsFromSource({
          sourceArticle,
          channels: ['인스타/틱톡'],
          topic: `[쇼핑 숏폼] ${topic}`,
        })
        const found = results.find((r) => r.channel === '인스타/틱톡')
        if (!found || found.error) throw new Error(found?.error || '대본 생성에 실패했어요.')
        draft = found
      } else {
        setStep('1/3 AI가 상품 특징 분석 및 시네마틱 숏폼 대본 작성 중...')
        draft = await generateDraft({
          channel: '인스타/틱톡',
          topic: `[쇼핑 숏폼] ${topic}`,
          referenceNote: '시청 지속 시간이 긴 임팩트 있는 오프닝 후킹과 쇼핑 구매욕을 자극하는 구어체 카피라이팅',
        })
      }

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
            // 2026-08-03: 화면에 보여주는 대본(draft.body)이랑 실제 영상 나레이션이 서로 다른
            // AI 호출로 따로 만들어져서 내용이 어긋날 수 있었음 - 같은 대본을 그대로 내레이션에도 써서 일치시킴.
            narrationText: draft.body,
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

      <div className="mt-4 flex flex-col gap-3">
        <input
          type="text"
          placeholder="예: 쿠팡 무선 저소음 가습기, 감성 캠핑 램프, 스마트 텀블러"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
          className="rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
        />
        <input
          type="text"
          placeholder="상품 링크(선택) - 넣으면 실제 상품 페이지 내용(가격/스펙/후기)을 확인해서 만들어요"
          value={productUrl}
          onChange={(e) => setProductUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
          className="rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
        />
      </div>
      <div className="mt-3 flex justify-end">
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
