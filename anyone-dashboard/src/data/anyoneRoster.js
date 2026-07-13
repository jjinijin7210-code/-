// 애니원(AnyOne) 자체 팀 조직도 기본값
// (계획서 "2. 전체 구조 — AI 직원 팀 구성" 섹션 그대로 반영)
// Luna 스튜디오와 같은 방식으로 부서별로 묶어서 보여주기 위한 순수 데이터 모듈.

export const DEFAULT_ANYONE_ROSTER = [
  { department: '리서치', role_name: '리서처', role_emoji: '🔍' },
  { department: '콘텐츠 제작', role_name: '작성자 A (블로그·인테리어/생활)', role_emoji: '✍️' },
  { department: '콘텐츠 제작', role_name: '작성자 B (블로그·푸드)', role_emoji: '✍️' },
  { department: '콘텐츠 제작', role_name: '작성자 C (스레드)', role_emoji: '✍️' },
  { department: '현지화', role_name: '번역/현지화 담당 (한국어)', role_emoji: '🌐' },
  { department: '현지화', role_name: '번역/현지화 담당 (영어)', role_emoji: '🌐' },
  { department: '현지화', role_name: '번역/현지화 담당 (일본어)', role_emoji: '🌐' },
  { department: '검수', role_name: '검수자 (팩트체커·1차)', role_emoji: '✅' },
  { department: '검수', role_name: '최종 매니저 (2차)', role_emoji: '🧑‍💼' },
  { department: '성과 분석', role_name: '데이터 분석/방향성 담당', role_emoji: '📊' },
  { department: '성과 분석', role_name: '성과 부진 원인 파악 담당', role_emoji: '🩺' },
  { department: '발행·CS', role_name: '발행 담당', role_emoji: '📤' },
  { department: '발행·CS', role_name: 'CS 응대 담당', role_emoji: '📤' },
  { department: '영상 (3단계 예정)', role_name: '영상 제작 담당', role_emoji: '🎬' },
]

export const ANYONE_DEPARTMENT_ORDER = [
  '리서치',
  '콘텐츠 제작',
  '현지화',
  '검수',
  '성과 분석',
  '발행·CS',
  '영상 (3단계 예정)',
]
