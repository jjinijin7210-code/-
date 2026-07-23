// ============================================================
// 유튜브팀 자동 리서치 - 지금은 콘텐츠(영상) 자동 제작까지는 아니고, 여러 나라를 동시에
// 확인하는 인기 영상 트렌드 리서치만 자동으로 돌려서 benchmark_reports에 쌓아둠
// (2026-07-19, 3팀 체제 개편 - 유튜브 실제 영상/스크립트 자동 제작은 별도 확장 필요).
//
// 2026-07-19: 일본 유튜브 채널 컨텐츠 방향을 "심리학"으로 확정 (사용자 결정) - 검색어 풀을
// 심리학 콘텐츠 위주로 바꾸고, 담당 리서처도 심리학 특화로 이름 변경.
//
// 2026-07-19 (같은 날 추가 변경, 사용자 결정): 심리학 안에서도 시니어 세대가 공감할 만한
// "가족 간 심리"(자식과의 관계, 부부/배우자와의 관계 등)로 더 좁힘 - 범용 심리학 팩트보다
// 반응이 좋을 거라 판단.
// ============================================================

import { Router } from 'express'
import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { searchPopularVideosMultiRegion, getTopComments, extractYoutubeVideoId } from '../lib/youtubeClient.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'
import { generatePsychologyVideo } from '../lib/psychologyVideoGenerator.js'
import { searchRedditStories, formatRedditStoriesForPrompt } from '../lib/redditClient.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'
import { callClaude } from '../lib/anthropicClient.js'
import { buildMarketAnalysisMessages } from '../lib/marketAnalysis.js'
import { saveMarketInsight, getLatestMarketInsight } from '../lib/marketInsights.js'

const router = Router()
const RESEARCHER_ROLE = '심리학 콘텐츠 리서처 (일본 채널 · 다지역 인기 영상 검색)'
const VIDEO_ROLE = '영상 제작 담당 (심리학 유튜브)'
// 2026-07-19: 크로스마켓 비교는 우선 미국·일본으로 한정 - 상용화 단계에서 한국/영국/프랑스 등
// 더 많은 나라로 넓히기로 함(사용자 결정, 지금은 스코프 최소화).
const REGIONS = ['US', 'JP']
const YOUTUBE_CHANNEL = '유튜브(일본어)'

// 소재가 마르지 않도록 돌아가면서 검색할 주제 후보 (매번 랜덤으로 하나 고름)
// 2026-07-19: 범용 심리학 팩트 대신 "가족 간 심리"(자식·배우자와의 관계)로 좁힘(사용자 결정)
const QUERY_POOL = [
  'family relationship psychology',
  'parents and adult children psychology',
  'marriage relationship psychology advice',
  'why adult children distance from parents psychology',
  'psychology of aging parents relationship',
  'wife husband relationship psychology',
]

// 일본은 한국이랑 생활상이 비슷한 부분이 많다는 판단(사용자 결정, 2026-07-19)으로, 일본 자료가
// 부족해도 한국에서 사람들이 실제로 많이 겪는 고민/걱정 콘텐츠를 벤치마킹 삼아 심리학 채널
// 주제를 잡는다. 이 결과도 category='심리학'으로 저장되어 psychology-video-run의 참고자료에
// 자동으로 같이 실린다.
// 2026-07-19: 가족/부부 관계 고민으로 좁힘(사용자 결정)
const KR_WORRY_QUERY_POOL = [
  '자식과 소통 안되는 부모 심리',
  '노후 부부관계 심리',
  '자녀와의 갈등 심리학',
  '황혼이혼 부부 심리',
  '부모 자식 갈등 심리학',
  '아내 남편 서운한 마음 심리',
]

// 실제 영상 제작용 주제 후보 (스크립트 작성 지시문이라 한글로 구체적으로)
// 2026-07-19: 시니어 대상 "자식과의 심리", "가족 간 심리", "아내와의 심리" 등 공감형 주제로
// 전면 교체(사용자 결정) - psychologyScript.js의 대본 톤도 이 방향에 맞춰 함께 조정함.
const VIDEO_TOPIC_POOL = [
  '자식이 연락을 잘 안 하는 이유 - 부모 자녀 심리',
  '나이 들수록 부부 사이가 멀어지는 심리적 이유',
  '자녀에게 서운함을 느끼는 부모의 심리',
  '오래된 부부일수록 대화가 줄어드는 이유',
  '자식 독립 후 찾아오는 빈둥지 증후군 심리',
  '배우자에게 인정받고 싶은 마음의 심리학',
  '가족인데도 자꾸 서운한 이유 - 기대와 애착의 심리',
]

