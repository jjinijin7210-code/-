// ============================================================
// 콘텐츠 DNA 분석 - 2026-07-27 요청("루나가 얘기한 새로운 방식: 채널 URL 입력 → AI가
// 콘텐츠 DNA 분석 → 가장 비슷한 채널 자동 추천 → 썸네일/제목/영상 길이/업로드 주기 벤치마킹").
//
// VidIQ의 신경망 기반 유사채널 매칭은 MCP 전용(유료 Max 플랜)이라 애니원 서버가 직접 못
// 불러와서(2026-07-27 확인) - 이미 있는 유튜브 공식 API(YOUTUBE_API_KEY) + Claude만으로
// 비슷한 워크플로우를 추가 비용 없이 구현함. VidIQ만큼 정교한 유사도 매칭은 아니고 Claude가
// 뽑은 키워드로 유튜브 검색하는 방식이라 정확도는 다소 떨어질 수 있음(사용자에게 설명 후 승인받음).
//
// 2026-07-27 (같은 날 추가): "컨텐츠 파일 바로넣기 해주면 안돼?" 요청 - 아직 유튜브에
// 올리지 않은 로컬 영상 파일도 분석할 수 있어야 한다는 요청(예: 코코로의 모구모구식당처럼
// 채널이 아직 없거나 특정 영상만 먼저 확인하고 싶은 경우). 채널 URL 대신 영상 파일을 올리면
// 장면을 몇 컷 뽑아 Claude Vision으로 콘텐츠 DNA를 분석하고, 그 결과로 똑같이 비슷한 채널을
// 찾아서 벤치마킹함 - 이후 단계(유사 채널 검색)는 두 입력 방식이 완전히 공유함.
// ============================================================

import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { callClaude, callClaudeJson } from '../lib/anthropicClient.js'
import {
  resolveChannelId,
  getChannelInfo,
  getChannelRecentVideos,
  searchChannels,
  estimateUploadsPerWeek,
} from '../lib/youtubeClient.js'

const router = Router()
const uploadDir = path.join(os.tmpdir(), 'anyone-content-dna-uploads')
fs.mkdirSync(uploadDir, { recursive: true })
const upload = multer({ dest: uploadDir, limits: { fileSize: 2 * 1024 * 1024 * 1024 } })

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}
function ffprobeBin() {
  return process.env.FFPROBE_PATH || 'ffprobe'
}

function parseDnaResponse(text) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI 응답에서 JSON을 찾지 못했어요.')
  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed.searchKeywords) || parsed.searchKeywords.length === 0) {
    throw new Error('검색 키워드를 만들지 못했어요.')
  }
  return parsed
}

const DNA_SYSTEM_PROMPT = `당신은 유튜브 채널 분석 전문가입니다. 주어진 자료(채널 정보+영상 제목들, 또는 영상 장면 이미지)를
보고 이 콘텐츠의 "콘텐츠 DNA"(핵심 주제, 톤/분위기, 타겟 시청자, 포맷 - 쇼츠/롱폼/브이로그 등)를 분석하고,
이것과 비슷한 다른 유튜브 채널을 찾을 때 쓸 검색 키워드를 만들어주세요.
- 검색 키워드는 유튜브 검색창에 실제로 넣을 법한 짧은 문구로, 한국어와 영어 섞어서 4~6개
- 채널 자체 이름이나 고유명사는 검색어에 넣지 마세요(그 채널만 다시 나옴)
반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이):
{"topic":"핵심 주제 한 줄","tone":"톤/분위기 한 줄","targetAudience":"타겟 시청자 한 줄","format":"포맷(쇼츠/롱폼/브이로그 등)","searchKeywords":["키워드1","키워드2","키워드3"]}`

