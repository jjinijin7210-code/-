import { Router } from 'express'
import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { searchInstagramHashtag } from '../lib/instagramHashtagClient.js'
import { searchTiktokHashtag } from '../lib/tiktokHashtagClient.js'
import { BENCHMARK_CATEGORIES, getCategoryByLabel } from '../lib/benchmarkCategories.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { callClaudeJson } from '../lib/anthropicClient.js'
import { buildDraftMessages, buildTranslateMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { getRecentDraftTitles } from '../lib/topicRotation.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'
import { generateImage } from '../lib/imageClient.js'
import { searchPhotos, fetchPhotoAsDataUrl } from '../lib/pexelsClient.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'

const TOP_PER_HASHTAG = 3 // 해시태그마다 상위 몇 개만 저장할지 (Apify 사용량/비용 절감)
const SOURCING_ROLE = '소싱 담당 (1688 · 쿠팡 교차 확인)'
const WRITER_ROLE = '작성자 (AI 초안 생성)'
const REVIEWER_ROLES = ['검수자 A (1차 - 팩트체크·과장표현·AI스러움)', '검수자 B (교차 검수)', '검수자 C (가독성)']
// 한국어 초안이 통과하면 영어/일본어로 자동 번역+검수까지 이어감(2026-07-19,
// 원래 조직도에 있던 언어별 번역 담당을 실제로 자동화에 연결).
// 2026-07-21 사용자 결정: 실제 계정(anyone.living/anyonejin)이 일본 타겟 하나뿐이라 영어 번역은
// 끄고 일본어만 생성함 - 영어 버전이 같은 계정에 섞여 올라가는 문제가 있었음.
const TRANSLATOR_ROLES = { '인스타/틱톡(일본어)': '번역/현지화 담당 (일본어)' }
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

// 하루 1번 호출 - 인스타/틱톡 인기 게시물을 카테고리별로 수집해 benchmark_reports에 저장.
// 2026-07-19: 동물/재밌는영상 카테고리는 일본 한정이 아니라 해외 전반에서 검색(해시태그가 영어)
// - 최종 게시물은 일본어로 번역돼 일본 채널에 올라감.
router.post('/benchmark/collect', async (req, res) => {
  const targetUserId = checkAuth(req, res)
  if (!targetUserId) return

  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, '일본 벤치마킹 수집', {
    endpoint: '/api/benchmark/collect',
    payload: {},
  })
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
  const run = await startAutomationRun(supabase, targetUserId, `콘텐츠 생성 (${category.label})`, {
    endpoint: '/api/benchmark/content-run',
    payload: { category: category.label, channel: targetChannel },
  })
  await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '작업중', `"${category.label}" 카테고리 초안 작성 중`)

  try {
    // 1) 오늘 수집된 벤치마킹 결과 중 이 카테고리에서 인기도 상위 몇 개를 참고 자료로 사용
    // 2026-07-19: 동물/재밌는영상 카테고리로 바뀌면서 "인기 많고 좋아요 1만 이상"만 참고하기로
    // 함(사용자 결정) - 기준 미달이면 아래 fallback 문구로 "오늘 자료 없음" 처리됨.
    const MIN_POPULARITY_SCORE = 10000
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    // 2026-07-26: 이 카테고리가 하루 최대 4번(00,04,08,12시)까지 돌기 때문에, "오늘 수집된 상위
    // 3개"를 그대로 고정 조회하면 같은 날 여러 번 도는 슬롯이 전부 똑같은 참고자료를 받아서
    // 사실상 같은 내용이 반복 생성되는 문제가 있었음(사용자 보고) - 후보를 3개가 아니라 넉넉히
    // 8개 뽑아두고, 오늘 이미 참고로 쓴 키워드는 아래에서 제외한 뒤 남은 것 중 상위 3개만 씀.
    const { data: benchmarkCandidates } = await supabase
      .from('benchmark_reports')
      .select('keyword, platform, popularity_score, note')
      .eq('user_id', targetUserId)
      .eq('category', category.label)
      .gte('collected_at', todayStart.toISOString())
      .gte('popularity_score', MIN_POPULARITY_SCORE)
      .order('popularity_score', { ascending: false })
      .limit(8)

    // 오늘 이 카테고리로 이미 저장된 초안이 참고로 썼던 키워드는 제외(source에 심어둔 표식으로
    // 추적) - 후보가 다 소진되면(같은 키워드밖에 없으면) 어쩔 수 없이 원래 후보 그대로 씀.
    const { data: todaysDrafts } = await supabase
      .from('content_drafts')
      .select('source')
      .eq('user_id', targetUserId)
      .eq('category', category.label)
      .gte('created_at', todayStart.toISOString())
    const usedKeywordsToday = new Set(
      (todaysDrafts || []).flatMap((d) => d.source?.match(/참고키워드:\s*([^)]+)/)?.[1]?.split(',').map((k) => k.trim()) || [])
    )
    const freshCandidates = (benchmarkCandidates || []).filter((b) => !usedKeywordsToday.has(b.keyword))
    const benchmarks = (freshCandidates.length > 0 ? freshCandidates : benchmarkCandidates || []).slice(0, 3)
    const usedKeywordsNote = benchmarks.map((b) => b.keyword).join(', ')

    // 2026-07-24: 국가별 트렌드 비교(marketInsights)는 유튜브 심리학 채널 리서치에서 나온
    // 내용(가족관계/부부심리 등)이라 동물·재밌는영상 카테고리에는 맞지 않음 - 여기 섞여 들어가면서
    // "동물 카테고리인데 갑자기 가족관계 얘기가 나온다"는 실제 버그가 생겨서(사용자 발견) 제거함.
    // 이 카테고리 참고자료는 실제로 수집된 해당 카테고리 벤치마킹 결과만 사용한다.
    const referenceNote =
      benchmarks && benchmarks.length > 0
        ? benchmarks.map((b) => `[${b.platform} ${b.keyword}] ${b.note}`).join('\n')
        : `(오늘 수집된 좋아요 ${MIN_POPULARITY_SCORE.toLocaleString()}건 이상 벤치마킹 자료 없음 - "${category.label}" 카테고리 일반적인 특징으로 작성)`

    // 2026-07-26: 참고자료가 겹치지 않아도 AI가 비슷한 각도로 쓸 수 있어서, 최근에 실제로
    // 저장된 제목들을 직접 프롬프트에 넣어 "이거랑 겹치지 않게" 명시적으로 지시 - 소재 풀
    // 크기와 무관하게 걸리는 마지막 방어선.
    const recentTitles = await getRecentDraftTitles(supabase, targetUserId, {
      platform: '인스타/틱톡(일본어)',
      category: category.label,
      limit: 8,
    })
    const avoidNote =
      recentTitles.length > 0
        ? `\n\n[최근에 이미 만든 제목들 - 아래와 겹치지 않는 다른 소재/각도로 새롭게 써줘]\n${recentTitles.map((t) => `- ${t}`).join('\n')}`
        : ''

    // 2) AI 초안 생성 - 참고 자료를 그대로 번역/복제하지 않고 "왜 인기 있는지"만 반영해 새로 재구성
    // (buildDraftUserPrompt의 LOCALIZATION_RULES가 이 원칙을 이미 강제함)
    // 2026-07-27: "댓글에 정보라고 남겨주시면" CTA 문구 제거(사용자 요청) - 그 트리거워드는
    // 1688 상품소싱(실제 구매 링크가 있는 콘텐츠) 전용으로 쓰기로 함. 이 카테고리(신기한동물/
    // 해외재밌는영상)는 실제 상품이 없는 콘텐츠라 CS 트리거를 붙이는 게 맞지 않았음.
    const topic = `카테고리: ${category.label} (일본 인스타/틱톡 트렌드 벤치마킹 기반)${avoidNote}`
    const { system: draftSystem, messages: draftMessages } = buildDraftMessages({
      channel: targetChannel,
      topic,
      referenceNote,
      needsPhotoQuery: true,
    })
    // 1024로는 카테고리에 따라(특히 여행지처럼 서술이 길어지는 주제) JSON이 중간에 잘려서
    // 파싱 실패("AI 응답을 JSON으로 해석하지 못했어요")가 나는 게 실제 운영 중 확인됨(2026-07-18,
    // 하루 5번 자동 파이프라인 중 여행지 슬롯만 3연속 실패) - 여유 있게 늘림
    // 2026-07-19: 그래도 가끔 파싱이 깨질 수 있는데, 작성자 단계가 유일한 관문이라 여기서
    // 실패하면 그 슬롯 자체가 통째로 날아가는 문제가 있었음(사용자 보고) - 같은 프롬프트로
    // 최대 2번까지 자동 재시도하도록 callClaudeJson으로 교체.
    const draft = await callClaudeJson({
      system: draftSystem,
      messages: draftMessages,
      maxTokens: 2000,
      parse: parseDraftResponse,
    })

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

    // 4) 이미지 준비 - 2026-07-19(사용자 결정: "그 동물의 다른 사진을 찾아서 올리면 되니까"):
    // 실제로 화제가 된 동물/장면을 Pexels(무료 라이선스 스톡사진)에서 검색해서 진짜 사진을 우선
    // 사용함 - 원본 바이럴 게시물을 그대로 퍼가는 게 아니라 같은 동물의 "다른" 정식 라이선스
    // 사진을 쓰는 방식이라 저작권 문제가 없음. Pexels에서 못 찾으면 기존처럼 AI가 완전히 새로운
    // 이미지를 창작하는 방식으로 대체함.
    // 2026-07-19 (추가 피드백): "소갯글도 없이 사진 하나밖에 없다, 사진 몇 장 같이 넣어도
    // 좋겠다" - 인스타 캐러셀처럼 여러 장 붙이도록 확장.
    const MAX_IMAGES_PER_POST = 3
    await setEmployeeStatus(supabase, targetUserId, IMAGE_ROLE, '작업중', `"${draft.title}" 이미지 준비 중`)
    const images = []
    let pickedPhotos = []
    if (draft.photoQuery) {
      try {
        const photos = await searchPhotos({ query: draft.photoQuery, perPage: 10 })
        // 위쪽 결과 중에서 무작위로 최대 MAX_IMAGES_PER_POST장을 골라 다양성을 조금 줌
        const pool = photos.slice(0, Math.max(photos.length, MAX_IMAGES_PER_POST * 2))
        pickedPhotos = pool.sort(() => Math.random() - 0.5).slice(0, MAX_IMAGES_PER_POST)
      } catch (pexelsErr) {
        console.error('[benchmark/content-run] Pexels 검색 실패, AI 이미지 생성으로 대체:', pexelsErr.message)
      }
    }
    try {
      if (pickedPhotos.length > 0) {
        for (const photo of pickedPhotos) {
          const dataUrl = await fetchPhotoAsDataUrl(photo.full)
          images.push({
            id: crypto.randomUUID(),
            kind: 'image',
            filename: `benchmark-${Date.now()}-${images.length}.jpg`,
            mime_type: 'image/jpeg',
            size: dataUrl.length,
            data_url: dataUrl,
            note: `Pexels 무료 스톡사진 (검색어: ${draft.photoQuery}, 촬영: ${photo.photographer})`,
            created_at: new Date().toISOString(),
          })
        }
        await setEmployeeStatus(supabase, targetUserId, IMAGE_ROLE, '완료', `"${draft.title}" 스톡사진 ${images.length}장 사용 완료`)
      } else {
        const imagePrompt = `"${draft.title}"라는 SNS 게시물에 어울리는 사진 스타일 이미지. ${category.label} 분위기.
실존 인물의 얼굴을 클로즈업으로 그리지 말고, 사물·반려동물·풍경·소품 중심의 따뜻하고 감성적인 구도로.
저작권 문제 없는 완전히 새로운 창작 이미지여야 함.`
        for (let i = 0; i < MAX_IMAGES_PER_POST; i++) {
          const dataUrl = await generateImage({ prompt: imagePrompt })
          images.push({
            id: crypto.randomUUID(),
            kind: 'image',
            filename: `benchmark-${Date.now()}-${i}.png`,
            mime_type: 'image/png',
            size: dataUrl.length,
            data_url: dataUrl,
            note: `해외 벤치마킹(${category.label}) 기반 AI 생성 이미지 (Pexels 검색 결과 없음)`,
            created_at: new Date().toISOString(),
          })
        }
        await setEmployeeStatus(supabase, targetUserId, IMAGE_ROLE, '완료', `"${draft.title}" 이미지 ${images.length}장 생성 완료`)
      }
    } catch (imgErr) {
      console.error('[benchmark/content-run] 이미지 준비 실패, 이미지 없이 저장:', imgErr.message)
      await setEmployeeStatus(supabase, targetUserId, IMAGE_ROLE, '이슈발생', imgErr.message)
    }

    // 5) 한국어 초안이 통과했으면 일본어로 번역 + 검수까지 진행하고, 실제로 게시될 그 결과만
    // content_drafts에 저장한다. 한국어 원본은 절대 게시되지 않는 내부 중간 산출물이라 목록에
    // 남기지 않는다 (2026-07-21 사용자 결정: "한국어도 끄고 일본어만 생성해서 인스타 틱톡만
    // 하자" - 실제 계정은 anyone.living/anyonejin 하나뿐이라 한국어/영어 버전을 만들어봤자
    // 게시되지 않거나 같은 계정에 잘못 섞여 올라갈 뿐이었음).
    let savedDraft = null
    let translationPassed = false
    if (passed && targetChannel === '인스타/틱톡') {
      const targetLangChannel = '인스타/틱톡(일본어)'
      const translatorRole = TRANSLATOR_ROLES[targetLangChannel]
      await setEmployeeStatus(supabase, targetUserId, translatorRole, '작업중', `"${draft.title}" 번역 중`)
      try {
        const { system: trSystem, messages: trMessages } = buildTranslateMessages({
          targetChannel: targetLangChannel,
          title: draft.title,
          body: draft.body,
          hashtags: draft.hashtags,
        })
        const trDraft = await callClaudeJson({ system: trSystem, messages: trMessages, maxTokens: 2000, parse: parseDraftResponse })

        const trInitialReview = await runReviewStages({ title: trDraft.title, body: trDraft.body, channel: targetLangChannel })
        const trResult = await reviseUntilPassOrGiveUp({
          title: trDraft.title,
          body: trDraft.body,
          channel: targetLangChannel,
          initialReview: trInitialReview,
        })
        translationPassed = trResult.review.result === '통과'

        // 2026-07-27: 실제 상품 링크가 없는 카테고리라 CS 트리거(정보/핑크 댓글→인포크 안내)는
        // 안 붙임(사용자 요청) - 그 트리거는 1688 상품소싱 콘텐츠 전용으로 남겨둠.
        const { data: trSaved, error: trInsertError } = await supabase
          .from('content_drafts')
          .insert({
            user_id: targetUserId,
            title: trResult.title,
            platform: targetLangChannel,
            category: category.label,
            body: trResult.body,
            images,
            hashtags: trDraft.hashtags,
            // 참고키워드 표식은 위쪽 "오늘 이미 참고로 쓴 키워드 제외" 로직이 다음 실행에서
            // 다시 읽어가는 값이라 형식(참고키워드: a, b, c)을 바꾸면 안 됨.
            source: `일본어 자동 번역 (해외 벤치마킹 기반, 카테고리: ${category.label}, 참고키워드: ${usedKeywordsNote || '없음'})`,
            status: translationPassed ? '통과' : '반려',
            review_opinion: trResult.review.reasons.join(' / '),
            reject_reason: translationPassed ? null : trResult.review.reasons.join(' / '),
            checked_no_real_person_image: true,
            checked_no_overseas_reuse: true,
          })
          .select()
          .single()
        if (trInsertError) throw new Error(trInsertError.message)
        savedDraft = trSaved

        for (const stage of trResult.review.stages) {
          const { error: logError } = await supabase.from('review_log').insert({
            user_id: targetUserId,
            draft_id: trSaved.id,
            reviewer_role: `검수자(AI) - ${stage.stage}`,
            check_type: stage.stage,
            result: stage.result,
            reason: stage.reasons?.join(' / ') || '',
          })
          if (logError) console.error('[benchmark/content-run] review_log 저장 실패:', logError.message)
        }

        await setEmployeeStatus(
          supabase,
          targetUserId,
          translatorRole,
          translationPassed ? '완료' : '이슈발생',
          translationPassed ? `"${trResult.title}" 번역+검수 완료` : `번역 검수 반려 - ${trResult.review.reasons[0] || '사유 미기재'}`
        )
      } catch (trErr) {
        console.error('[benchmark/content-run] 일본어 번역 실패:', trErr.message)
        await setEmployeeStatus(supabase, targetUserId, translatorRole, '이슈발생', trErr.message)
      }
    }

    await finishAutomationRun(supabase, run?.id, {
      status: savedDraft ? (translationPassed ? '완료' : '이슈발생') : '이슈발생',
      summary: savedDraft
        ? `"${savedDraft.title}" (${translationPassed ? '통과' : '반려'}${attempts > 0 ? `, AI 자동 수정 ${attempts}회` : ''})`
        : `한국어 초안 단계에서 중단됨 - ${review.reasons[0] || '사유 미기재'}`,
      draftId: savedDraft?.id,
    })

    const resultLine = savedDraft
      ? translationPassed
        ? '✅ 통과 - 발행 대기 중'
        : `⚠️ 번역 반려 - ${savedDraft.reject_reason || '사유 미기재'}`
      : `⚠️ 한국어 초안 반려 - ${review.reasons[0] || '사유 미기재'}`
    await sendTelegramMessage(
      `🤖 애니원 자동 생성 (${category.label})\n\n"${draft.title}"\n${resultLine}${attempts > 0 ? `\n(AI 자동 수정 ${attempts}회 후)` : ''}`
    )

    res.json({ ok: true, draftId: savedDraft?.id ?? null, status: savedDraft?.status ?? '반려', review })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 애니원 자동 생성 (${category.label}) 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

export default router
