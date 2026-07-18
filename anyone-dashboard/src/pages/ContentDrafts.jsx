import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  parseHashtags,
} from '../lib/contentPreview'
import {
  generateDraft,
  translateDraft,
  reviewDraftWithAi,
  autoFixAndReview,
  getBloggerStatus,
  publishToBlogger,
  getGoogleConnectUrl,
  generateAiImage,
  generateSimilarImage,
  searchPexelsPhotos,
  fetchPexelsImage,
  openInstagramLogin,
  prepareInstagramPost,
  openTiktokLogin,
  prepareTiktokPost,
} from '../lib/apiClient'
import { compressImageFile, fileToDataUrl } from '../lib/attachments'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'

const STATUS_OPTIONS = ['초안', '검수중', '통과', '반려', '발행완료']
const PLATFORM_OPTIONS = PREVIEW_PLATFORMS
// 발행/통과로 넘어가려면 반드시 안전 원칙 체크가 되어 있어야 함
const PASS_LIKE_STATUSES = ['통과', '발행완료']
// 중복 정리할 때 같은 제목이 여러 개면 이 순위가 가장 높은 것만 남김 (이미 업로드 완료한 건 항상 보호)
const STATUS_RANK = { 발행완료: 5, 통과: 4, 검수중: 3, 반려: 2, 초안: 1 }
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
  needs_custom_image: false,
  needs_inpock_registration: false,
}

