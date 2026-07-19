// ============================================================
// YouTube Data API v3 호출 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// 조회수 기준으로 검색한 뒤, 통계(조회수/좋아요) 붙여서 좋아요 기준으로 필터링한다.
// ============================================================

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search'
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'

export async function searchPopularVideos({ query, minLikes = 10000, maxResults = 15, regionCode, videoDuration }) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!query) {
    throw new Error('검색어(query)가 필요해요.')
  }

  const searchParams = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'viewCount',
    maxResults: String(Math.min(maxResults, 50)),
    key: apiKey,
  })
  if (regionCode) searchParams.set('regionCode', regionCode)
  if (videoDuration) searchParams.set('videoDuration', videoDuration) // short | medium | long

  const searchRes = await fetch(`${SEARCH_URL}?${searchParams.toString()}`)
  if (!searchRes.ok) {
    const errText = await searchRes.text().catch(() => '')
    throw new Error(`YouTube 검색 API 오류 (${searchRes.status}): ${errText.slice(0, 300)}`)
  }
  const searchData = await searchRes.json()
  const videoIds = (searchData.items || []).map((item) => item.id.videoId).filter(Boolean)
  if (videoIds.length === 0) return []

  const videosParams = new URLSearchParams({
    part: 'snippet,statistics,contentDetails',
    id: videoIds.join(','),
    key: apiKey,
  })
  const videosRes = await fetch(`${VIDEOS_URL}?${videosParams.toString()}`)
  if (!videosRes.ok) {
    const errText = await videosRes.text().catch(() => '')
    throw new Error(`YouTube 영상 정보 API 오류 (${videosRes.status}): ${errText.slice(0, 300)}`)
  }
  const videosData = await videosRes.json()

  return (videosData.items || [])
    .map((v) => ({
      videoId: v.id,
      title: v.snippet.title,
      channelTitle: v.snippet.channelTitle,
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
      viewCount: Number(v.statistics.viewCount || 0),
      likeCount: Number(v.statistics.likeCount || 0),
      url: `https://www.youtube.com/watch?v=${v.id}`,
    }))
    .filter((v) => v.likeCount >= minLikes)
    .sort((a, b) => b.viewCount - a.viewCount)
}

// ISO8601 재생시간(PT4M13S 등)을 초 단위 숫자로 변환
function parseIso8601Duration(iso) {
  if (!iso) return null
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!match) return null
  const [, h, m, s] = match
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)
}

// 급상승 트렌드 스캔용 - minLikes 필터 없이(조회수는 적어도 성장 속도가 빠른 영상을 놓치지
// 않기 위함) 키워드+지역+게시일 이후 조건으로 검색하고, 점수 계산에 필요한 필드를 다 채워서 돌려줌.
export async function searchVideosForTrendScan({ query, regionCode = 'KR', publishedAfter, maxResults = 15, order = 'viewCount' }) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!query) {
    throw new Error('검색어(query)가 필요해요.')
  }

  const searchParams = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order,
    regionCode,
    maxResults: String(Math.min(maxResults, 50)),
    key: apiKey,
  })
  if (publishedAfter) searchParams.set('publishedAfter', publishedAfter)

  const searchRes = await fetch(`${SEARCH_URL}?${searchParams.toString()}`)
  if (!searchRes.ok) {
    const errText = await searchRes.text().catch(() => '')
    throw new Error(`YouTube 검색 API 오류 (${searchRes.status}): ${errText.slice(0, 300)}`)
  }
  const searchData = await searchRes.json()
  const videoIds = (searchData.items || []).map((item) => item.id.videoId).filter(Boolean)
  if (videoIds.length === 0) return []

  const videosParams = new URLSearchParams({
    part: 'snippet,statistics,contentDetails',
    id: videoIds.join(','),
    key: apiKey,
  })
  const videosRes = await fetch(`${VIDEOS_URL}?${videosParams.toString()}`)
  if (!videosRes.ok) {
    const errText = await videosRes.text().catch(() => '')
    throw new Error(`YouTube 영상 정보 API 오류 (${videosRes.status}): ${errText.slice(0, 300)}`)
  }
  const videosData = await videosRes.json()

  return (videosData.items || []).map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    description: v.snippet.description || '',
    channelTitle: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
    durationSeconds: parseIso8601Duration(v.contentDetails?.duration),
    viewCount: Number(v.statistics?.viewCount || 0),
    likeCount: Number(v.statistics?.likeCount || 0),
    commentCount: Number(v.statistics?.commentCount || 0),
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }))
}

// 유튜브 URL(watch?v=, youtu.be/, shorts/ 등 다양한 형식)에서 영상 ID만 뽑아냄
export function extractYoutubeVideoId(urlOrId) {
  const s = (urlOrId || '').trim()
  if (!s) return null
  if (/^[\w-]{11}$/.test(s)) return s // 이미 순수 ID 형태면 그대로
  try {
    const u = new URL(s)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0]
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2]
    const v = u.searchParams.get('v')
    if (v) return v
  } catch {
    return null
  }
  return null
}

// 검색이 아니라 진희님이 직접 찾은 특정 유튜브 영상 하나를 URL로 바로 가져올 때 씀
// (2026-07-19 요청 - 검색으로 안 걸리는 영상도 직접 넣을 수 있게).
export async function getVideoById(videoIdOrUrl) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  const videoId = extractYoutubeVideoId(videoIdOrUrl)
  if (!videoId) {
    throw new Error('올바른 유튜브 영상 URL이나 ID가 아니에요.')
  }

  const videosParams = new URLSearchParams({ part: 'snippet,statistics', id: videoId, key: apiKey })
  const videosRes = await fetch(`${VIDEOS_URL}?${videosParams.toString()}`)
  if (!videosRes.ok) {
    const errText = await videosRes.text().catch(() => '')
    throw new Error(`YouTube 영상 정보 API 오류 (${videosRes.status}): ${errText.slice(0, 300)}`)
  }
  const videosData = await videosRes.json()
  const v = videosData.items?.[0]
  if (!v) {
    throw new Error('해당 영상을 찾지 못했어요. URL을 다시 확인해주세요.')
  }

  return {
    videoId: v.id,
    title: v.snippet.title,
    channelTitle: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
    viewCount: Number(v.statistics.viewCount || 0),
    likeCount: Number(v.statistics.likeCount || 0),
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }
}

// 특정 지역 하나로 고정하지 않고 여러 나라를 한 번에 같이 확인하고 싶다는 요청(2026-07-18)
// 반영 - regionCodes 배열을 받아서 나라별로 검색한 뒤 하나로 합침. 같은 영상이 여러 나라
// 검색에 동시에 걸리면 처음 나온 지역 표시만 남기고 중복 제거, 조회수 기준 재정렬.
export async function searchPopularVideosMultiRegion({ query, minLikes = 10000, maxResults = 15, regionCodes, videoDuration }) {
  const regions = regionCodes && regionCodes.length > 0 ? regionCodes : [undefined]
  const resultsByRegion = await Promise.all(
    regions.map(async (regionCode) => {
      const videos = await searchPopularVideos({ query, minLikes, maxResults, regionCode, videoDuration })
      return videos.map((v) => ({ ...v, region: regionCode || '전체' }))
    })
  )

  const seen = new Map()
  for (const videos of resultsByRegion) {
    for (const v of videos) {
      if (!seen.has(v.videoId)) seen.set(v.videoId, v)
    }
  }
  return [...seen.values()].sort((a, b) => b.viewCount - a.viewCount)
}
