// ============================================================
// 스레드/블로그팀 자동 파이프라인 - 인스타/틱톡팀(benchmark.js)과 같은 원리지만
// 일본 벤치마킹 없이 스레드·여행 블로그 채널만 대상으로 함 (2026-07-19, 3팀 체제 개편).
//
// 2026-07-19 (같은 날 추가 변경, 사용자 결정): 채널별 방향을 아래처럼 재정리함.
// - 스레드: "요즘 일상 공감" 대신 "공감 가는 사연" 위주로. 한국어 그대로, 한국 사이트에 게시.
// - 블로그(네이버): 국내/푸드/생활 등 여러 주제 혼합 대신 "일본 여행지 중 숨은 좋은 곳" 하나로
//   집중. 한국어 그대로, 한국 채널(네이버)에 게시.
// - 블로그(구글 Blogger): "한국 여행지 중 숨은 좋은 곳"을 한국어로 먼저 쓰고 영어로 번역해서
//   게시(해외 독자 대상이라 번역 필요 - 인스타/틱톡팀 번역 캐스케이드와 같은 원리).
// 기존 "한국어 AI 콘텐츠는 어떤 채널이든 직접 게시 금지" 원칙은, 스레드·네이버블로그가 애초에
// 한국 독자를 대상으로 하는 채널이라는 게 확인되어 이 두 채널에 한해 예외로 처리함(사용자 확인).
// ============================================================

