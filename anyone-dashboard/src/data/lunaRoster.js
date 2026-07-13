// Luna Creative Studio 조직도 기본값
// (Luna_Creative_Studio_운영계획서.md의 "조직 구성" 섹션 그대로 반영)
// 순수 데이터 모듈로 분리해서, React 컴포넌트뿐 아니라 Node.js 테스트에서도 그대로 가져다 쓸 수 있게 했습니다.

export const DEFAULT_ROSTER = [
  { department: '디렉터', role_name: '루나 (Creative Director)' },
  { department: '아트본부', role_name: '아트 디렉터' },
  { department: '아트본부', role_name: '캐릭터 디자이너' },
  { department: '아트본부', role_name: '이미지 디자이너' },
  { department: '아트본부', role_name: '썸네일 디자이너' },
  { department: '영상본부', role_name: '영상 감독' },
  { department: '영상본부', role_name: '스토리보드 담당' },
  { department: '영상본부', role_name: '영상 프롬프트 엔지니어' },
  { department: '콘텐츠본부', role_name: '카피라이터' },
  { department: '콘텐츠본부', role_name: 'SNS 콘텐츠 담당' },
  { department: '콘텐츠본부', role_name: '현지화 담당' },
  { department: '브랜드본부', role_name: '브랜드 매니저' },
  { department: '브랜드본부', role_name: '에셋 관리자' },
  { department: 'QA본부', role_name: '품질관리 책임자' },
  { department: 'QA본부', role_name: '디자인 QA' },
  { department: 'QA본부', role_name: '프롬프트 QA' },
  { department: '연구소', role_name: '트렌드 연구원' },
  { department: '연구소', role_name: '아이디어 연구원' },
]

export const DEPARTMENT_ORDER = ['디렉터', '아트본부', '영상본부', '콘텐츠본부', '브랜드본부', 'QA본부', '연구소']

// 계획서 3장(이중 검수와 교차 검수)에서 요청한 9단계 업무 상태
export const LUNA_STATUS_OPTIONS = [
  '대기',
  '업무 접수',
  '작업 중',
  '내부 검수 중',
  '수정 중',
  '교차 검수 중',
  '진희 승인 대기',
  '완료',
  '반려',
]
