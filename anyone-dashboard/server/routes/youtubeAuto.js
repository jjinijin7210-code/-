// ============================================================
// 유튜브팀 자동 리서치 - 지금은 콘텐츠(영상) 자동 제작까지는 아니고, 여러 나라를 동시에
// 확인하는 인기 영상 트렌드 리서치만 자동으로 돌려서 benchmark_reports에 쌓아둠
// (2026-07-19, 3팀 체제 개편 - 유튜브 실제 영상/스크립트 자동 제작은 별도 확장 필요).
//
// 2026-07-19: 일본 유튜브 채널 컨텐츠 방향을 "심리학"으로 확정 (사용자 결정) - 검색어 풀을
// 심리학 콘텐츠 위주로 바꾸고, 담당 리서처도 심리학 특화로 이름 변경.
// ============================================================

import { Router } from 'express'
import crypto from 'node:crypto'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { setEmployeeStatus } from '../lib/employeeStatusSync.js'
import { startAutomationRun, finishAutomationRun } from '../lib/automationLog.js'
import { searchPopularVideosMultiRegion } from '../lib/youtubeClient.js'
import { sendTelegramMessage } from '../lib/telegramClient.js'
import { generatePsychologyVideo } from '../lib/psychologyVideoGenerator.js'
import { runReviewStages, reviseUntilPassOrGiveUp } from '../lib/reviseAndReview.js'

const router = Router()
const RESEARCHER_ROLE = '심리학 콘텐츠 리서처 (일본 채널 · 다지역 인기 영상 검색)'
const VIDEO_ROLE = '영상 제작 담당 (심리학 유튜브)'
const REGIONS = ['US', 'KR', 'JP']
const YOUTUBE_CHANNEL = '유튜브(일본어)'

// 소재가 마르지 않도록 돌아가면서 검색할 주제 후보 (매번 랜덤으로 하나 고름)
const QUERY_POOL = [
  'psychology facts about human behavior',
  'dark psychology tricks explained',
  'why people do this psychology',
  'relationship psychology tips',
  'body language psychology signs',
  'mind tricks psychology facts',
]

// 실제 영상 제작용 주제 후보 (스크립트 작성 지시문이라 한글로 구체적으로)
const VIDEO_TOPIC_POOL = [
  '첫인상이 왜 그렇게 오래 가는지에 대한 심리학',
  '거짓말할 때 사람들이 무의식적으로 보이는 신호',
  '손해를 더 크게 느끼는 심리 - 손실 회피 편향',
  '사람을 끌어당기는 대화법의 심리학',
  '스트레스를 받을 때 뇌와 몸에서 일어나는 일',
  '단순히 자주 보기만 해도 호감이 생기는 이유 (단순노출 효과)',
  '왜 우리는 남과 비교하면 불행해질까',
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

    await setEmployeeStatus(supabase, targetUserId, RESEARCHER_ROLE, '완료', `"${query}" 검색 완료 - 상위 ${top.length}건 저장`)
    await finishAutomationRun(supabase, run?.id, { status: '완료', summary: `"${query}" - ${top.length}건 저장` })
    await sendTelegramMessage(
      `🤖 유튜브팀 트렌드 리서치 (${query})\n\n✅ ${top.length}건 저장됨\n${top.map((v) => `- ${v.title} (${v.region})`).join('\n')}`
    )

    res.json({ ok: true, query, savedCount: top.length })
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
router.post('/youtube/psychology-video-run', async (req, res) => {
  const { token, format } = req.body || {}
  if (!process.env.AUTO_RUN_SECRET || token !== process.env.AUTO_RUN_SECRET) {
    return res.status(401).json({ error: '인증 토큰이 올바르지 않아요.' })
  }
  const targetUserId = process.env.AUTO_TARGET_USER_ID
  if (!targetUserId) {
    return res.status(500).json({ error: 'AUTO_TARGET_USER_ID가 서버 .env에 설정되어 있지 않아요.' })
  }
  const videoFormat = format === 'long' ? 'long' : 'shorts'
  const topic = VIDEO_TOPIC_POOL[Math.floor(Math.random() * VIDEO_TOPIC_POOL.length)]

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
    const referenceNote = references?.length ? references.map((r) => `- ${r.keyword}: ${r.note}`).join('\n') : undefined

    const { fileName, title, hook, hasMusic } = await generatePsychologyVideo({ topic, format: videoFormat, referenceNote })
    const videoUrl = `${req.protocol}://${req.get('host')}/generated/${fileName}`

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

    res.json({ ok: true, draftId: savedDraft.id, status: savedDraft.status, videoUrl })
  } catch (err) {
    await setEmployeeStatus(supabase, targetUserId, VIDEO_ROLE, '이슈발생', err.message)
    await finishAutomationRun(supabase, run?.id, { status: '이슈발생', errorMessage: err.message })
    await sendTelegramMessage(`🤖 심리학 유튜브 영상 제작 실패\n\n❌ ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

export default router
