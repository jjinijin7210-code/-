// ============================================================
// 관리 팀장 브리핑 - 하루 목표(콘텐츠 5개 이상 생성)가 실제로 지켜지고 있는지
// 매일 아침 10시/저녁 10시 두 번 확인해서 텔레그램으로 진희님께 보고한다.
// 대시보드를 직접 안 열어봐도 "오늘 진행이 안 되고 있다"를 바로 알 수 있게 하는 게 목적
// (2026-07-18, 하루 5번 슬롯 중 일부가 조용히 실패하고 있었는데 며칠간 몰랐던 문제 재발 방지).
// ============================================================

import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'

const router = Router()
const DAILY_TARGET = 5

function checkAuth(req, res) {
  const { token } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
    return null
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
    return null
  }
  return targetUserId
}

// 서버는 UTC로 돌아가므로, "오늘"을 한국시간(KST, UTC+9) 기준 하루로 계산해서
// 그 하루에 해당하는 UTC 시각 범위로 변환한다.
function getTodayKstRangeUtc() {
  const now = new Date()
  const kstWallClock = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kstWallClock.getUTCFullYear()
  const m = kstWallClock.getUTCMonth()
  const d = kstWallClock.getUTCDate()
  const startOfKstDayAsUtcFields = Date.UTC(y, m, d, 0, 0, 0)
  const startUtc = new Date(startOfKstDayAsUtcFields - 9 * 60 * 60 * 1000)
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000)
  return { startUtc, endUtc, label: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

router.post('/briefing/team-lead-report', async (req, res) => {
  const targetUserId = checkAuth(req, res)
  if (!targetUserId) return

  try {
    const supabase = getSupabaseAdmin()
    const { startUtc, endUtc, label } = getTodayKstRangeUtc()

    const { data: drafts, error } = await supabase
      .from('content_drafts')
      .select('title, status, platform')
      .eq('user_id', targetUserId)
      .gte('created_at', startUtc.toISOString())
      .lt('created_at', endUtc.toISOString())
      .order('created_at', { ascending: true })
    if (error) throw new Error(`초안 조회 실패: ${error.message}`)

    const total = drafts.length
    const byStatus = {}
    for (const d of drafts) byStatus[d.status] = (byStatus[d.status] || 0) + 1

    const { data: failedRuns } = await supabase
      .from('automation_runs')
      .select('run_type, error_message')
      .eq('user_id', targetUserId)
      .eq('status', '이슈발생')
      .gte('started_at', startUtc.toISOString())
      .lt('started_at', endUtc.toISOString())

    const onTrack = total >= DAILY_TARGET
    const lines = [
      `📋 관리 팀장 일일 브리핑 (${label})`,
      '',
      onTrack ? `✅ 오늘 목표 달성 - ${total}/${DAILY_TARGET}개` : `⚠️ 오늘 목표 미달 - ${total}/${DAILY_TARGET}개`,
    ]
    if (total > 0) {
      const statusLine = Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(' · ')
      lines.push(`(${statusLine})`)
    }
    if (failedRuns?.length > 0) {
      lines.push('', `🔴 실패한 자동 실행 ${failedRuns.length}건:`)
      for (const r of failedRuns.slice(0, 5)) {
        lines.push(`- ${r.run_type}: ${(r.error_message || '사유 미기재').slice(0, 80)}`)
      }
    }
    if (!onTrack) {
      lines.push('', '대시보드 > 자동화 실행 로그에서 확인해주세요.')
    }

    const message = lines.join('\n')
    await sendTelegramMessage(message)

    res.json({ ok: true, total, target: DAILY_TARGET, onTrack, byStatus, failedRunCount: failedRuns?.length || 0 })
  } catch (err) {
    await sendTelegramMessage(`📋 관리 팀장 브리핑 실패\n\n❌ ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

export default router
