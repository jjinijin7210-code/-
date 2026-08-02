// ============================================================
// 쇼핑쇼츠 기획실 - 밤사이/틈틈이 가벼운 소재 후보 3개만 먼저 뽑고, 대시보드에서 골라 쓰는
// 벤치마킹 기능 (2026-07-30, "AI 직원 8명" 영상 콘텐츠 기획 담당 패턴 참고). 실제 DB 저장은
// 클라이언트가 useSupabaseTable로 직접 하고(card-news/generate와 동일한 관례), 이 라우트는
// Claude 호출만 담당하는 무상태(stateless) 텍스트 생성기다.
// ============================================================

import { Router } from 'express'
import { callClaudeJson } from '../lib/anthropicClient.js'
import { buildShoppingShortsTopicMessages, parseShoppingShortsTopicsResponse } from '../lib/promptBuilder.js'

const router = Router()

router.post('/shopping-shorts/topics/generate', async (req, res) => {
  const { likedTopics, skippedTopics } = req.body || {}
  try {
    const { system, messages } = buildShoppingShortsTopicMessages({
      likedTopics: Array.isArray(likedTopics) ? likedTopics.slice(0, 8) : [],
      skippedTopics: Array.isArray(skippedTopics) ? skippedTopics.slice(0, 8) : [],
    })
    const topics = await callClaudeJson({
      system,
      messages,
      maxTokens: 800,
      parse: parseShoppingShortsTopicsResponse,
    })
    res.json({ topics })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
