// ============================================================
// 완료된 콘텐츠를 오래 갖고 있을 필요 없다는 요청(2026-07-29)에 따라, 발행완료 콘텐츠 초안과
// 승인된 에셋을 7일 지나면 자동으로 지운다. 로그인 세션 없는 요청이라 다른 /auto/* 라우트와
// 동일하게 AUTO_RUN_SECRET 토큰으로 보호하고, Render Cron Job이 매일 이 주소를 호출하는
// 방식을 쓴다 (scripts/run-drafts-cleanup.sh 참고).
// ============================================================

import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { deleteFromStorage } from '../lib/supabaseStorage.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'

const router = Router()
const RETENTION_DAYS = 7

function cutoffIso() {
  return new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

// attachments 배열(images/files, [{data_url}, ...])에서 Storage에 올라간 파일들을 먼저 지움 -
// DB row만 지우고 Storage 파일이 안 지워지면 용량이 계속 쌓이므로 (best-effort, 실패해도 진행)
async function deleteAttachmentsFromStorage(rows, column) {
  for (const row of rows) {
    const attachments = row[column]
    if (!Array.isArray(attachments)) continue
    for (const a of attachments) {
      if (a?.data_url?.startsWith('http')) await deleteFromStorage(a.data_url)
    }
  }
}

router.post('/cleanup/run', async (req, res) => {
  const { token, dryRun } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  const supabase = getSupabaseAdmin()
  const cutoff = cutoffIso()
  // dryRun:true면 뭐가 지워질지만 미리보기 - 실제 삭제/Storage 정리는 하지 않음 (처음 실행 전 검증용)
  const runRecord = !dryRun && targetUserId ? await startAutomationRun(supabase, targetUserId, '완료 콘텐츠 자동 정리', { endpoint: '/api/cleanup/run' }) : null

  try {
    // 발행완료 콘텐츠 초안 - published_at이 없는 예전 행은 updated_at으로 대신 판단
    const { data: drafts, error: draftsErr } = await supabase
      .from('content_drafts')
      .select('id, images, published_at, updated_at')
      .eq('status', '발행완료')
    if (draftsErr) throw draftsErr
    const expiredDrafts = (drafts || []).filter((d) => (d.published_at || d.updated_at) < cutoff)

    // 승인된 에셋
    const { data: assets, error: assetsErr } = await supabase
      .from('assets')
      .select('id, files, updated_at')
      .eq('approval_status', '승인')
    if (assetsErr) throw assetsErr
    const expiredAssets = (assets || []).filter((a) => a.updated_at < cutoff)

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        deletedDrafts: expiredDrafts.length,
        deletedAssets: expiredAssets.length,
        draftIds: expiredDrafts.map((d) => d.id),
        assetIds: expiredAssets.map((a) => a.id),
      })
    }

    await deleteAttachmentsFromStorage(expiredDrafts, 'images')
    if (expiredDrafts.length) {
      const { error } = await supabase.from('content_drafts').delete().in('id', expiredDrafts.map((d) => d.id))
      if (error) throw error
    }
    await deleteAttachmentsFromStorage(expiredAssets, 'files')
    if (expiredAssets.length) {
      const { error } = await supabase.from('assets').delete().in('id', expiredAssets.map((a) => a.id))
      if (error) throw error
    }

    const summary = `발행완료 초안 ${expiredDrafts.length}건, 승인 에셋 ${expiredAssets.length}건 삭제 (7일 경과 기준)`
    if (runRecord) await finishAutomationRun(supabase, runRecord.id, { status: '완료', summary })
    res.json({ ok: true, deletedDrafts: expiredDrafts.length, deletedAssets: expiredAssets.length })
  } catch (err) {
    if (runRecord) await finishAutomationRun(supabase, runRecord.id, { status: '이슈발생', errorMessage: err.message })
    res.status(502).json({ error: err.message })
  }
})

export default router
