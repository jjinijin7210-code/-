// ============================================================
// 스레드/블로그팀 자동 파이프라인 - 인스타/틱톡팀(benchmark.js)과 같은 원리지만
// 일본 벤치마킹 없이 스레드·여행 블로그 채널만 대상으로 함 (2026-07-19, 3팀 체제 개편).
// ============================================================

import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'

const router = Router()
const WRITER_ROLE = '작성자 (스레드·블로그 AI 초안 생성)'
const REVIEWER_ROLE = '검수자 (스레드·블로그 팩트체크·과장표현·AI스러움)'

// 채널마다 카테고리(다른 화면의 CS링크·벤치마킹 등에서 쓰는 구분값)가 다름
function getCategoryForChannel(channel) {
  if (channel === '블로그(네이버)-푸드') return '푸드쇼핑'
  if (channel === '블로그(네이버)-여행') return '여행지'
  return '인테리어/생활용품'
}

// 소재가 마르지 않도록 채널별로 돌아가면서 쓸 주제 후보 (매번 랜덤으로 하나 고름)
const TOPIC_POOL = {
  스레드: ['요즘 일상에서 느낀 소소한 공감 포인트', '20대가 공감할 만한 소비/생활 습관 이야기', '최근 화제가 된 생활 밀착형 팁'],
  '블로그(네이버)-여행': ['국내 근교 숨은 여행지', '일본 도쿄 근교 숨은 여행지', '당일치기로 다녀올 만한 소도시'],
}

router.post('/thread-blog/auto-run', async (req, res) => {
  const { token, channel: requestedChannel } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
  }

  const channel = requestedChannel || '스레드'
  const pool = TOPIC_POOL[channel] || TOPIC_POOL['스레드']
  const topic = pool[Math.floor(Math.random() * pool.length)]

  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, `스레드/블로그 생성 (${channel})`)
  await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '작업중', `"${topic}" 주제로 ${channel} 초안 작성 중`)

  try {
    const { system, messages } = buildDraftMessages({ channel, topic })
    const draftText = await callClaude({ system, messages, maxTokens: channel.startsWith('블로그') ? 3000 : 1024 })
    const draft = parseDraftResponse(draftText)

    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '완료', `"${draft.title}" 초안 작성 완료`)
    await setEmployeeStatus(supabase, targetUserId, REVIEWER_ROLE, '작업중', `"${draft.title}" 검수 중`)

    const initialReview = await runReviewStages({ title: draft.title, body: draft.body, channel })
    const { title: finalTitle, body: finalBody, review, attempts } = await reviseUntilPassOrGiveUp({
      title: draft.title,
      body: draft.body,
      channel,
      initialReview,
    })
    const passed = review.result === '통과'
    await setEmployeeStatus(
      supabase,
      targetUserId,
      REVIEWER_ROLE,
      passed ? '완료' : '이슈발생',
      passed ? `검수 통과${attempts > 0 ? ` (AI 자동 수정 ${attempts}회 후)` : ''}` : review.reasons[0] || '반려'
    )

    const { data: savedDraft, error: insertError } = await supabase
      .from('content_drafts')
      .insert({
        user_id: targetUserId,
        title: finalTitle,
        platform: channel,
        category: getCategoryForChannel(channel),
        body: finalBody,
        images: [],
        hashtags: draft.hashtags,
        // 한국어 콘텐츠는 게시하지 않는다는 정책(2026-07-19) - 이 팀은 아직 번역 사슬이
        // 없어서 일단 표시만 해둠 (실제로 쓰려면 인스타/틱톡팀처럼 번역 자동화를 추가해야 함)
        source: `[번역용 소스 - 직접 게시 금지, 번역 자동화 미구현] 스레드/블로그팀 자동 생성 (주제: ${topic})`,
        status: passed ? '통과' : '반려',
        review_opinion: review.reasons.join(' / '),
        reject_reason: passed ? null : review.reasons.join(' / '),
        checked_no_real_person_image: true,
        checked_no_overseas_reuse: true,
      })
      .select()
      .single()
    if (insertError) throw new Error(`초안 저장 실패: ${insertError.message}`)

    await finishAutomationRun(supabase, run?.id, {
      status: passed ? '완료' : '이슈발생',
      summary: `"${finalTitle}" (${passed ? '통과' : '반려'}${attempts > 0 ? `, AI 자동 수정 ${attempts}회` : ''})`,
    })
    await sendTelegramMessage(
      `🤖 스레드/블로그팀 자동 생성 (${channel})\n\n"${finalTitle}"\n${passed ? '✅ 통과 - 발행 대기 중' : `⚠️ 반려 - ${review.reasons[0] || '사유 미기재'}`}`
    )

    res.json({ ok: true, draftId: savedDraft.id, status: savedDraft.status })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 스레드/블로그팀 자동 생성 (${channel}) 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

export default router
