import { Router } from 'express'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, parseDraftResponse } from '../lib/promptBuilder.js'

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

export default router
