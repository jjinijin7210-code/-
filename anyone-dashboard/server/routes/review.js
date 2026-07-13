import { Router } from 'express'
import { callClaude } from '../lib/anthropicClient.js'
import { buildReviewMessages, parseReviewResponse } from '../lib/reviewParser.js'

const router = Router()

router.post('/review', async (req, res) => {
  const { title, body, channel } = req.body || {}

  if (!body || !body.trim()) {
    return res.status(400).json({ error: '검수할 본문(body)이 없어요.' })
  }

  try {
    const { system, messages } = buildReviewMessages({ title, body, channel })
    const text = await callClaude({ system, messages, maxTokens: 512 })
    const review = parseReviewResponse(text)
    res.json(review)
  } catch (err) {
    // 네트워크/API 자체가 실패한 경우에도 "반려 + 사람 확인 필요"로 안전하게 응답
    res.status(200).json({
      result: '반려',
      reasons: [`AI 검수 호출에 실패했어요: ${err.message}`],
      checks: { fact_check: 'fail', exaggeration: 'fail', ai_tone: 'fail' },
      parseError: true,
    })
  }
})

export default router
