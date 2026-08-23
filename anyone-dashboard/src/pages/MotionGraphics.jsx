import { useEffect, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader'
import {
  deleteMotionGraphic,
  getMotionGraphicStatus,
  getMotionGraphicTemplates,
  startMotionGraphicRender,
} from '../lib/apiClient'

// 설계 문서의 UI 흐름 그대로: 템플릿 선택 → 내용 입력 → 비율 → 길이 → 브랜드 색상 → 만들기.
// 렌더링은 서버 job으로 돌아가고 여기서 status를 폴링한다 ("AI 초안 자동생성" 로딩 패턴 재사용).
const ASPECT_LABELS = {
  vertical: '세로 9:16 (릴스/쇼츠)',
  horizontal: '가로 16:9 (유튜브)',
  square: '정사각 1:1',
}

// 템플릿 카드에 보여줄 미리보기 흉내 (실제 썸네일 이미지 대신 색/이모지로 구분)
const TEMPLATE_EMOJI = {
  milestone: '🎉',
  countup: '📈',
  comparison: '⚖️',
  quote: '💬',
  title: '🎬',
}

const POLL_INTERVAL_MS = 2000

export default function MotionGraphics() {
  const [meta, setMeta] = useState(null)
  const [metaError, setMetaError] = useState(null)

  const [templateId, setTemplateId] = useState('milestone')
  const [values, setValues] = useState({})
  const [aspect, setAspect] = useState('vertical')
  const [durationSec, setDurationSec] = useState(5)
  const [brandColor, setBrandColor] = useState('#6d28d9')
  const [useBrandColor, setUseBrandColor] = useState(true)

  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState([]) // [{ videoUrl, templateName, createdAt }]
  const pollTimer = useRef(null)

  useEffect(() => {
    getMotionGraphicTemplates()
      .then(setMeta)
      .catch((err) => setMetaError(err.message))
    return () => clearTimeout(pollTimer.current)
  }, [])

  const template = meta?.templates?.find((t) => t.id === templateId)

  const setField = (key, value) => setValues((prev) => ({ ...prev, [key]: value }))

  const pollStatus = (jobId, templateName) => {
    pollTimer.current = setTimeout(async () => {
      try {
        const status = await getMotionGraphicStatus(jobId)
        if (status.status === 'done') {
          setRendering(false)
          setResults((prev) => [{ videoUrl: status.videoUrl, templateName, createdAt: new Date() }, ...prev])
        } else if (status.status === 'error') {
          setRendering(false)
          setError(status.error || '렌더링에 실패했어요.')
        } else {
          pollStatus(jobId, templateName)
        }
      } catch (err) {
        setRendering(false)
        setError(err.message)
      }
    }, POLL_INTERVAL_MS)
  }

  const handleRender = async () => {
    if (!template) return
    setError(null)
    setRendering(true)
    try {
      const { jobId } = await startMotionGraphicRender({
        template: templateId,
        props: values,
        aspect,
        durationSec,
        brandColor: useBrandColor ? brandColor : undefined,
      })
      pollStatus(jobId, template.name)
    } catch (err) {
      setRendering(false)
      setError(err.message)
    }
  }

  const handleDelete = async (videoUrl) => {
    try {
      await deleteMotionGraphic(videoUrl)
      setResults((prev) => prev.filter((r) => r.videoUrl !== videoUrl))
    } catch (err) {
      setError(err.message)
    }
  }

  if (metaError) {
    return (
      <div>
        <PageHeader emoji="✨" title="모션그래픽 만들기" />
        <p className="rounded-lg border border-stamp-reject/40 bg-stamp-reject/5 p-4 text-sm text-stamp-reject">
          템플릿 목록을 불러오지 못했어요: {metaError} (백엔드 서버가 켜져 있는지 확인해 주세요)
        </p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        emoji="✨"
        title="모션그래픽 만들기"
        description="텍스트·숫자 애니메이션 카드를 서버에서 렌더링해 mp4로 받아요. 크레딧 소모 없이 서버 컴퓨팅만 사용해요."
      />

      {/* 1. 템플릿 선택 */}
      <section className="mb-5 rounded-xl bg-white p-5 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-ink">1. 템플릿 선택</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(meta?.templates || []).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTemplateId(t.id)
                setValues({})
              }}
              className={`rounded-lg border p-3 text-left transition-colors ${
                templateId === t.id
                  ? 'border-stamp-amber bg-stamp-amber/10'
                  : 'border-ink/10 hover:border-stamp-amber/50'
              }`}
            >
              <div className="text-2xl">{TEMPLATE_EMOJI[t.id] || '🎞️'}</div>
              <div className="mt-1 text-sm font-semibold text-ink">{t.name}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-ink/50">{t.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 2. 내용 입력 (템플릿별로 다름) */}
      {template && (
        <section className="mb-5 rounded-xl bg-white p-5 shadow-card">
          <h2 className="mb-3 text-sm font-bold text-ink">2. 내용 입력 — {template.name}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {template.fields.map((field) => (
              <label key={field.key} className="block text-sm">
                <span className="mb-1 block font-medium text-ink/80">
                  {field.label}
                  {field.required && <span className="ml-0.5 text-stamp-reject">*</span>}
                </span>
                {field.type === 'select' ? (
                  <select
                    value={values[field.key] ?? field.options[0]}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className="w-full rounded-lg border border-ink/15 px-3 py-2"
                  >
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === 'intro' ? '인트로' : opt === 'outro' ? '아웃트로' : opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    placeholder={field.example !== '' ? `예: ${field.example}` : ''}
                    className="w-full rounded-lg border border-ink/15 px-3 py-2"
                  />
                )}
              </label>
            ))}
          </div>
        </section>
      )}

      {/* 3~5. 비율 / 길이 / 브랜드 색상 */}
      <section className="mb-5 rounded-xl bg-white p-5 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-ink">3. 화면 비율 · 길이 · 색상</h2>
        <div className="flex flex-wrap items-end gap-5">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink/80">화면 비율</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="rounded-lg border border-ink/15 px-3 py-2">
              {(meta?.aspects || []).map((a) => (
                <option key={a} value={a}>
                  {ASPECT_LABELS[a] || a}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink/80">길이</span>
            <select
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
              className="rounded-lg border border-ink/15 px-3 py-2"
            >
              {(meta?.durations || [3, 5, 8]).map((d) => (
                <option key={d} value={d}>
                  {d}초
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useBrandColor} onChange={(e) => setUseBrandColor(e.target.checked)} />
            <span className="font-medium text-ink/80">브랜드 색상 적용</span>
            <input
              type="color"
              value={brandColor}
              disabled={!useBrandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="h-9 w-14 cursor-pointer rounded border border-ink/15"
            />
          </label>
        </div>
      </section>

      {/* 6. 만들기 → 폴링 → 결과 */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={handleRender}
          disabled={rendering || !template}
          className="rounded-lg bg-stamp-amber px-6 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-stamp-amber/90 disabled:opacity-50"
        >
          {rendering ? '렌더링 중… (몇 초~몇십 초 걸려요)' : '✨ 만들기'}
        </button>
        {rendering && (
          <span className="flex items-center gap-2 text-sm text-ink/60">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stamp-amber border-t-transparent" />
            서버에서 프레임을 그리는 중이에요…
          </span>
        )}
      </div>

      {error && (
        <p className="mb-5 rounded-lg border border-stamp-reject/40 bg-stamp-reject/5 p-3 text-sm text-stamp-reject">{error}</p>
      )}

      {results.length > 0 && (
        <section className="rounded-xl bg-white p-5 shadow-card">
          <h2 className="mb-3 text-sm font-bold text-ink">완성된 모션그래픽</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {results.map((r) => (
              <div key={r.videoUrl} className="rounded-lg border border-ink/10 p-3">
                <video src={r.videoUrl} controls className="w-full rounded" />
                <div className="mt-2 flex items-center justify-between text-xs text-ink/60">
                  <span>
                    {r.templateName} · {r.createdAt.toLocaleTimeString('ko-KR')}
                  </span>
                  <span className="flex gap-2">
                    <a href={r.videoUrl} download className="font-semibold text-stamp-amber hover:underline">
                      다운로드
                    </a>
                    <button onClick={() => handleDelete(r.videoUrl)} className="text-stamp-reject hover:underline">
                      삭제
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
