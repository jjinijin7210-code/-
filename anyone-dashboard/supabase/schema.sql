-- ============================================================
-- 애니원(AnyOne) 대시보드 - Supabase 스키마
-- 계획서 8개 데이터 구조 + Luna 스튜디오 조직도(luna_staff)를 테이블로 변환
-- 이 파일 전체를 Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- ============================================================

-- 공통: updated_at 자동 갱신용 함수
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- 1. 직원 현황 (employee_status)
-- 리서처/작성자/검수자/발행담당/모니터링담당/매니저 등 AI 직원 역할별 작업 상태
-- ------------------------------------------------------------
create table employee_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role_name text not null,              -- 예: 리서처, 작성자, 검수자, 발행 담당, 모니터링 담당, 최종 매니저
  role_emoji text default '🤖',
  status text not null default '대기',   -- 대기 / 작업중 / 완료 / 이슈발생
  current_task text,                     -- 지금 하고 있는 작업 설명
  note text,
  updated_at timestamptz not null default now()
);
create trigger trg_employee_status_updated
  before update on employee_status
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 2. 콘텐츠 초안 (content_drafts)
-- 블로그/스레드/인스타/틱톡/네이버클립 초안 + 검수 상태 + CS 트리거 키워드
-- ------------------------------------------------------------
create table content_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  platform text not null default '블로그(네이버)-인테리어/생활', -- 블로그(네이버)-인테리어/생활 / 블로그(네이버)-푸드 / 블로그(구글 Blogger) / 스레드 / 인스타/틱톡
  category text default '인테리어/생활용품',      -- 인테리어/생활용품 / 푸드쇼핑
  body text,
  images jsonb not null default '[]'::jsonb,   -- 첨부 이미지 (base64)
  hashtags text,                                -- 자유 입력 - 화면에서 파싱해서 #태그 배열로 사용
  link text,
  source text,                                  -- 출처
  author_name text,                             -- 실제 작성자/AI 이름
  review_opinion text,                          -- 검수 의견 요약
  revision_history jsonb not null default '[]'::jsonb, -- 수정 이력 [{note, editor, edited_at}, ...]
  scheduled_at text,                            -- 예약 발행 날짜 (자유 형식 문자열)
  published_url text,                           -- 실제 발행된 URL
  status text not null default '초안',           -- 초안 / 검수중 / 통과 / 반려 / 발행완료
  trigger_keyword text,                          -- CS 키워드 트리거 (예: "핑크")
  cs_link_id uuid,                                -- cs_links 테이블 생성 후 아래에서 FK 제약 추가
  author_role text default '작성자',
  reject_reason text,
  -- 안전 원칙 체크 (계획서 필수 항목) - 저장 전 반드시 확인
  checked_no_real_person_image boolean not null default false,
  checked_no_overseas_reuse boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

-- ------------------------------------------------------------
-- 3. 검수 로그 (review_log)
-- 검수자/매니저가 무엇을 확인했고 무엇을 반려했는지 기록
-- ------------------------------------------------------------
create table review_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  draft_id uuid references content_drafts(id) on delete cascade,
  reviewer_role text not null default '검수자',   -- 검수자 / 최종 매니저
  check_type text not null,                       -- 팩트체크 / 자연스러움(AI스러움) / 식품표시광고법 / 최종승인
  result text not null default '대기',            -- 통과 / 반려 / 대기
  reason text,
  checked_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. 벤치마킹 리포트 (benchmark_reports)
-- 리서처가 찾은 인기 키워드/주제
-- ------------------------------------------------------------
create table benchmark_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  keyword text not null,
  platform text default '블로그',        -- 블로그 / 스레드 / 유튜브
  source_type text default '공식 API',   -- 공식 API / 트렌드 도구
  popularity_score int,
  category text default '인테리어/생활용품',
  note text,
  collected_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. CS 링크 (cs_links)
