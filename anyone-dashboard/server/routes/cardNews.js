// ============================================================
// 카드뉴스 생성 + 이미지 렌더링. luna-one의 완성된 카드뉴스 기능(promptBuilder.js cards
// 플랫폼 + cardImageRenderer.js)을 그대로 이식함 (2026-07-29).
// ============================================================

import { Router } from 'express'
import { callClaudeJson } from '../lib/anthropicClient.js'
import { buildCardNewsMessages, parseCardNewsResponse } from '../lib/promptBuilder.js'
import { renderCardsToImages, CARD_TEMPLATES, DECORATION_STYLES } from '../lib/cardImageRenderer.js'
import { getLatestTrendNote } from '../lib/trendNote.js'
import { uploadToStorage } from '../lib/supabaseStorage.js'
import crypto from 'node:crypto'

const router = Router()

// 주제/원본 자료 -> 카드뉴스 텍스트(JSON: {title, cards}) 생성
router.post('/card-news/generate', async (req, res) => {
  const { topic, sourceArticle, cardCount, photos } = req.body || {}

  if ((!topic || !topic.trim()) && (!sourceArticle || !sourceArticle.trim())) {
    return res.status(400).json({ error: '주제 또는 원본 자료 중 하나는 필수예요.' })
  }

  const count = Math.min(Math.max(Number(cardCount) || 7, 3), 12)
  const photoList = Array.isArray(photos) ? photos : []

  try {
    const trendNote = await getLatestTrendNote()
    const { system, messages } = buildCardNewsMessages({ topic, sourceArticle, cardCount: count, photos: photoList, trendNote })
    const result = await callClaudeJson({
      system,
      messages,
      // 2026-08-02: blogText(카드마다 3~4문장 블로그용 설명) 필드 추가로 카드당 출력량이 늘어서
      // 장수당 예산을 220→380으로, 상한도 4000→6000으로 올림 (luna-one과 동일 조정).
      maxTokens: Math.min(6000, 300 + count * 380),
      parse: (text) => parseCardNewsResponse(text, photoList.length),
    })
    res.json({ ...result, trendNote })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 생성된 카드(JSON) -> 실제 PNG 이미지 배열로 렌더링 (headless Chromium, 계정 세션 무관)
router.post('/card-news/render-images', async (req, res) => {
  const { cards, photos, decoration, template } = req.body || {}
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: '렌더링할 카드가 없어요.' })
  }
  try {
    // 2026-07-30: decoration이 'hearts' 아니면 무조건 'none'으로 뭉개던 버그 수정 - 장식
    // 스타일이 4종(hearts/stars/ribbon/gold)으로 늘었는데 여기서 막고 있었음. template도
    // 새로 추가(7가지 카드뉴스 색상 조합) - 둘 다 실제 등록된 id인지 검증 후 전달.
    const safeDecoration = DECORATION_STYLES.some((d) => d.id === decoration) ? decoration : 'none'
    const safeTemplate = CARD_TEMPLATES.some((t) => t.id === template) ? template : 'neon'
    // renderCardsToImages는 base64 data URL 배열을 돌려주는데, 그대로 클라이언트에 내려주고
    // 저장까지 하면 Supabase 이그레스 초과 원인이 그대로 반복됨(2026-07-29) - 렌더링 직후
    // 바로 Storage에 올리고 URL만 내려줌 (base64 왕복 자체를 없앰).
    const dataUrls = await renderCardsToImages(cards, photos || [], safeDecoration, safeTemplate)
    const images = await Promise.all(
      dataUrls.map(async (dataUrl, i) => {
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
        const buffer = Buffer.from(base64, 'base64')
        return uploadToStorage(buffer, { fileName: `card-news/${Date.now()}-${crypto.randomUUID()}-${i}.png`, contentType: 'image/png' })
      })
    )
    res.json({ images })
  } catch (err) {
    res.status(502).json({ error: `카드 이미지 생성 실패: ${err.message}` })
  }
})

export default router
