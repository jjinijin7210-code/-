import { Router } from 'express'
import { callClaudeJson } from '../lib/anthropicClient.js'
import { buildDraftMessages, buildTranslateMessages, parseDraftResponse } from '../lib/promptBuilder.js'
import { getCurrentWeatherNote } from '../lib/weatherClient.js'
import { getLatestTrendNote } from '../lib/trendNote.js'
import { searchPhotos, fetchPhotoAsDataUrl } from '../lib/pexelsClient.js'
import { uploadToStorage } from '../lib/supabaseStorage.js'

// data: URI -> Supabase Storage에 업로드하고 공개 URL을 돌려줌. base64를 DB에 그대로 저장하던
// 게 이그레스 할당량 초과(2026-07-29)의 원인이라, 여기서 만들어지는 시점에 바로 Storage로 보냄.
async function uploadDataUrlServerSide(dataUrl, fileName, contentType) {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  return uploadToStorage(buffer, { fileName: `uploads/${fileName}`, contentType })
}

const router = Router()

// 구글 블로그는 해외 독자 대상이라 실제로 게시되는 건 영어 버전이어야 함 (threadBlogAuto.js의
// 자동화와 동일한 방식 - 한국어로 먼저 쓴 뒤 "(영어)"를 붙인 가짜 채널명으로 번역 요청을 걸어서
// promptBuilder의 언어 감지(getTargetLanguage)가 영어로 잡히게 함. 실제 저장되는 platform 값은
// 그대로 '블로그(구글 Blogger)'로 둔다.)
const GOOGLE_BLOG_CHANNEL = '블로그(구글 Blogger)'

