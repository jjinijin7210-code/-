import { Router } from 'express'
import { callClaude } from '../lib/anthropicClient.js'
import { buildReviewMessages, parseReviewResponse, combineStageResults, REVIEW_STAGES, STAGE_CHECK_KEYS } from '../lib/reviewParser.js'
import { reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'

const router = Router()

router.post('/review', async (req, res) => {
  const { title, body, channel } = req.body || {}

  if (!body || !body.trim()) {
    return res.status(400).json({ error: '검수할 본문(body)이 없어요.' })
  }

  try {
    // 2중3중 검수: 서로 다른 관점의 검수를 순서대로 돌리고, 하나라도 반려면 전체 반려로 처리
    const stageResults = []
    for (const stage of REVIEW_STAGES) {
      const { system, messages } = buildReviewMessages({ title, body, channel, stage })
      // 512로는 반려 사유가 길게 나올 때 응답이 중간에 잘려 JSON 파싱이 깨지는 경우가 있어 여유있게 올림
      const text = await callClaude({ system, messages, maxTokens: 1024 })
      stageResults.push({ stage, result: parseReviewResponse(text, STAGE_CHECK_KEYS[stage]) })
    }
    const review = combineStageResults(stageResults)
    res.json(review)
  } catch (err) {
    // 네트워크/API 자체가 실패한 경우에도 "반려 + 사람 확인 필요"로 안전하게 응답
    res.status(200).json({
      result: '반려',
      reasons: [`AI 검수 호출에 실패했어요: ${err.message}`],
      checks: { fact_check: 'fail', exaggeration: 'fail', ai_tone: 'fail' },
      stages: [],
      parseError: true,
    })
  }
})

// 반려된 초안을 반려 사유에 맞춰 AI가 스스로 고치고, 통과하거나 최대 시도 횟수까지
// 자동으로 반복 검수한다 (사람이 직접 고칠 필요 없이 버튼 한 번으로 처리).
router.post('/review/auto-fix', async (req, res) => {
  const { title, body, channel, reasons } = req.body || {}

  if (!title || !body || !body.trim()) {
    return res.status(400).json({ error: '제목/본문이 필요해요.' })
  }

  try {
    const initialReview = { result: '반려', reasons: Array.isArray(reasons) ? reasons : [] }
    const result = await reviseUntilPassOrGiveUp({ title, body, channel, initialReview })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