export default function ContentDrafts() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('content_drafts')
  const { rows: csLinks } = useSupabaseTable('cs_links')
  const { insertRow: insertReviewLog } = useSupabaseTable('review_log')
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()

  // 목록 보기: "작업중"(초안~반려까지) / "업로드 완료"(발행완료만, 따로 모아서 보관용) 탭
  const [listView, setListView] = useState('working')
  const workingRows = rows.filter((r) => r.status !== '발행완료')
  const archivedRows = rows.filter((r) => r.status === '발행완료')
  const visibleRows = listView === 'archive' ? archivedRows : workingRows

  const [dupMessage, setDupMessage] = useState(null)
  const [dupCleaning, setDupCleaning] = useState(false)
  const handleCleanupDuplicates = async () => {
    setDupMessage(null)
    const groups = {}
    for (const r of rows) {
      const key = `${r.platform}::${(r.title || '').trim()}`
      if (!groups[key]) groups[key] = []
      groups[key].push(r)
    }
    const dupGroups = Object.values(groups).filter((g) => g.length > 1)
    const toDelete = dupGroups.flatMap((g) => {
      const sorted = [...g].sort((a, b) => {
        const rankDiff = (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0)
        if (rankDiff !== 0) return rankDiff
        return new Date(a.created_at) - new Date(b.created_at)
      })
      return sorted.slice(1) // 그룹마다 순위 가장 높은 것 1개만 남기고 나머지는 삭제 대상
    })

    if (toDelete.length === 0) {
      setDupMessage({ type: 'success', text: '중복된 게시물이 없어요.' })
      return
    }

    const titles = toDelete.map((r) => `[${r.status}] ${r.title}`)
    const preview = titles.slice(0, 5).join(', ') + (titles.length > 5 ? ` 외 ${titles.length - 5}개` : '')
    const ok = await confirm(
      `제목·채널이 같은 중복 게시물 ${toDelete.length}개를 삭제할게요 (그룹마다 상태가 가장 좋은 것만 남겨요. 발행완료는 항상 보호돼요): ${preview}. 삭제하면 되돌릴 수 없어요, 진행할까요?`
    )
    if (!ok) return

    setDupCleaning(true)
    try {
      for (const r of toDelete) {
        await deleteRow(r.id)
      }
      setDupMessage({ type: 'success', text: `중복 게시물 ${toDelete.length}개를 삭제했어요.` })
    } catch (e) {
      setDupMessage({ type: 'error', text: `삭제 중 오류가 났어요: ${e.message}` })
    } finally {
      setDupCleaning(false)
    }
  }

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

  // 반려된(또는 수정한) 기존 초안을 고친 뒤 다시 AI 검수받기
  const [reReviewLoading, setReReviewLoading] = useState(false)
  const [reReviewError, setReReviewError] = useState(null)

  // 반려 사유를 사람이 직접 고치지 않고, AI가 스스로 고쳐서 통과할 때까지 자동 재검수
  const [autoFixLoading, setAutoFixLoading] = useState(false)
  const [autoFixError, setAutoFixError] = useState(null)

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

  // 참고 사진을 올리면 그 느낌으로 비슷한 새 이미지를 AI가 다시 그려서 생성
  const [similarRefFile, setSimilarRefFile] = useState(null)
  const [similarPrompt, setSimilarPrompt] = useState('')
  const [similarLoading, setSimilarLoading] = useState(false)
  const [similarError, setSimilarError] = useState(null)

  const handleGenerateSimilarImage = async () => {
    if (!similarRefFile || !similarPrompt.trim()) return
    setSimilarLoading(true)
    setSimilarError(null)
    try {
      const compressed = await compressImageFile(similarRefFile)
      const refDataUrl = await fileToDataUrl(compressed)
      const { dataUrl } = await generateSimilarImage({ imageDataUrl: refDataUrl, prompt: similarPrompt })
      const attachment = {
        id: crypto.randomUUID(),
        kind: 'image',
        filename: `similar-${Date.now()}.png`,
        mime_type: 'image/png',
        size: dataUrl.length,
        data_url: dataUrl,
        note: `참고 사진 기반 생성: ${similarPrompt}`,
        created_at: new Date().toISOString(),
      }
      setForm((f) => ({ ...f, images: [...(f.images || []), attachment] }))
      setSimilarRefFile(null)
      setSimilarPrompt('')
    } catch (err) {
      setSimilarError(err.message)
    } finally {
      setSimilarLoading(false)
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

  // 인스타그램 자동 입력 (진희님 컴퓨터에서만 동작 - 실제 크롬 브라우저를 조작)
  const [igLoading, setIgLoading] = useState(false)
  const [igMessage, setIgMessage] = useState(null) // { type: 'success' | 'error', text }

  const handleOpenInstagramLogin = async () => {
    setIgLoading(true)
    setIgMessage(null)
    try {
      const result = await openInstagramLogin()
      setIgMessage({ type: 'success', text: result.message })
    } catch (err) {
      setIgMessage({ type: 'error', text: err.message })
    } finally {
      setIgLoading(false)
    }
  }

  const handlePrepareInstagramPost = async () => {
    const firstImage = (form.images || []).find((img) => img.kind === 'image')
    if (!firstImage) {
      setIgMessage({ type: 'error', text: '먼저 이미지를 1장 첨부해주세요.' })
      return
    }
    const hashtagText = parseHashtags(form.hashtags).join(' ')
    const caption = [form.body, hashtagText].filter(Boolean).join('\n\n')

    setIgLoading(true)
    setIgMessage(null)
    try {
      const result = await prepareInstagramPost({ caption, imageDataUrl: firstImage.data_url })
      setIgMessage({ type: 'success', text: result.message })
    } catch (err) {
      setIgMessage({
        type: 'error',
        text: err.loginRequired
          ? '인스타그램 로그인 창이 열렸어요! 화면에 뜬 창에서 로그인하신 뒤, 이 버튼을 한 번 더 눌러주세요.'
          : err.message,
      })
    } finally {
      setIgLoading(false)
    }
  }

  // 틱톡 자동 입력 (인스타그램과 같은 방식 - 다른 창/도메인이라 로그인은 따로 필요)
  const [ttLoading, setTtLoading] = useState(false)
  const [ttMessage, setTtMessage] = useState(null)

  const handleOpenTiktokLogin = async () => {
    setTtLoading(true)
    setTtMessage(null)
    try {
      const result = await openTiktokLogin()
      setTtMessage({ type: 'success', text: result.message })
    } catch (err) {
      setTtMessage({ type: 'error', text: err.message })
    } finally {
      setTtLoading(false)
    }
  }

  const handlePrepareTiktokPost = async () => {
    // 틱톡 스튜디오가 사진 업로드를 없애고 영상만 받아서, 사진 최대 3장을 짧은
    // 슬라이드쇼 영상으로 만들어 올림 (server/routes/tiktok.js의 composeSimpleSlideshow)
    const imageEntries = (form.images || []).filter((img) => img.kind === 'image').slice(0, 3)
    if (imageEntries.length === 0) {
      setTtMessage({ type: 'error', text: '먼저 이미지를 1~3장 첨부해주세요.' })
      return
    }
    const hashtagText = parseHashtags(form.hashtags).join(' ')
    const caption = [form.body, hashtagText].filter(Boolean).join('\n\n')

    setTtLoading(true)
    setTtMessage(null)
    try {
      const result = await prepareTiktokPost({
        caption,
        imageDataUrls: imageEntries.map((img) => img.data_url),
      })
      setTtMessage({ type: 'success', text: result.message })
    } catch (err) {
      setTtMessage({
        type: 'error',
        text: err.loginRequired
          ? '틱톡 로그인 창이 열렸어요! 화면에 뜬 창에서 로그인하신 뒤, 이 버튼을 한 번 더 눌러주세요.'
          : err.message,
      })
    } finally {
      setTtLoading(false)
    }
  }

  // 인스타그램/틱톡은 각자 전용 탭(server/lib/localBrowser.js)을 따로 쓰기 때문에
  // 순서대로 이어서 실행해도 서로 화면을 방해하지 않는다.
  const handlePrepareBothPosts = async () => {
    await handlePrepareInstagramPost()
    await handlePrepareTiktokPost()
  }

  // 인스타/틱톡은 실제 게시가 별도 브라우저 창에서 사람이 직접 눌러야 끝나기 때문에,
  // 여기서 "게시 완료" 버튼을 눌러줘야만 상태가 기록에 남는다 (안 누르면 계속 "통과"로 남아서
  // 나중에 뭘 올렸는지 헷갈리게 됨 - 진희님이 겪은 바로 그 문제).
  const [markPublishedMessage, setMarkPublishedMessage] = useState(null)
  const handleMarkPublished = async () => {
    setMarkPublishedMessage(null)
    if (!form.checked_no_real_person_image || !form.checked_no_overseas_reuse) {
      setMarkPublishedMessage({ type: 'error', text: '먼저 아래 "발행 전 안전 원칙 확인" 체크박스 두 개를 체크해주세요.' })
      return
    }
    const published = { status: '발행완료' }
    setForm((f) => ({ ...f, ...published }))
    if (editing) await updateRow(editing.id, { ...form, ...published })
    setMarkPublishedMessage({ type: 'success', text: '이 초안을 "발행완료"로 표시했어요.' })
  }

  // 완성된 초안(주로 한국어)을 다른 언어 채널로 번역해서 새 초안으로 복제 - 직역이 아니라
  // buildTranslateMessages(프롬프트 빌더)가 현지화해서 다시 씀. 원본은 그대로 두고 새 행을 추가함
  // (같은 영상/이미지를 그대로 여러 나라에 배포하는 흐름 - 자막/음성은 새 초안에서 각각 준비).
  const translateTargets = PLATFORM_OPTIONS.filter((p) => p.startsWith('인스타/틱톡') && p !== form.platform)
  const [translateChannel, setTranslateChannel] = useState('')
  const [translateLoading, setTranslateLoading] = useState(false)
  const [translateMessage, setTranslateMessage] = useState(null)
  const handleTranslate = async () => {
    setTranslateMessage(null)
    if (!translateChannel) {
      setTranslateMessage({ type: 'error', text: '번역할 언어 채널을 먼저 선택해주세요.' })
      return
    }
    if (!form.title || !form.body) {
      setTranslateMessage({ type: 'error', text: '원본 제목·본문이 먼저 있어야 번역할 수 있어요.' })
      return
    }
    setTranslateLoading(true)
    try {
      const translated = await translateDraft({
        targetChannel: translateChannel,
        title: form.title,
        body: form.body,
        hashtags: form.hashtags,
      })
      const newDraft = await insertRow({
        ...emptyForm,
        title: translated.title,
        body: translated.body,
        hashtags: translated.hashtags,
        platform: translateChannel,
        category: getCategoryForChannel(translateChannel),
        images: form.images,
        source: `${form.title} (초안 번역, 원본 채널: ${form.platform})`,
        author_name: 'AI 번역',
      })
      setTranslateMessage({
        type: 'success',
        text: `"${translateChannel}" 채널로 새 초안을 만들었어요. 목록에서 확인해보세요.`,
      })
      void newDraft
    } catch (e) {
      setTranslateMessage({ type: 'error', text: e.message })
    } finally {
      setTranslateLoading(false)
    }
  }

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
    setReReviewError(null)
    setAutoFixError(null)
    setIgMessage(null)
    setTtMessage(null)
    setMarkPublishedMessage(null)
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

  // 홈/아침 브리핑에서 "?id=..."로 들어오면 해당 초안을 바로 열어줌 (일일이 목록에서 찾을 필요 없게)
  useEffect(() => {
    const id = searchParams.get('id')
    if (!id) return
    const row = rows.find((r) => r.id === id)
    if (row) {
      openEdit(row)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, searchParams])

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

  // 반려 사유를 보고 제목/본문/이미지를 고친 뒤 눌러서 다시 AI 검수를 받는다 (기존엔 "저장"만
  // 누르면 상태가 그대로 남아있어서, 실제로 다시 확인받으려면 이 버튼을 눌러야 함)
  const handleReReview = async () => {
    setReReviewLoading(true)
    setReReviewError(null)
    try {
      const review = await reviewDraftWithAi({ title: form.title, body: form.body, channel: form.platform })
      setReviewResult(review)
      setForm((f) => ({
        ...f,
        status: review.result,
        review_opinion: review.reasons?.join(' / ') || (review.result === '통과' ? '문제 없음' : ''),
        reject_reason: review.result === '반려' ? review.reasons?.join(' / ') || '' : null,
      }))
    } catch (err) {
      setReReviewError(err.message)
    } finally {
      setReReviewLoading(false)
    }
  }

  // 반려 사유를 사람이 직접 안 고치고, AI가 스스로 고쳐서 통과할 때까지(최대 2번) 자동 재검수
  const handleAutoFix = async () => {
    setAutoFixLoading(true)
    setAutoFixError(null)
    try {
      const reasons = (form.reject_reason || '').split(' / ').filter(Boolean)
      const result = await autoFixAndReview({ title: form.title, body: form.body, channel: form.platform, reasons })
      setReviewResult(result.review)
      setForm((f) => ({
        ...f,
        title: result.title,
        body: result.body,
        status: result.review.result,
        review_opinion: result.review.reasons?.join(' / ') || (result.review.result === '통과' ? '문제 없음' : ''),
        reject_reason: result.review.result === '반려' ? result.review.reasons?.join(' / ') || '' : null,
      }))
    } catch (err) {
      setAutoFixError(err.message)
    } finally {
      setAutoFixLoading(false)
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
      const safetyChecked = form.checked_no_real_person_image && form.checked_no_overseas_reuse
      const published = {
        published_url: result.url || form.published_url,
        // 안전 원칙 체크가 안 되어 있으면 "발행완료"로 자동 전환하지 않음 (수동 저장 흐름과 동일한 기준 유지)
        status: safetyChecked ? '발행완료' : form.status,
      }
      setForm((f) => ({ ...f, ...published }))
      // "저장"을 따로 안 누르고 창을 닫아도 발행 상태가 기록에 남도록 바로 DB에도 반영
      if (editing) await updateRow(editing.id, { ...form, ...published })
      setPublishMessage({
        type: 'success',
        text: safetyChecked
          ? '구글 블로그에 발행했고, 상태도 "발행완료"로 바로 저장했어요.'
          : '구글 블로그에 발행했어요. (안전 원칙 체크를 안 하셔서 상태는 자동으로 안 바뀌었어요 - 체크 후 저장해주세요)',
      })
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

      {!loading && !error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-paper-card p-1 shadow-card">
            <button
              onClick={() => setListView('working')}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                listView === 'working' ? 'bg-stamp-amber text-white' : 'text-ink/60 hover:bg-ink/5'
              }`}
            >
              작업중 ({workingRows.length})
            </button>
            <button
              onClick={() => setListView('archive')}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                listView === 'archive' ? 'bg-stamp-amber text-white' : 'text-ink/60 hover:bg-ink/5'
              }`}
            >
              📦 업로드 완료 ({archivedRows.length})
            </button>
          </div>
          {listView === 'working' && (
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={handleCleanupDuplicates}
                disabled={dupCleaning}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm font-semibold text-ink/70 hover:bg-ink/5 disabled:opacity-50"
              >
                {dupCleaning ? '정리 중...' : '🧹 중복 정리'}
              </button>
              {dupMessage && (
                <p className={`text-[11px] ${dupMessage.type === 'success' ? 'text-stamp-pass' : 'text-stamp-reject'}`}>
                  {dupMessage.text}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && !error && visibleRows.length === 0 && <EmptyView />}

      <div className="space-y-2">
        {visibleRows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{row.title}</span>
              <div className="flex flex-wrap items-center gap-1">
                {row.needs_custom_image && (
                  <span className="stamp-badge border-stamp-amber text-stamp-amber bg-stamp-amber/5">🎨 이미지 필요</span>
                )}
                {row.needs_inpock_registration && (
                  <span className="stamp-badge border-stamp-amber text-stamp-amber bg-stamp-amber/5">🛒 인포크 등록 필요</span>
                )}
                <StatusBadge status={row.status} />
              </div>
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

            <div className="mb-2 rounded-md border border-ink/10 p-2">
              <p className="mb-1.5 text-[11px] font-semibold text-ink/50">
                📎 참고 사진을 올리면 그 느낌으로 비슷한(원본 그대로가 아닌 새로 그린) 이미지를 만들어요
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSimilarRefFile(e.target.files?.[0] || null)}
                  className="min-w-[160px] flex-1 text-xs"
                />
                <input
                  className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
                  placeholder="어떻게 비슷하게 만들지 (예: 같은 분위기로 다른 색 원피스)"
                  value={similarPrompt}
                  onChange={(e) => setSimilarPrompt(e.target.value)}
                />
                <button
                  type="button"
                  disabled={similarLoading || !similarRefFile || !similarPrompt.trim()}
                  onClick={handleGenerateSimilarImage}
                  className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                >
                  {similarLoading ? '생성 중...' : '🎨 비슷한 이미지 생성'}
                </button>
              </div>
              {similarError && <p className="mt-1.5 text-xs text-stamp-reject">{similarError}</p>}
            </div>

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

          {form.platform.startsWith('인스타/틱톡') && (
            <button
              type="button"
              onClick={handlePrepareBothPosts}
              disabled={igLoading || ttLoading || !form.body}
              className="my-3 w-full rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-ink/80 disabled:opacity-50"
            >
              {igLoading || ttLoading ? '처리 중...' : '📤 인스타 + 틱톡 한 번에 채우기 (각자 다른 탭에 순서대로)'}
            </button>
          )}

          {form.platform.startsWith('인스타/틱톡') && (
            <div className="mb-3">
              <button
                type="button"
                onClick={handleMarkPublished}
                className="w-full rounded-lg border border-stamp-pass/40 bg-stamp-pass/5 px-3 py-2 text-xs font-semibold text-stamp-pass hover:bg-stamp-pass/10"
              >
                ✅ 실제로 게시(공유) 눌렀어요 - 발행완료로 표시하기
              </button>
              {markPublishedMessage && (
                <p className={`mt-1 text-[11px] ${markPublishedMessage.type === 'success' ? 'text-stamp-pass' : 'text-stamp-reject'}`}>
                  {markPublishedMessage.text}
                </p>
              )}
            </div>
          )}

          {form.platform.startsWith('인스타/틱톡') && (
            <div className="my-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
              <p className="mb-1 text-xs font-bold text-ink/70">📷 인스타그램 자동 입력</p>
              <p className="mb-2 text-[11px] text-ink/40">
                이 컴퓨터에서만 동작해요 (Render 배포 사이트에서는 안 돼요). 버튼 하나만 누르면 사진·본문·해시태그를
                자동으로 채워줘요 (로그인이 안 되어 있으면 그때 뜨는 창에서 로그인하고 버튼을 한 번 더 누르면 돼요).
                마지막 "공유" 버튼만 인스타그램 창에서 직접 눌러주세요.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handlePrepareInstagramPost}
                  disabled={igLoading || !form.body}
                  className="rounded-md bg-stamp-amber px-3 py-2 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                >
                  {igLoading ? '처리 중...' : '📷 인스타그램에 사진·글 자동으로 채우기'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenInstagramLogin}
                  disabled={igLoading}
                  className="text-[11px] text-ink/40 underline decoration-dotted hover:text-stamp-amber disabled:opacity-50"
                >
                  (문제 있을 때만) 로그인 창만 다시 열기
                </button>
              </div>
              {igMessage && (
                <p className={`mt-2 text-[11px] ${igMessage.type === 'success' ? 'text-stamp-pass' : 'text-stamp-reject'}`}>
                  {igMessage.text}
                </p>
              )}
            </div>
          )}

          {form.platform.startsWith('인스타/틱톡') && (
            <div className="my-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
              <p className="mb-1 text-xs font-bold text-ink/70">🎵 틱톡 자동 입력</p>
              <p className="mb-2 text-[11px] text-ink/40">
                이 컴퓨터에서만 동작해요. 인스타그램과 같은 방식이지만 틱톡은 로그인을 따로 해야 해요 (처음 한 번만).
                틱톡이 사진 업로드를 없애서, 첨부한 사진(최대 3장)을 짧은 영상으로 자동으로 만들어서 올려요.
                마지막 "게시" 버튼만 틱톡 창에서 직접 눌러주세요.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handlePrepareTiktokPost}
                  disabled={ttLoading || !form.body}
                  className="rounded-md bg-stamp-amber px-3 py-2 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                >
                  {ttLoading ? '영상 만드는 중...' : '🎵 틱톡에 사진 → 영상으로 자동 업로드'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenTiktokLogin}
                  disabled={ttLoading}
                  className="text-[11px] text-ink/40 underline decoration-dotted hover:text-stamp-amber disabled:opacity-50"
                >
                  (문제 있을 때만) 로그인 창만 다시 열기
                </button>
              </div>
              {ttMessage && (
                <p className={`mt-2 text-[11px] ${ttMessage.type === 'success' ? 'text-stamp-pass' : 'text-stamp-reject'}`}>
                  {ttMessage.text}
                </p>
              )}
            </div>
          )}

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

          {editing && (
            <div className="my-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleReReview}
                  disabled={reReviewLoading || !form.title || !form.body}
                  className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                >
                  {reReviewLoading ? '검수 중...' : '🔄 다시 AI 검수받기'}
                </button>
                {form.status === '반려' && (
                  <button
                    type="button"
                    onClick={handleAutoFix}
                    disabled={autoFixLoading || !form.title || !form.body}
                    className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/80 disabled:opacity-50"
                  >
                    {autoFixLoading ? 'AI가 고치는 중...' : '🤖 AI가 알아서 고쳐서 재검수'}
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] text-ink/40">
                "다시 AI 검수받기"는 본인이 직접 고친 뒤 확인만 다시 받는 거예요. "AI가 알아서
                고쳐서 재검수"는 반려 사유를 보고 AI가 스스로 제목·본문을 고쳐서(최대 2번) 통과할
                때까지 시도해요. "저장"만 누르면 상태가 그대로 유지돼요.
              </p>
              {reReviewError && <p className="mt-2 text-xs text-stamp-reject">{reReviewError}</p>}
              {autoFixError && <p className="mt-2 text-xs text-stamp-reject">{autoFixError}</p>}
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

          {/* 아직 손이 더 가는 초안 표시 - 목록에서 배지로 바로 보여서 "이거 발행해도 되나?" 헷갈림 방지 */}
          <div className="my-3 space-y-2 rounded-lg border border-stamp-amber/30 bg-stamp-amber/5 p-3">
            <p className="text-xs font-bold text-stamp-amber">📋 추가로 할 일이 있나요?</p>
            <FormField
              type="checkbox"
              label="🎨 이미지를 따로(직접) 만들어야 해요"
              value={form.needs_custom_image}
              onChange={(v) => setForm({ ...form, needs_custom_image: v })}
            />
            <FormField
              type="checkbox"
              label="🛒 인포크에 이 상품을 먼저 등록해야 해요"
              value={form.needs_inpock_registration}
              onChange={(v) => setForm({ ...form, needs_inpock_registration: v })}
            />
          </div>

          {/* 다른 언어로 번역해서 새 초안 만들기 - 같은 이미지/영상으로 여러 나라에 배포할 때 씀 */}
          {editing && isLocalizationChannel(form.platform) && translateTargets.length > 0 && (
            <div className="my-3 rounded-lg border border-stamp-amber/30 bg-stamp-amber/5 p-3">
              <p className="mb-2 text-xs font-bold text-stamp-amber">🌐 다른 언어로 번역해서 새 초안 만들기</p>
              <p className="mb-2 text-[11px] text-ink/50">
                직역이 아니라 그 언어권 20대가 자연스럽게 느끼도록 다시 써요. 원본은 그대로 두고, 이미지는 그대로 가져간 새 초안이 만들어져요.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <FormField
                  type="select"
                  options={[{ value: '', label: '언어 선택' }, ...translateTargets]}
                  value={translateChannel}
                  onChange={setTranslateChannel}
                />
                <button
                  type="button"
                  onClick={handleTranslate}
                  disabled={translateLoading}
                  className="rounded-md bg-stamp-amber px-3 py-1.5 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                >
                  {translateLoading ? '번역 중...' : '번역해서 새 초안 만들기'}
                </button>
              </div>
              {translateMessage && (
                <p className={`mt-1 text-[11px] ${translateMessage.type === 'success' ? 'text-stamp-pass' : 'text-stamp-reject'}`}>
                  {translateMessage.text}
                </p>
              )}
            </div>
          )}

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
