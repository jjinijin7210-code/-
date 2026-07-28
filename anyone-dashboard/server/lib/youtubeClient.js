// ============================================================
// YouTube Data API v3 호출 래퍼 - fetch만 사용 (별도 SDK 설치 불필요)
// 조회수 기준으로 검색한 뒤, 통계(조회수/좋아요) 붙여서 좋아요 기준으로 필터링한다.
// ============================================================

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search'
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'
const PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems'

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
export function parseIso8601Duration(iso) {
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

// 2026-07-23: 심리학 영상 대본에 넣을 "실제 사연" 소재를 레딧뿐 아니라 다른 심리학 유튜브
// 채널에서도 찾자는 요청 - 인기 심리학 영상의 댓글에는 시청자들이 직접 겪은 이야기를 남기는
// 경우가 많아서(예: "저희 아들도 딱 이래요..."), 이걸 사연 소재로 같이 활용한다.
const COMMENT_THREADS_URL = 'https://www.googleapis.com/youtube/v3/commentThreads'

export async function getTopComments(videoId, maxResults = 10) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || !videoId) return []

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      videoId,
      order: 'relevance',
      maxResults: String(Math.min(maxResults, 50)),
      textFormat: 'plainText',
      key: apiKey,
    })
    const res = await fetch(`${COMMENT_THREADS_URL}?${params.toString()}`)
    if (!res.ok) return [] // 댓글이 꺼져있는 영상 등도 있어서 에러여도 그냥 빈 배열(best-effort)
    const data = await res.json()
    return (data.items || [])
      .map((item) => item.snippet?.topLevelComment?.snippet)
      .filter(Boolean)
      .map((s) => ({ text: s.textDisplay, likeCount: s.likeCount || 0 }))
      .sort((a, b) => b.likeCount - a.likeCount)
  } catch {
    return []
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

// ============================================================
// 2026-07-27: "콘텐츠 DNA" 기능용 - 채널 URL을 넣으면 분석해서 비슷한 채널을 추천해주는 기능.
// VidIQ의 신경망 기반 유사채널 매칭만큼 정교하진 않지만, 이미 있는 유튜브 공식 API +
// Claude만으로 추가 비용 없이 자동화할 수 있음(사용자 확인, 2026-07-27).
// ============================================================

// 채널 URL/핸들/이름에서 채널 ID를 알아냄 - 형식이 여러 가지라(/channel/UC.../@handle/
// /c/이름/그냥 채널명 검색어) 순서대로 시도한다.
export async function resolveChannelId(input) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  const raw = (input || '').trim()
  if (!raw) throw new Error('채널 URL이나 이름이 필요해요.')

  // 이미 채널 ID 형태(UC로 시작하는 24자)면 그대로 사용
  if (/^UC[\w-]{22}$/.test(raw)) return raw

  let handle = null
  let pathSearch = null
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    const channelMatch = u.pathname.match(/\/channel\/(UC[\w-]{22})/)
    if (channelMatch) return channelMatch[1]
    const handleMatch = u.pathname.match(/\/@([\w.-]+)/)
    if (handleMatch) handle = handleMatch[1]
    const legacyMatch = u.pathname.match(/\/(?:c|user)\/([\w.-]+)/)
    if (legacyMatch) pathSearch = legacyMatch[1]
  } catch {
    // URL이 아니면(그냥 채널명/핸들 텍스트) 아래에서 검색으로 처리
    if (raw.startsWith('@')) handle = raw.slice(1)
    else pathSearch = raw
  }

  if (handle) {
    const params = new URLSearchParams({ part: 'id', forHandle: handle, key: apiKey })
    const res = await fetch(`${CHANNELS_URL}?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      const id = data.items?.[0]?.id
      if (id) return id
    }
  }

  // 핸들로 못 찾았거나 /c/user 형식이면 검색으로 폴백(검색은 정확도가 좀 떨어질 수 있음)
  const searchParams = new URLSearchParams({
    part: 'snippet',
    q: handle || pathSearch || raw,
    type: 'channel',
    maxResults: '1',
    key: apiKey,
  })
  const searchRes = await fetch(`${SEARCH_URL}?${searchParams.toString()}`)
  if (!searchRes.ok) throw new Error('채널을 찾지 못했어요. URL을 다시 확인해주세요.')
  const searchData = await searchRes.json()
  const channelId = searchData.items?.[0]?.id?.channelId
  if (!channelId) throw new Error('채널을 찾지 못했어요. URL을 다시 확인해주세요.')
  return channelId
}

export async function getChannelInfo(channelId) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  const params = new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: channelId, key: apiKey })
  const res = await fetch(`${CHANNELS_URL}?${params.toString()}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`YouTube 채널 정보 API 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  const c = data.items?.[0]
  if (!c) throw new Error('채널 정보를 찾지 못했어요.')
  return {
    channelId: c.id,
    title: c.snippet.title,
    description: c.snippet.description || '',
    thumbnail: c.snippet.thumbnails?.medium?.url || c.snippet.thumbnails?.default?.url,
    subscriberCount: Number(c.statistics?.subscriberCount || 0),
    videoCount: Number(c.statistics?.videoCount || 0),
    viewCount: Number(c.statistics?.viewCount || 0),
    uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads || null,
  }
}

// 채널의 최근 업로드 영상들 - uploads 재생목록으로 가져와서(검색 API보다 훨씬 저렴함,
// 1유닛 vs 100유닛) 업로드 주기·영상 길이·조회수 패턴을 계산할 수 있게 함.
export async function getChannelRecentVideos(uploadsPlaylistId, maxResults = 15) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  if (!uploadsPlaylistId) return []

  const playlistParams = new URLSearchParams({
    part: 'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.min(maxResults, 50)),
    key: apiKey,
  })
  const playlistRes = await fetch(`${PLAYLIST_ITEMS_URL}?${playlistParams.toString()}`)
  if (!playlistRes.ok) return []
  const playlistData = await playlistRes.json()
  const videoIds = (playlistData.items || []).map((item) => item.snippet?.resourceId?.videoId).filter(Boolean)
  if (videoIds.length === 0) return []

  const videosParams = new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: videoIds.join(','), key: apiKey })
  const videosRes = await fetch(`${VIDEOS_URL}?${videosParams.toString()}`)
  if (!videosRes.ok) return []
  const videosData = await videosRes.json()

  return (videosData.items || []).map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    publishedAt: v.snippet.publishedAt,
    thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
    durationSeconds: parseIso8601Duration(v.contentDetails?.duration),
    viewCount: Number(v.statistics?.viewCount || 0),
    likeCount: Number(v.statistics?.likeCount || 0),
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }))
}

// 채널 검색(이름/키워드로) - 콘텐츠 DNA 분석에서 뽑은 키워드로 비슷한 채널 후보를 찾을 때 씀
export async function searchChannels({ query, maxResults = 8, regionCode }) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YOUTUBE_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'channel',
    maxResults: String(Math.min(maxResults, 50)),
    key: apiKey,
  })
  if (regionCode) params.set('regionCode', regionCode)
  const res = await fetch(`${SEARCH_URL}?${params.toString()}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.items || [])
    .map((item) => item.snippet?.channelId || item.id?.channelId)
    .filter(Boolean)
}

// 업로드 주기(주당 몇 개) - 최근 영상들의 게시 시각 간격 평균으로 추정
export function estimateUploadsPerWeek(videos) {
  if (!videos || videos.length < 2) return null
  const sorted = [...videos].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  const newest = new Date(sorted[0].publishedAt)
  const oldest = new Date(sorted[sorted.length - 1].publishedAt)
  const daysSpan = (newest - oldest) / (1000 * 60 * 60 * 24)
  if (daysSpan <= 0) return null
  return Math.round(((sorted.length - 1) / daysSpan) * 7 * 10) / 10
}
