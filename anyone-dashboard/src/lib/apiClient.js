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

// 영상 제작실 - 씬(이미지+모션+자막+보이스) + 배경음악을 직접 구성해서 mp4로 렌더링
export async function renderVideoStudio(formData) {
  const res = await fetch(`${API_BASE}/api/video-studio/render`, { method: 'POST', body: formData })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `영상 렌더링이 실패했어요 (${res.status})`)
  }
  return data
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
