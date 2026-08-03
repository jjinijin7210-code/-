// 백엔드 서버(server/)에 요청을 보내는 얇은 클라이언트.
// 개발 중에는 vite.config.js의 proxy 설정 덕분에 상대 경로(/api, /auth)로 바로 호출하면
// 자동으로 백엔드(기본 http://localhost:3001)로 전달됩니다.
// 배포 시에는 VITE_API_BASE_URL 환경변수로 실제 백엔드 주소를 지정해주세요.

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `요청이 실패했어요 (${res.status})`)
  }
  return data
}

// 스레드/인스타·틱톡용 AI 초안 생성
export function generateDraft({ channel, topic, referenceNote }) {
  return postJson('/api/draft', { channel, topic, referenceNote })
}

// 완성된 초안을 다른 언어 채널로 현지화(번역) - 직역이 아니라 그 언어권 표현으로 다시 씀
export function translateDraft({ targetChannel, title, body, hashtags }) {
  return postJson('/api/draft/translate', { targetChannel, title, body, hashtags })
}

// 기사/링크 등 원본 소재 하나를 여러 채널용으로 한 번에 변환 (returns { results: [{channel, title, body, hashtags, error?}], weatherNote })
export function generateDraftsFromSource({ sourceArticle, channels, topic }) {
  return postJson('/api/draft/from-source', { sourceArticle, channels, topic })
}

// 상품 링크(쿠팡 등) 실제 내용 가져오기 - 루나원 프록시 재사용 (returns { title, text })
export function extractUrlContent(url) {
  return postJson('/api/luna/extract/url', { url })
}

// 역사경제 유튜브(한국어) 영상을 실제로 제작해서 content_drafts에 바로 저장 (대본→내레이션→AI
// 일러스트→줌인/줌아웃 랜덤 합성이라 몇 분 걸림). topic을 주면(소재 직접 입력) 랜덤 주제풀 대신
// 그 소재로 만든다. format은 'long'(기본, 5~10분 롱폼) 또는 'shorts'.
export function generateHistoryEconomyVideoNow({ format = 'long', topic } = {}) {
  return postJson('/api/youtube/history-economy-video-run-manual', { format, topic })
}

// AI 자동 검수 (팩트체크/과장표현/AI스러운 문체)
export function reviewDraftWithAi({ title, body, channel }) {
  return postJson('/api/review', { title, body, channel })
}

// 반려된 초안을 반려 사유에 맞춰 AI가 스스로 고치고, 통과하거나 최대 시도 횟수까지 자동 재검수
export function autoFixAndReview({ title, body, channel, reasons }) {
  return postJson('/api/review/auto-fix', { title, body, channel, reasons })
}

// 구글 계정 연결 여부 확인
export async function getBloggerStatus() {
  const res = await fetch(`${API_BASE}/api/blogger/status`)
  if (!res.ok) return { connected: false }
  return res.json()
}

// Blogger로 실제 발행
export function publishToBlogger({ title, content, isDraft }) {
  return postJson('/api/blogger/publish', { title, content, isDraft })
}

// 구글 계정 연결 시작 URL (새 탭으로 열면 됨)
export function getGoogleConnectUrl() {
  return `${API_BASE}/auth/google`
}

// 유튜브 업로드용 구글 계정 연결 여부 확인 (Blogger와 같은 연결을 공유함)
export async function getYoutubeUploadStatus() {
  const res = await fetch(`${API_BASE}/api/youtube/upload-status`)
  if (!res.ok) return { connected: false }
  return res.json()
}

// 카드뉴스 텍스트(제목+카드 목록) 생성 - returns { title, cards, trendNote }
export function generateCardNews({ topic, sourceArticle, cardCount, photos }) {
  return postJson('/api/card-news/generate', { topic, sourceArticle, cardCount, photos })
}

// 생성된 카드를 실제 PNG 이미지 배열로 렌더링 - returns { images: [dataUrl, ...] }
export function renderCardNewsImages({ cards, photos, decoration, template }) {
  return postJson('/api/card-news/render-images', { cards, photos, decoration, template })
}

