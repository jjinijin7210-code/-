-- ============================================================
-- 마이그레이션: automation_runs 테이블 추가 (2026-07-15)
-- 이미 schema.sql을 한 번 실행한 기존 프로젝트라면, 이 파일만 Supabase SQL Editor에서
-- 실행하면 됩니다 (schema.sql 전체를 다시 실행할 필요 없음).
-- ============================================================

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_type text not null,
  status text not null default '진행중',
  summary text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table automation_runs enable row level security;

create policy "본인 데이터만 접근 - automation_runs" on automation_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
