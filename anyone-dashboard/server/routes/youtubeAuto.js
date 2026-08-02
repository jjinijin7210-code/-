// ============================================================
// 유튜브팀 자동 리서치 + 역사경제 영상 자동 제작.
//
// 2026-07-19: 원래 "유튜브(일본어)" 채널을 "심리학" 콘텐츠로 운영했었음(사용자 결정) - 검색어
// 풀/대본 톤이 전부 심리학 위주였음.
//
// 2026-07-30: "심리학 올릴 채널이 없다"는 이유로 심리학 콘텐츠를 완전히 접고(사용자 결정),
// 대신 진희님 본인 채널 중 하나인 "유튜브(한국어)-경제"를 위한 **역사경제 콘텐츠**로 이 파이프라인
// 전체를 새로 짬 - "역사는 반복된다" 컨셉으로, 과거 경제 위기/사건을 오늘날과 연결짓는 다큐 톤.
// 대본 구조는 두 벤치마킹을 결합함:
// 1. 진희님이 직접 고른 경제 채널 10개(간단경제한스푼·경제해적단) → promptBuilder.js의
//    ECONOMY_STRUCTURE_RULE(수동 "AI 초안 생성" 버튼용 텍스트 대본에 이미 반영돼 있음)
// 2. 진희님이 "이거다!"라고 확정한 "더타임" 채널(역사 미스터리 다큐) 3편 실제 분석 →
//    server/lib/historyEconomyScript.js의 감각후킹→반전→숫자충격→가설붕괴→오늘날연결 구조
// 영상 제작(TTS+AI 일러스트+영상 합성)은 코코로 마스코트/일본어 번역 없이 역사경제 다큐용으로
// 새로 만든 server/lib/historyEconomyVideoGenerator.js를 씀 - 마스코트 대신 포인트마다 AI가
// 그린 다큐풍 일러스트(실존 인물 얼굴 그대로 재현 금지), 줌인/줌아웃 랜덤 효과(뉴머니 채널
// 벤치마킹 - "매번 랜덤이라 천편일률적으로 안 보인다"는 이유).
// ============================================================

import { Router } from 'express'
import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { searchPopularVideosMultiRegion } from '../lib/youtubeClient.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'
import { generateHistoryEconomyVideo } from '../lib/historyEconomyVideoGenerator.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'
import { callClaude } from '../lib/anthropicClient.js'
import { buildMarketAnalysisMessages } from '../lib/marketAnalysis.js'
import { saveMarketInsight, getLatestMarketInsight } from '../lib/marketInsights.js'
import { pickAvoidingRecent, getRecentDraftTitles, getRecentSourceTags } from '../lib/topicRotation.js'

const router = Router()
const RESEARCHER_ROLE = '역사경제 콘텐츠 리서처 (다지역 인기 영상 검색)'
const VIDEO_ROLE = '영상 제작 담당 (역사경제 유튜브)'
// 나라별 검색은 "요즘 어떤 역사/경제 다큐 형식이 뜨는지" 참고용 - 실제 대본 언어(한국어)와는
// 무관하게, 다양한 시장의 트렌드를 넓게 보려고 유지함(심리학 때부터 있던 구조 그대로 재사용).
const REGIONS = ['US', 'JP', 'KR', 'GB', 'FR', 'DE', 'BR', 'IN']
const YOUTUBE_CHANNEL = '유튜브(한국어)-경제'
const CATEGORY = '경제'

// 소재가 마르지 않도록 돌아가면서 검색할 주제 후보 (매번 랜덤으로 하나 고름, 다지역 검색이라 영어)
const QUERY_POOL = [
  'stock market crash history documentary',
  'economic bubble collapse history',
  'hyperinflation history explained',
  'financial crisis history documentary',
  'great depression documentary',
  'currency collapse history',
  'bank run history explained',
  'economic collapse civilization history',
  'gold standard history economics',
  'trade war history economics',
]

// 한국 자료도 같이 벤치마킹 - 실제 한국어 대본을 쓰는 채널이라 한국 시청자 반응이 더 직접적인
// 참고가 됨. 이 결과도 category='경제'로 저장되어 history-economy-video-run의 참고자료에 자동
// 반영됨.
const KR_HISTORY_QUERY_POOL = [
  '역사적 경제 위기 다큐',
  '금융 버블 붕괴 역사',
  '화폐 개혁 역사 이야기',
  '대공황 다큐멘터리',
  '경제 위기 미스터리',
  '은행 파산 역사',
  '초인플레이션 역사',
  '경제 붕괴 문명 역사',
]

