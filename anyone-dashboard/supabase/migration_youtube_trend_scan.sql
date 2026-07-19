-- ============================================================
-- 마이그레이션: 유튜브 트렌드 분석 직원용 테이블 추가 (2026-07-19)
-- 이미 schema.sql을 한 번 실행한 기존 프로젝트라면, 이 파일만 Supabase SQL Editor에서
-- 실행하면 됩니다 (schema.sql 전체를 다시 실행할 필요 없음).
-- ============================================================

create table youtube_trend_scan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  genre text not null,
  video_id text not null,
  title text not null,
  description text,
  thumbnail_url text,
  channel_title text,
  published_at timestamptz,
  duration_seconds int,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  hours_since_published numeric,
  views_per_hour numeric,
  like_rate numeric,
  comment_rate numeric,
  trend_score numeric,
  is_rising_24h boolean default false,
  is_rising_7d boolean default false,
  is_low_view_fast_growth boolean default false,
  ai_emotion text,
  ai_hook text,
  ai_topic text,
  ai_expected_audience text,
  video_url text,
  scanned_at timestamptz not null default now()
);

create table youtube_trend_report (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  genre text not null,
  report text not null,
  error_message text,
  created_at timestamptz not null default now()
);

alter table youtube_trend_scan enable row level security;
alter table youtube_trend_report enable row level security;

create policy "본인 데이터만 접근 - youtube_trend_scan" on youtube_trend_scan
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "본인 데이터만 접근 - youtube_trend_report" on youtube_trend_report
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
