-- ============================================================
-- 마이그레이션: cs_reply_log 테이블 추가 (2026-07-17)
-- 인스타그램 댓글 자동 응답 기능이 "이미 답글 보낸 댓글"을 기억해서
-- 같은 댓글에 중복으로 답글을 보내지 않도록 기록하는 테이블입니다.
-- 이미 schema.sql을 한 번 실행한 기존 프로젝트라면, 이 파일만 Supabase SQL Editor에서
-- 실행하면 됩니다 (schema.sql 전체를 다시 실행할 필요 없음).
-- ============================================================

create table cs_reply_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_url text not null,
  commenter_username text not null,
  comment_text text,
  matched_keyword text not null,
  target_url text not null,
  replied_at timestamptz not null default now()
);

-- 같은 게시물의 같은 사람에게는 한 번만 답글을 보내도록 방지
create unique index cs_reply_log_unique_reply on cs_reply_log (user_id, post_url, commenter_username);

alter table cs_reply_log enable row level security;

create policy "본인 데이터만 접근 - cs_reply_log" on cs_reply_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
