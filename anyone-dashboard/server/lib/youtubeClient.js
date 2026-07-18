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