// 쇼핑쇼츠 기획실 - 가벼운 소재 후보 3개 생성 (최근 선택/스킵 이력을 취향 신호로 같이 보냄)
export function generateShoppingShortsTopics({ likedTopics, skippedTopics }) {
  return postJson('/api/shopping-shorts/topics/generate', { likedTopics, skippedTopics })
}

// 유튜브로 실제 영상 업로드
export function uploadToYoutube({ title, description, videoUrl, tags, privacyStatus }) {
  return postJson('/api/youtube/upload', { title, description, videoUrl, tags, privacyStatus })
}

// 유튜브 인기 영상 검색 (조회수순, 좋아요 minLikes 이상만)
// 검색이 아니라 직접 찾은 유튜브 영상 URL을 바로 가져올 때 씀
export async function lookupYoutubeVideo(url) {
  const params = new URLSearchParams({ url })
  const res = await fetch(`${API_BASE}/api/youtube/lookup?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `영상을 가져오지 못했어요 (${res.status})`)
  }
  return data.video
}

export async function searchYoutubeVideos({ query, minLikes = 10000, regionCodes, videoDuration }) {
  const params = new URLSearchParams({ q: query, minLikes: String(minLikes) })
  if (regionCodes?.length) params.set('regionCodes', regionCodes.join(','))
  if (videoDuration) params.set('videoDuration', videoDuration)
  const res = await fetch(`${API_BASE}/api/youtube/search?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `유튜브 검색이 실패했어요 (${res.status})`)
  }
  return data.videos || []
}

// 콘텐츠 DNA 분석 - 채널 URL 또는 영상 파일(2026-07-27, "파일 바로넣기" 요청) 넣으면
// 주제/톤/포맷 분석 + 비슷한 채널 추천/벤치마킹
export async function analyzeContentDna({ channelUrl, videoFile }) {
  const fd = new FormData()
  if (videoFile) fd.append('video', videoFile)
  else if (channelUrl) fd.append('channelUrl', channelUrl)
  const res = await fetch(`${API_BASE}/api/content-dna/analyze`, { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `분석이 실패했어요 (${res.status})`)
  return data
}

// 1688 상품 소싱 검색 (베스트셀러순 기본)
export async function search1688Products({ query, maxProducts, sortType }) {
  const params = new URLSearchParams({ q: query })
  if (maxProducts) params.set('maxProducts', String(maxProducts))
  if (sortType) params.set('sortType', sortType)
  const res = await fetch(`${API_BASE}/api/sourcing/1688?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `1688 상품 검색이 실패했어요 (${res.status})`)
  }
  return data.products || []
}

// 1688 소싱 상품이 쿠팡에도 실제로 팔리고 있는지 확인 (구매 링크를 붙이려면 쿠팡에 있어야 함)
export async function searchCoupangProducts({ query }) {
  const params = new URLSearchParams({ q: query })
  const res = await fetch(`${API_BASE}/api/sourcing/coupang?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `쿠팡 상품 확인이 실패했어요 (${res.status})`)
  }
  return data.products || []
}

// 네이버 쇼핑(스마트스토어) 상품 검색 - Apify 스크래핑, 결과에 실제 구매 링크가 바로 포함됨
export async function searchNaverShoppingProducts({ query, maxCrawlPages }) {
  const params = new URLSearchParams({ q: query })
  if (maxCrawlPages) params.set('maxCrawlPages', String(maxCrawlPages))
  const res = await fetch(`${API_BASE}/api/sourcing/naver-shopping?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `네이버 쇼핑 검색이 실패했어요 (${res.status})`)
  }
  return data.products || []
}

// 쿠팡/1688 검색 결과의 상품 이미지를 첨부용 data URL로 변환
export async function fetchSourcingImage(url) {
  const params = new URLSearchParams({ url })
  const res = await fetch(`${API_BASE}/api/sourcing/fetch-image?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `이미지를 불러오지 못했어요 (${res.status})`)
  }
  return data.dataUrl
}

// 쇼츠 자동 제작 (상품 이미지 + 스크립트/내레이션 자동 생성 → mp4 렌더링)
export async function generateShorts({ title, imageUrls, note }) {
  return postJson('/api/shorts/generate', { title, imageUrls, note })
}