// 실제 영상 제작용 주제 후보 - "역사는 반복된다"(과거 사건 + 오늘날과의 연결)를 제목 자체에
// 드러내는 구체적 소재로 씀 (더타임 채널의 "~한 진짜 이유" 형식 + 경제 채널들의 구체적 사건명).
const VIDEO_TOPIC_POOL = [
  '1929년 대공황, 사실 이런 식으로 시작됐다 - 오늘날과 닮은 신호들',
  '로마 제국을 무너뜨린 건 전쟁이 아니라 화폐였다',
  '튤립 버블, 인류 최초의 투기 광풍이 남긴 교훈',
  '초인플레이션이 나라를 무너뜨리는 진짜 과정 (바이마르 공화국)',
  '금본위제는 왜 사라졌을까 - 화폐의 역사가 바뀐 순간',
  '1997년 IMF, 그날 대한민국에 무슨 일이 있었나',
  '대항해시대를 만든 건 모험심이 아니라 돈이었다',
  '역사상 가장 큰 뱅크런, 사람들은 왜 한꺼번에 돈을 빼갔을까',
  '봉건제가 무너진 진짜 이유, 사실은 경제 구조 때문이었다',
  '2008년 금융위기, 사실 100년 전에도 똑같은 일이 있었다',
  '화폐 개혁이 있을 때마다 사라진 사람들의 돈, 어디로 갔을까',
  '무역전쟁이 문명을 무너뜨린 역사 속 진짜 사례',
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

  const supabase = getSupabaseAdmin()
  // QUERY_POOL이 작아서 순수 랜덤이면 며칠 안에 같은 검색어가 반복됨 - 실행 이력
  // (automation_runs.run_type에 검색어가 그대로 심어져 있음)에서 최근 검색어를 뽑아 피해서 고름.
  const { data: recentRuns } = await supabase
    .from('automation_runs')
    .select('run_type')
    .eq('user_id', targetUserId)
    .ilike('run_type', '유튜브 트렌드 리서치%')
    .order('created_at', { ascending: false })
    .limit(10)
  const recentQueries = (recentRuns || []).map((r) => r.run_type?.match(/\(([^)]+)\)/)?.[1]).filter(Boolean)
  const query = pickAvoidingRecent(QUERY_POOL, recentQueries)
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
        category: CATEGORY,
        popularity_score: v.viewCount,
        note: `[자동 리서치] ${v.channelTitle} · 조회수 ${v.viewCount} · 좋아요 ${v.likeCount} · ${v.region} · ${v.url}`,
      })
    }

    // 한국 역사경제 콘텐츠도 같이 벤치마킹 - 실제 한국어 대본을 쓰는 채널이라 직접적인 참고가 됨
    let krSavedCount = 0
    try {
      const { data: recentKrReports } = await supabase
        .from('benchmark_reports')
        .select('note')
        .eq('user_id', targetUserId)
        .eq('category', CATEGORY)
        .ilike('note', '%한국 역사경제 콘텐츠%')
        .order('collected_at', { ascending: false })
        .limit(10)
      const recentKrQueries = (recentKrReports || [])
        .map((r) => r.note?.match(/검색어:\s*([^)]+)/)?.[1])
        .filter(Boolean)
      const krQuery = pickAvoidingRecent(KR_HISTORY_QUERY_POOL, recentKrQueries)
      const krVideos = await searchPopularVideosMultiRegion({ query: krQuery, minLikes: 3000, maxResults: 10, regionCodes: ['KR'] })
      const krTop = krVideos.slice(0, 5)
      for (const v of krTop) {
        await supabase.from('benchmark_reports').insert({
          user_id: targetUserId,
          keyword: v.title,
          platform: '유튜브',
          source_type: '공식 API',
          category: CATEGORY,
          popularity_score: v.viewCount,
          // "검색어: xxx" 표식은 위쪽 최근 검색어 중복 방지 로직이 다시 읽어가는 값이라
          // 형식을 바꾸면 안 됨.
          note: `[한국 역사경제 콘텐츠 벤치마킹] (검색어: ${krQuery}) ${v.channelTitle} · 조회수 ${v.viewCount} · 좋아요 ${v.likeCount} · ${v.url}`,
        })
      }
      krSavedCount = krTop.length
    } catch (krErr) {
      console.error('[youtube/auto-research] 한국 역사경제 콘텐츠 검색 실패:', krErr.message)
    }

    // 나라별 비교 분석 - 전 채널(인스타틱톡/스레드블로그/유튜브) 콘텐츠 생성에 참고자료로 쓸 수 있게 저장.
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

    res.json({ ok: true, query, savedCount: top.length, krSavedCount, insightNote })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 유튜브팀 트렌드 리서치 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

