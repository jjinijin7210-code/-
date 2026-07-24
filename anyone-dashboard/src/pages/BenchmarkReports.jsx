import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import {
  searchYoutubeVideos,
  lookupYoutubeVideo,
  search1688Products,
  generateShorts,
  searchCoupangProducts,
  searchNaverShoppingProducts,
  fetchSourcingImage,
  generateDraft,
  reviewDraftWithAi,
} from '../lib/apiClient'
import { getCategoryForChannel } from '../lib/contentPreview'

const DURATION_OPTIONS = [
  { value: '', label: '전체 길이' },
  { value: 'short', label: '쇼츠(4분 미만)' },
  { value: 'long', label: '롱폼(20분 이상)' },
]
// 지역을 하나로 고정하지 않고 여러 나라를 한 번에 같이 확인함(2026-07-18 요청) - 체크박스 다중선택
const REGION_OPTIONS = [
  { value: 'US', label: '미국' },
  { value: 'KR', label: '한국' },
  { value: 'JP', label: '일본' },
]

function formatCount(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`
  return String(n)
}

const PLATFORM_OPTIONS = ['블로그', '스레드', '유튜브', '상품소싱']
const SOURCE_OPTIONS = ['공식 API', '트렌드 도구']
const CATEGORY_OPTIONS = ['인테리어/생활용품', '푸드쇼핑', '심리학']

const emptyForm = {
  keyword: '',
  platform: PLATFORM_OPTIONS[0],
  source_type: SOURCE_OPTIONS[0],
  category: CATEGORY_OPTIONS[0],
  popularity_score: '',
  note: '',
}

export default function BenchmarkReports() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('benchmark_reports', {
    orderBy: 'collected_at',
  })
  const { insertRow: insertContentDraft } = useSupabaseTable('content_drafts')
  const navigate = useNavigate()
  const { user } = useAuth()
  // 2026-07-24: 상품 소싱 검색(1688/쿠팡/네이버쇼핑)은 Apify 유료 크롤링이라, 지인 테스트
  // 계정한테는 막아둠(ContentDrafts.jsx의 AI 이미지 생성 제한과 같은 이유/같은 방식).
  const ownerUserId = import.meta.env.VITE_OWNER_USER_ID
  const isOwner = !ownerUserId || user?.id === ownerUserId
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const [query, setQuery] = useState('')
  const [duration, setDuration] = useState('')
  const [regions, setRegions] = useState(REGION_OPTIONS.map((o) => o.value)) // 기본으로 전부 체크 - 한 나라로 고정 안 함
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [results, setResults] = useState(null)

  const toggleRegion = (value) => {
    setRegions((prev) => (prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]))
  }

  // 검색이 아니라 직접 찾은 영상 URL을 바로 목록에 넣고 싶을 때 씀 (2026-07-19 요청)
  const [lookupUrl, setLookupUrl] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const runLookup = async (e) => {
    e.preventDefault()
    if (!lookupUrl.trim()) return
    setLookupLoading(true)
    setLookupError('')
    try {
      const video = await lookupYoutubeVideo(lookupUrl.trim())
      setResults((prev) => [video, ...(prev || []).filter((v) => v.videoId !== video.videoId)])
      setLookupUrl('')
    } catch (err) {
      setLookupError(err.message)
    } finally {
      setLookupLoading(false)
    }
  }

  const runSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearchError('')
    try {
      const videos = await searchYoutubeVideos({ query, minLikes: 10000, regionCodes: regions, videoDuration: duration || undefined })
      setResults(videos)
    } catch (err) {
      setSearchError(err.message)
      setResults(null)
    } finally {
      setSearching(false)
    }
  }

  const [sourcingQuery, setSourcingQuery] = useState('')
  const [sourcingSearching, setSourcingSearching] = useState(false)
  const [sourcingError, setSourcingError] = useState('')
  const [sourcingResults, setSourcingResults] = useState(null)

  const runSourcingSearch = async (e) => {
    e.preventDefault()
    if (!sourcingQuery.trim()) return
    setSourcingSearching(true)
    setSourcingError('')
    try {
      const products = await search1688Products({ query: sourcingQuery })
      setSourcingResults(products)
    } catch (err) {
      setSourcingError(err.message)
      setSourcingResults(null)
    } finally {
      setSourcingSearching(false)
    }
  }

  const [shortsState, setShortsState] = useState({}) // key(detailUrl) -> { loading, error, videoUrl }

  const makeShorts = async (product, key) => {
    setShortsState((prev) => ({ ...prev, [key]: { loading: true } }))
    try {
      const note = `가격: ${product.price || '-'} · 주문수: ${product.orderCount || '-'} · 재구매율: ${product.repurchaseRate || '-'}`
      const { videoUrl } = await generateShorts({
        title: product.title,
        imageUrls: [product.imageUrl].filter(Boolean),
        note,
      })
      setShortsState((prev) => ({ ...prev, [key]: { loading: false, videoUrl } }))
    } catch (err) {
      setShortsState((prev) => ({ ...prev, [key]: { loading: false, error: err.message } }))
    }
  }

  // 1688에서 소싱한 상품을 쿠팡에서 실제로 파는지 먼저 확인하고("승인 게이트"), 확인된
  // 상품만 사람이 직접 "초안 만들기"를 눌러야 AI 초안이 생성됨 (2026-07-19 요청 - 인포크
  // 파트너스 링크는 진희님이 직접 상품을 등록해서 만드는 구조라, 쿠팡에 없는 상품은
  // 애초에 진행하면 안 되고, 있는 상품도 자동으로 바로 게시하지 않고 승인을 거쳐야 함).
  const [coupangKeyword, setCoupangKeyword] = useState('')
  const [sourcingChannel, setSourcingChannel] = useState('인스타/틱톡')
  const [coupangCheckState, setCoupangCheckState] = useState({}) // key -> { loading, error, notFound, match, creatingDraft, imageChoice }

  const checkCoupang = async (product, key) => {
    if (!coupangKeyword.trim()) {
      setCoupangCheckState((prev) => ({ ...prev, [key]: { error: '쿠팡 확인용 한글 키워드를 먼저 입력해주세요.' } }))
      return
    }
    setCoupangCheckState((prev) => ({ ...prev, [key]: { loading: true } }))
    try {
      const products = await searchCoupangProducts({ query: coupangKeyword })
      const match = products[0]
      if (!match) {
        setCoupangCheckState((prev) => ({ ...prev, [key]: { notFound: true } }))
        return
      }
      setCoupangCheckState((prev) => ({ ...prev, [key]: { match, imageChoice: match.thumbnail ? 'coupang' : '1688' } }))
    } catch (err) {
      setCoupangCheckState((prev) => ({ ...prev, [key]: { error: err.message } }))
    }
  }

  const approveAndCreateDraft = async (product, key) => {
    const state = coupangCheckState[key]
    if (!state?.match) return
    setCoupangCheckState((prev) => ({ ...prev, [key]: { ...state, creatingDraft: true, createError: null } }))
    try {
      const { match, imageChoice } = state
      const priceText = match.price ? `${Number(match.price).toLocaleString('ko-KR')}원` : '정보 없음'
      const channel = sourcingChannel
      // 블로그는 본문에 실제 구매 링크를 바로 넣을 수 있지만(캡션만 되는 인스타/틱톡과 다름),
      // 링크가 실제로 있어야 의미가 있어서 쿠팡에 없는 상품은 애초에 이 흐름에 못 들어옴
      // (승인 게이트가 이미 막아줌) - 2026-07-19 요청, 상품소싱 블로그 글에 쿠팡 링크 기재.
      const topic = channel.startsWith('블로그')
        ? `상품명: ${product.title} (가격대: ${priceText})

[필수 지시사항] 본문 중 자연스러운 위치에 아래 구매 링크를 안내하는 문장을 반드시 포함해서 작성해줘
(링크 자체를 지어내지 말고 정확히 이 URL을 그대로 써): ${match.productUrl}`
        : `상품명: ${product.title} (가격대: ${priceText})

[필수 지시사항] 게시물 마지막 부분에 "댓글에 '정보'라고 남겨주시면 구매 링크 보내드릴게요!" 같은
자연스러운 유도 문구를 반드시 포함해서 작성해줘. 이게 없으면 안 돼.`
      const draft = await generateDraft({ channel, topic })
      // AI가 링크를 빼먹거나 다르게 적었을 가능성에 대비 - 검증된 쿠팡 링크가 본문에 정확히
      // 없으면 직접 붙여넣어서, 진희님이 콘텐츠 관리에서 확인하실 링크가 항상 맞게 만듦.
      if (channel.startsWith('블로그') && !draft.body.includes(match.productUrl)) {
        draft.body = `${draft.body}\n\n👉 구매 링크: ${match.productUrl}`
      }
      const review = await reviewDraftWithAi({ title: draft.title, body: draft.body, channel })

      const images = []
      const chosenUrl = imageChoice === '1688' ? product.imageUrl : match.thumbnail
      if (chosenUrl) {
        try {
          const dataUrl = await fetchSourcingImage(chosenUrl)
          images.push({
            id: crypto.randomUUID(),
            kind: 'image',
            filename: `sourced-${Date.now()}.jpg`,
            mime_type: 'image/jpeg',
            size: dataUrl.length,
            data_url: dataUrl,
            note: imageChoice === '1688' ? `1688 소싱 이미지 (${product.shopName || '-'})` : `쿠팡 상품 이미지 (${match.title})`,
            created_at: new Date().toISOString(),
          })
        } catch (imgErr) {
          console.error('[상품소싱] 이미지 첨부 실패, 텍스트만 저장:', imgErr.message)
        }
      }

      const saved = await insertContentDraft({
        title: draft.title,
        platform: channel,
        category: getCategoryForChannel(channel),
        body: draft.body,
        images,
        hashtags: draft.hashtags,
        source: `상품소싱 승인 완료 - 쿠팡: "${match.title}" (${match.productUrl}) / 1688: "${product.title}" (${product.detailUrl})`,
        status: review.result,
        review_opinion: review.reasons?.join(' / ') || (review.result === '통과' ? '문제 없음' : ''),
        reject_reason: review.result === '반려' ? review.reasons?.join(' / ') || '' : null,
      })
      navigate(`/drafts?id=${saved.id}`)
    } catch (err) {
      setCoupangCheckState((prev) => ({ ...prev, [key]: { ...state, creatingDraft: false, createError: err.message } }))
    }
  }

  // 네이버 쇼핑(스마트스토어) 소싱 - Apify 스크래핑(네이버 쇼핑 검색 공식 API는 2026-07-31부로
  // 대체 없이 완전 종료 예정이라 사용 불가, 1688/쿠팡과 동일한 방식으로 전환)이라 검색 결과에
  // 이미 실제 구매 링크가 들어있어서, 1688→쿠팡처럼 별도 존재 확인 단계 없이 바로 승인해서
  // 초안을 만들 수 있음 (2026-07-20 요청).
  const [naverQuery, setNaverQuery] = useState('')
  const [naverSearching, setNaverSearching] = useState(false)
  const [naverError, setNaverError] = useState('')
  const [naverResults, setNaverResults] = useState(null)
  const [naverChannel, setNaverChannel] = useState('블로그(네이버)-생활')
  const [naverApproveState, setNaverApproveState] = useState({}) // key -> { creatingDraft, createError }

  const runNaverSearch = async (e) => {
    e.preventDefault()
    if (!naverQuery.trim()) return
    setNaverSearching(true)
    setNaverError('')
    try {
      const products = await searchNaverShoppingProducts({ query: naverQuery })
      setNaverResults(products)
    } catch (err) {
      setNaverError(err.message)
      setNaverResults(null)
    } finally {
      setNaverSearching(false)
    }
  }

  const approveNaverAndCreateDraft = async (product, key) => {
    setNaverApproveState((prev) => ({ ...prev, [key]: { creatingDraft: true } }))
    try {
      const channel = naverChannel
      const priceText = product.price ? `${Number(product.price).toLocaleString('ko-KR')}원` : '정보 없음'
      // 블로그는 본문에 실제 구매 링크를 바로 넣고, 인스타/틱톡은 댓글 트리거 유도 문구로
      // (1688/쿠팡 소싱 흐름과 동일한 원칙 - 인포크 링크는 진희님이 직접 관리)
      const topic = channel.startsWith('블로그')
        ? `상품명: ${product.title} (가격대: ${priceText})

[필수 지시사항] 본문 중 자연스러운 위치에 아래 구매 링크를 안내하는 문장을 반드시 포함해서 작성해줘
(링크 자체를 지어내지 말고 정확히 이 URL을 그대로 써): ${product.productUrl}`
        : `상품명: ${product.title} (가격대: ${priceText})

[필수 지시사항] 게시물 마지막 부분에 "댓글에 '정보'라고 남겨주시면 구매 링크 보내드릴게요!" 같은
자연스러운 유도 문구를 반드시 포함해서 작성해줘. 이게 없으면 안 돼.`
      const draft = await generateDraft({ channel, topic })
      if (channel.startsWith('블로그') && !draft.body.includes(product.productUrl)) {
        draft.body = `${draft.body}\n\n👉 구매 링크: ${product.productUrl}`
      }
      const review = await reviewDraftWithAi({ title: draft.title, body: draft.body, channel })

      const images = []
      if (product.image) {
        try {
          const dataUrl = await fetchSourcingImage(product.image)
          images.push({
            id: crypto.randomUUID(),
            kind: 'image',
            filename: `naver-${Date.now()}.jpg`,
            mime_type: 'image/jpeg',
            size: dataUrl.length,
            data_url: dataUrl,
            note: `네이버 쇼핑 상품 이미지 (${product.mallName || '-'})`,
            created_at: new Date().toISOString(),
          })
        } catch (imgErr) {
          console.error('[네이버 쇼핑] 이미지 첨부 실패, 텍스트만 저장:', imgErr.message)
        }
      }

      const saved = await insertContentDraft({
        title: draft.title,
        platform: channel,
        category: getCategoryForChannel(channel),
        body: draft.body,
        images,
        hashtags: draft.hashtags,
        source: `네이버 쇼핑 소싱 승인 완료 - "${product.title}" (${product.productUrl})`,
        status: review.result,
        review_opinion: review.reasons?.join(' / ') || (review.result === '통과' ? '문제 없음' : ''),
        reject_reason: review.result === '반려' ? review.reasons?.join(' / ') || '' : null,
      })
      navigate(`/drafts?id=${saved.id}`)
    } catch (err) {
      setNaverApproveState((prev) => ({ ...prev, [key]: { creatingDraft: false, createError: err.message } }))
    }
  }

  const addProductToReport = (product) => {
    setEditing(null)
    setForm({
      keyword: product.title,
      platform: '상품소싱',
      source_type: '트렌드 도구',
      category: CATEGORY_OPTIONS[0],
      popularity_score: '',
      note: `가격: ${product.price || '-'} · 주문수: ${product.orderCount || '-'} · 판매자: ${product.shopName || '-'} · ${product.detailUrl || ''}`,
    })
    setModalOpen(true)
  }

  const addVideoToReport = (video) => {
    setEditing(null)
    setForm({
      keyword: video.title,
      platform: '유튜브',
      source_type: '공식 API',
      category: CATEGORY_OPTIONS[0],
      popularity_score: video.viewCount,
      note: `채널: ${video.channelTitle} · 조회수 ${formatCount(video.viewCount)} · 좋아요 ${formatCount(video.likeCount)} · ${video.url}`,
    })
    setModalOpen(true)
  }

  // 해외 유튜브 영상을 일본어 채널 초안으로 바로 연결 - 콘텐츠 관리(작업중→발행완료→
  // 일주일 후 자동 보관) 흐름을 그대로 타도록 content_drafts에 초안을 만들고 그 화면으로 이동시킴.
  // 원본을 그대로 번역하지 않고 재구성하라는 원칙(promptBuilder.js LOCALIZATION_RULES)은
  // 콘텐츠 관리의 "AI로 초안 생성"이 이미 강제하고 있어서 여기선 source에 출처만 남겨둠.
  const [creatingDraftId, setCreatingDraftId] = useState(null)
  const createJapaneseDraftFromVideo = async (video) => {
    setCreatingDraftId(video.videoId)
    try {
      const saved = await insertContentDraft({
        title: video.title,
        platform: '인스타/틱톡(일본어)',
        category: getCategoryForChannel('인스타/틱톡(일본어)'),
        body: '',
        images: [],
        status: '초안',
        source: `유튜브 벤치마킹 기반 (직역 금지, 참고만) - "${video.title}" · ${video.channelTitle} · 조회수 ${formatCount(video.viewCount)} · ${video.url}`,
      })
      navigate(`/drafts?id=${saved.id}`)
    } catch (err) {
      setSearchError(`초안 생성 실패: ${err.message}`)
    } finally {
      setCreatingDraftId(null)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="벤치마킹 리포트"
        emoji="🔍"
        description="리서처가 찾은 인기 키워드·주제 (매일 오전 10시 리포트 대상)"
        onAddClick={openAdd}
        addLabel="리포트 추가"
      />

      {/* 유튜브 인기 영상 검색 (조회수순, 좋아요 1만 개 이상만) */}
      <div className="mb-4 rounded-xl bg-paper-card p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-ink">🔎 유튜브 인기 영상 검색</h2>
        <form onSubmit={runSearch} className="flex flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
            placeholder="검색어 (예: winter home decor)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rounded-md border border-ink/15 px-2 py-2 text-sm"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            {DURATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={searching}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {searching ? '검색 중...' : '검색'}
          </button>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-ink/40">지역(여러 개 같이 확인):</span>
          {REGION_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-1 text-xs text-ink/70">
              <input type="checkbox" checked={regions.includes(o.value)} onChange={() => toggleRegion(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink/40">좋아요 1만 개 이상인 영상만, 체크한 나라들을 합쳐서 조회수 순으로 보여줘요.</p>

        <form onSubmit={runLookup} className="mt-3 flex flex-wrap gap-2 border-t border-ink/10 pt-3">
          <input
            className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
            placeholder="직접 찾은 영상 URL 붙여넣기 (예: https://www.youtube.com/watch?v=...)"
            value={lookupUrl}
            onChange={(e) => setLookupUrl(e.target.value)}
          />
          <button
            type="submit"
            disabled={lookupLoading}
            className="rounded-md border border-stamp-amber px-4 py-2 text-sm font-semibold text-stamp-amber hover:bg-stamp-amber/10 disabled:opacity-50"
          >
            {lookupLoading ? '가져오는 중...' : '+ 이 영상 목록에 추가'}
          </button>
        </form>
        {lookupError && <p className="mt-1 text-xs text-stamp-reject">{lookupError}</p>}

        {searchError && <p className="mt-3 text-xs text-stamp-reject">{searchError}</p>}

        {results && results.length === 0 && !searchError && (
          <p className="mt-3 text-xs text-ink/40">조건에 맞는 영상이 없어요 (좋아요 1만 개 이상 기준).</p>
        )}

        {results && results.length > 0 && (
          <div className="mt-3 space-y-2">
            {results.map((v) => (
              <div key={v.videoId} className="flex items-center gap-3 rounded-lg border border-ink/10 p-2">
                {v.thumbnail && <img src={v.thumbnail} alt="" className="h-12 w-20 flex-shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <a href={v.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:underline">
                    {v.title}
                  </a>
                  <p className="truncate text-xs text-ink/50">
                    {v.channelTitle} · 조회수 {formatCount(v.viewCount)} · 좋아요 {formatCount(v.likeCount)}
                    {v.region && <span className="ml-1 rounded bg-ink/5 px-1.5 py-0.5 text-[10px]">{v.region}</span>}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => addVideoToReport(v)}
                    className="rounded-md border border-stamp-amber px-3 py-1.5 text-xs font-semibold text-stamp-amber hover:bg-stamp-amber/10"
                  >
                    + 리포트에 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => createJapaneseDraftFromVideo(v)}
                    disabled={creatingDraftId === v.videoId}
                    className="rounded-md bg-stamp-amber px-3 py-1.5 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                  >
                    {creatingDraftId === v.videoId ? '이동 중...' : '🇯🇵 일본어 초안으로'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setResults((prev) => prev.filter((r) => r.videoId !== v.videoId))}
                    className="rounded-md px-3 py-1 text-[11px] text-ink/40 hover:text-stamp-reject"
                  >
                    ✕ 목록에서 제거
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isOwner && (
        <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-ink/60">
          이 계정에서는 상품 소싱 검색(1688/쿠팡/네이버쇼핑) 기능이 꺼져 있어요.
        </div>
      )}
      {isOwner && (
      <>
      {/* 1688 상품 소싱 검색 (베스트셀러순) */}
      <div className="mb-4 rounded-xl bg-paper-card p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-ink">📦 1688 상품 소싱 검색</h2>
        <form onSubmit={runSourcingSearch} className="flex flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
            placeholder="검색어 (예: 겨울 담요, 주방 정리용품)"
            value={sourcingQuery}
            onChange={(e) => setSourcingQuery(e.target.value)}
          />
          <button
            type="submit"
            disabled={sourcingSearching}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {sourcingSearching ? '검색 중...' : '검색'}
          </button>
        </form>
        <p className="mt-2 text-[11px] text-ink/40">주문량(수요) 기준 베스트셀러 순으로 보여줘요.</p>

        <div className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-2">
          <label className="mb-1 block text-[11px] font-semibold text-ink/60">🛒 쿠팡 확인용 한글 키워드</label>
          <input
            className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
            placeholder="예: 실리콘 주방매트 (아래 상품 중 하나를 고른 뒤 '쿠팡 확인'을 누르기 전에 입력해주세요)"
            value={coupangKeyword}
            onChange={(e) => setCoupangKeyword(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <label className="text-[11px] font-semibold text-ink/60">승인 시 만들 채널</label>
            <select
              className="rounded-md border border-ink/15 px-2 py-1 text-xs"
              value={sourcingChannel}
              onChange={(e) => setSourcingChannel(e.target.value)}
            >
              <option value="인스타/틱톡">인스타/틱톡 (댓글 트리거 유도 문구)</option>
              <option value="블로그(네이버)-생활">블로그(네이버)-생활 (본문에 쿠팡 링크 직접 기재)</option>
            </select>
          </div>
          <p className="mt-1 text-[11px] text-ink/40">
            쿠팡에서 실제로 파는 상품인지 먼저 확인하고, 승인해야만 AI 초안이 만들어져요 — 인포크 파트너스 링크는 직접 상품을 등록해서 만드셔야 하니, 그것부터 먼저 하고 오셔도 돼요. 블로그를 고르면 본문에 쿠팡 상품 링크가 바로 들어가요.
          </p>
        </div>

        {sourcingError && <p className="mt-3 text-xs text-stamp-reject">{sourcingError}</p>}

        {sourcingResults && sourcingResults.length === 0 && !sourcingError && (
          <p className="mt-3 text-xs text-ink/40">조건에 맞는 상품이 없어요.</p>
        )}

        {sourcingResults && sourcingResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {sourcingResults.map((p, i) => {
              const key = p.detailUrl || String(i)
              const shorts = shortsState[key]
              const coupangCheck = coupangCheckState[key]
              return (
                <div key={key} className="rounded-lg border border-ink/10 p-2">
                  <div className="flex items-center gap-3">
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="h-16 w-16 flex-shrink-0 rounded object-cover" />}
                    <div className="min-w-0 flex-1">
                      <a href={p.detailUrl} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:underline">
                        {p.title}
                      </a>
                      <p className="truncate text-xs text-ink/50">
                        {p.price} · 주문 {p.orderCount || 0}건 · 재구매율 {p.repurchaseRate || '-'} · {p.shopName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addProductToReport(p)}
                      className="flex-shrink-0 rounded-md border border-stamp-amber px-3 py-1.5 text-xs font-semibold text-stamp-amber hover:bg-stamp-amber/10"
                    >
                      + 리포트에 추가
                    </button>
                    <button
                      type="button"
                      disabled={shorts?.loading}
                      onClick={() => makeShorts(p, key)}
                      className="flex-shrink-0 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/80 disabled:opacity-50"
                    >
                      {shorts?.loading ? '제작 중...' : '🎬 쇼츠 만들기'}
                    </button>
                    <button
                      type="button"
                      disabled={coupangCheck?.loading}
                      onClick={() => checkCoupang(p, key)}
                      className="flex-shrink-0 rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 hover:bg-ink/5 disabled:opacity-50"
                    >
                      {coupangCheck?.loading ? '확인 중...' : '🛒 쿠팡 확인'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourcingResults((prev) => prev.filter((_, idx) => idx !== i))}
                      className="flex-shrink-0 rounded-md px-2 py-1 text-[11px] text-ink/40 hover:text-stamp-reject"
                    >
                      ✕
                    </button>
                  </div>
                  {shorts?.error && <p className="mt-2 text-xs text-stamp-reject">{shorts.error}</p>}
                  {shorts?.videoUrl && (
                    <video src={shorts.videoUrl} controls className="mt-2 max-h-80 rounded-lg" />
                  )}

                  {coupangCheck?.error && <p className="mt-2 text-xs text-stamp-reject">{coupangCheck.error}</p>}
                  {coupangCheck?.notFound && (
                    <p className="mt-2 text-xs text-stamp-reject">
                      쿠팡에서 '{coupangKeyword}' 판매 상품을 못 찾았어요. 이 상품은 넘어가거나 다른 키워드로 다시 확인해보세요.
                    </p>
                  )}
                  {coupangCheck?.match && (
                    <div className="mt-2 rounded-lg border border-stamp-amber/40 bg-stamp-amber/5 p-2">
                      <p className="mb-1 text-xs font-semibold text-ink/70">✅ 쿠팡에서 찾았어요 — 인포크 파트너스 링크를 먼저 등록해두셨다면 아래에서 승인해주세요.</p>
                      <div className="flex items-center gap-2">
                        {coupangCheck.match.thumbnail && (
                          <img src={coupangCheck.match.thumbnail} alt="" className="h-14 w-14 flex-shrink-0 rounded object-cover" />
                        )}
                        <div className="min-w-0 flex-1">
                          <a href={coupangCheck.match.productUrl} target="_blank" rel="noreferrer" className="block truncate text-sm text-ink hover:underline">
                            {coupangCheck.match.title}
                          </a>
                          <p className="text-xs text-ink/50">
                            {coupangCheck.match.price ? `${Number(coupangCheck.match.price).toLocaleString('ko-KR')}원` : '가격 정보 없음'}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink/60">
                        <span className="font-semibold">사용할 사진:</span>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={coupangCheck.imageChoice === 'coupang'}
                            onChange={() => setCoupangCheckState((prev) => ({ ...prev, [key]: { ...prev[key], imageChoice: 'coupang' } }))}
                          />
                          쿠팡 사진
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={coupangCheck.imageChoice === '1688'}
                            onChange={() => setCoupangCheckState((prev) => ({ ...prev, [key]: { ...prev[key], imageChoice: '1688' } }))}
                          />
                          1688 사진
                        </label>
                      </div>
                      <p className="mt-1 text-[11px] text-ink/40">
                        직접 찍거나 만든 사진을 쓰고 싶으면, 초안이 만들어진 뒤 "콘텐츠 관리"에서 사진을 바꿔 넣으실 수 있어요.
                      </p>
                      <button
                        type="button"
                        disabled={coupangCheck.creatingDraft}
                        onClick={() => approveAndCreateDraft(p, key)}
                        className="mt-2 rounded-md bg-stamp-amber px-4 py-2 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                      >
                        {coupangCheck.creatingDraft ? '초안 만드는 중...' : '✅ 승인하고 초안 만들기'}
                      </button>
                      {coupangCheck.createError && <p className="mt-2 text-xs text-stamp-reject">{coupangCheck.createError}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 네이버 쇼핑 상품 소싱 검색 (Apify 스크래핑 - 결과에 실제 구매 링크가 바로 포함됨) */}
      <div className="mb-4 rounded-xl bg-paper-card p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-ink">🛍️ 네이버 쇼핑 상품 소싱 검색</h2>
        <form onSubmit={runNaverSearch} className="flex flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-md border border-ink/15 px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
            placeholder="검색어 (예: 실리콘 주방매트)"
            value={naverQuery}
            onChange={(e) => setNaverQuery(e.target.value)}
          />
          <button
            type="submit"
            disabled={naverSearching}
            className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {naverSearching ? '검색 중...' : '검색'}
          </button>
        </form>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-[11px] font-semibold text-ink/60">승인 시 만들 채널</label>
          <select
            className="rounded-md border border-ink/15 px-2 py-1 text-xs"
            value={naverChannel}
            onChange={(e) => setNaverChannel(e.target.value)}
          >
            <option value="블로그(네이버)-생활">블로그(네이버)-생활 (본문에 네이버 상품 링크 직접 기재)</option>
          </select>
        </div>
        <p className="mt-2 text-[11px] text-ink/40">
          실제 스마트스토어 판매 상품이라 결과에 구매 링크가 바로 들어있어요 - 1688처럼 별도로 "실제 파는지 확인"하는 단계 없이 바로 승인하시면 돼요.
        </p>

        {naverError && <p className="mt-3 text-xs text-stamp-reject">{naverError}</p>}
        {naverResults && naverResults.length === 0 && !naverError && (
          <p className="mt-3 text-xs text-ink/40">조건에 맞는 상품이 없어요.</p>
        )}

        {naverResults && naverResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {naverResults.map((p, i) => {
              const key = p.productUrl || String(i)
              const approve = naverApproveState[key]
              return (
                <div key={key} className="rounded-lg border border-ink/10 p-2">
                  <div className="flex items-center gap-3">
                    {p.image && <img src={p.image} alt="" className="h-16 w-16 flex-shrink-0 rounded object-cover" />}
                    <div className="min-w-0 flex-1">
                      <a href={p.productUrl} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:underline">
                        {p.title}
                      </a>
                      <p className="truncate text-xs text-ink/50">
                        {p.price ? `${p.price.toLocaleString('ko-KR')}원` : '가격 정보 없음'} · {p.mallName || '-'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={approve?.creatingDraft}
                      onClick={() => approveNaverAndCreateDraft(p, key)}
                      className="flex-shrink-0 rounded-md bg-stamp-amber px-4 py-2 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
                    >
                      {approve?.creatingDraft ? '초안 만드는 중...' : '✅ 승인하고 초안 만들기'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNaverResults((prev) => prev.filter((_, idx) => idx !== i))}
                      className="flex-shrink-0 rounded-md px-2 py-1 text-[11px] text-ink/40 hover:text-stamp-reject"
                    >
                      ✕
                    </button>
                  </div>
                  {approve?.createError && <p className="mt-2 text-xs text-stamp-reject">{approve.createError}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
      </>
      )}

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView />}

      {/* 푸드 카테고리 이미지 소싱 원칙 리마인더 */}
      <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-ink/60">
        💡 푸드 상품 후보는 도매 사이트(1688, 도매꾹 등)·도우인 이미지만 참고하고, 한국 사이트 이미지는 사용하지 않아요.
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{row.keyword}</span>
              {row.popularity_score != null && (
                <span className="stamp-badge border-stamp-amber text-stamp-amber bg-stamp-amber/5">
                  인기도 {row.popularity_score}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/50">
              <span>{row.platform}</span>
              <span>·</span>
              <span>{row.source_type}</span>
              <span>·</span>
              <span>{row.category}</span>
            </div>
            {row.note && <p className="mt-1 text-xs text-ink/60">{row.note}</p>}
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '리포트 수정' : '리포트 추가'}>
        <form onSubmit={handleSave}>
          <FormField label="키워드" required value={form.keyword} onChange={(v) => setForm({ ...form, keyword: v })} />
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="플랫폼"
              type="select"
              options={PLATFORM_OPTIONS}
              value={form.platform}
              onChange={(v) => setForm({ ...form, platform: v })}
            />
            <FormField
              label="수집 방식"
              type="select"
              options={SOURCE_OPTIONS}
              value={form.source_type}
              onChange={(v) => setForm({ ...form, source_type: v })}
            />
          </div>
          <FormField
            label="카테고리"
            type="select"
            options={CATEGORY_OPTIONS}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <FormField
            label="인기도 점수"
            type="number"
            value={form.popularity_score}
            onChange={(v) => setForm({ ...form, popularity_score: v })}
          />
          <FormField label="메모" type="textarea" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 리포트를 삭제할까요? 휴지통으로 이동해요.')
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
              <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
