import { Router } from 'express'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, buildTranslateMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { getCurrentWeatherNote } from '../lib/weatherClient.js'

const router = Router()

router.post('/draft', async (req, res) => {
  const { channel, topic, referenceNote } = req.body || {}

  if (!channel || !topic || !topic.trim()) {
    return res.status(400).json({ error: '채널과 주제(topic)는 필수예요.' })
  }

  try {
    const { system, messages } = buildDraftMessages({ channel, topic, referenceNote })
    // 블로그는 소제목이 있는 긴 article 형태라 1024토큰으로는 JSON이 중간에 잘려서
    // 파싱 실패가 났음(실측 확인) - 블로그류만 넉넉하게 늘림
    const maxTokens = channel.startsWith('블로그') ? 3000 : 1024
    const text = await callClaude({ system, messages, maxTokens })
    const draft = parseDraftResponse(text)
    res.json(draft)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 기사/링크 등 원본 소재 하나를 여러 채널(스레드/블로그/인스타·틱톡/유튜브 등)용으로 한번에
// 변환 - 2026-07-23, 진희님이 "오늘처럼 기사 넣으면 채널별로 한 번에 만들어줬으면" 요청해서 추가.
// 채널마다 별도 Claude 호출이라 시간이 좀 걸릴 수 있음 - 한 채널이 실패해도 나머지는 계속 진행함.
router.post('/draft/from-source', async (req, res) => {
  const { sourceArticle, channels, topic } = req.body || {}

  if (!sourceArticle || !sourceArticle.trim()) {
    return res.status(400).json({ error: '원본 기사/소재 내용은 필수예요.' })
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: '생성할 채널을 하나 이상 선택해주세요.' })
  }

  // 날씨 조회는 실패해도 전체 생성을 막지 않음 (best-effort)
  const weatherNote = await getCurrentWeatherNote()

  const results = []
  for (const channel of channels) {
    try {
      const { system, messages } = buildDraftMessages({
        channel,
        topic,
        sourceArticle,
        includeSeasonWeather: true,
        weatherNote,
      })
      const maxTokens = channel.startsWith('블로그') ? 3000 : 1024
      const text = await callClaude({ system, messages, maxTokens })
      const draft = parseDraftResponse(text)
      results.push({ channel, ...draft })
    } catch (err) {
      results.push({ channel, error: err.message })
    }
  }

  res.json({ results, weatherNote })
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
