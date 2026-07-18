import { Router } from 'express'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, buildTranslateMessages, parseDraftResponse } from '../lib/promptBuilder.js'

const router = Router()

router.post('/draft', async (req, res) => {
  const { channel, topic, referenceNote } = req.body || {}

  if (!channel || !topic || !topic.trim()) {
    return res.status(400).json({ error: '채널과 주제(topic)는 필수예요.' })
  }

  try {
    const { system, messages } = buildDraftMessages({ channel, topic, referenceNote })
    const text = await callClaude({ system, messages, maxTokens: 1024 })
    const draft = parseDraftResponse(text)
    res.json(draft)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 완성된 초안을 다른 언어 채널로 현지화(번역) - 직역이 아니라 자연스럽게 다시 씀
router.post('/draft/translate', async (req, res) => {
  const { targetChannel, title, body, hashtags } = req.body || {}

  if (!targetChannel || !title || !body) {
    return res.status(400).json({ error: 'targetChannel, title, body는 필수예요.' })
  }

  try {
    const { system, messages } = buildTranslateMessages({ targetChannel, title, body, hashtags })
    const text = await callClaude({ system, messages, maxTokens: 1024 })
    const draft = parseDraftResponse(text)
    res.json(draft)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
