// ============================================================
// 브랜드 센터 & 에셋 보관함 (계획서 7장)
// ============================================================

// 관리할 5개 브랜드 (요청하신 그대로) - 브랜드 테이블이 비어있으면 이 목록으로 자동 시딩
export const DEFAULT_BRAND_NAMES = ['AnyOne', 'Luna Creative Studio', 'June', '트롯충전소', '제나 스튜디오']

export const BRAND_TEXT_FIELDS = [
  { key: 'colors', label: '색상', type: 'text', hint: '예: #1B2540, #B8823C' },
  { key: 'fonts', label: '폰트', type: 'text' },
  { key: 'tone', label: '말투', type: 'text' },
  { key: 'image_style', label: '이미지 스타일', type: 'text' },
  { key: 'forbidden_expressions', label: '금지 표현', type: 'textarea' },
  { key: 'representative_character', label: '대표 캐릭터', type: 'text' },
  { key: 'default_hashtags', label: '기본 해시태그', type: 'text', hint: '예: #애니원 #꿀템' },
]

export function getEmptyBrand(name = '') {
  const base = { name, logo: [] }
  for (const f of BRAND_TEXT_FIELDS) base[f.key] = ''
  return base
}

// 브랜드 테이블이 비어있을 때 채워넣을 5개 기본 브랜드 레코드
export function getDefaultBrandSeeds() {
  return DEFAULT_BRAND_NAMES.map((name) => getEmptyBrand(name))
}

// 에셋 분류 10종 (요청하신 순서 그대로)
export const ASSET_CATEGORIES = [
  '이미지',
  '썸네일',
  '로고',
  '배너',
  '캐릭터',
  '영상',
  '음원',
  '프롬프트',
  '문서',
  '게시물 완성본',
]

export const COPYRIGHT_STATUS_OPTIONS = ['자체 제작', '라이선스 구매', '무료 소스', '출처 확인 필요']
export const APPROVAL_STATUS_OPTIONS = ['대기', '승인', '반려']

export function getEmptyAsset() {
  return {
    brand: DEFAULT_BRAND_NAMES[0],
    category: ASSET_CATEGORIES[0],
    creator: '',
    created_date: '',
    copyright_status: COPYRIGHT_STATUS_OPTIONS[0],
    approval_status: APPROVAL_STATUS_OPTIONS[0],
    version: '',
    linked_post_id: '',
    files: [],
    note: '',
  }
}
