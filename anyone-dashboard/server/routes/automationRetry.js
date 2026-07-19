// ============================================================
// 자동화 실행 로그에서 "이슈발생" 난 실행을 버튼 하나로 재시도.
// 실패했던 실행이 자기 자신을 다시 호출할 때 쓸 endpoint/payload를 이미
// automationLog.js가 저장해뒀으므로, 그 정보를 그대로 재사용해서 같은 내부 API를
// 다시 호출한다 (GitHub Actions 크론이 호출하는 것과 완전히 동일한 경로).
// ============================================================

import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const router = Router()
const PORT = process.env.BACKEND_PORT || process.env.PORT || 3001

router.post('/automation/retry', async (req, res) => {
  const { runId } = req.body || {}
  if (!runId) {
    return res.status(400).json({ error: 'runId가 필요해요.' })
  }
  if (!process.env.AUTO_RUN_SECRET) {
    return res.status(500).json({ error: 'AUTO_RUN_SECRET이 서버에 설정되어 있지 않아요.' })
  }

  const supabase = getSupabaseAdmin()
  const { data: run, error } = await supabase.from('automation_runs').select('*').eq('id', runId).single()
  if (error || !run) {
    return res.status(404).json({ error: '해당 실행 기록을 찾을 수 없어요.' })
  }
  if (!run.endpoint) {
    return res.status(400).json({ error: '이 실행은 재시도 정보가 없어요 (오래된 기록이라 재시도를 지원하지 않아요).' })
  }

  try {
    const response = await fetch(`http://localhost:${PORT}${run.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(run.payload || {}), token: process.env.AUTO_RUN_SECRET }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || `재시도 요청이 실패했어요 (${response.status})`)
    }
    res.json({ ok: true, result: data })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
