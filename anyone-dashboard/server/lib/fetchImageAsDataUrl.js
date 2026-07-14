// ============================================================
// 임의의 이미지 URL을 서버가 대신 받아 data URL(base64)로 변환.
// 자동 파이프라인 내부에서만(신뢰된 소싱 결과 URL) 호출하는 용도 - 사용자 입력 URL을
// 그대로 받는 공개 엔드포인트에는 쓰지 않는다 (그런 경우는 pexelsClient.js처럼 도메인 검증 필요).
// ============================================================

export async function fetchImageAsDataUrl(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`이미지를 불러오지 못했어요 (${res.status})`)
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  return `data:${contentType};base64,${buf.toString('base64')}`
}