// 역사경제 유튜브 영상 실제 제작 - 대본→포인트별 내레이션(TTS)→AI 일러스트→줌인/줌아웃 랜덤
// 효과까지 합성한 mp4를 만들어 content_drafts에 저장한다. 유튜브 업로드 API 연동은 아직 없어서
// (다른 채널들처럼) 발행은 여기 저장된 영상을 진희님이 직접 유튜브에 올리는 방식.
// customTopic이 있으면(진희님이 소재를 직접 넣은 경우) 그걸 쓰고, 없으면 주제 풀에서 랜덤으로 고름
async function runHistoryEconomyVideoRun({ videoFormat, customTopic }) {
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    throw new Error('AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.')
  }
  const supabase = getSupabaseAdmin()
  // source에 심어둔 "주제: xxx" 표식으로 최근에 실제로 만든 주제를 찾아 최대한 피해서 고름.
  const recentlyUsedTopics = customTopic
    ? []
    : await getRecentSourceTags(supabase, targetUserId, { platform: YOUTUBE_CHANNEL, marker: '주제' })
  const topic =
    customTopic && customTopic.trim() ? customTopic.trim() : pickAvoidingRecent(VIDEO_TOPIC_POOL, recentlyUsedTopics)
  const run = await startAutomationRun(supabase, targetUserId, `역사경제 유튜브 영상 제작 (${videoFormat})`, {
    endpoint: '/api/youtube/history-economy-video-run',
    payload: { format: videoFormat },
  })
  await setEmployeeStatus(supabase, targetUserId, VIDEO_ROLE, '작업중', `"${topic}" 주제로 ${videoFormat === 'long' ? '롱폼' : '쇼츠'} 제작 중`)

  try {
    // 진희님이 벤치마킹 리포트에 직접 추가한 역사경제 참고 링크(category='경제')가 있으면
    // 스타일/각도 참고 자료로 대본 생성에 반영 (원문 번역/복사 금지 - promptBuilder와 같은 원칙)
    const { data: references } = await supabase
      .from('benchmark_reports')
      .select('keyword, note')
      .eq('user_id', targetUserId)
      .eq('category', CATEGORY)
      .order('collected_at', { ascending: false })
      .limit(5)
    const linkNote = references?.length ? references.map((r) => `- ${r.keyword}: ${r.note}`).join('\n') : ''
    // 국가별 비교 분석(있으면)도 같이 참고자료로 넣어서 포맷/스타일 결정에 반영
    const marketNote = await getLatestMarketInsight(supabase, targetUserId)
    // 주제가 겹치지 않아도 대본 각도가 비슷할 수 있어서, 최근에 실제로 만든 영상 제목을 넣어
    // 다른 각도로 쓰도록 명시 지시 (다른 파이프라인과 동일 원리)
    const recentTitles = await getRecentDraftTitles(supabase, targetUserId, { platform: YOUTUBE_CHANNEL, limit: 8 })
    const avoidNote =
      recentTitles.length > 0
        ? `[최근에 이미 만든 영상 제목들 - 아래와 겹치지 않는 다른 소재/각도로 새롭게 써줘]\n${recentTitles.map((t) => `- ${t}`).join('\n')}`
        : ''
    const referenceNote =
      [linkNote, marketNote ? `[국가별 트렌드 비교]\n${marketNote}` : '', avoidNote].filter(Boolean).join('\n\n') || undefined

    const { fileName, videoUrl: storageUrl, title, hook, hasMusic } = await generateHistoryEconomyVideo({
      topic,
      format: videoFormat,
      referenceNote,
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
        category: CATEGORY,
        body: hook,
        images: [
          {
            id: crypto.randomUUID(),
            kind: 'video',
            filename: fileName,
            mime_type: 'video/mp4',
            data_url: videoUrl,
            note: `역사경제 유튜브 ${videoFormat === 'long' ? '롱폼' : '쇼츠'} 자동 생성${hasMusic ? ' (배경음악 포함)' : ' (배경음악 없음)'}`,
            created_at: new Date().toISOString(),
          },
        ],
        hashtags: [],
        source: `역사경제 유튜브 자동 제작 (주제: ${topic})`,
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
      `🤖 역사경제 유튜브 영상 제작 (${videoFormat === 'long' ? '롱폼' : '쇼츠'})\n\n"${finalTitle}"\n${passed ? '✅ 통과 - 업로드 대기 중' : `⚠️ 반려 - ${review.reasons[0] || '사유 미기재'}`}`
    )

    return { ok: true, draftId: savedDraft.id, status: savedDraft.status, videoUrl }
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, VIDEO_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 역사경제 유튜브 영상 제작 실패\n\n❌ ${err.message}`)
    throw err
  }
}

// GitHub Actions/Render Cron(자동화)에서 호출 - AUTO_RUN_SECRET 토큰으로만 인증
router.post('/youtube/history-economy-video-run', async (req, res) => {
  const { token, format } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  try {
    const result = await runHistoryEconomyVideoRun({ videoFormat: format === 'shorts' ? 'shorts' : 'long' })
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 대시보드 "🎬 역사경제 영상 만들기" 버튼에서 호출 - 이 사이트 자체가 개인 전용 도구라 다른
// API(예: /api/draft)처럼 별도 토큰 없이 호출 가능.
// topic을 같이 보내면(진희님이 직접 소재를 넣은 경우) 랜덤 주제풀 대신 그 소재로 만든다.
router.post('/youtube/history-economy-video-run-manual', async (req, res) => {
  const { format, topic } = req.body || {}
  try {
    const result = await runHistoryEconomyVideoRun({ videoFormat: format === 'shorts' ? 'shorts' : 'long', customTopic: topic })
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
