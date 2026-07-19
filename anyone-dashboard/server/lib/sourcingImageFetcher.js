// ============================================================
// 쿠팡/1688 검색 결과의 상품 이미지 URL을 서버가 대신 받아 data URL(base64)로 변환.
// 기존 첨부 이미지(images[]) 컨벤션과 동일한 형태로 저장하기 위함 (핫링크 대신 영구 보관).
// pexelsClient.js의 도메인 검증 패턴과 동일하게, 알려진 쿠팡/알리바바 CDN 도메인만 허용.
// ============================================================

const ALLOWED_IMAGE_HOSTS = [/\.coupangcdn\.com$/i, /(^|\.)coupang\.com$/i, /\.alicdn\.com$/i, /(^|\.)alibaba\.com$/i]

export async function fetchSourcingImageAsDataUrl(url) {
  let hostname
  try {
    hostname = new URL(url).hostname
  } catch {
    throw new Error('유효하지 않은 이미지 주소예요.')
  }
  if (!ALLOWED_IMAGE_HOSTS.some((re) => re.test(hostname))) {
    throw new Error('허용되지 않은 이미지 출처예요.')
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`이미지를 불러오지 못했어요 (${res.status})`)
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  return `data:${contentType};base64,${buf.toString('base64')}`
}
