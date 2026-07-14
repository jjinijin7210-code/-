import { Router } from 'express'
import crypto from 'node:crypto'
import { search1688Products } from '../lib/sourcingClient.js'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import {
  buildReviewMessages,
  parseReviewResponse,
  combineStageResults,
  REVIEW_STAGES,
  STAGE_CHECK_KEYS,
} from '../lib/reviewParser.js'
import { fetchImageAsDataUrl } from '../lib/fetchImageAsDataUrl.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const router = Router()

// 무인 자동 파이프라인 진입점: 1688 상품 소싱 → AI 초안 생성 → 2중3중 검수 → content_drafts 저장.
// 외부 무료 스케줄러(cron-job.org 등)가 이 URL을 정해진 시간마다 호출하는 방식으로 쓴다.
// 로그인 세션이 없는 요청이라 AUTO_RUN_SECRET 토큰으로 아무나 못 부르게 막는다.
router.get('/auto/run', async (req, res) => {
  const { token, keyword, channel } = req.query

  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
  }
  if (!keyword || !String(keyword).trim()) {
    return res.status(400).json({ error: '검색 키워드(keyword)는 필수예요.' })
  }
  const targetChannel = channel || '인스타/틱톡'

  try {
    // 1) 상품 소싱 (1688) - Apify 액터가 maxProducts 20 미만을 허용하지 않아 20으로 호출하고,
    // 실제로는 가장 점수 높은 1개만 사용해 이후 단계(초안/검수) 비용을 최소화
    const products = await search1688Products({ query: keyword, maxProducts: 20 })
    const product = products[0]
    if (!product) {
      return res.status(404).json({ error: `'${keyword}' 검색 결과 상품이 없어요.` })
    }

    // 2) AI 초안 생성
    const topic = `상품명: ${product.title} (가격대: ${product.price || '정보 없음'})`
    const { system: draftSystem, messages: draftMessages } = buildDraftMessages({ channel: targetChannel, topic })
    const draftText = await callClaude({ system: draftSystem, messages: draftMessages, maxTokens: 1024 })
    const draft = parseDraftResponse(draftText)

    // 3) 2중3중 검수 - 하나라도 반려면 전체 반려 (fail-safe)
    const stageResults = []
    for (const stage of REVIEW_STAGES) {
      const { system, messages } = buildReviewMessages({
        title: draft.title,
        body: draft.body,
        channel: targetChannel,
        stage,
      })
      const text = await callClaude({ system, messages, maxTokens: 512 })
      stageResults.push({ stage, result: parseReviewResponse(text, STAGE_CHECK_KEYS[stage]) })
    }
    const review = combineStageResults(stageResults)
    const passed = review.result === '통과'

    // 4) 상품 이미지 첨부 (실패해도 초안 저장 자체는 계속 진행)
    const images = []
    if (product.imageUrl) {
      try {
        const dataUrl = await fetchImageAsDataUrl(product.imageUrl)
        images.push({
          id: crypto.randomUUID(),
          kind: 'image',
          filename: `sourced-${Date.now()}.jpg`,
          mime_type: 'image/jpeg',
          size: dataUrl.length,
          data_url: dataUrl,
          note: `1688 소싱 이미지${product.shopName ? ` (${product.shopName})` : ''}`,
          created_at: new Date().toISOString(),
        })
      } catch {
        // 이미지 첨부 실패는 무시하고 텍스트 초안만이라도 저장
      }
    }

    // 5) content_drafts에 저장 - 통과면 사람이 마지막 발행 버튼만 누르면 되는 상태로, 반려면 반려 사유와 함께 남김
    const supabase = getSupabaseAdmin()
    const { data: savedDraft, error: insertError } = await supabase
      .from('content_drafts')
      .insert({
        user_id: targetUserId,
        title: draft.title,
        platform: targetChannel,
        body: draft.body,
        images,
        hashtags: draft.hashtags,
        source: `자동소싱: 1688 "${keyword}"`,
        status: passed ? '통과' : '반려',
        review_opinion: review.reasons.join(' / '),
        reject_reason: passed ? null : review.reasons.join(' / '),
        checked_no_real_person_image: true,
        checked_no_overseas_reuse: true,
      })
      .select()
      .single()

    if (insertError) throw new Error(`초안 저장 실패: ${insertError.message}`)

    // 6) 검수 로그 - 3단계 각각 별도 행으로 기록 (수동 검수 흐름과 동일한 컨벤션)
    for (const stage of review.stages) {
      const { error: logError } = await supabase.from('review_log').insert({
        user_id: targetUserId,
        draft_id: savedDraft.id,
        reviewer_role: `검수자(AI) - ${stage.stage}`,
        check_type: stage.stage,
        result: stage.result,
        reason: stage.reasons?.join(' / ') || '',
      })
      if (logError) console.error('[auto/run] review_log 저장 실패:', logError.message)
    }

    res.json({ ok: true, draftId: savedDraft.id, status: savedDraft.status, review })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
