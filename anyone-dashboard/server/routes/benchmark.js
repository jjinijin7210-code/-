import { Router } from 'express'
import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { searchInstagramHashtag } from '../lib/instagramHashtagClient.js'
import { searchTiktokHashtag } from '../lib/tiktokHashtagClient.js'
import { BENCHMARK_CATEGORIES, getCategoryByLabel } from '../lib/benchmarkCategories.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { ensureCsLink, CS_TRIGGER_KEYWORD } from '../lib/csLink.js'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'
import { generateImage } from '../lib/imageClient.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'

const TOP_PER_HASHTAG = 3 // 해시태그마다 상위 몇 개만 저장할지 (Apify 사용량/비용 절감)
const SOURCING_ROLE = '소싱 담당 (1688 · 쿠팡 교차 확인)'
const WRITER_ROLE = '작성자 (AI 초안 생성)'
const REVIEWER_ROLES = ['검수자 A (1차 - 팩트체크·과장표현·AI스러움)', '검수자 B (교차 검수)', '검수자 C (가독성)']
const CS_ROLE = 'CS 담당 (댓글 트리거 → 인포크 안내)'
// 예전엔 "영상 제작 담당(팬줌 합성·내레이션)"이었는데, 지금 파이프라인은 영상 합성이 아니라
// 썸네일 이미지를 생성하므로 그에 맞게 이름을 바꾸고 실제로 상태를 갱신하게 함(2026-07-19,
// 이 역할이 코드에서 아예 안 건드려져서 "대기"로 멈춰 보이던 문제).
const IMAGE_ROLE = '이미지·썸네일 제작 담당 (AI 이미지 생성)'

function checkAuth(req, res) {
  const { token } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
    return null
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
    return null
  }
  return targetUserId
}

const router = Router()

// 하루 1번 호출 - 일본 인스타/틱톡 인기 게시물을 카테고리별로 수집해 benchmark_reports에 저장.
router.post('/benchmark/collect', async (req, res) => {
  const targetUserId = checkAuth(req, res)
  if (!targetUserId) return

  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, '일본 벤치마킹 수집')
  await setEmployeeStatus(supabase, targetUserId, SOURCING_ROLE, '작업중', '일본 인스타/틱톡 트렌드 수집 중')

  let savedCount = 0
  const errors = []

  try {
    for (const category of BENCHMARK_CATEGORIES) {
      for (const hashtag of category.hashtags) {
        const [igPosts, tiktokPosts] = await Promise.all([
          searchInstagramHashtag({ hashtag, resultsLimit: TOP_PER_HASHTAG }).catch((e) => {
            errors.push(`인스타 #${hashtag}: ${e.message}`)
            return []
          }),
          searchTiktokHashtag({ hashtag, resultsPerPage: TOP_PER_HASHTAG }).catch((e) => {
            errors.push(`틱톡 #${hashtag}: ${e.message}`)
            return []
          }),
        ])

        for (const p of igPosts) {
          const { error } = await supabase.from('benchmark_reports').insert({
            user_id: targetUserId,
            keyword: `#${hashtag}`,
            platform: '인스타그램',
            source_type: '트렌드 도구',
            popularity_score: p.likesCount,
            category: category.label,
            note: `좋아요 ${p.likesCount.toLocaleString()} · 댓글 ${p.commentsCount.toLocaleString()} · 캡션: ${p.caption.slice(0, 80)} · ${p.url || ''}`,
          })
          if (error) errors.push(`저장 실패(IG #${hashtag}): ${error.message}`)
          else savedCount++
        }
        for (const p of tiktokPosts) {
          const { error } = await supabase.from('benchmark_reports').insert({
            user_id: targetUserId,
            keyword: `#${hashtag}`,
            platform: '틱톡',
            source_type: '트렌드 도구',
            popularity_score: p.playCount,
            category: category.label,
            note: `조회수 ${(p.playCount || 0).toLocaleString()} · 좋아요 ${(p.likesCount || 0).toLocaleString()} · 캡션: ${p.caption.slice(0, 80)} · ${p.url || ''}`,
          })
          if (error) errors.push(`저장 실패(틱톡 #${hashtag}): ${error.message}`)
          else savedCount++
        }
      }
    }

    await setEmployeeStatus(supabase, targetUserId, SOURCING_ROLE, '완료', `벤치마킹 ${savedCount}건 수집 완료`)
    await finishAutomationRun(supabase, run?.id, {
      status: errors.length > 0 ? '이슈발생' : '완료',
      summary: `${savedCount}건 저장${errors.length ? `, 오류 ${errors.length}건` : ''}`,
      errorMessage: errors.join(' / '),
    })

    res.json({ ok: true, savedCount, errors })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, SOURCING_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    res.status(502).json({ error: err.message })
  }
})

