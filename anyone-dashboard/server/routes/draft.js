import { Router } from 'express'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, buildTranslateMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { getCurrentWeatherNote } from '../lib/weatherClient.js'

const router = Router()

// 구글 블로그는 해외 독자 대상이라 실제로 게시되는 건 영어 버전이어야 함 (threadBlogAuto.js의
// 자동화와 동일한 방식 - 한국어로 먼저 쓴 뒤 "(영어)"를 붙인 가짜 채널명으로 번역 요청을 걸어서
// promptBuilder의 언어 감지(getTargetLanguage)가 영어로 잡히게 함. 실제 저장되는 platform 값은
// 그대로 '블로그(구글 Blogger)'로 둔다.)
const GOOGLE_BLOG_CHANNEL = '블로그(구글 Blogger)'

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

      if (channel === GOOGLE_BLOG_CHANNEL) {
        // 한국어 초안은 그대로 내보내지 않고, 곧바로 영어로 번역한 버전을 이 채널의 결과로 씀
        // (실제 게시 대상은 영어 버전이므로 - threadBlogAuto.js 자동화와 동일한 원칙)
        const { system: trSystem, messages: trMessages } = buildTranslateMessages({
          targetChannel: `${GOOGLE_BLOG_CHANNEL}(영어)`,
          title: draft.title,
          body: draft.body,
          hashtags: draft.hashtags,
        })
        const trText = await callClaude({ system: trSystem, messages: trMessages, maxTokens: 3000 })
        const translated = parseDraftResponse(trText)
        results.push({ channel, ...translated })
      } else {
        results.push({ channel, ...draft })
      }
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
