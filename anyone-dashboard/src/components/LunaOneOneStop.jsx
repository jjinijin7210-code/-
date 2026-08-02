import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { generateDraft, generateAiImage } from '../lib/apiClient'
import { uploadDataUrlToStorage } from '../lib/attachments'

export default function LunaOneOneStop() {
  const drafts = useSupabaseTable('content_drafts', { select: 'id' })
  const [sourceType, setSourceType] = useState('url') // 'url' | 'youtube' | 'text'
  const [sourceInput, setSourceInput] = useState('')
  const [targetLang, setTargetLang] = useState('ko') // 'ko' | 'ja' | 'en'
  const [targetPlatform, setTargetPlatform] = useState('인스타/틱톡')

  const [loading, setLoading] = useState(false)
  const [stepStatus, setStepStatus] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleOneStopBuild = async () => {
    if (!sourceInput.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      let extractedTitle = ''
      let extractedText = sourceInput.trim()

      // Step 1: 루나원 추출 엔진 연동 (URL 또는 유튜브 자막)
      setStepStatus('1/4 루나원(Luna One) 엔진으로 소재 텍스트 추출 중...')
      if (sourceType === 'url') {
        try {
          const res = await fetch('/api/luna/extract/url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: sourceInput }),
          }).then((r) => r.json())
          if (res.text) {
            extractedTitle = res.title || ''
            extractedText = res.text
          }
        } catch (e) {
          console.warn('루나원 URL 추출 폴백:', e)
        }
      } else if (sourceType === 'youtube') {
        try {
          const res = await fetch('/api/luna/extract/youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: sourceInput }),
          }).then((r) => r.json())
          if (res.text) {
            extractedTitle = res.title || 'YouTube 영상 추출'
            extractedText = res.text
          }
        } catch (e) {
          console.warn('루나원 유튜브 자막 추출 폴백:', e)
        }
      }

      // Step 2: 애니원 AI 대본 변환
      setStepStatus(`2/4 애니원 AI 직원이 [${targetPlatform}] 맞춤 대본 작성 중...`)
      const langName = targetLang === 'ja' ? '일본어' : targetLang === 'en' ? '영어' : '한국어'
      const draft = await generateDraft({
        channel: targetPlatform,
        topic: extractedTitle || sourceInput.slice(0, 50),
        referenceNote: `[${langName} 원스톱 변환] 원문: ${extractedText.slice(0, 1500)}`,
      })

      // Step 3: 애니비드 AI 연출 이미지 렌더링
      setStepStatus('3/4 애니비드(AnyVid) 8K 시네마틱 이미지 생성 중...')
      const topicKeyword = extractedTitle || sourceInput.slice(0, 40)
      const imgRes = await generateAiImage({
        prompt: `${topicKeyword}, cinematic lighting, ultra detailed 8k photo, masterpiece`,
      })

      let imageUrl = null
      if (imgRes?.dataUrl) {
        const attachment = await uploadDataUrlToStorage(imgRes.dataUrl, {
          kind: 'image',
          filename: `luna-onestop-${Date.now()}.png`,
          note: topicKeyword,
        })
        imageUrl = attachment.data_url
      }

      // Step 4: 숏폼 비디오(.mp4) 합성 및 초안함 저장
      setStepStatus('4/4 Remotion 숏폼 동영상 합성 및 초안함 자동 보관 중...')
      let videoUrl = null
      try {
        const shortsRes = await fetch('/api/shorts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title || topicKeyword,
            imageUrls: [imageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800'],
            note: topicKeyword,
          }),
        }).then((r) => r.json())
        videoUrl = shortsRes.videoUrl
      } catch (e) {
        console.warn('쇼츠 렌더링 폴백:', e)
      }

      await drafts.insertRow({
        title: draft.title || `[루나원 원스톱] ${topicKeyword}`,
        body: draft.body,
        hashtags: draft.hashtags,
        platform: targetPlatform,
        category: '루나원 원스톱',
        status: '초안',
        images: imageUrl ? [{ data_url: imageUrl }] : [],
      })

      setResult({
        title: draft.title || topicKeyword,
        body: draft.body,
        hashtags: draft.hashtags,
        imageUrl,
        videoUrl: videoUrl || imageUrl,
      })

      setSourceInput('')
    } catch (err) {
      console.error(err)
      setError(err.message || '원스톱 시스템 생성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
      setStepStatus('')
    }
  }

  return (
    <section className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-paper-card via-paper-card to-indigo-500/5 p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">
            🌙
          </span>
          <div>
            <h2 className="text-base font-bold text-ink">루나원 + 애니원 + 애니비드 [원스톱 통합 엔진]</h2>
            <p className="text-xs text-ink/50">기사/유튜브/텍스트 하나로 5개국어 대본 + AI 이미지 + 숏폼 동영상(.mp4)을 한 번에 만듭니다.</p>
          </div>
        </div>
        <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-bold text-indigo-600">
          👑 3대 시스템 풀 연동
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-ink/60">소재 유형:</span>
          <button
            type="button"
            onClick={() => setSourceType('url')}
            className={`rounded-md px-3 py-1 font-semibold transition-all ${
              sourceType === 'url' ? 'bg-indigo-600 text-white' : 'bg-ink/5 text-ink/70 hover:bg-ink/10'
            }`}
          >
            🌐 기사/웹페이지 URL
          </button>
          <button
            type="button"
            onClick={() => setSourceType('youtube')}
            className={`rounded-md px-3 py-1 font-semibold transition-all ${
              sourceType === 'youtube' ? 'bg-indigo-600 text-white' : 'bg-ink/5 text-ink/70 hover:bg-ink/10'
            }`}
          >
            🎬 유튜브 링크 (자막 추출)
          </button>
          <button
            type="button"
            onClick={() => setSourceType('text')}
            className={`rounded-md px-3 py-1 font-semibold transition-all ${
              sourceType === 'text' ? 'bg-indigo-600 text-white' : 'bg-ink/5 text-ink/70 hover:bg-ink/10'
            }`}
          >
            ✍️ 직접 텍스트 입력
          </button>

          <span className="ml-auto font-bold text-ink/60">언어:</span>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1 text-xs text-ink focus:outline-none"
          >
            <option value="ko">🇰🇷 한국어</option>
            <option value="ja">🇯🇵 일본어</option>
            <option value="en">🇺🇸 영어</option>
          </select>

          <span className="font-bold text-ink/60">플랫폼:</span>
          <select
            value={targetPlatform}
            onChange={(e) => setTargetPlatform(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1 text-xs text-ink focus:outline-none"
          >
            <option value="인스타/틱톡">📱 인스타 / 틱톡 쇼츠</option>
            <option value="스레드">💬 스레드 (Threads)</option>
            <option value="네이버블로그">📝 네이버 블로그</option>
          </select>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            placeholder={
              sourceType === 'url'
                ? 'https://news.naver.com/... 웹페이지 주소를 입력하세요'
                : sourceType === 'youtube'
                ? 'https://www.youtube.com/watch?v=... 유튜브 링크를 입력하세요'
                : '아이디어나 텍스트 원문을 입력하세요'
            }
            value={sourceInput}
            onChange={(e) => setSourceInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleOneStopBuild()}
            className="flex-1 rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
          />
          <button
            onClick={handleOneStopBuild}
            disabled={loading || !sourceInput.trim()}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                <span>원스톱 생성 중...</span>
              </>
            ) : (
              <>
                <span>👑 원스톱 완성하기</span>
              </>
            )}
          </button>
        </div>

        {loading && (
          <div className="rounded-lg bg-indigo-500/10 p-3 text-center text-xs font-semibold text-indigo-600 animate-pulse">
            {stepStatus}
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-stamp-reject/10 p-3 text-xs font-semibold text-stamp-reject">
            ⚠️ {error}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-indigo-500/20 bg-white p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-ink/10 pb-2">
              <span className="text-xs font-bold text-indigo-600">🎉 [루나원+애니원+애니비드] 원스톱 제작 완료!</span>
              <span className="text-[11px] text-ink/40">콘텐츠 초안함 자동 저장됨</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-bold text-sm text-ink mb-1">{result.title}</h4>
                <p className="text-xs text-ink/80 whitespace-pre-line leading-relaxed bg-ink/5 p-3 rounded-md max-h-48 overflow-y-auto">
                  {result.body}
                </p>
                {result.hashtags && (
                  <p className="mt-2 text-xs font-medium text-indigo-600">{result.hashtags}</p>
                )}
              </div>

              <div className="flex flex-col items-center justify-center bg-black/5 rounded-md p-2">
                {result.videoUrl?.endsWith('.mp4') || result.videoUrl?.endsWith('.webm') ? (
                  <video src={result.videoUrl} controls autoPlay loop className="max-h-56 rounded shadow-md" />
                ) : (
                  <img src={result.imageUrl || result.videoUrl} alt="원스톱 연출 컷" className="max-h-56 rounded object-cover shadow-md" />
                )}
                <span className="mt-2 text-[11px] text-ink/50">원스톱 생성 미디어 프리뷰</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