import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { callClaudeJson } from '../lib/anthropicClient.js'
import { buildDraftMessages, buildTranslateMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'
import { pickTrendingTopic } from '../lib/threadsSearchClient.js'
import { pickAvoidingRecent, getRecentDraftTitles, getRecentSourceTags } from '../lib/topicRotation.js'

const router = Router()
const WRITER_ROLE = '작성자 (스레드·블로그 AI 초안 생성)'
const REVIEWER_ROLE = '검수자 (스레드·블로그 팩트체크·과장표현·AI스러움)'
const TRANSLATOR_ROLE = '번역/현지화 담당 (영어 - 구글 블로그)'
const GOOGLE_BLOG_CHANNEL = '블로그(구글 Blogger)'

// 채널마다 카테고리(다른 화면의 CS링크·벤치마킹 등에서 쓰는 구분값)가 다름
function getCategoryForChannel(channel) {
  if (channel === '블로그(네이버)-여행') return '여행지'
  if (channel === GOOGLE_BLOG_CHANNEL) return '여행지'
  return '인테리어/생활용품'
}

// 소재가 마르지 않도록 채널별로 돌아가면서 쓸 주제 후보 (트렌드 확인이 실패했을 때의 기본값으로도 씀)
// 2026-07-26: 후보가 3개뿐이라 며칠만 지나도 반복된다는 피드백(사용자 보고) - 같은 방향성
// 안에서 후보 개수를 늘리고, 아래 pickAvoidingRecent()로 최근에 실제로 쓰인 주제는 최대한 피해서 뽑음.
const TOPIC_POOL = {
  스레드: [
    '가족이나 친구 사이에 있었던 마음 짠했던 사연',
    '직장·사회생활에서 있었던 공감되는 사연',
    '살면서 누구나 한 번쯤 겪어봤을 법한 사연',
    '뭉클했던 인간관계 사연',
    '어릴 때는 몰랐는데 나중에 이해하게 된 부모님 마음',
    '작은 친절 하나가 오래 기억에 남았던 사연',
  ],
  '블로그(네이버)-여행': [
    '일본 도쿄 근교 숨은 여행지',
    '일본 오사카·간사이 근교 숨은 여행지',
    '일본 소도시 숨은 온천/명소',
    '일본 규슈 지역 숨은 여행지',
    '일본 도호쿠 지역 숨은 여행지',
    '일본 시골 마을 숨은 명소',
  ],
  [GOOGLE_BLOG_CHANNEL]: [
    '한국 근교 숨은 여행지',
    '당일치기로 다녀올 만한 한국 소도시',
    '한국 로컬이 아는 숨은 명소',
    '한국 바닷가 근처 숨은 여행지',
    '한국 산간 지역 숨은 명소',
    '한국 섬 여행 숨은 명소',
  ],
}

// 스레드는 실제 좋아요/댓글 반응으로 오늘의 주제를 고름 (2026-07-19 요청). 스레드 검색은
// 한글보다 영어 키워드가 훨씬 잘 잡혀서(실측 확인) 검색어 자체는 영어를 쓰되, 실제로 생성되는
// 글 주제(topic)는 한글 그대로 둔다.
const THREAD_TOPIC_CANDIDATES = [
  { topic: '가족이나 친구 사이에 있었던 마음 짠했던 사연', searchQuery: 'heartwarming relatable family friend story' },
  { topic: '직장·사회생활에서 있었던 공감되는 사연', searchQuery: 'relatable workplace story' },
  { topic: '살면서 누구나 한 번쯤 겪어봤을 법한 사연', searchQuery: 'relatable life story everyone experienced' },
  { topic: '뭉클했던 인간관계 사연', searchQuery: 'touching relationship story' },
  { topic: '어릴 때는 몰랐는데 나중에 이해하게 된 부모님 마음', searchQuery: 'story about understanding parents later in life' },
  { topic: '작은 친절 하나가 오래 기억에 남았던 사연', searchQuery: 'small act of kindness memorable story' },
]

async function pickThreadTopic(recentlyUsed) {
  try {
    const { picked, scored } = await pickTrendingTopic(THREAD_TOPIC_CANDIDATES, { maxPostsPerQuery: 8 })
    return {
      topic: picked.topic,
      trendNote: `스레드 반응 확인: ${scored.map((s) => `"${s.searchQuery}"(${s.score})`).join(', ')} 중 최고 반응 주제 선택`,
    }
  } catch (err) {
    console.error('[thread-blog/auto-run] 스레드 트렌드 확인 실패, 랜덤 선택으로 대체:', err.message)
    const pool = TOPIC_POOL['스레드']
    return { topic: pickAvoidingRecent(pool, recentlyUsed), trendNote: null }
  }
}

router.post('/thread-blog/auto-run', async (req, res) => {
  const { token, channel: requestedChannel } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
  }

  const channel = requestedChannel || '스레드'
  const supabase = getSupabaseAdmin()

  // 2026-07-26: 주제 풀이 작아서(3~4개) 순수 랜덤으로 뽑으면 며칠 안에 같은 주제가 반복된다는
  // 피드백(사용자 보고) - source에 심어둔 "주제: xxx" 표식으로 최근에 실제로 쓰인 주제를 찾아서
  // 최대한 피해 뽑음(topicRotation.js 공통 헬퍼).
  const recentlyUsedTopics = await getRecentSourceTags(supabase, targetUserId, { platform: channel, marker: '주제' })

  let trendNote = null
  let topic
  if (channel === '스레드') {
    const picked = await pickThreadTopic(recentlyUsedTopics)
    topic = picked.topic
    trendNote = picked.trendNote
  } else {
    const pool = TOPIC_POOL[channel] || TOPIC_POOL['블로그(네이버)-여행']
    topic = pickAvoidingRecent(pool, recentlyUsedTopics)
  }

  const run = await startAutomationRun(supabase, targetUserId, `스레드/블로그 생성 (${channel})`, {
    endpoint: '/api/thread-blog/auto-run',
    payload: { channel: requestedChannel },
  })
  await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '작업중', `"${topic}" 주제로 ${channel} 초안 작성 중`)

  try {
    // 같은 주제라도 AI가 비슷한 각도로 쓸 수 있어서, 최근 실제 제목도 같이 넣어 다른 각도를
    // 명시적으로 유도함(참고자료 자체가 겹쳐도 걸리는 마지막 방어선, benchmark.js와 동일 원리).
    const recentTitles = await getRecentDraftTitles(supabase, targetUserId, { platform: channel, limit: 8 })
    const avoidNote =
      recentTitles.length > 0
        ? `\n\n[최근에 이미 만든 제목들 - 아래와 겹치지 않는 다른 소재/각도로 새롭게 써줘]\n${recentTitles.map((t) => `- ${t}`).join('\n')}`
        : ''
    const { system, messages } = buildDraftMessages({ channel, topic: topic + avoidNote })
    // 작성자 단계가 유일한 관문이라 JSON 파싱이 한 번 깨지면 그 슬롯이 통째로 날아가는 문제가
    // 있었음(2026-07-19 사용자 보고, benchmark.js와 동일) - 최대 2번까지 자동 재시도.
    const draft = await callClaudeJson({
      system,
      messages,
      maxTokens: channel.startsWith('블로그') ? 3000 : 1024,
      parse: parseDraftResponse,
    })

    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '완료', `"${draft.title}" 초안 작성 완료`)
    await setEmployeeStatus(supabase, targetUserId, REVIEWER_ROLE, '작업중', `"${draft.title}" 검수 중`)

    const initialReview = await runReviewStages({ title: draft.title, body: draft.body, channel })
    const { title: finalTitle, body: finalBody, review, attempts } = await reviseUntilPassOrGiveUp({
      title: draft.title,
      body: draft.body,
      channel,
      initialReview,
    })
    const passed = review.result === '통과'
    await setEmployeeStatus(
      supabase,
      targetUserId,
      REVIEWER_ROLE,
      passed ? '완료' : '이슈발생',
      passed ? `검수 통과${attempts > 0 ? ` (AI 자동 수정 ${attempts}회 후)` : ''}` : review.reasons[0] || '반려'
    )

    // 구글 블로그는 한국어 원고가 그대로 게시 대상이 아니라 영어 번역의 소스이므로 라벨을
    // 다르게 붙임(인스타/틱톡팀과 같은 원칙) - 스레드/네이버블로그는 한국어 그대로 게시되므로 그대로 둠.
    const isTranslationSource = channel === GOOGLE_BLOG_CHANNEL
    const { data: savedDraft, error: insertError } = await supabase
      .from('content_drafts')
      .insert({
        user_id: targetUserId,
        title: finalTitle,
        platform: channel,
        category: getCategoryForChannel(channel),
        body: finalBody,
        images: [],
        hashtags: draft.hashtags,
        source: isTranslationSource
          ? `[번역용 소스 - 직접 게시 금지] 스레드/블로그팀 자동 생성 (주제: ${topic})${trendNote ? ` / ${trendNote}` : ''}`
          : `스레드/블로그팀 자동 생성 (주제: ${topic})${trendNote ? ` / ${trendNote}` : ''}`,
        status: passed ? '통과' : '반려',
        review_opinion: review.reasons.join(' / '),
        reject_reason: passed ? null : review.reasons.join(' / '),
        checked_no_real_person_image: true,
        checked_no_overseas_reuse: true,
      })
      .select()
      .single()
    if (insertError) throw new Error(`초안 저장 실패: ${insertError.message}`)

    // 구글 블로그는 한국어 원고가 검수 통과했으면 영어로 번역 + 검수까지 이어서 진행
    // (해외 독자 대상 채널이라 번역이 있어야 실제로 게시 가능한 콘텐츠가 됨)
    let translation = null
    if (passed && channel === GOOGLE_BLOG_CHANNEL) {
      await setEmployeeStatus(supabase, targetUserId, TRANSLATOR_ROLE, '작업중', `"${finalTitle}" 번역 중`)
      try {
        const { system: trSystem, messages: trMessages } = buildTranslateMessages({
          targetChannel: `${GOOGLE_BLOG_CHANNEL}(영어)`,
          title: finalTitle,
          body: finalBody,
          hashtags: draft.hashtags,
        })
        const trDraft = await callClaudeJson({ system: trSystem, messages: trMessages, maxTokens: 3000, parse: parseDraftResponse })

        const trInitialReview = await runReviewStages({ title: trDraft.title, body: trDraft.body, channel: GOOGLE_BLOG_CHANNEL })
        const trResult = await reviseUntilPassOrGiveUp({
          title: trDraft.title,
          body: trDraft.body,
          channel: GOOGLE_BLOG_CHANNEL,
          initialReview: trInitialReview,
        })
        const trPassed = trResult.review.result === '통과'

        const { data: trSaved, error: trInsertError } = await supabase
          .from('content_drafts')
          .insert({
            user_id: targetUserId,
            title: trResult.title,
            platform: GOOGLE_BLOG_CHANNEL,
            category: getCategoryForChannel(GOOGLE_BLOG_CHANNEL),
            body: trResult.body,
            images: [],
            hashtags: trDraft.hashtags,
            source: `한국어 원본 자동 번역 (원본: "${finalTitle}")`,
            status: trPassed ? '통과' : '반려',
            review_opinion: trResult.review.reasons.join(' / '),
            reject_reason: trPassed ? null : trResult.review.reasons.join(' / '),
            checked_no_real_person_image: true,
            checked_no_overseas_reuse: true,
          })
          .select()
          .single()
        if (trInsertError) throw new Error(trInsertError.message)

        await setEmployeeStatus(
          supabase,
          targetUserId,
          TRANSLATOR_ROLE,
          trPassed ? '완료' : '이슈발생',
          trPassed ? `"${trResult.title}" 번역+검수 완료` : `번역 검수 반려 - ${trResult.review.reasons[0] || '사유 미기재'}`
        )
        translation = { draftId: trSaved.id, passed: trPassed }
      } catch (trErr) {
        console.error('[thread-blog/auto-run] 구글 블로그 번역 실패:', trErr.message)
        await setEmployeeStatus(supabase, targetUserId, TRANSLATOR_ROLE, '이슈발생', trErr.message)
      }
    }

    await finishAutomationRun(supabase, run?.id, {
      status: passed ? '완료' : '이슈발생',
      summary: `"${finalTitle}" (${passed ? '통과' : '반려'}${attempts > 0 ? `, AI 자동 수정 ${attempts}회` : ''})`,
      draftId: savedDraft.id,
    })
    await sendTelegramMessage(
      `🤖 스레드/블로그팀 자동 생성 (${channel})\n\n"${finalTitle}"\n${passed ? '✅ 통과 - 발행 대기 중' : `⚠️ 반려 - ${review.reasons[0] || '사유 미기재'}`}${translation ? `\n\n[영어 번역]\n${translation.passed ? '✅ 통과' : '⚠️ 반려'}` : ''}`
    )

    res.json({ ok: true, draftId: savedDraft.id, status: savedDraft.status, translation })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 스레드/블로그팀 자동 생성 (${channel}) 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

export default router
