-- 직원 현황에 "팀" 상위 구분 추가 (총괄팀장 아래 인스타틱톡팀/스레드블로그팀/유튜브팀, 2026-07-19)
-- Supabase SQL Editor에서 한 번만 실행하면 됨 (이미 실행됐으면 다시 돌려도 안전 - IF NOT EXISTS)
alter table employee_status add column if not exists team text default '인스타/틱톡팀';
