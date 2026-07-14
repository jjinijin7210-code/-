// ============================================================
// Pexels 무료 스톡 사진 검색 - fetch만 사용 (별도 SDK 설치 불필요)
// ============================================================

const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search'

export async function searchPhotos({ query, page = 1, perPage = 15 }) {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) {
    throw new Error('PEXELS_API_KEY가 서버 .env에 설정되어 있지 않아요.')
  }
  if (!query || !query.trim()) {
    throw new Error('검색어(query)가 필요해요.')
  }

  const params = new URLSearchParams({ query, page: String(page), per_page: String(perPage) })
  const res = await fetch(`${PEXELS_SEARCH_URL}?${params.toString()}`, {
    headers: { Authorization: apiKey },
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Pexels 검색 오류 (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  return (data.photos || []).map((p) => ({
    id: p.id,
    thumb: p.src.medium,
    full: p.src.large2x || p.src.original,
    photographer: p.photographer,
  }))
}

// 선택한 사진을 서버가 대신 받아 data URL로 변환 - 기존 첨부 이미지(images[]) 컨벤션과 동일한 형태로 쓰기 위함.
export async function fetchPhotoAsDataUrl(url) {
  if (!/^https:\/\/images\.pexels\.com\//.test(url)) {
    throw new Error('유효하지 않은 Pexels 이미지 주소예요.')
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`이미지를 불러오지 못했어요 (${res.status})`)
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  return `data:${contentType};base64,${buf.toString('base64')}`
}
