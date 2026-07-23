// ============================================================
// 오늘 날씨 조회 (Open-Meteo - API 키 필요 없는 무료 서비스)
// 계절감뿐 아니라 "오늘 진짜 날씨"까지 글쓰기 소재에 자연스럽게 녹이기 위한 용도 (2026-07-23)
// 실패해도 콘텐츠 생성 자체를 막으면 안 되므로, 실패 시 null을 돌려주고 상위에서 무시하게 함.
// ============================================================

const SEOUL_LAT = 37.5665
const SEOUL_LON = 126.978

// WMO 날씨 코드 -> 한국어 간단 설명 (https://open-meteo.com/en/docs 의 weathercode 표 기준)
const WEATHER_CODE_KO = {
  0: '맑음',
  1: '대체로 맑음',
  2: '구름 조금',
  3: '흐림',
  45: '안개',
  48: '짙은 안개',
  51: '이슬비',
  53: '이슬비',
  55: '강한 이슬비',
  61: '약한 비',
  63: '비',
  65: '강한 비',
  66: '진눈깨비',
  67: '강한 진눈깨비',
  71: '약한 눈',
  73: '눈',
  75: '강한 눈',
  80: '소나기',
  81: '소나기',
  82: '강한 소나기',
  95: '뇌우',
  96: '뇌우(우박 동반)',
  99: '강한 뇌우(우박 동반)',
}

/**
 * 서울 기준 현재 날씨를 "맑음 28도" 형태의 한국어 한 줄로 돌려준다. 실패하면 null.
 */
export async function getCurrentWeatherNote() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${SEOUL_LAT}&longitude=${SEOUL_LON}&current_weather=true`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json()
    const cw = data.current_weather
    if (!cw) return null
    const desc = WEATHER_CODE_KO[cw.weathercode] || '맑음'
    return `${desc} ${Math.round(cw.temperature)}도`
  } catch {
    return null
  }
}
