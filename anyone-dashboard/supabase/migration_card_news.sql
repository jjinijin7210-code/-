-- ============================================================
-- 마이그레이션: 카드뉴스 보관함 테이블 추가 (2026-07-29)
-- 이미 schema.sql을 한 번 실행한 기존 프로젝트라면, 이 파일만 Supabase SQL Editor에서
-- 실행하면 됩니다 (schema.sql 전체를 다시 실행할 필요 없음).
-- ============================================================

create table card_news_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  cards jsonb not null default '[]'::jsonb,   -- [{page, headline, body, visual}, ...]
  photos jsonb not null default '[]'::jsonb,   -- 첨부 사진 [{dataUrl, caption}, ...]
  images jsonb not null default '[]'::jsonb,   -- 렌더링된 PNG (base64 data URL) 배열
  card_count int not null default 7,
  topic text,
  created_at timestamptz not null default now()
);

alter table card_news_drafts enable row level security;

create policy "본인 데이터만 접근 - card_news_drafts" on card_news_drafts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
