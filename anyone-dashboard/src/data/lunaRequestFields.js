// ============================================================
// 루나 요청서 고도화 (계획서 5장)
//
// 요청 종류(이미지/영상)에 따라 다른 세부 필드를 받고, 새로운 11단계 상태 흐름을 사용합니다.
// 순수 데이터 + 순수 함수로 작성해서 Node.js에서도 그대로 검증할 수 있게 했습니다.
// (테스트: scripts/test-luna-request-fields.mjs)
// ============================================================

export const REQUEST_TYPES = ['이미지', '영상', '기타']

// 계획서 5장에서 요청하신 11단계 요청 상태 흐름
export const REQUEST_STATUS_FLOW = [
  '요청 작성',
  '전달',
  '접수',
  '담당자 배정',
  '제작 중',
  '내부 QA',
  '교차 검수',
  '결과 수령',
  '진희 승인',
  '애니원 등록',
  '사용 완료',
]

const RATIO_OPTIONS = ['1:1', '4:5', '9:16', '16:9', '3:4', '기타']
const PRIORITY_OPTIONS = ['낮음', '보통', '높음', '긴급']

// 이미지 요청 전용 필드 (요청하신 순서 그대로)
export const IMAGE_FIELDS = [
  { key: 'channel', label: '채널', type: 'text' },
  { key: 'purpose', label: '사용 목적', type: 'text' },
  { key: 'target', label: '타깃', type: 'text' },
  { key: 'key_message', label: '핵심 메시지', type: 'textarea' },
  { key: 'image_kind', label: '이미지 종류', type: 'text' },
  { key: 'ratio', label: '비율', type: 'select', options: RATIO_OPTIONS },
  { key: 'style', label: '스타일', type: 'text' },
  { key: 'character', label: '캐릭터', type: 'text' },
  { key: 'background', label: '배경', type: 'text' },
  { key: 'costume', label: '의상', type: 'text' },
  { key: 'expression', label: '표정', type: 'text' },
  { key: 'image_caption', label: '이미지 문구', type: 'textarea' },
  { key: 'forbidden_elements', label: '금지 요소', type: 'textarea' },
  { key: 'reference_image', label: '참고 이미지 (링크/설명)', type: 'text' },
  { key: 'quantity', label: '장수', type: 'number' },
  { key: 'priority', label: '우선순위', type: 'select', options: PRIORITY_OPTIONS },
  { key: 'brand', label: '브랜드', type: 'text' },
]

// 영상 요청 전용 필드 (요청하신 순서 그대로)
export const VIDEO_FIELDS = [
  { key: 'song_title', label: '곡명', type: 'text' },
  { key: 'total_duration', label: '총길이', type: 'text' },
  { key: 'scene_count', label: '장면 수', type: 'number' },
  { key: 'scene_duration', label: '장면 길이', type: 'text' },
  { key: 'video_ai', label: '영상 AI', type: 'text' },
  { key: 'ratio', label: '비율', type: 'select', options: RATIO_OPTIONS },
  { key: 'camera_movement', label: '카메라 움직임', type: 'text' },
  { key: 'lipsync', label: '립싱크 여부', type: 'checkbox' },
  { key: 'subtitle', label: '자막 여부', type: 'checkbox' },
  { key: 'start_scene', label: '시작 장면', type: 'textarea' },
  { key: 'end_scene', label: '마지막 장면', type: 'textarea' },
  { key: 'reference_image', label: '참고 이미지', type: 'text' },
]

// 요청 종류에 맞는 필드 목록 반환 ('기타'는 세부 필드 없음)
export function getFieldsForType(requestType) {
  if (requestType === '이미지') return IMAGE_FIELDS
  if (requestType === '영상') return VIDEO_FIELDS
  return []
}

// 요청 종류에 맞는 기본값 객체 생성 (체크박스는 false, 나머지는 빈 문자열)
export function getEmptyDetails(requestType) {
  const fields = getFieldsForType(requestType)
  const details = {}
  for (const f of fields) {
    details[f.key] = f.type === 'checkbox' ? false : ''
  }
  return details
}
