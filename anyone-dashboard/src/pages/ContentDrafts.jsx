import { useEffect, useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import AttachmentSection from '../components/AttachmentSection'
import ContentPreview from '../components/ContentPreview'
import {
  PREVIEW_PLATFORMS,
  isValidUrl,
  appendRevision,
  getCategoryForChannel,
  isAiDraftChannel,
  isLocalizationChannel,
  isBloggerChannel,
} from '../lib/contentPreview'
import { generateDraft, reviewDraftWithAi, getBloggerStatus, publishToBlogger, getGoogleConnectUrl, generateAiImage, searchPexelsPhotos, fetchPexelsImage } from '../lib/apiClient'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'

const STATUS_OPTIONS = ['초안', '검수중', '통과', '반려', '발행완료']
const PLATFORM_OPTIONS = PREVIEW_PLATFORMS
// 발행/통과로 넘어가려면 반드시 안전 원칙 체크가 되어 있어야 함
const PASS_LIKE_STATUSES = ['통과', '발행완료']
const IMAGE_KIND = [
  { key: 'image', label: '이미지' },
  { key: 'video', label: '영상 (자동 합성)' },
]

const emptyForm = {
  title: '',
  platform: PLATFORM_OPTIONS[0],
  category: getCategoryForChannel(PLATFORM_OPTIONS[0]),
  body: '',
  images: [],
  hashtags: '',
  link: '',
  source: '',
  author_name: '',
  status: '초안',
  review_opinion: '',
  revision_history: [],
  scheduled_at: '',
  published_url: '',
  trigger_keyword: '',
  cs_link_id: '',
  reject_reason: '',
  checked_no_real_person_image: false,
  checked_no_overseas_reuse: false,
}

export default function ContentDrafts() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('content_drafts')
  const { rows: csLinks } = useSupabaseTable('cs_links')
  const { insertRow: insertReviewLog } = useSupabaseTable('review_log')
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState(null)
  const [revisionNote, setRevisionNote] = useState('')

  // AI 초안 생성 관련 상태
  const [aiTopic, setAiTopic] = useState('')
  const [aiReferenceNote, setAiReferenceNote] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [reviewResult, setReviewResult] = useState(null) // { result, reasons, checks }

  // AI 이미지 생성 관련 상태 (Luna에게 맡기지 않고 바로 생성)
  const [aiImagePrompt, setAiImagePrompt] = useState('')
  const [aiImageLoading, setAiImageLoading] = useState(false)
  const [aiImageError, setAiImageError] = useState(null)

  const handleGenerateImage = async () => {
    if (!aiImagePrompt.trim()) return
    setAiImageLoading(true)
    setAiImageError(null)
    try {
      const { dataUrl } = await generateAiImage({ prompt: aiImagePrompt })
      const attachment = {
        id: crypto.randomUUID(),
        kind: 'image',
        filename: `ai-${Date.now()}.png`,
        mime_type: 'image/png',
        size: dataUrl.length,
        data_url: dataUrl,
        note: aiImagePrompt,
        created_at: new Date().toISOString(),
      }
      setForm((f) => ({ ...f, images: [...(f.images || []), attachment] }))
      setAiImagePrompt('')
    } catch (err) {
      setAiImageError(err.message)
    } finally {
      setAiImageLoading(false)
    }
  }

  // 무료 스톡 사진(Pexels) 검색 관련 상태
  const [stockQuery, setStockQuery] = useState('')
  const [stockLoading, setStockLoading] = useState(false)
  const [stockError, setStockError] = useState(null)
  const [stockResults, setStockResults] = useState([])
  const [stockPickingId, setStockPickingId] = useState(null)

  const handleStockSearch = async () => {
    if (!stockQuery.trim()) return
    setStockLoading(true)
    setStockError(null)
    try {
      const photos = await searchPexelsPhotos({ query: stockQuery })
      setStockResults(photos)
    } catch (err) {
      setStockError(err.message)
    } finally {
      setStockLoading(false)
    }
  }

  const handlePickStockPhoto = async (photo) => {
    setStockPickingId(photo.id)
    setStockError(null)
    try {
      const dataUrl = await fetchPexelsImage(photo.full)
      const attachment = {
        id: crypto.randomUUID(),
        kind: 'image',
        filename: `pexels-${photo.id}.jpg`,
        mime_type: 'image/jpeg',
        size: dataUrl.length,
        data_url: dataUrl,
        note: `무료 스톡 사진 (Pexels · ${photo.photographer})`,
        created_at: new Date().toISOString(),
      }
      setForm((f) => ({ ...f, images: [...(f.images || []), attachment] }))
    } catch (err) {
      setStockError(err.message)
    } finally {
      setStockPickingId(null)
    }
  }

  // Blogger 연동 상태
  const [bloggerConnected, setBloggerConnected] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishMessage, setPublishMessage] = useState(null)

  useEffect(() => {
    if (modalOpen && isBloggerChannel(form.platform)) {
      getBloggerStatus().then((s) => setBloggerConnected(s.connected))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, form.platform])

  const resetAiState = () => {
    setAiTopic('')
    setAiReferenceNote('')
    setAiError(null)
    setReviewResult(null)
    setPublishMessage(null)
  }

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setRevisionNote('')
    setFormError(null)
    resetAiState()
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm({ ...emptyForm, ...row, cs_link_id: row.cs_link_id || '', images: row.images || [], revision_history: row.revision_history || [] })
    setRevisionNote('')
    setFormError(null)
    resetAiState()
    setModalOpen(true)
  }

  const handlePlatformChange = (platform) => {
    setForm({ ...form, platform, category: getCategoryForChannel(platform) })
    setReviewResult(null)
  }

  // "AI로 초안 생성" - 스레드/인스타·틱톡 채널 전용 (계획서 톤 원칙 + 인스타 현지화 재구성 원칙은 서버 프롬프트에서 처리)
  const handleGenerateDraft = async () => {
    if (!aiTopic.trim()) {
      setAiError('주제/키워드를 먼저 입력해주세요.')
      return
    }
    setAiLoading(true)
    setAiError(null)
    setReviewResult(null)
    try {
      const draft = await generateDraft({
        channel: form.platform,
        topic: aiTopic,
        referenceNote: isLocalizationChannel(form.platform) ? aiReferenceNote : undefined,
      })
      setForm((f) => ({ ...f, title: draft.title, body: draft.body, hashtags: draft.hashtags || f.hashtags, status: '검수중' }))
      // 생성 직후 자동으로 검수자 단계로 - AI 검수 호출
      await runAiReview({ title: draft.title, body: draft.body, channel: form.platform })
    } catch (err) {
      setAiError(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  // AI 자동 검수 - 팩트체크/과장표현/AI스러운 문체 체크 후 통과/반려 반영 + 검수 로그 기록
  const runAiReview = async ({ title, body, channel }) => {
    try {
      const review = await reviewDraftWithAi({ title, body, channel })
      setReviewResult(review)
      setForm((f) => ({
        ...f,
        status: review.result,
        review_opinion: review.reasons?.join(' / ') || (review.result === '통과' ? '문제 없음' : ''),
      }))
    } catch (err) {
      setAiError(`AI 검수 호출 실패: ${err.message}`)
    }
  }

  const handleConnectGoogle = () => {
    window.open(getGoogleConnectUrl(), '_blank', 'noopener,noreferrer')
  }

  const handlePublishToBlogger = async () => {
    setPublishLoading(true)
    setPublishMessage(null)
    try {
      const result = await publishToBlogger({ title: form.title, content: form.body, isDraft: false })
      setForm((f) => ({ ...f, published_url: result.url || f.published_url, status: '발행완료' }))
      setPublishMessage({ type: 'success', text: '구글 블로그에 발행했어요.' })
    } catch (err) {
      setPublishMessage({ type: 'error', text: err.message })
    } finally {
      setPublishLoading(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setFormError(null)

    // 안전 원칙 체크 없이는 통과/발행완료로 저장할 수 없도록 막기
    const needsCheck = PASS_LIKE_STATUSES.includes(form.status)
    if (needsCheck && (!form.checked_no_real_person_image || !form.checked_no_overseas_reuse)) {
      setFormError('통과·발행완료 상태로 저장하려면 아래 안전 원칙 체크를 모두 완료해야 해요.')
      return
    }
    // 링크/발행 URL 형식 검증
    if (!isValidUrl(form.link)) {
      setFormError('링크 형식이 올바르지 않아요 (http:// 또는 https://로 시작해야 해요).')
      return
    }
    if (!isValidUrl(form.published_url)) {
      setFormError('발행 URL 형식이 올바르지 않아요 (http:// 또는 https://로 시작해야 해요).')
      return
    }

    // 이번 수정 메모가 있으면 수정 이력에 남기고 저장 (없으면 이력 변화 없음)
    const revision_history = appendRevision(form.revision_history, revisionNote, form.author_name)
    const payload = { ...form, revision_history, cs_link_id: form.cs_link_id || null }

    let saved
    if (editing) {
      saved = await updateRow(editing.id, payload)
    } else {
      saved = await insertRow(payload)
    }

    // AI 검수 결과가 있으면 검수 로그에도 기록 (계획서 5장 검수 구조 - 2중3중 검수 단계별로 각각 기록)
    if (reviewResult && saved) {
      if (reviewResult.stages?.length > 0) {
        for (const stage of reviewResult.stages) {
          await insertReviewLog({
            draft_id: saved.id,
            reviewer_role: `검수자(AI) - ${stage.stage}`,
            check_type: stage.stage,
            result: stage.result,
            reason: stage.reasons?.join(' / ') || '',
          })
        }
      } else {
        await insertReviewLog({
          draft_id: saved.id,
          reviewer_role: '검수자(AI)',
          check_type: 'AI 자동검수',
          result: reviewResult.result,
          reason: reviewResult.reasons?.join(' / ') || '',
        })
      }
    }

    setRevisionNote('')
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="콘텐츠 관리"
        emoji="✍️"
        description="본문·이미지·해시태그부터 발행 URL까지, 채널별 미리보기와 함께 관리해요"
        onAddClick={openAdd}
        addLabel="초안 추가"
      />

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView />}

      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{row.title}</span>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
              <span>{row.platform}</span>
              {row.trigger_keyword && (
                <>
                  <span>·</span>
                  <span>키워드: "{row.trigger_keyword}"</span>
                </>
              )}
              {row.scheduled_at && (
                <>
                  <span>·</span>
                  <span>예약: {row.scheduled_at}</span>
                </>
              )}
            </div>
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '초안 수정' : '초안 추가'}>
        <form onSubmit={handleSave}>
          <FormField label="제목" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <FormField
            label="채널"
            type="select"
            options={PLATFORM_OPTIONS}
            value={form.platform}
            onChange={handlePlatformChange}
          />

          {/* AI로 초안 생성 - 스레드·인스타/틱톡 채널 전용 (텍스트 자동화 범위) */}
          {isAiDraftChannel(form.platform) && (
            <div className="my-3 rounded-lg border border-stamp-amber/30 bg-stamp-amber/5 p-3">
              <p className="mb-2 text-xs font-bold text-stamp-amber">🤖 AI로 초안 생성</p>
              <FormField
                label="주제/키워드"
                hint="예: 겨울 원피스 꿀템 추천"
                value={aiTopic}
                onChange={setAiTopic}
              />
              {isLocalizationChannel(form.platform) && (
                <FormField
                  label="참고한 해외 트렌드 포인트 (선택)"
                  type="textarea"
                  hint='원문 캡션이 아니라 "왜 인기 있는지" 요약만 적어주세요 - 원문 그대로 번역하지 않고 새로 재구성해요'
                  value={aiReferenceNote}
                  onChange={setAiReferenceNote}
                />
              )}
              {aiError && <p className="mb-2 text-xs text-stamp-reject">{aiError}</p>}
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={aiLoading}
                className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
              >
                {aiLoading ? '생성 중...' : '🤖 AI로 초안 생성'}
              </button>
              <p className="mt-2 text-[11px] text-ink/40">
                생성되면 자동으로 검수자(AI) 단계로 넘어가서 팩트체크·과장표현·AI스러운 문체를 체크해요.
              </p>
            </div>
          )}

          {/* AI 자동 검수 결과 */}
          {reviewResult && (
            <div
              className={`my-3 rounded-lg border p-3 text-xs ${
                reviewResult.result === '통과'
                  ? 'border-stamp-pass/30 bg-stamp-pass/5 text-stamp-pass'
                  : 'border-stamp-reject/30 bg-stamp-reject/5 text-stamp-reject'
              }`}
            >
              <p className="font-bold">AI 검수 결과: {reviewResult.result}</p>
              {reviewResult.reasons?.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {reviewResult.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <FormField label="본문" type="textarea" value={form.body} onChange={(v) => setForm({ ...form, body: v })} />

          <div className="my-3">
            <p className="mb-2 text-xs font-bold text-ink/70">🖼 이미지</p>
            <div className="mb-2 flex flex-wrap gap-2">
              <input
                className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
                placeholder="AI 이미지 설명 (예: 하얀 접시 위 겨울 담요, 따뜻한 조명, 상품 사진 스타일)"
                value={aiImagePrompt}
                onChange={(e) => setAiImagePrompt(e.target.value)}
              />
              <button
                type="button"
                disabled={aiImageLoading || !aiImagePrompt.trim()}
                onClick={handleGenerateImage}
                className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
              >
                {aiImageLoading ? '생성 중...' : '🎨 AI 이미지 생성'}
              </button>
            </div>
            {aiImageError && <p className="mb-2 text-xs text-stamp-reject">{aiImageError}</p>}

            <div className="mb-2 flex flex-wrap gap-2">
              <input
                className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
                placeholder="무료 스톡 사진 검색 (예: 바다, 도시 야경)"
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleStockSearch()
                  }
                }}
              />
              <button
                type="button"
                disabled={stockLoading || !stockQuery.trim()}
                onClick={handleStockSearch}
                className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
              >
                {stockLoading ? '검색 중...' : '🔍 스톡 사진 검색'}
              </button>
            </div>
            {stockError && <p className="mb-2 text-xs text-stamp-reject">{stockError}</p>}
            {stockResults.length > 0 && (
              <div className="mb-2 grid grid-cols-5 gap-2 sm:grid-cols-6">
                {stockResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePickStockPhoto(p)}
                    disabled={stockPickingId === p.id}
                    title={`사진: ${p.photographer}`}
                    className="group relative overflow-hidden rounded-md border border-ink/10 disabled:opacity-50"
                  >
                    <img src={p.thumb} alt="" className="h-16 w-full object-cover" />
                    {stockPickingId === p.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] text-white">
                        추가 중...
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <AttachmentSection attachments={form.images} kinds={IMAGE_KIND} onChange={(next) => setForm({ ...form, images: next })} />
            {isBloggerChannel(form.platform) && (
              <p className="mt-1 text-[11px] text-ink/40">
                구글 블로그는 이미지를 자동 삽입하지 않아요. 위에서 첨부한 이미지를 본문 원하는 위치에 직접 붙여넣어주세요.
              </p>
            )}
          </div>

          <FormField
            label="해시태그"
            hint="공백/쉼표로 구분해서 입력하면 자동으로 #이 붙어요 (예: 겨울코디 원피스)"
            value={form.hashtags}
            onChange={(v) => setForm({ ...form, hashtags: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <FormField label="링크" hint="http(s)://로 시작" value={form.link} onChange={(v) => setForm({ ...form, link: v })} />
            <FormField label="출처" value={form.source} onChange={(v) => setForm({ ...form, source: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="작성자" value={form.author_name} onChange={(v) => setForm({ ...form, author_name: v })} />
            <FormField
              label="예약 날짜"
              hint="예: 2026-07-20 10:00"
              value={form.scheduled_at}
              onChange={(v) => setForm({ ...form, scheduled_at: v })}
            />
          </div>
          <FormField
            label="발행 URL"
            hint="실제로 발행된 후 이 글의 주소"
            value={form.published_url}
            onChange={(v) => setForm({ ...form, published_url: v })}
          />

          {/* 구글 Blogger 발행 */}
          {isBloggerChannel(form.platform) && (
            <div className="my-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
              <p className="mb-2 text-xs font-bold text-ink/70">🔗 구글 블로그(Blogger) 발행</p>
              {bloggerConnected ? (
                <>
                  <p className="mb-2 text-[11px] text-stamp-pass">🟢 구글 계정이 연결되어 있어요.</p>
                  <button
                    type="button"
                    onClick={handlePublishToBlogger}
                    disabled={publishLoading || !form.title || !form.body}
                    className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                  >
                    {publishLoading ? '발행 중...' : '📤 구글 블로그로 발행'}
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-2 text-[11px] text-ink/50">아직 구글 계정이 연결되어 있지 않아요.</p>
                  <button
                    type="button"
                    onClick={handleConnectGoogle}
                    className="rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5"
                  >
                    구글 계정 연결하기
                  </button>
                </>
              )}
              {publishMessage && (
                <p className={`mt-2 text-[11px] ${publishMessage.type === 'success' ? 'text-stamp-pass' : 'text-stamp-reject'}`}>
                  {publishMessage.text}
                </p>
              )}
            </div>
          )}

          <FormField
            label="검수 의견"
            type="textarea"
            value={form.review_opinion}
            onChange={(v) => setForm({ ...form, review_opinion: v })}
          />

          <FormField
            label="상태"
            type="select"
            options={STATUS_OPTIONS}
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v })}
          />
          {form.status === '반려' && (
            <FormField
              label="반려 사유"
              type="textarea"
              value={form.reject_reason}
              onChange={(v) => setForm({ ...form, reject_reason: v })}
            />
          )}
          <FormField
            label="CS 트리거 키워드"
            hint='예: "핑크" — 댓글에 이 키워드가 오면 아래 CS 링크를 매칭'
            value={form.trigger_keyword}
            onChange={(v) => setForm({ ...form, trigger_keyword: v })}
          />
          <FormField
            label="연결할 CS 링크"
            type="select"
            options={[
              { value: '', label: '(연결 안 함)' },
              ...csLinks.map((l) => ({ value: l.id, label: `"${l.trigger_keyword}" → ${l.target_url}` })),
            ]}
            value={form.cs_link_id}
            onChange={(v) => setForm({ ...form, cs_link_id: v })}
          />

          {/* 수정 이력 - 지난 기록은 읽기 전용, 이번 저장에 남길 메모만 입력 가능 */}
          <div className="my-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
            <p className="mb-2 text-xs font-bold text-ink/70">🕘 수정 이력</p>
            {form.revision_history.length === 0 ? (
              <p className="mb-2 text-[11px] text-ink/30">아직 기록된 수정 이력이 없어요.</p>
            ) : (
              <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto text-[11px] text-ink/60">
                {form.revision_history.map((r, i) => (
                  <li key={i}>
                    <span className="text-ink/30">{new Date(r.edited_at).toLocaleString('ko-KR')}</span>
                    {r.editor && <span> · {r.editor}</span>} — {r.note}
                  </li>
                ))}
              </ul>
            )}
            <FormField
              label="이번 수정 내용 (저장하면 위 이력에 자동 기록돼요)"
              type="textarea"
              value={revisionNote}
              onChange={setRevisionNote}
            />
          </div>

          {/* 안전 원칙 체크 - 계획서 필수 항목, 통과/발행 전 반드시 체크 */}
          <div className="my-3 space-y-2 rounded-lg border border-stamp-reject/30 bg-stamp-reject/5 p-3">
            <p className="text-xs font-bold text-stamp-reject">⚠️ 발행 전 안전 원칙 확인</p>
            <FormField
              type="checkbox"
              label="실존 인물(가족 등) 사진 기반 이미지를 생성하지 않았어요"
              value={form.checked_no_real_person_image}
              onChange={(v) => setForm({ ...form, checked_no_real_person_image: v })}
            />
            <FormField
              type="checkbox"
              label="해외 원본 영상·이미지를 그대로 가공해 재사용하지 않았어요 (아이디어만 참고)"
              value={form.checked_no_overseas_reuse}
              onChange={(v) => setForm({ ...form, checked_no_overseas_reuse: v })}
            />
          </div>

          {/* 채널별 미리보기 */}
          <div className="my-3">
            <p className="mb-2 text-xs font-bold text-ink/70">👀 미리보기</p>
            <ContentPreview draft={form} />
          </div>

          {formError && <p className="mb-2 text-xs text-stamp-reject">{formError}</p>}

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 초안을 삭제할까요? 휴지통으로 이동해요.')
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
              <button
                type="submit"
                className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90"
              >
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