-- 키워드 트리거 ↔ 인포크링크 매핑
-- ------------------------------------------------------------
create table cs_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger_keyword text not null,
  target_url text not null default 'https://link.inpock.co.kr/jena10',
  category text default '인테리어/생활용품',
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- content_drafts.cs_link_id 에 이제 실제 FK 제약을 추가 (cs_links가 방금 생성되었으므로)
alter table content_drafts
  add constraint fk_content_drafts_cs_link
  foreign key (cs_link_id) references cs_links(id);

-- ------------------------------------------------------------
-- 6. 성과 데이터 (analytics_data)
-- 발행 후 조회수/반응 지표
-- ------------------------------------------------------------
create table analytics_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  draft_id uuid references content_drafts(id) on delete cascade,
  views int default 0,
  likes int default 0,
  comments int default 0,
  cs_trigger_count int default 0,   -- 키워드 트리거로 CS 발송된 횟수
  collected_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. QA 파이프라인 (qa_pipeline) + 검수 이력 (qa_review_steps)
-- Luna Creative Studio 이중 검수 · 교차 검수 강제 워크플로
-- 순서: 담당자 작업 완료 → 내부 QA → 브랜드 검수 → 루나 최종 검수 → 애니 교차 검수 → 진희 최종 승인 → 완료
-- 앞 단계가 통과되지 않으면 다음 단계로 진행할 수 없고, 작업자 본인은 자신의 작업을 검수/승인할 수 없음
-- (강제 규칙은 애플리케이션 코드: src/lib/qaWorkflow.js 에서 처리하고, 아래 컬럼은 그 결과를 저장)
-- ------------------------------------------------------------
create table qa_pipeline (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_name text not null,
  department text default '아트본부',   -- 아트본부 / 영상본부 / 콘텐츠본부 / 브랜드본부 / QA본부 / 연구소
  assignee text not null,               -- 작업 담당자 (이 사람은 이 항목의 검수자가 될 수 없음)
  current_stage int not null default 0, -- 0=내부 QA 대기 ... 5=모든 단계 통과(완료)
  status text not null default '진행중', -- 진행중 / 반려 / 완료
  note text,
  updated_at timestamptz not null default now()
);
create trigger trg_qa_pipeline_updated
  before update on qa_pipeline
  for each row execute function set_updated_at();

create table qa_review_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pipeline_id uuid not null references qa_pipeline(id) on delete cascade,
  stage text not null,                  -- 내부 QA / 브랜드 검수 / 루나 최종 검수 / 애니 교차 검수 / 진희 최종 승인
  reviewer text not null,
  result text not null,                 -- 통과 / 반려
  comment text,
  reject_reason text,
  revision_note text,
  reviewed_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. 루나 요청 (luna_requests)
-- Luna Creative Studio에 넘긴 이미지·영상 작업 요청 + 증거제출 원칙 체크
-- 요청 상태 흐름: 요청 작성 → 전달 → 접수 → 담당자 배정 → 제작 중 → 내부 QA →
--               교차 검수 → 결과 수령 → 진희 승인 → 애니원 등록 → 사용 완료
-- ------------------------------------------------------------
create table luna_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_title text not null,
  request_type text not null default '이미지', -- 이미지 / 영상 / 기타
  department text default '아트본부',
  status text not null default '요청 작성',    -- 11단계 흐름 (위 주석 참고)
  details jsonb not null default '{}'::jsonb, -- 요청 종류별 세부 필드 (채널/비율/스타일/곡명/장면수 등)
  june_reference jsonb, -- June 공식 캐릭터 기준 적용 스냅샷 (버전/기준프롬프트/적용시각)
  -- 증거 제출 원칙 (Luna 계획서: "완료했습니다"만으로 종료 금지)
  evidence_summary boolean not null default false,   -- 작업 요약 제출 여부
  evidence_result boolean not null default false,    -- 작업 결과 제출 여부
  evidence_review boolean not null default false,     -- 검수 결과 제출 여부
  evidence_suggestion boolean not null default false, -- 개선/다음작업 제안 제출 여부
  evidence_screenshot boolean not null default false, -- 실행 화면 스크린샷 첨부 완료 여부 (실제 첨부 없이는 앱에서 체크 불가)
  attachments jsonb not null default '[]'::jsonb,     -- 실행화면/테스트로그/오류화면/작업파일/전후비교 실제 첨부파일들 (base64)
  note text,
  requested_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 9. Luna 스튜디오 직원 (luna_staff)