router.post('/youtube/auto-research', async (req, res) => {
  const { token } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
  }

  const query = QUERY_POOL[Math.floor(Math.random() * QUERY_POOL.length)]
  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, `유튜브 트렌드 리서치 (${query})`, {
    endpoint: '/api/youtube/auto-research',
    payload: {},
  })
  await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '작업중', `"${query}" 다지역(${REGIONS.join('/')}) 검색 중`)

  try {
    const videos = await searchPopularVideosMultiRegion({ query, minLikes: 10000, maxResults: 10, regionCodes: REGIONS })
    const top = videos.slice(0, 5)

    for (const v of top) {
      await supabase.from('benchmark_reports').insert({
        user_id: targetUserId,
        keyword: v.title,
        platform: '유튜브',
        source_type: '공식 API',
        category: '심리학',
        popularity_score: v.viewCount,
        note: `[자동 리서치] ${v.channelTitle} · 조회수 ${v.viewCount} · 좋아요 ${v.likeCount} · ${v.region} · ${v.url}`,
      })
    }

    // 한국 "고민/걱정" 콘텐츠도 같이 벤치마킹 - 일본 자료가 부족해도 생활상이 비슷한 한국
    // 콘텐츠를 참고해서 심리학 채널 주제를 잡을 수 있게 (사용자 결정, 2026-07-19)
    let krWorrySavedCount = 0
    try {
      const worryQuery = KR_WORRY_QUERY_POOL[Math.floor(Math.random() * KR_WORRY_QUERY_POOL.length)]
      const krVideos = await searchPopularVideosMultiRegion({ query: worryQuery, minLikes: 3000, maxResults: 10, regionCodes: ['KR'] })
      const krTop = krVideos.slice(0, 5)
      for (const v of krTop) {
        await supabase.from('benchmark_reports').insert({
          user_id: targetUserId,
          keyword: v.title,
          platform: '유튜브',
          source_type: '공식 API',
          category: '심리학',
          popularity_score: v.viewCount,
          note: `[한국 고민 콘텐츠 벤치마킹 - 일본어 채널 주제 참고용] ${v.channelTitle} · 조회수 ${v.viewCount} · 좋아요 ${v.likeCount} · ${v.url}`,
        })
      }
      krWorrySavedCount = krTop.length
    } catch (krErr) {
      console.error('[youtube/auto-research] 한국 고민 콘텐츠 검색 실패:', krErr.message)
    }

    // 나라별 비교 분석 - "미국은 지금 어떤 형식이 인기인가", "일본 썸네일 스타일" 같은 인사이트를
    // 뽑아서 전 채널(인스타틱톡/스레드블로그/유튜브) 콘텐츠 생성에 참고자료로 쓸 수 있게 저장.
    let insightNote = null
    try {
      const videosByRegion = {}
      for (const region of REGIONS) {
        videosByRegion[region] = videos.filter((v) => v.region === region).slice(0, 10)
      }
      const hasEnoughData = Object.values(videosByRegion).some((list) => list.length > 0)
      if (hasEnoughData) {
        const { system: maSystem, messages: maMessages } = buildMarketAnalysisMessages({ videosByRegion })
        insightNote = await callClaude({ system: maSystem, messages: maMessages, maxTokens: 800 })
        await saveMarketInsight(supabase, targetUserId, insightNote)
      }
    } catch (insightErr) {
      console.error('[youtube/auto-research] 크로스마켓 분석 실패, 리서치 결과는 그대로 저장:', insightErr.message)
    }

    await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '완료', `"${query}" 검색 완료 - 상위 ${top.length}건 저장${insightNote ? ' + 국가 비교 분석 완료' : ''}`)
    await finishAutomationRun(supabase, run?.id, { status: '완료', summary: `"${query}" - ${top.length}건 저장${insightNote ? ' + 비교 분석' : ''}` })
    await sendTelegramMessage(
      `🤖 유튜브팀 트렌드 리서치 (${query})\n\n✅ ${top.length}건 저장됨\n${top.map((v) => `- ${v.title} (${v.region})`).join('\n')}${insightNote ? `\n\n📊 국가 비교 분석\n${insightNote}` : ''}`
    )

    res.json({ ok: true, query, savedCount: top.length, insightNote })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 유튜브팀 트렌드 리서치 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

