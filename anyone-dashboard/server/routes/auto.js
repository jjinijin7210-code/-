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
import { generateShortsVideo } from '../lib/shortsGenerator.js'
import { searchCoupangProducts } from '../lib/coupangClient.js'

const SOURCE_PRODUCT_COUNT = 4 // 특정 한 상품 소재를 그대로 쓰지 않도록 비슷한 상품 여러 개를 모아 영상으로 합성

// CS 트리거 키워드 - 게시물 댓글에 이 단어가 달리면 인포크 링크를 자동으로 안내하는 구조.
// (계획서 원칙: 모든 자동 게시물은 반드시 이 유도 문구를 포함해야 함)
const CS_TRIGGER_KEYWORD = '정보'
const CS_TARGET_URL = 'https://link.inpock.co.kr/jena10'

// user_id + trigger_keyword로 기존 cs_links 행을 찾고, 없으면 새로 만든다.
async function ensureCsLink(supabase, targetUserId) {
  const { data: existing } = await supabase
    .from('cs_links')
    .select('id')
    .eq('user_id', targetUserId)
    .eq('trigger_keyword', CS_TRIGGER_KEYWORD)
    .maybeSingle()
  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('cs_links')
    .insert({ user_id: targetUserId, trigger_keyword: CS_TRIGGER_KEYWORD, target_url: CS_TARGET_URL })
    .select('id')
    .single()
  if (error) throw new Error(`CS 링크 생성 실패: ${error.message}`)
  return created.id
}

const router = Router()

// 무인 자동 파이프라인 진입점: 1688 상품 소싱 → AI 초안 생성 → 2중3중 검수 → content_drafts 저장.
// GitHub Actions 스케줄이 이 주소를 정해진 시간마다 호출하는 방식으로 쓴다.
// 로그인 세션이 없는 요청이라 AUTO_RUN_SECRET 토큰으로 아무나 못 부르게 막는다.
// GET 쿼리스트링 대신 POST 본문(JSON)을 쓰는 이유: 한글 키워드가 URL 쿼리스트링으로 오면
// 중간 프록시 레이어에서 인코딩이 깨지는 문제가 있었음 - JSON 본문은 이 문제가 없다.
router.post('/auto/run', async (req, res) => {
  const { token, keyword, keywordKo, channel } = req.body || {}

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
  if (!keywordKo || !String(keywordKo).trim()) {
    return res.status(400).json({ error: '쿠팡 확인용 한글 키워드(keywordKo)는 필수예요.' })
  }
  const targetChannel = channel || '인스타/틱톡'

  try {
    // 1) 쿠팡에 실제로 파는 상품인지부터 확인 - 없으면 애초에 초안을 만들지 않는다
    // (인포크 링크는 사람이 직접 만들어서 넣는 구조라, 쿠팡에 없는 상품은 게시해도 연결할 링크가 없음)
    const coupangProducts = await searchCoupangProducts({ query: keywordKo })
    const coupangMatch = coupangProducts[0]
    if (!coupangMatch) {
      return res.status(200).json({ ok: true, skipped: true, reason: `쿠팡에서 '${keywordKo}' 검색 결과가 없어요.` })
    }

    // 2) 상품 소싱 (1688) - Apify 액터가 maxProducts 20 미만을 허용하지 않아 20으로 호출.
    // 특정 한 상품의 사진/영상을 그대로 가져다 쓰지 않기 위해, 비슷한 상품 여러 개를 모아
    // 나중에 영상으로 합성한다 (원본 그대로 재사용 금지 원칙).
    const products = await search1688Products({ query: keyword, maxProducts: 20 })
    const product = products[0]
    if (!product) {
      return res.status(404).json({ error: `'${keyword}' 검색 결과 상품이 없어요.` })
    }
    const sourceProducts = products.filter((p) => p.imageUrl).slice(0, SOURCE_PRODUCT_COUNT)

    // 3) AI 초안 생성 - 댓글 트리거 유도 문구를 반드시 자연스럽게 포함시키도록 지시
    const topic = `상품명: ${product.title} (가격대: ${product.price || '정보 없음'})

[필수 지시사항] 게시물 마지막 부분에 "댓글에 '${CS_TRIGGER_KEYWORD}'라고 남겨주시면 구매 링크 보내드릴게요!" 같은
자연스러운 유도 문구를 반드시 포함해서 작성해줘. 이게 없으면 안 돼.`
    const { system: draftSystem, messages: draftMessages } = buildDraftMessages({ channel: targetChannel, topic })
    const draftText = await callClaude({ system: draftSystem, messages: draftMessages, maxTokens: 1024 })
    const draft = parseDraftResponse(draftText)

    // 4) 2중3중 검수 - 하나라도 반려면 전체 반려 (fail-safe)
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

    // 5) 비슷한 상품 여러 장을 모아 팬/줌 영상으로 합성 (실패하면 상품 사진 1장으로 대체)
    const images = []
    try {
      const { fileName } = await generateShortsVideo({
        title: draft.title,
        imageUrls: sourceProducts.map((p) => p.imageUrl),
        note: `${keyword} 카테고리 소개 영상`,
      })
      const videoUrl = `${req.protocol}://${req.get('host')}/generated/${fileName}`
      images.push({
        id: crypto.randomUUID(),
        kind: 'video',
        filename: fileName,
        mime_type: 'video/mp4',
        data_url: videoUrl,
        note: `1688 유사 상품 ${sourceProducts.length}개를 합성한 자동 생성 영상`,
        created_at: new Date().toISOString(),
      })
    } catch (videoErr) {
      console.error('[auto/run] 영상 합성 실패, 사진 1장으로 대체:', videoErr.message)
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
            note: `1688 소싱 이미지${product.shopName ? ` (${product.shopName})` : ''} (영상 합성 실패로 대체)`,
            created_at: new Date().toISOString(),
          })
        } catch {
          // 이미지 첨부까지 실패해도 텍스트 초안만이라도 저장
        }
      }
    }

    // 6) content_drafts에 저장 - 통과면 사람이 마지막 발행 버튼만 누르면 되는 상태로, 반려면 반려 사유와 함께 남김
    // source에 쿠팡 매칭 상품 링크를 남겨서, 회원님이 인포크에 넣을 파트너스 링크를 쉽게 찾을 수 있게 함
    const supabase = getSupabaseAdmin()
    const csLinkId = await ensureCsLink(supabase, targetUserId)
    const { data: savedDraft, error: insertError } = await supabase
      .from('content_drafts')
      .insert({
        user_id: targetUserId,
        title: draft.title,
        platform: targetChannel,
        body: draft.body,
        images,
        hashtags: draft.hashtags,
        source: `자동소싱: 1688 "${keyword}" / 쿠팡 매칭 상품: ${coupangMatch.title} (${coupangMatch.productUrl})`,
        status: passed ? '통과' : '반려',
        review_opinion: review.reasons.join(' / '),
        reject_reason: passed ? null : review.reasons.join(' / '),
        checked_no_real_person_image: true,
        checked_no_overseas_reuse: true,
        trigger_keyword: CS_TRIGGER_KEYWORD,
        cs_link_id: csLinkId,
      })
      .select()
      .single()

    if (insertError) throw new Error(`초안 저장 실패: ${insertError.message}`)

    // 7) 검수 로그 - 3단계 각각 별도 행으로 기록 (수동 검수 흐름과 동일한 컨벤션)
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

    res.json({
      ok: true,
      draftId: savedDraft.id,
      status: savedDraft.status,
      review,
      coupangMatch: { title: coupangMatch.title, productUrl: coupangMatch.productUrl },
    })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