// 키워드로 후보 채널을 찾아서 상세 정보 + 벤치마크 지표(업로드 주기/평균 길이/평균 조회수)까지
// 계산 - 채널 URL 입력이든 영상 파일 입력이든 이 단계부터는 완전히 공유됨.
async function findSimilarChannels(searchKeywords, excludeChannelId) {
  const candidateIds = new Set()
  for (const keyword of searchKeywords.slice(0, 5)) {
    const ids = await searchChannels({ query: keyword, maxResults: 5, regionCode: 'KR' })
    for (const id of ids) {
      if (id !== excludeChannelId) candidateIds.add(id)
    }
    if (candidateIds.size >= 12) break
  }

  const candidates = [...candidateIds].slice(0, 8)
  const similarChannels = []
  for (const id of candidates) {
    try {
      const info = await getChannelInfo(id)
      const videos = await getChannelRecentVideos(info.uploadsPlaylistId, 10)
      const durations = videos.map((v) => v.durationSeconds).filter(Boolean)
      const avgDurationSeconds = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null
      const avgViews = videos.length ? Math.round(videos.reduce((a, v) => a + v.viewCount, 0) / videos.length) : null
      similarChannels.push({
        channelId: info.channelId,
        title: info.title,
        thumbnail: info.thumbnail,
        subscriberCount: info.subscriberCount,
        uploadsPerWeek: estimateUploadsPerWeek(videos),
        avgDurationSeconds,
        avgViews,
        sampleThumbnails: videos.slice(0, 4).map((v) => ({ thumbnail: v.thumbnail, title: v.title, url: v.url })),
        channelUrl: `https://www.youtube.com/channel/${info.channelId}`,
      })
    } catch {
      // 후보 하나가 실패해도(비공개 채널 등) 나머지는 계속 진행 - best-effort
    }
  }
  similarChannels.sort((a, b) => (b.subscriberCount || 0) - (a.subscriberCount || 0))
  return similarChannels
}

router.post('/content-dna/analyze', upload.single('video'), async (req, res) => {
  const framePaths = []
  try {
    const channelUrl = req.body?.channelUrl

    if (req.file) {
      // ---- 입력 방식 1: 로컬 영상 파일 - 장면을 뽑아 Claude Vision으로 DNA 분석 ----
      const probe = spawnSync(ffprobeBin(), [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', req.file.path,
      ])
      const durationSec = Number(probe.stdout?.toString().trim()) || 0
      if (!durationSec) throw new Error('영상 길이를 확인하지 못했습니다.')

      const frameCount = Math.min(8, Math.max(3, Math.round(durationSec / 5)))
      const images = []
      for (let i = 0; i < frameCount; i += 1) {
        const t = (durationSec * (i + 0.5)) / frameCount
        const framePath = path.join(uploadDir, `dna-frame-${crypto.randomUUID()}.jpg`)
        framePaths.push(framePath)
        const shot = spawnSync(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', req.file.path, '-frames:v', '1', framePath])
        if (shot.status === 0 && fs.existsSync(framePath)) {
          images.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(framePath).toString('base64') } })
        }
      }
      if (images.length === 0) throw new Error('영상에서 장면을 추출하지 못했습니다.')

      const originalName = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8').replace(/\.[^.]+$/, '')
      const raw = await callClaude({
        system: DNA_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [...images, { type: 'text', text: `파일명(참고용): ${originalName || '(제목 없음)'}\n\n위 장면들을 보고 콘텐츠 DNA를 분석해주세요.` }],
        }],
        maxTokens: 700,
      })
      const dna = parseDnaResponse(raw)

      const similarChannels = await findSimilarChannels(dna.searchKeywords, null)

      return res.json({
        channel: { title: originalName || '(업로드한 영상)', thumbnail: null, subscriberCount: null, videoCount: null },
        dna: { topic: dna.topic, tone: dna.tone, targetAudience: dna.targetAudience, format: dna.format, searchKeywords: dna.searchKeywords },
        similarChannels,
      })
    }

    // ---- 입력 방식 2: 채널 URL ----
    if (!channelUrl) return res.status(400).json({ error: '채널 URL이나 영상 파일 중 하나를 입력해주세요.' })

    const channelId = await resolveChannelId(channelUrl)
    const channel = await getChannelInfo(channelId)
    const recentVideos = await getChannelRecentVideos(channel.uploadsPlaylistId, 15)
    if (recentVideos.length === 0) {
      return res.status(400).json({ error: '이 채널의 최근 영상을 찾지 못했어요. 영상이 있는 채널인지 확인해주세요.' })
    }

    const titleList = recentVideos.slice(0, 15).map((v) => `- ${v.title}`).join('\n')
    const dna = await callClaudeJson({
      system: DNA_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `채널명: ${channel.title}\n채널 설명: ${channel.description.slice(0, 500)}\n\n최근 영상 제목들:\n${titleList}`,
      }],
      maxTokens: 700,
      parse: parseDnaResponse,
    })

    const similarChannels = await findSimilarChannels(dna.searchKeywords, channelId)

    res.json({
      channel: { title: channel.title, thumbnail: channel.thumbnail, subscriberCount: channel.subscriberCount, videoCount: channel.videoCount },
      dna: { topic: dna.topic, tone: dna.tone, targetAudience: dna.targetAudience, format: dna.format, searchKeywords: dna.searchKeywords },
      similarChannels,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {})
    for (const p of framePaths) fs.unlink(p, () => {})
  }
})

export default router