// 심리학 유튜브 영상 실제 제작 - 대본→포인트별 내레이션(TTS)→이미지(돌려씀)→잔잔한 배경음악까지
// 합성한 mp4를 만들어 content_drafts에 저장한다. 유튜브 업로드 API 연동은 아직 없어서
// (다른 채널들처럼) 발행은 여기 저장된 영상을 진희님이 직접 유튜브에 올리는 방식.
// 2026-07-19: 우선 workflow_dispatch(수동 트리거)로만 열어두고, 자동 스케줄에는 아직 안 넣음 -
// 결과 품질/빈도를 사용자가 먼저 확인한 뒤 자동 스케줄 여부를 정하기로 함.
//
// 2026-07-23: GitHub Actions에서만 트리거 가능해서 대표님이 매번 github.com 들어가야 했던 게
// 불편하다는 피드백 - 대시보드에서 바로 누를 수 있는 "심리학 영상 만들기" 버튼도 추가하기로 하고,
// 실제 생성 로직은 runPsychologyVideoRun()으로 분리해서 두 경로(자동화 토큰 / 대시보드 버튼)가
// 같이 쓰게 함.
// customTopic이 있으면(진희님이 소재를 직접 넣은 경우) 그걸 쓰고, 없으면 기존처럼 주제 풀에서 랜덤으로 고름
async function runPsychologyVideoRun({ videoFormat, customTopic }) {
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    throw new Error('AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.')
  }
  const topic = customTopic && customTopic.trim() ? customTopic.trim() : VIDEO_TOPIC_POOL[Math.floor(Math.random() * VIDEO_TOPIC_POOL.length)]

  const supabase = getSupabaseAdmin()
  const run = await startAutomationRun(supabase, targetUserId, `심리학 유튜브 영상 제작 (${videoFormat})`, {
    endpoint: '/api/youtube/psychology-video-run',
    payload: { format: videoFormat },
  })
  await setEmployeeStatus(supabase, targetUserId, VIDEO_ROLE, '작업중', `"${topic}" 주제로 ${videoFormat === 'long' ? '롱폼' : '쇼츠'} 제작 중`)

  try {
    // 진희님이 벤치마킹 리포트에 직접 추가한 심리학 참고 링크(category='심리학')가 있으면
    // 스타일/각도 참고 자료로 대본 생성에 반영 (원문 번역/복사 금지 - promptBuilder와 같은 원칙)
    const { data: references } = await supabase
      .from('benchmark_reports')
      .select('keyword, note')
      .eq('user_id', targetUserId)
      .eq('category', '심리학')
      .order('collected_at', { ascending: false })
      .limit(5)
    const linkNote = references?.length ? references.map((r) => `- ${r.keyword}: ${r.note}`).join('\n') : ''
    // 국가별 비교 분석(있으면)도 같이 참고자료로 넣어서 포맷/스타일 결정에 반영
    const marketNote = await getLatestMarketInsight(supabase, targetUserId)
    const referenceNote = [linkNote, marketNote ? `[국가별 트렌드 비교]\n${marketNote}` : ''].filter(Boolean).join('\n\n') || undefined

    // 레딧에서 실제 고민 사연 후보를 찾아서(2026-07-23, "평면적인 정보보다 각색한 사연 소개도
    // 같이 넣어달라"는 요청) 대본에 각색 소재로 전달 - 못 찾아도(레딧 차단 등) 그냥 진행함(best-effort)
    const redditStories = await searchRedditStories({ query: topic })

    // 2026-07-23 (같은 요청, 추가): "레딧뿐 아니라 다른 심리학 채널도 이용하면 좋겠다" - 위에서
    // 리서치팀이 이미 찾아둔 인기 심리학 유튜브 영상(references)의 댓글에서도 사연 소재를 찾는다.
    // 시청자들이 자기 경험을 댓글로 남기는 경우가 많아서("저희 아들도 딱 이래요...") 사연감이 좋음.
    let youtubeCommentStories = []
    try {
      const videoIds = (references || [])
        .map((r) => extractYoutubeVideoId(r.note?.match(/https?:\/\/\S+/)?.[0] || ''))
        .filter(Boolean)
        .slice(0, 3)
      for (const videoId of videoIds) {
        const comments = await getTopComments(videoId, 5)
        youtubeCommentStories.push(
          ...comments
            .filter((c) => c.text && c.text.length > 40) // 너무 짧은 댓글("ㅠㅠ" 등)은 사연으로 못 씀
            .map((c) => ({ title: '(유튜브 댓글)', body: c.text.slice(0, 800) }))
        )
      }
    } catch (ytErr) {
      console.error('[psychology-video-run] 유튜브 댓글 수집 실패, 레딧만으로 진행:', ytErr.message)
    }

    const storyMaterial =
      formatRedditStoriesForPrompt([...redditStories, ...youtubeCommentStories.slice(0, 5)]) || undefined

    const { fileName, videoUrl: storageUrl, title, hook, hasMusic } = await generatePsychologyVideo({
      topic,
      format: videoFormat,
      referenceNote,
      storyMaterial,
    })
    const baseUrl = process.env.RENDER_EXTERNAL_URL || 'https://anyone-dashboard-p3an.onrender.com'
    const videoUrl = storageUrl || `${baseUrl}/generated/${fileName}`

    const initialReview = await runReviewStages({ title, body: hook, channel: YOUTUBE_CHANNEL })
    const { title: finalTitle, review, attempts } = await reviseUntilPassOrGiveUp({
      title,
      body: hook,
      channel: YOUTUBE_CHANNEL,
      initialReview,
    })
    const passed = review.result === '통과'
    await setEmployeeStatus(
      supabase,
      targetUserId,
      VIDEO_ROLE,
      passed ? '완료' : '이슈발생',
      passed ? `"${finalTitle}" 제작 완료${hasMusic ? ' (배경음악 포함)' : ''}` : review.reasons[0] || '반려'
    )

    const { data: savedDraft, error: insertError } = await supabase
      .from('content_drafts')
      .insert({
        user_id: targetUserId,
        title: finalTitle,
        platform: YOUTUBE_CHANNEL,
        category: '심리학',
        body: hook,
        images: [
          {
            id: crypto.randomUUID(),
            kind: 'video',
            filename: fileName,
            mime_type: 'video/mp4',
            data_url: videoUrl,
            note: `심리학 유튜브 ${videoFormat === 'long' ? '롱폼' : '쇼츠'} 자동 생성${hasMusic ? ' (배경음악 포함)' : ' (배경음악 없음)'}`,
            created_at: new Date().toISOString(),
          },
        ],
        hashtags: [],
        source: `심리학 유튜브 자동 제작 (주제: ${topic})`,
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
      `🤖 심리학 유튜브 영상 제작 (${videoFormat === 'long' ? '롱폼' : '쇼츠'})\n\n"${finalTitle}"\n${passed ? '✅ 통과 - 업로드 대기 중' : `⚠️ 반려 - ${review.reasons[0] || '사유 미기재'}`}`
    )

    return { ok: true, draftId: savedDraft.id, status: savedDraft.status, videoUrl }
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, VIDEO_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 심리학 유튜브 영상 제작 실패\n\n❌ ${err.message}`)
    throw err
  }
}

// GitHub Actions(자동화)에서 호출 - AUTO_RUN_SECRET 토큰으로만 인증
router.post('/youtube/psychology-video-run', async (req, res) => {
  const { token, format } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  try {
    const result = await runPsychologyVideoRun({ videoFormat: format === 'long' ? 'long' : 'shorts' })
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 대시보드 "🎬 심리학 영상 만들기" 버튼에서 호출 - 이 사이트 자체가 개인 전용 도구라 다른
// API(예: /api/draft)처럼 별도 토큰 없이 호출 가능 (2026-07-23 추가).
// topic을 같이 보내면(진희님이 직접 소재를 넣은 경우) 랜덤 주제풀 대신 그 소재로 만든다.
router.post('/youtube/psychology-video-run-manual', async (req, res) => {
  const { format, topic } = req.body || {}
  try {
    const result = await runPsychologyVideoRun({ videoFormat: format === 'long' ? 'long' : 'shorts', customTopic: topic })
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
