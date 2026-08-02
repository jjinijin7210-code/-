-- ============================================================
-- 마이그레이션: 쇼핑쇼츠 기획실 - 기획 후보 테이블 추가 (2026-07-30)
-- "밤사이 후보 3개 생성 -> 아침에 대시보드에서 선택 -> 선택/스킵 이력이 다음 생성에 반영"
-- 루프용. 이미 schema.sql을 한 번 실행한 기존 프로젝트라면, 이 파일만 Supabase SQL
-- Editor에서 실행하면 됩니다 (schema.sql 전체를 다시 실행할 필요 없음).
-- ============================================================

create table shopping_shorts_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  summary text not null default '',
  angle text not null default '',   -- 왜 지금 이 소재인지 (후킹 관점)
  status text not null default '대기' check (status in ('대기', '선택', '스킵')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table shopping_shorts_topics enable row level security;

create policy "본인 데이터만 접근 - shopping_shorts_topics" on shopping_shorts_topics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