-- Luna Creative Studio 조직도 + 직원별 업무 상태
-- ------------------------------------------------------------
create table luna_staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  department text not null default '아트본부', -- 디렉터 / 아트본부 / 영상본부 / 콘텐츠본부 / 브랜드본부 / QA본부 / 연구소
  role_name text not null,                     -- 예: 아트 디렉터, 캐릭터 디자이너 ...
  status text not null default '대기',
  -- 대기 / 업무 접수 / 작업 중 / 내부 검수 중 / 수정 중 / 교차 검수 중 / 진희 승인 대기 / 완료 / 반려
  current_task text,
  note text,
  updated_at timestamptz not null default now()
);
create trigger trg_luna_staff_updated
  before update on luna_staff
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 10. June 캐릭터 관리실 (june_character)
-- June 공식 캐릭터 기준을 버전으로 관리. is_active=true인 버전이 "지금의 공식 기준"이며,
-- 루나 요청서에 자동으로 반영됨 (src/lib/juneCharacter.js 참고)
-- ------------------------------------------------------------
create table june_character (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  version text not null,
  is_active boolean not null default false,
  views jsonb not null default '[]'::jsonb, -- 앞면/측면/뒷면 레퍼런스 이미지 (base64)
  face text,
  hair text,
  outfit text,
  expression text,
  pose text,
  color text,
  forbidden_elements text,
  base_prompt text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_june_character_updated
  before update on june_character
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 11. 브랜드 센터 (brands)
-- AnyOne / Luna Creative Studio / June / 트롯충전소 / 제나 스튜디오 브랜드 가이드
-- ------------------------------------------------------------
create table brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  logo jsonb not null default '[]'::jsonb,
  colors text,
  fonts text,
  tone text,
  image_style text,
  forbidden_expressions text,
  representative_character text,
  default_hashtags text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_brands_updated
  before update on brands
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 12. 에셋 보관함 (assets)
-- 이미지/썸네일/로고/배너/캐릭터/영상/음원/프롬프트/문서/게시물 완성본
-- ------------------------------------------------------------
create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brand text not null,
  category text not null default '이미지',
  creator text,
  created_date text, -- 자유 형식 날짜 문자열 (예: 2026-07-20)
  copyright_status text not null default '자체 제작',
  approval_status text not null default '대기',
  version text,
  linked_post_id uuid references content_drafts(id) on delete set null,
  files jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_assets_updated
  before update on assets
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 13. 아침 브리핑 (briefings)
-- 화면에서 생성/저장하는 브리핑 (자동 발송은 별도 서버 작업 - 미구현)
-- ------------------------------------------------------------
create table briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  briefing_date text not null, -- YYYY-MM-DD
  content text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS (Row Level Security) 설정
-- 개인 도구지만, 계정 단위로 데이터를 분리해두어 안전하게 사용
-- ============================================================
alter table employee_status enable row level security;
alter table content_drafts enable row level security;
alter table review_log enable row level security;
alter table benchmark_reports enable row level security;
alter table cs_links enable row level security;
alter table analytics_data enable row level security;
alter table qa_pipeline enable row level security;
alter table qa_review_steps enable row level security;
alter table luna_requests enable row level security;
alter table luna_staff enable row level security;
alter table june_character enable row level security;
alter table brands enable row level security;
alter table assets enable row level security;
alter table briefings enable row level security;

-- 각 테이블에 대해 "본인 데이터만 조회/수정" 정책 적용
do $$
declare
  t text;
  tables text[] := array[
    'employee_status', 'content_drafts', 'review_log', 'benchmark_reports',
    'cs_links', 'analytics_data', 'qa_pipeline', 'qa_review_steps',
    'luna_requests', 'luna_staff', 'june_character', 'brands', 'assets', 'briefings'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy "본인 데이터만 접근 - %1$s" on %1$s
       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t
    );
  end loop;
end $$;
