// 모션그래픽 템플릿 5종이 공유하는 유틸.
// 세로(9:16)/가로(16:9)/정사각(1:1) 어느 비율에서도 같은 느낌이 나도록,
// 모든 크기는 px 고정값 대신 짧은 변 기준 비율(scaleUnit)로 계산한다.

export function scaleUnit(width, height) {
  return Math.min(width, height) / 1080
}

// 숫자에 천 단위 콤마 - 카운트업 중간값에도 매 프레임 적용됨
export function formatNumber(value) {
  return Math.round(value).toLocaleString('ko-KR')
}

// 브랜드 색이 어두운색인지 밝은색인지 판단해서 글자색을 정함 (배경으로 깔 때 대비 확보)
export function readableTextColor(hexColor) {
  const hex = String(hexColor || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  // sRGB 상대 휘도 근사 - 정밀할 필요 없이 흰/검 선택용
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1a1a2e' : '#ffffff'
}

export const FONT_STACK =
  "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