// 하루 5번(기존 1688 파이프라인 자리) 호출 - 오늘 수집된 벤치마킹 결과를 아이디어 삼아
// 완전히 새로운 문장/이미지로 재구성한 초안을 만들고 3단계 검수까지 거쳐 content_drafts에 저장.
router.post('/benchmark/content-run', async (req, res) => {
  const targetUserId = checkAuth(req, res)
  if (!targetUserId) return

  const { category: categoryLabel, channel } = req.body || {}
  const category = getCategoryByLabel(categoryLabel)
  if (!category) {
    return res.status(400).json({ error: `알 수 없는 카테고리예요: ${categoryLabel}` })
  }
  const targetChannel = channel || '인스타/틱톡'

  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, `콘텐츠 생성 (${category.label})`)
  await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '작업중', `"${category.label}" 카테고리 초안 작성 중`)

  try {
    // 1) 오늘 수집된 벤치마킹 결과 중 이 카테고리에서 인기도 상위 몇 개를 참고 자료로 사용
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data: benchmarks } = await supabase
      .from('benchmark_reports')
      .select('keyword, platform, popularity_score, note')
      .eq('user_id', targetUserId)
      .eq('category', category.label)
      .gte('collected_at', todayStart.toISOString())
      .order('popularity_score', { ascending: false })
      .limit(3)

    const referenceNote =
      benchmarks && benchmarks.length > 0
        ? benchmarks.map((b) => `[${b.platform} ${b.keyword}] ${b.note}`).join('\n')
        : `(오늘 수집된 벤치마킹 자료 없음 - "${category.label}" 카테고리 일반적인 특징으로 작성)`

    // 2) AI 초안 생성 - 참고 자료를 그대로 번역/복제하지 않고 "왜 인기 있는지"만 반영해 새로 재구성
    // (buildDraftUserPrompt의 LOCALIZATION_RULES가 이 원칙을 이미 강제함)
    const topic = `카테고리: ${category.label} (일본 인스타/틱톡 트렌드 벤치마킹 기반)

[필수 지시사항] 게시물 마지막 부분에 "댓글에 '${CS_TRIGGER_KEYWORD}'라고 남겨주시면 관련 정보 보내드릴게요!" 같은
자연스러운 유도 문구를 반드시 포함해서 작성해줘. 이게 없으면 안 돼.`
    const { system: draftSystem, messages: draftMessages } = buildDraftMessages({
      channel: targetChannel,
      topic,
      referenceNote,
    })
    // 1024로는 카테고리에 따라(특히 여행지처럼 서술이 길어지는 주제) JSON이 중간에 잘려서
    // 파싱 실패("AI 응답을 JSON으로 해석하지 못했어요")가 나는 게 실제 운영 중 확인됨(2026-07-18,
    // 하루 5번 자동 파이프라인 중 여행지 슬롯만 3연속 실패) - 여유 있게 늘림
    const draftText = await callClaude({ system: draftSystem, messages: draftMessages, maxTokens: 2000 })
    const draft = parseDraftResponse(draftText)

    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '완료', `"${draft.title}" 초안 작성 완료`)

    // 3) 2중3중 검수 - 반려되면 반려 사유를 보고 AI가 스스로 고쳐서 최대 2번까지 자동 재시도
    // (사람 개입 없는 자동 파이프라인이라, 여기서 포기하면 그 슬롯은 그냥 날아가버림 - 되도록 살려봄)
    const initialReview = await runReviewStages({ title: draft.title, body: draft.body, channel: targetChannel })
    const {
      title: finalTitle,
      body: finalBody,
      review,
      attempts,
    } = await reviseUntilPassOrGiveUp({ title: draft.title, body: draft.body, channel: targetChannel, initialReview })
    draft.title = finalTitle
    draft.body = finalBody
    const passed = review.result === '통과'

    for (const roleName of REVIEWER_ROLES) {
      const task = passed
        ? attempts > 0
          ? `검수 통과 (AI 자동 수정 ${attempts}회 후)`
          : '검수 통과'
        : review.reasons[0] || '반려'
      await setEmployeeStatus(supabase, targetUserId, roleName, passed ? '완료' : '이슈발생', task)
    }

    // 4) 실제 스크래핑한 원본 사진을 그대로 쓰지 않기 위해, 주제에 맞는 완전히 새로운 이미지를 AI로 생성
    // (실존 인물 얼굴 클로즈업 없이, 사물/반려동물/풍경/소품 중심으로 그려달라고 명시)
    // 상품소싱·여행지는 실제 일본 인기 콘텐츠 리서치 결과 "TOP5"/"○○選" 같은 굵은 텍스트가
    // 박힌 화려한 랭킹형 썸네일이 잘 먹히는 걸 확인해서(2026-07-18) 이 두 카테고리만 그 스타일로,
    // 나머지 카테고리는 기존처럼 텍스트 없는 깔끔한 사진 스타일 그대로 유지함.
    const THUMBNAIL_STYLE_CATEGORIES = ['상품소싱', '여행지']
    await setEmployeeStatus(supabase, targetUserId, IMAGE_ROLE, '작업중', `"${draft.title}" 이미지 생성 중`)
    const images = []
    try {
      const imagePrompt = THUMBNAIL_STYLE_CATEGORIES.includes(category.label)
        ? `일본 SNS(인스타/틱톡)에서 잘 먹히는 화려한 랭킹형 썸네일 이미지. 배경은 "${draft.title}"
주제에 어울리는 상품/장소 사진, 그 위에 굵고 큼직한 일본어 텍스트로 임팩트 있게 제목을 얹은
스타일 (예: "TOP5", "○○選" 같은 리스트형 썸네일). 텍스트는 눈에 확 띄게 크고 두꺼운 폰트,
배경보다 텍스트가 먼저 보이도록. 실존 인물의 얼굴을 클로즈업으로 그리지 말 것.
저작권 문제 없는 완전히 새로운 창작 이미지여야 함.`
        : `"${draft.title}"라는 SNS 게시물에 어울리는 사진 스타일 이미지. ${category.label} 분위기.
실존 인물의 얼굴을 클로즈업으로 그리지 말고, 사물·반려동물·풍경·소품 중심의 따뜻하고 감성적인 구도로.
저작권 문제 없는 완전히 새로운 창작 이미지여야 함.`
      const dataUrl = await generateImage({ prompt: imagePrompt })
      images.push({
        id: crypto.randomUUID(),
        kind: 'image',
        filename: `benchmark-${Date.now()}.png`,
        mime_type: 'image/png',
        size: dataUrl.length,
        data_url: dataUrl,
        note: `일본 벤치마킹(${category.label}) 기반 AI 생성 이미지`,
        created_at: new Date().toISOString(),
      })
      await setEmployeeStatus(
        supabase,
        targetUserId,
        IMAGE_ROLE,
        '완료',
        `"${draft.title}" ${THUMBNAIL_STYLE_CATEGORIES.includes(category.label) ? '랭킹형 썸네일' : '이미지'} 생성 완료`
      )
    } catch (imgErr) {
      console.error('[benchmark/content-run] 이미지 생성 실패, 이미지 없이 저장:', imgErr.message)
      await setEmployeeStatus(supabase, targetUserId, IMAGE_ROLE, '이슈발생', imgErr.message)
    }

    // 5) content_drafts에 저장
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
        source: `일본 벤치마킹 기반 자동 생성 (카테고리: ${category.label})`,
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

    await setEmployeeStatus(supabase, targetUserId, CS_ROLE, '완료', 'CS 트리거 링크 연결 완료')

    for (const stage of review.stages) {
      const { error: logError } = await supabase.from('review_log').insert({
        user_id: targetUserId,
        draft_id: savedDraft.id,
        reviewer_role: `검수자(AI) - ${stage.stage}`,
        check_type: stage.stage,
        result: stage.result,
        reason: stage.reasons?.join(' / ') || '',
      })
      if (logError) console.error('[benchmark/content-run] review_log 저장 실패:', logError.message)
    }

    await finishAutomationRun(supabase, run?.id, {
      status: passed ? '완료' : '이슈발생',
      summary: `"${draft.title}" (${passed ? '통과' : '반려'}${attempts > 0 ? `, AI 자동 수정 ${attempts}회` : ''})`,
    })

    const resultLine = passed
      ? `✅ 통과 - 발행 대기 중`
      : `⚠️ 반려 - ${review.reasons[0] || '사유 미기재'}`
    await sendTelegramMessage(
      `🤖 애니원 자동 생성 (${category.label})\n\n"${draft.title}"\n${resultLine}${attempts > 0 ? `\n(AI 자동 수정 ${attempts}회 후)` : ''}`
    )

    res.json({ ok: true, draftId: savedDraft.id, status: savedDraft.status, review })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 애니원 자동 생성 (${category.label}) 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

export default router
