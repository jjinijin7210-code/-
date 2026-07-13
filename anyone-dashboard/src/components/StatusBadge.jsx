// 상태 문자열을 보고 도장 색을 결정 (통과류=초록, 반려류=빨강, 나머지=회색)
const PASS_WORDS = ['통과', '완료', '발행완료']
const REJECT_WORDS = ['반려', '이슈발생']

function getStampStyle(status) {
  if (PASS_WORDS.some((w) => status?.includes(w))) {
    return 'border-stamp-pass text-stamp-pass bg-stamp-pass/5'
  }
  if (REJECT_WORDS.some((w) => status?.includes(w))) {
    return 'border-stamp-reject text-stamp-reject bg-stamp-reject/5'
  }
  return 'border-stamp-pending text-stamp-pending bg-stamp-pending/5'
}

export default function StatusBadge({ status }) {
  if (!status) return null
  return <span className={`stamp-badge ${getStampStyle(status)}`}>{status}</span>
}