// AI 이미지 생성 (Luna 없이 바로 이미지 생성 - data URL로 돌려받아서 첨부에 바로 추가 가능)
export async function generateAiImage({ prompt, size }) {
  return postJson('/api/images/generate', { prompt, size })
}

// 참고 사진을 올리면 그 느낌으로 비슷한 새 이미지를 AI가 다시 그려서 생성
export async function generateSimilarImage({ imageDataUrl, prompt, size }) {
  return postJson('/api/images/edit', { imageDataUrl, prompt, size })
}

// 이미지 형식 변환 (jpg/png/webp) - 서버에 파일을 남기지 않고 바로 data URL로 결과를 돌려받음
export async function convertImageFormat({ imageDataUrl, format }) {
  return postJson('/api/images/convert', { imageDataUrl, format })
}

// 인스타그램 자동 입력 (진희님 컴퓨터에서만 동작 - 실제 크롬을 열어서 조작)
export function openInstagramLogin() {
  return postJson('/api/instagram/open-login', {})
}

// prepare는 "로그인 필요" 상태(409)도 화면에서 구분해서 안내해야 해서 postJson을 안 쓰고 직접 처리
export async function prepareInstagramPost({ caption, imageDataUrl }) {
  const res = await fetch(`${API_BASE}/api/instagram/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption, imageDataUrl }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `요청이 실패했어요 (${res.status})`)
    err.loginRequired = Boolean(data.loginRequired)
    throw err
  }
  return data
}

// 인스타그램 댓글 자동 응답 - 최근 게시물 댓글 중 CS 트리거 키워드가 있는 것을 찾기 (읽기 전용)
export async function scanInstagramComments() {
  const res = await fetch(`${API_BASE}/api/instagram/scan-comments`, { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `요청이 실패했어요 (${res.status})`)
    err.loginRequired = Boolean(data.loginRequired)
    throw err
  }
  return data
}

// 찾은 댓글 하나에 실제로 답글을 보내고 기록 (사람이 항목별로 눌러서 실행)
export async function replyInstagramComment(match) {
  const res = await fetch(`${API_BASE}/api/instagram/reply-comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(match),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `요청이 실패했어요 (${res.status})`)
  }
  return data
}

// 틱톡 자동 입력 (진희님 컴퓨터에서만 동작 - 인스타그램과 같은 방식, 마지막 게시는 직접)
export function openTiktokLogin() {
  return postJson('/api/tiktok/open-login', {})
}

export async function prepareTiktokPost({ caption, imageDataUrls }) {
  const res = await fetch(`${API_BASE}/api/tiktok/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption, imageDataUrls }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `요청이 실패했어요 (${res.status})`)
    err.loginRequired = Boolean(data.loginRequired)
    throw err
  }
  return data
}

// 네이버 블로그 자동 입력 (진희님 컴퓨터에서만 동작 - 인스타/틱톡과 같은 방식, 마지막 발행은 직접)
export function openNaverBlogLogin() {
  return postJson('/api/naverblog/open-login', {})
}

export async function prepareNaverBlogPost({ title, body, images }) {
  const res = await fetch(`${API_BASE}/api/naverblog/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, images }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `요청이 실패했어요 (${res.status})`)
    err.loginRequired = Boolean(data.loginRequired)
    throw err
  }
  return data
}

// 스레드 자동 입력 (진희님 컴퓨터에서만 동작 - 인스타/틱톡과 같은 방식, 마지막 게시는 직접)
export function openThreadsLogin() {
  return postJson('/api/threads/open-login', {})
}

