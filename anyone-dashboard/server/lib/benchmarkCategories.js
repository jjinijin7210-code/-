// ============================================================
// 일본향 인스타/틱톡 벤치마킹 카테고리 - 하루 1회 수집, 하루 5회 콘텐츠 생성 슬롯이 순환해서 사용
// ============================================================

export const BENCHMARK_CATEGORIES = [
  { label: '일상공감·개그', hashtags: ['あるある', '共感'] },
  { label: '브이로그·힐링', hashtags: ['癒し', '日常vlog', 'もふもふ', '珍しい動物'] },
  { label: '패션뷰티소품', hashtags: ['かわいい', 'プチプラ', '韓国コスメ'] },
]

export function getCategoryByLabel(label) {
  return BENCHMARK_CATEGORIES.find((c) => c.label === label)
}
