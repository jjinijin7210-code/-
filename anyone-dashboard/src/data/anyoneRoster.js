// 애니원(AnyOne) 자체 팀 조직도 기본값
// 2026-07-19: 총괄 팀장 아래 채널별 3개 팀(인스타/틱톡, 스레드/블로그, 유튜브)으로 재편.
// department 필드에 "팀 · 부서" 형식으로 팀 구분을 같이 넣어서(DB 스키마 변경 없이) 그룹핑에 씀.

export const DEFAULT_ANYONE_ROSTER = [
  { department: '총괄', role_name: '루나 (총괄 팀장 - 전체 진행 확인·브리핑)', role_emoji: '🌙' },

  { department: '인스타틱톡팀 · 리서치', role_name: '리서처', role_emoji: '🔍' },
  { department: '인스타틱톡팀 · 콘텐츠제작', role_name: '작성자 (AI 초안 생성)', role_emoji: '✍️' },
  { department: '인스타틱톡팀 · 콘텐츠제작', role_name: '이미지·썸네일 제작 담당 (AI 이미지 생성)', role_emoji: '🎬' },
  { department: '인스타틱톡팀 · 콘텐츠제작', role_name: '쇼츠 제작 담당 (사진→영상 합성)', role_emoji: '📹' },
  { department: '인스타틱톡팀 · 검수', role_name: '검수자 A (1차 - 팩트체크·과장표현·AI스러움)', role_emoji: '🧐' },
  { department: '인스타틱톡팀 · 검수', role_name: '검수자 B (교차 검수)', role_emoji: '🔁' },
  { department: '인스타틱톡팀 · 검수', role_name: '검수자 C (가독성)', role_emoji: '📖' },
  { department: '인스타틱톡팀 · 현지화', role_name: '번역/현지화 담당 (영어)', role_emoji: '🌐' },
  { department: '인스타틱톡팀 · 현지화', role_name: '번역/현지화 담당 (일본어)', role_emoji: '🌐' },
  { department: '인스타틱톡팀 · 발행CS', role_name: 'CS 담당 (댓글 트리거 → 인포크 안내)', role_emoji: '💬' },

  { department: '스레드블로그팀 · 콘텐츠제작', role_name: '작성자 (스레드·블로그 AI 초안 생성)', role_emoji: '✍️' },
  { department: '스레드블로그팀 · 검수', role_name: '검수자 (스레드·블로그 팩트체크·과장표현·AI스러움)', role_emoji: '🧐' },

  { department: '유튜브팀 · 리서치', role_name: '심리학 콘텐츠 리서처 (일본 채널 · 다지역 인기 영상 검색)', role_emoji: '🧠' },
  { department: '유튜브팀 · 콘텐츠제작', role_name: '영상 제작 담당 (심리학 유튜브)', role_emoji: '🎬' },
]

// 화면에 보여줄 팀 순서 (총괄이 맨 위, 그 아래 채널별 3개 팀)
export const ANYONE_TEAM_ORDER = ['총괄', '인스타틱톡팀', '스레드블로그팀', '유튜브팀']

export const ANYONE_DEPARTMENT_ORDER = DEFAULT_ANYONE_ROSTER.map((p) => p.department).filter((d, i, arr) => arr.indexOf(d) === i)

// department 값("팀 · 부서" 또는 팀 이름 그 자체)에서 팀 이름만 뽑아냄
export function getTeamFromDepartment(department) {
  if (!department) return '기타'
  const [team] = department.split(' · ')
  return team
}
