-- ============================================================
-- 마이그레이션: google_tokens 테이블 추가 (2026-07-19)
-- 구글 계정 연동(블로거 발행 + 신규 유튜브 업로드) 토큰을 Render 서버의 로컬 파일 대신
-- Supabase에 저장한다. Render 무료 플랜은 재배포/재시작마다 로컬 디스크가 초기화되는데
-- (generated-videos를 Supabase Storage로 옮긴 것과 같은 이유), 로컬 파일 저장 방식으로는
-- 코드를 새로 배포할 때마다 구글 계정을 다시 연결해야 하는 문제가 있었다.
-- 이미 schema.sql을 한 번 실행한 기존 프로젝트라면, 이 파일만 Supabase SQL Editor에서
-- 실행하면 된다 (schema.sql 전체를 다시 실행할 필요 없음).
-- ============================================================

create table google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now()
);

-- 사용자당 한 행만 유지 (연결/재연결 시 upsert)
create unique index google_tokens_unique_user on google_tokens (user_id);

alter table google_tokens enable row level security;

create policy "본인 데이터만 접근 - google_tokens" on google_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
