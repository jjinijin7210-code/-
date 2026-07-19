-- ============================================================
-- 마이그레이션: automation_runs.draft_id 추가 (2026-07-19)
-- 이미 automation_runs 테이블이 있는 기존 프로젝트라면, 이 파일만 Supabase SQL Editor에서
-- 실행하면 됩니다. 실행 로그에서 그 실행이 만든 초안으로 바로 이동할 수 있게 해줍니다.
-- ============================================================

alter table automation_runs
  add column if not exists draft_id uuid references content_drafts(id) on delete set null;
