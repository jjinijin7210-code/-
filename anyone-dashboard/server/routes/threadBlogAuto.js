// ============================================================
// 스레드/블로그팀 자동 파이프라인 - 인스타/틱톡팀(benchmark.js)과 같은 원리지만
// 일본 벤치마킹 없이 스레드·여행 블로그 채널만 대상으로 함 (2026-07-19, 3팀 체제 개편).
// ============================================================

import { Router } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { callClaude } from '../lib/anthropicClient.js'
import { buildDraftMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'
import { pickTrendingTopic } from '../lib/threadsSearchClient.js'
import { compareSearchTrend } from '../lib/naverDatalabClient.js'

const router = Router()
const WRITER_ROLE = '작성자 (스레드·블로그 AI 초안 생성)'
const REVIEWER_ROLE = '검수자 (스레드·블로그 팩트체크·과장표현·AI스러움)'

// 채널마다 카테고리(다른 화면의 CS링크·벤치마킹 등에서 쓰는 구분값)가 다름
function getCategoryForChannel(channel) {
  if (channel === '블로그(네이버)-푸드') return '푸드쇼핑'
  if (channel === '블로그(네이버)-여행') return '여행지'
  return '인테리어/생활용품'
}

// 소재가 마르지 않도록 채널별로 돌아가면서 쓸 주제 후보 (트렌드 확인이 실패했을 때의 기본값으로도 씀)
const TOPIC_POOL = {
  스레드: ['요즘 일상에서 느낀 소소한 공감 포인트', '20대가 공감할 만한 소비/생활 습관 이야기', '최근 화제가 된 생활 밀착형 팁'],
  '블로그(네이버)-여행': ['국내 근교 숨은 여행지', '일본 도쿄 근교 숨은 여행지', '당일치기로 다녀올 만한 소도시'],
  '블로그(네이버)-푸드': ['요즘 화제인 홈파티/자취 음식 레시피', '동네 숨은 맛집 소개'],
  '블로그(네이버)-생활': ['자취/원룸 생활용품 추천', '집 꾸미기 소품 아이디어'],
}

// 스레드는 실제 좋아요/댓글 반응으로 오늘의 주제를 고름 (2026-07-19 요청 - "여행이나 다른 것도
// 트렌드에 따라 바꾸자"). 여름 휴가철이라 여행 후보를 항상 포함시켜서, 트렌드가 안 받쳐줘도
// 완전히 배제되진 않게 함. 스레드 검색은 한글보다 영어 키워드가 훨씬 잘 잡혀서(실측 확인)
// 검색어 자체는 영어를 쓰되, 실제로 생성되는 글 주제(topic)는 한글 그대로 둔다.
const THREAD_TOPIC_CANDIDATES = [
  { topic: '요즘 일상에서 느낀 소소한 공감 포인트', searchQuery: 'relatable daily life thoughts' },
  { topic: '20대가 공감할 만한 소비/생활 습관 이야기', searchQuery: 'life hacks saving money tips' },
  { topic: '최근 화제가 된 생활 밀착형 팁', searchQuery: 'trending life tips today' },
  { topic: '요즘 가기 좋은 여름 휴가 여행지 이야기', searchQuery: 'summer vacation travel tips' },
]

// 네이버는 글별 좋아요 수를 공식 API로 안 주기 때문에, 데이터랩 검색어트렌드(공식/무료)로
// "요즘 사람들이 실제로 많이 검색하는 주제"를 대신 확인해서 블로그 카테고리를 고른다.
// NAVER_CLIENT_ID/SECRET이 없으면(등록 전) 트렌드 확인 없이 기본값(푸드)으로 대체한다.
const BLOG_TREND_CANDIDATES = [
  { channel: '블로그(네이버)-푸드', keywords: ['맛집 추천', '홈파티 음식'] },
  { channel: '블로그(네이버)-생활', keywords: ['생활용품 추천', '집꾸미기'] },
]

async function pickThreadTopic() {
  try {
    const { picked, scored } = await pickTrendingTopic(THREAD_TOPIC_CANDIDATES, { maxPostsPerQuery: 8 })
    return {
      topic: picked.topic,
      trendNote: `스레드 반응 확인: ${scored.map((s) => `"${s.searchQuery}"(${s.score})`).join(', ')} 중 최고 반응 주제 선택`,
    }
  } catch (err) {
    console.error('[thread-blog/auto-run] 스레드 트렌드 확인 실패, 랜덤 선택으로 대체:', err.message)
    const pool = TOPIC_POOL['스레드']
    return { topic: pool[Math.floor(Math.random() * pool.length)], trendNote: null }
  }
}

// requestedChannel이 '블로그(네이버)-트렌드'(트렌드 확인용 특수값)면 실제 채널을 골라서 반환
async function resolveBlogChannel(requestedChannel) {
  if (requestedChannel !== '블로그(네이버)-트렌드') {
    return { channel: requestedChannel, trendNote: null }
  }
  try {
    const ranked = await compareSearchTrend(
      BLOG_TREND_CANDIDATES.map((c) => ({ label: c.channel, keywords: c.keywords })),
      { days: 7 }
    )
    const top = ranked[0]
    return {
      channel: top.label,
      trendNote: `네이버 검색 트렌드 확인: ${ranked.map((r) => `${r.label}(${r.avgRatio.toFixed(1)})`).join(', ')} 중 "${top.label}" 선택`,
    }
  } catch (err) {
    console.error('[thread-blog/auto-run] 블로그 트렌드 확인 실패, 기본값(푸드)으로 대체:', err.message)
    return { channel: '블로그(네이버)-푸드', trendNote: null }
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

  const blogResolved = await resolveBlogChannel(requestedChannel || '스레드')
  const channel = blogResolved.channel
  let trendNote = blogResolved.trendNote
  let topic
  if (channel === '스레드') {
    const picked = await pickThreadTopic()
    topic = picked.topic
    trendNote = picked.trendNote
  } else {
    const pool = TOPIC_POOL[channel] || TOPIC_POOL['블로그(네이버)-여행']
    topic = pool[Math.floor(Math.random() * pool.length)]
  }

  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, `스레드/블로그 생성 (${channel})`, {
    endpoint: '/api/thread-blog/auto-run',
    payload: { channel: requestedChannel },
  })
  await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '작업중', `"${topic}" 주제로 ${channel} 초안 작성 중`)

  try {
    const { system, messages } = buildDraftMessages({ channel, topic })
    const draftText = await callClaude({ system, messages, maxTokens: channel.startsWith('블로그') ? 3000 : 1024 })
    const draft = parseDraftResponse(draftText)

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
        // 한국어 콘텐츠는 게시하지 않는다는 정책(2026-07-19) - 이 팀은 아직 번역 사슬이
        // 없어서 일단 표시만 해둠 (실제로 쓰려면 인스타/틱톡팀처럼 번역 자동화를 추가해야 함)
        source: `[번역용 소스 - 직접 게시 금지, 번역 자동화 미구현] 스레드/블로그팀 자동 생성 (주제: ${topic})${trendNote ? ` / ${trendNote}` : ''}`,
        status: passed ? '통과' : '반려',
        review_opinion: review.reasons.join(' / '),
        reject_reason: passed ? null : review.reasons.join(' / '),
        checked_no_real_person_image: true,
        checked_no_overseas_reuse: true,
      })
      .select()
      .single()
    if (insertError) throw new Error(`초안 저장 실패: ${insertError.message}`)

    await finishAutomationRun(supabase, run?.id, {
      status: passed ? '완료' : '이슈발생',
      summary: `"${finalTitle}" (${passed ? '통과' : '반려'}${attempts > 0 ? `, AI 자동 수정 ${attempts}회` : ''})`,
      draftId: savedDraft.id,
    })
    await sendTelegramMessage(
      `🤖 스레드/블로그팀 자동 생성 (${channel})\n\n"${finalTitle}"\n${passed ? '✅ 통과 - 발행 대기 중' : `⚠️ 반려 - ${review.reasons[0] || '사유 미기재'}`}`
    )

    res.json({ ok: true, draftId: savedDraft.id, status: savedDraft.status })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, WRITER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 스레드/블로그팀 자동 생성 (${channel}) 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

export default router
