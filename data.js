// AnyOne 직원 현황판 — 직원 명단 및 업무 프리셋
// 기획서 "2. 전체 구조 — AI 직원 팀 구성" 기준
//
// automated: true  -> 활동 로그 기반 자동 상태 표시 (지금 하는 일)
// automated: false -> 아직 자동화되지 않은 역할, 기존 수동 클릭(대기→검토중→통과) 유지

const EMPLOYEES = [
  {
    id: 'researcher',
    name: '리서처',
    emoji: '🔍',
    dept: '리서치',
    automated: true,
    taskPresets: [
      '인기 키워드·게시물 벤치마킹 중',
      '오전 10시 리포트 작성 중',
    ],
  },
  {
    id: 'writerA',
    name: '작성자 A',
    emoji: '✍️',
    dept: '블로그 · 인테리어/생활',
    automated: true,
    taskPresets: [
      '겨울 이불빨래 꿀팁 초안 작성 중',
      '인테리어 소재 초안 작성 중',
    ],
  },
  {
    id: 'writerB',
    name: '작성자 B',
    emoji: '✍️',
    dept: '블로그 · 푸드',
    automated: true,
    taskPresets: [
      '푸드 카테고리 초안 작성 중 (식품표시광고법 체크 포함)',
    ],
  },
  {
    id: 'writerC',
    name: '작성자 C',
    emoji: '✍️',
    dept: '스레드',
    automated: true,
    taskPresets: [
      '스레드용 캐주얼 톤 초안 작성 중',
    ],
  },
  {
    id: 'localizeKo',
    name: '번역/현지화 담당 (한국어)',
    emoji: '🌐',
    dept: '현지화',
    automated: true,
    taskPresets: [
      '해외 소재 한국어 현지화 재구성 중',
    ],
  },
  {
    id: 'localizeEn',
    name: '번역/현지화 담당 (영어)',
    emoji: '🌐',
    dept: '현지화',
    automated: true,
    taskPresets: [
      '소재 영어 현지화 재구성 중',
    ],
  },
  {
    id: 'localizeJp',
    name: '번역/현지화 담당 (일본어)',
    emoji: '🌐',
    dept: '현지화',
    automated: true,
    taskPresets: [
      '소재 일본어 현지화 재구성 중',
    ],
  },
  {
    id: 'reviewer',
    name: '검수자 (팩트체커)',
    emoji: '✅',
    dept: '1차 검수',
    automated: true,
    taskPresets: [
      '사실관계·출처 검증 중',
      '과장·AI스러운 문장 검출 중',
    ],
  },
  {
    id: 'manager',
    name: '최종 매니저',
    emoji: '🧑‍💼',
    dept: '2차 검수',
    automated: true,
    taskPresets: [
      '톤·일관성·정책 준수 종합 점검 중',
    ],
  },
  {
    id: 'dataAnalyst',
    name: '데이터 분석/방향성 담당',
    emoji: '📊',
    dept: '성과 분석',
    automated: true,
    taskPresets: [
      '채널별 성과 지표 수집·분석 중',
      '주간 방향성 리포트 작성 중',
    ],
  },
  {
    id: 'diagnosis',
    name: '성과 부진 원인 파악 담당',
    emoji: '🩺',
    dept: '성과 진단',
    automated: true,
    taskPresets: [
      '저조 콘텐츠 원인 진단 중',
    ],
  },
  {
    id: 'publisher',
    name: '발행 담당',
    emoji: '📤',
    dept: '발행',
    automated: true,
    taskPresets: [
      '발행 전 체크리스트 확인 중',
      '게시/배포 진행 중',
    ],
  },
  {
    id: 'cs',
    name: 'CS 응대 담당',
    emoji: '📤',
    dept: 'CS',
    automated: true,
    taskPresets: [
      '댓글 키워드 트리거 감지·응대 중',
      '인포크링크 발송 중',
    ],
  },
  {
    id: 'videoTeam',
    name: '영상 제작 담당',
    emoji: '🎬',
    dept: '숏폼 (3단계 예정)',
    automated: false, // 아직 자동화 전 — 수동 상태 클릭 유지
  },
  {
    id: 'lunaImage',
    name: '루나 (이미지 담당)',
    emoji: '🎨',
    dept: 'Luna Creative Studio',
    automated: true,
    taskPresets: [
      '루나에게 이미지 요청 발송 중',
      '이미지 생성/원칙 체크(실존인물·저작권) 중',
    ],
  },
  {
    id: 'lunaCrossCheck',
    name: '루나 (교차 검수)',
    emoji: '✅',
    dept: '3차 교차검수',
    automated: true,
    taskPresets: [
      '3차 교차검수 중',
    ],
  },
];

// 수동 상태 순환: 대기 → 검토중 → 통과 → (다시 대기)
const MANUAL_STATUS_CYCLE = [
  { key: 'idle', emoji: '⚪', label: '대기' },
  { key: 'reviewing', emoji: '🟡', label: '검토중' },
  { key: 'passed', emoji: '🔵', label: '통과' },
];
