import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import PrincipleChecklist from './PrincipleChecklist'

// 탭 구성: 계획서 3장(1단계 웹 대시보드) + 8개 데이터 구조 기준
const NAV_ITEMS = [
  { to: '/', label: '홈', emoji: '🏠', end: true },
  { to: '/morning-briefing', label: '아침 브리핑', emoji: '🌅' },
  { to: '/employees', label: '직원 현황', emoji: '🧑‍💼' },
  { to: '/drafts', label: '콘텐츠 관리', emoji: '✍️' },
  { to: '/reviews', label: '검수 로그', emoji: '✅' },
  { to: '/benchmark', label: '벤치마킹 리포트', emoji: '🔍' },
  { to: '/cs-links', label: 'CS 링크 관리', emoji: '💬' },
  { to: '/analytics', label: '성과 데이터', emoji: '📊' },
  { to: '/luna-studio', label: 'Luna 스튜디오', emoji: '🌙' },
  { to: '/qa-pipeline', label: 'QA 파이프라인', emoji: '🎨' },
  { to: '/luna-requests', label: '루나 요청', emoji: '📨' },
  { to: '/june-character', label: 'June 캐릭터', emoji: '🧸' },
  { to: '/brand-center', label: '브랜드 센터', emoji: '🏷️' },
  { to: '/asset-vault', label: '에셋 보관함', emoji: '🗂️' },
  { to: '/settings', label: '설정 · 백업', emoji: '⚙️' },
]

export default function Sidebar({ onNavigate }) {
  const { user, signOut } = useAuth()

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-ink text-white">
      {/* 로고 영역 */}
      <div className="border-b border-white/10 px-5 py-5">
        <p className="font-mono text-[11px] tracking-widest text-stamp-amber">ANYONE OPS</p>
        <h1 className="text-lg font-bold">애니원 대시보드</h1>
        <p className="mt-1 text-[11px] text-white/40">
          {isSupabaseConfigured ? '🟢 Supabase 연결됨' : '🟡 로컬 저장 모드 (브라우저)'}
        </p>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-stamp-amber/15 font-semibold text-stamp-amber'
                  : 'text-white/70 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <span aria-hidden>{item.emoji}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* 안전 원칙 - 항상 하단에 고정 노출 */}
      <div className="border-t border-white/10 p-3">
        <PrincipleChecklist compact />
      </div>

      {/* 사용자 정보 / 로그아웃 */}
      <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-white/60">
        <span className="truncate">{user?.email}</span>
        <button
          onClick={signOut}
          className="shrink-0 rounded px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white"
        >
          로그아웃
        </button>
      </div>
    </aside>
  )
}