router.post('/draft', async (req, res) => {
  const { channel, topic, referenceNote } = req.body || {}

  if (!channel || !topic || !topic.trim()) {
    return res.status(400).json({ error: '채널과 주제(topic)는 필수예요.' })
  }

  try {
    const trendNote = await getLatestTrendNote()
    const { system, messages } = buildDraftMessages({ channel, topic, referenceNote, trendNote })
    // 블로그는 소제목이 있는 긴 article 형태, 유튜브(한국어)는 쇼츠 나레이션 대본이라 둘 다
    // 1024토큰으로는 JSON이 중간에 잘려서 파싱 실패가 났음(실측 확인) - 넉넉하게 늘림
    const maxTokens = channel.startsWith('블로그') || channel.startsWith('유튜브(한국어)') ? 3000 : 1024
    // 2026-07-23: 가끔 AI 응답이 JSON 파싱에 실패하는 문제(대부분 그날그날의 응답 변동) - 같은
    // 프롬프트로 재시도하면 대부분 성공한다는 게 dailyAutofill.mjs 등에서 이미 확인된 방식이라 동일 적용
    const draft = await callClaudeJson({ system, messages, maxTokens, parse: parseDraftResponse })
    res.json({ ...draft, trendNote })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// 기사/링크 등 원본 소재 하나를 여러 채널(스레드/블로그/인스타·틱톡/유튜브 등)용으로 한번에
// 변환 - 2026-07-23, 진희님이 "오늘처럼 기사 넣으면 채널별로 한 번에 만들어줬으면" 요청해서 추가.
// 채널마다 별도 Claude 호출이라 시간이 좀 걸릴 수 있음 - 한 채널이 실패해도 나머지는 계속 진행함.
router.post('/draft/from-source', async (req, res) => {
  const { sourceArticle, channels, topic } = req.body || {}

  if (!sourceArticle || !sourceArticle.trim()) {
    return res.status(400).json({ error: '원본 기사/소재 내용은 필수예요.' })
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: '생성할 채널을 하나 이상 선택해주세요.' })
  }

  // 날씨/트렌드 조회는 실패해도 전체 생성을 막지 않음 (best-effort)
  const [weatherNote, trendNote] = await Promise.all([getCurrentWeatherNote(), getLatestTrendNote()])

  const results = []
  for (const channel of channels) {
    try {
      const isBlog = channel.startsWith('블로그')
      const isCardNews = channel.includes('카드뉴스')
      const isLongForm = isBlog || isCardNews || channel.startsWith('유튜브(한국어)')
      const { system, messages } = buildDraftMessages({
        channel,
        topic,
        sourceArticle,
        includeSeasonWeather: true,
        weatherNote,
        trendNote,
        needsPhotoQuery: isBlog || isCardNews,
      })
      const maxTokens = isLongForm ? 3000 : 1024
      // 2026-07-23: 가끔 AI 응답이 JSON 파싱에 실패하는 문제 - 같은 프롬프트로 재시도하면 대부분
      // 성공한다는 게 dailyAutofill.mjs 등에서 이미 확인된 방식이라 동일 적용 (기존엔 재시도 없이
      // 바로 실패해서 "구글 블로그는 실패네" 같은 리포트가 나왔음)
      const draft = await callClaudeJson({ system, messages, maxTokens, parse: parseDraftResponse })

      let finalDraft = draft
      if (channel === GOOGLE_BLOG_CHANNEL) {
        // 한국어 초안은 그대로 내보내지 않고, 곧바로 영어로 번역한 버전을 이 채널의 결과로 씀
        // (실제 게시 대상은 영어 버전이므로 - threadBlogAuto.js 자동화와 동일한 원칙)
        const { system: trSystem, messages: trMessages } = buildTranslateMessages({
          targetChannel: `${GOOGLE_BLOG_CHANNEL}(영어)`,
          title: draft.title,
          body: draft.body,
          hashtags: draft.hashtags,
        })
        finalDraft = await callClaudeJson({
          system: trSystem,
          messages: trMessages,
          maxTokens: 3000,
          parse: parseDraftResponse,
        })
      }

      // 블로그류는 photoQuery로 무료 스톡사진(Pexels)을 찾아서 같이 첨부 - "사진이 없는데 본문이
      // 사진 얘기를 하면 뭘 봐야 할지 모르겠다"는 피드백(2026-07-23) 반영. 실패해도(검색어로 못
      // 찾음, PEXELS_API_KEY 없음 등) 글 자체는 그대로 내보냄(best-effort).
      let images = []
      if (isBlog && draft.photoQuery) {
        try {
          const photos = await searchPhotos({ query: draft.photoQuery, perPage: 3 })
          const picked = photos.slice(0, 2)
          images = await Promise.all(
            picked.map(async (p) => {
              const dataUrl = await fetchPhotoAsDataUrl(p.full)
              const fileName = `pexels-${p.id}-${Date.now()}.jpg`
              const url = await uploadDataUrlServerSide(dataUrl, fileName, 'image/jpeg')
              return {
                kind: 'image',
                filename: `pexels-${p.id}.jpg`,
                mime_type: 'image/jpeg',
                data_url: url,
                note: `무료 스톡 사진 (Pexels · ${p.photographer}) - 검색어: ${draft.photoQuery}`,
              }
            })
          )
        } catch (photoErr) {
          console.error('[draft/from-source] 스톡사진 검색 실패, 사진 없이 진행:', photoErr.message)
        }
      }

      results.push({ channel, ...finalDraft, images })
    } catch (err) {
      results.push({ channel, error: err.message })
    }
  }

  res.json({ results, weatherNote, trendNote })
})

// 완성된 초안을 다른 언어 채널로 현지화(번역) - 직역이 아니라 자연스럽게 다시 씀
router.post('/draft/translate', async (req, res) => {
  const { targetChannel, title, body, hashtags } = req.body || {}

  if (!targetChannel || !title || !body) {
    return res.status(400).json({ error: 'targetChannel, title, body는 필수예요.' })
  }

  try {
    const { system, messages } = buildTranslateMessages({ targetChannel, title, body, hashtags })
    const draft = await callClaudeJson({ system, messages, maxTokens: 1024, parse: parseDraftResponse })
    res.json(draft)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
