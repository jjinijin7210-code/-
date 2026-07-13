import { Router } from 'express'
import { callClaude } from '../lib/anthropicClient.js'
import { buildReviewMessages, parseReviewResponse, combineStageResults, REVIEW_STAGES, STAGE_CHECK_KEYS } from '../lib/reviewParser.js'

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
      const text = await callClaude({ system, messages, maxTokens: 512 })
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

export default router
