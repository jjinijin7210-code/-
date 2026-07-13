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

// AI 자동 검수 (팩트체크/과장표현/AI스러운 문체)
export function reviewDraftWithAi({ title, body, channel }) {
  return postJson('/api/review', { title, body, channel })
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
export async function searchYoutubeVideos({ query, minLikes = 10000, regionCode, videoDuration }) {
  const params = new URLSearchParams({ q: query, minLikes: String(minLikes) })
  if (regionCode) params.set('regionCode', regionCode)
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