export async function prepareThreadsPost({ body, imageDataUrl }) {
  const res = await fetch(`${API_BASE}/api/threads/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, imageDataUrl }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `요청이 실패했어요 (${res.status})`)
    err.loginRequired = Boolean(data.loginRequired)
    throw err
  }
  return data
}

// 영상 제작실 - 씬(이미지+모션+자막+보이스) + 배경음악을 직접 구성해서 mp4로 렌더링
export async function renderVideoStudio(formData) {
  const res = await fetch(`${API_BASE}/api/video-studio/render`, { method: 'POST', body: formData })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `영상 렌더링이 실패했어요 (${res.status})`)
  }
  return data
}

// 영상 제작실 - CapCut에서 마무리 편집하도록 소재(이미지/영상+오디오+자막)만 zip으로 내보내기
export async function exportVideoStudioCapcut(formData) {
  const res = await fetch(`${API_BASE}/api/video-studio/export-capcut`, { method: 'POST', body: formData })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `CapCut 내보내기가 실패했어요 (${res.status})`)
  }
  return data
}

// 영상 제작실 - 렌더링/내보내기 결과 파일(mp4/zip)을 서버에서 삭제
export async function deleteVideoStudioGenerated(fileUrl) {
  const fileName = fileUrl.split('/').pop()
  const res = await fetch(`${API_BASE}/api/video-studio/generated/${fileName}`, { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `파일 삭제가 실패했어요 (${res.status})`)
  }
  return data
}

// 영상 제작실 - 우측 하단에 고정된 워터마크(기본은 노트북LM 위치) 지우기
export async function removeVideoWatermark(formData) {
  const res = await fetch(`${API_BASE}/api/video-studio/remove-watermark`, { method: 'POST', body: formData })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `워터마크 제거가 실패했어요 (${res.status})`)
  }
  return data
}

// 영상 제작실 - 씬 자막/나레이션 흐름을 읽고 장면별 모션+효과(하트 등) 자동 추천 (2026-08-02)
export async function autoDirectVideoStudio(scenes) {
  const res = await fetch(`${API_BASE}/api/video-studio/auto-direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenes }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `자동 연출이 실패했어요 (${res.status})`)
  return data
}

// 영상 제작실 - 후킹 썸네일 추천 (상품 사진 첨부 또는 방금 렌더링한 영상 장면 기반)
export async function suggestVideoThumbnail(formData) {
  const res = await fetch(`${API_BASE}/api/video-studio/thumbnail-suggest`, { method: 'POST', body: formData })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `썸네일 추천이 실패했어요 (${res.status})`)
  return data
}

// 영상 제작실 - 추천 배경음악 목록(server/assets/bgm/) 조회
export async function getBgmList() {
  const res = await fetch(`${API_BASE}/api/video-studio/bgm-list`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `배경음악 목록을 불러오지 못했어요 (${res.status})`)
  return data.tracks || []
}

// 유튜브 트렌드 분석 - 장르별 급상승 영상을 상승 속도 기준으로 채점 + AI 분석/리포트
export async function scanYoutubeTrend({ genre, keywords, days }) {
  return postJson('/api/youtube-trend/scan', { genre, keywords, days })
}

// 해외(도우인/웨이보/빌리비리 등) 링크 영상 다운로드 - 쇼핑쇼츠 벤치마킹용 참고 시청 목적 (재업로드 금지)
export async function downloadVideoFromLink(url) {
  return postJson('/api/video-download', { url })
}

// 받아둔 영상 파일 삭제
export async function deleteDownloadedVideo(fileName) {
  const res = await fetch(`${API_BASE}/api/video-download/${encodeURIComponent(fileName)}`, { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `삭제가 실패했어요 (${res.status})`)
  }
  return data
}

// 자동화 실행 로그에서 "이슈발생" 난 항목을 버튼 하나로 재시도 (같은 내부 파이프라인을 다시 호출)
export function retryAutomationRun(runId) {
  return postJson('/api/automation/retry', { runId })
}

// 무료 스톡 사진(Pexels) 검색
export async function searchPexelsPhotos({ query, page }) {
  const params = new URLSearchParams({ q: query })
  if (page) params.set('page', String(page))
  const res = await fetch(`${API_BASE}/api/pexels/search?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `스톡 사진 검색이 실패했어요 (${res.status})`)
  }
  return data.photos || []
}

// 선택한 스톡 사진을 data URL로 가져오기 (첨부 이미지로 바로 추가 가능)
export async function fetchPexelsImage(url) {
  const params = new URLSearchParams({ url })
  const res = await fetch(`${API_BASE}/api/pexels/fetch?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `이미지를 불러오지 못했어요 (${res.status})`)
  }
  return data.dataUrl
}
