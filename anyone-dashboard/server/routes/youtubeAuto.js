// ============================================================
// 유튜브팀 자동 리서치 - 지금은 콘텐츠(영상) 자동 제작까지는 아니고, 여러 나라를 동시에
// 확인하는 인기 영상 트렌드 리서치만 자동으로 돌려서 benchmark_reports에 쌓아둠
// (2026-07-19, 3팀 체제 개편 - 유튜브 실제 영상/스크립트 자동 제작은 별도 확장 필요).
// ============================================================

import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { searchPopularVideosMultiRegion } from '../lib/youtubeClient.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'

const router = Router()
const RESEARCHER_ROLE = '트렌드 리서처 (다지역 인기 영상 검색)'
const REGIONS = ['US', 'KR', 'JP']

// 소재가 마르지 않도록 돌아가면서 검색할 주제 후보 (매번 랜덤으로 하나 고름)
const QUERY_POOL = ['home organization ideas', 'life hack gadgets', 'travel hidden gems', 'must have products review']

router.post('/youtube/auto-research', async (req, res) => {
  const { token } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
  }

  const query = QUERY_POOL[Math.floor(Math.random() * QUERY_POOL.length)]
  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, `유튜브 트렌드 리서치 (${query})`)
  await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '작업중', `"${query}" 다지역(${REGIONS.join('/')}) 검색 중`)

  try {
    const videos = await searchPopularVideosMultiRegion({ query, minLikes: 10000, maxResults: 10, regionCodes: REGIONS })
    const top = videos.slice(0, 5)

    for (const v of top) {
      await supabase.from('benchmark_reports').insert({
        user_id: targetUserId,
        keyword: v.title,
        platform: '유튜브',
        source_type: '공식 API',
        category: '인테리어/생활용품',
        popularity_score: v.viewCount,
        note: `[자동 리서치] ${v.channelTitle} · 조회수 ${v.viewCount} · 좋아요 ${v.likeCount} · ${v.region} · ${v.url}`,
      })
    }

    await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '완료', `"${query}" 검색 완료 - 상위 ${top.length}건 저장`)
    await finishAutomationRun(supabase, run?.id, { status: '완료', summary: `"${query}" - ${top.length}건 저장` })
    await sendTelegramMessage(
      `🤖 유튜브팀 트렌드 리서치 (${query})\n\n✅ ${top.length}건 저장됨\n${top.map((v) => `- ${v.title} (${v.region})`).join('\n')}`
    )

    res.json({ ok: true, query, savedCount: top.length })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 유튜브팀 트렌드 리서치 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

export default router
