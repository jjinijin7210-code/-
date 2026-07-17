-- ============================================================
-- 마이그레이션: content_drafts에 "추가로 할 일" 표시 컬럼 추가 (2026-07-17)
-- 검수는 통과했지만 아직 손이 더 가는 초안(이미지 직접 제작 필요 / 인포크에 상품 등록 필요)을
-- 목록에서 한눈에 구분할 수 있게 하는 용도입니다.
-- 이미 schema.sql을 한 번 실행한 기존 프로젝트라면, 이 파일만 Supabase SQL Editor에서
-- 실행하면 됩니다 (schema.sql 전체를 다시 실행할 필요 없음).
-- ============================================================

alter table content_drafts
  add column needs_custom_image boolean not null default false,
  add column needs_inpock_registration boolean not null default false;
