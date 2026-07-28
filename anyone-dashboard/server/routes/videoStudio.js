import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { renderVideo, ffprobeDuration } from '../lib/videoRenderer.js'
import { renderVideoRemotion } from '../lib/remotionRenderer.js'
import { renderThumbnails } from '../lib/thumbnailRenderer.js'
import { callClaude } from '../lib/anthropicClient.js'
import { GENERATED_DIR } from './shorts.js'
import { BGM_DIR } from '../lib/backgroundMusic.js'

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

// video-maker(독립 프로그램)의 씬 편집기를 그대로 대시보드 안으로 옮겨온 라우트.
// 렌더링 엔진(videoRenderer.js)은 video-maker/build.js와 동일한 로직을 공유한다.

const router = Router()
const uploadDir = path.join(os.tmpdir(), 'anyone-video-studio-uploads')
fs.mkdirSync(uploadDir, { recursive: true })
// 2026-07-26: 실사용 중 영상(비디오) 씬 파일이 200MB 제한에 걸려 "File too large"로
// 업로드 자체가 거부되는 걸 발견 - 보통 영상 길이가 5분 정도라 화질에 따라 1GB도 빠듯할 수
// 있어서 2GB로 잡음 (로컬 PC에서만 쓰는 기능이라 용량 여유를 넉넉히 둬도 문제없음).
const upload = multer({ dest: uploadDir, limits: { fileSize: 2 * 1024 * 1024 * 1024 } })

// 2026-07-23: "배경음악 추천 + 직접 고르기" 요청 - server/assets/bgm/에 넣어둔 무료 음악
// 목록을 보여줘서, 매번 파일을 새로 업로드하지 않고 목록에서 골라 쓸 수 있게 함.
router.get('/video-studio/bgm-list', (req, res) => {
  if (!fs.existsSync(BGM_DIR)) return res.json({ tracks: [] })
  const files = fs.readdirSync(BGM_DIR).filter((f) => /\.(mp3|wav)$/i.test(f))
  res.json({ tracks: files.map((f) => ({ filename: f, url: `/bgm-assets/${encodeURIComponent(f)}` })) })
})

router.post('/video-studio/render', upload.any(), async (req, res) => {
  try {
    const scenesMeta = JSON.parse(req.body.scenesMeta || '[]')
    if (!scenesMeta.length) {
      return res.status(400).json({ error: '씬이 하나도 없어요.' })
    }

    const fileMap = {}
    ;(req.files || []).forEach((f) => {
      fileMap[f.fieldname] = f
    })

    const scenes = scenesMeta.map((s, i) => {
      const file = fileMap[`scene_image_${i}`]
      if (!file) throw new Error(`씬 ${i + 1}의 이미지 파일이 없어요.`)
      // multer가 저장하는 파일명엔 확장자가 없어서, 진짜 영상인지 사진인지는 업로드
      // 당시의 mimetype으로만 구분 가능함 (내가 만든 영상을 씬으로 그대로 넣고 싶다는 요청, 2026-07-19)
      const isVideo = (file.mimetype || '').startsWith('video/')
      const scene = { src: file.path, duration: Number(s.duration) || 4, motion: s.motion || 'zoom-in', isVideo }
      if (s.text) scene.text = s.text
      if (isVideo && s.startTime) scene.startTime = Number(s.startTime) || 0
      const voiceFile = fileMap[`scene_voice_${i}`]
      if (voiceFile) {
        scene.voice = voiceFile.path
        if (s.voiceVolume) scene.voiceVolume = Number(s.voiceVolume)
      }
      return scene
    })

    const cfg = {
      width: Number(req.body.width) || 1080,
      height: Number(req.body.height) || 1920,
      fps: Number(req.body.fps) || 30,
      transitionDuration: req.body.transitionDuration !== undefined ? Number(req.body.transitionDuration) : 0.6,
      transitionType: ['rotate', 'diagonal'].includes(req.body.transitionType) ? req.body.transitionType : 'fade',
      autoCaptionVoice: req.body.autoCaptionVoice === '1',
      autoCaptionBgm: req.body.autoCaptionBgm === '1',
      scenes,
    }
    if (fileMap.audio) {
      cfg.audio = fileMap.audio.path
      cfg.audioVolume = Number(req.body.audioVolume) || 1
      cfg.loopAudio = true
    } else if (req.body.bgmFilename) {
      // 추천 목록(server/assets/bgm/)에서 고른 경우 - 매번 새로 업로드 안 하고 파일명으로 바로 참조
      const bgmPath = path.join(BGM_DIR, path.basename(req.body.bgmFilename))
      if (fs.existsSync(bgmPath)) {
        cfg.audio = bgmPath
        cfg.audioVolume = Number(req.body.audioVolume) || 1
        cfg.loopAudio = true
      }
    }

    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.mp4`
    const outPath = path.join(GENERATED_DIR, fileName)

    if (req.body.engine === 'remotion') {
      // 베타(Phase 1)는 사진 씬만 지원 - 영상 씬은 다음 phase로 미룸(계획 문서 참고)
      if (scenes.some((s) => s.isVideo)) {
        return res.status(400).json({ error: '베타는 아직 영상 씬을 지원하지 않아요. 사진 씬만 사용해주세요.' })
      }
      await renderVideoRemotion(cfg, outPath)
    } else {
      renderVideo(cfg, outPath)
    }

    res.json({ videoUrl: `/generated/${fileName}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    ;(req.files || []).forEach((f) => fs.unlink(f.path, () => {}))
  }
})

// 2026-07-27 요청: "쇼츠나 롱폼은 후킹 들어간 썸네일도 추천해주면 안될까", "상품사진을
// 이미지로 만들어 넣을 수 있게", "이미지는 뒤로 빼고 앞에 글씨" - 상품 사진을 직접 첨부하거나
// (우선) 방금 렌더링한 영상(fileName으로 참조, 재업로드 없이 GENERATED_DIR에서 바로 읽음)에서
// 장면을 뽑아, Claude Vision으로 후킹 문구 3개 + 배경으로 쓸 최적 후보를 고른 뒤, 사진을
// 배경으로 깔고 그 위에 문구를 얹은 완성 썸네일 PNG까지 합성해서 반환한다.
router.post('/video-studio/thumbnail-suggest', upload.any(), async (req, res) => {
  const framePaths = []
  try {
    const text = (req.body.text || '').slice(0, 4000)
    const aspect = req.body.aspect === 'horizontal' ? 'horizontal' : 'vertical'
    const photoFiles = (req.files || []).filter((f) => f.fieldname === 'photos')

    const candidates = []
    for (const f of photoFiles) {
      candidates.push({ dataUrl: `data:${f.mimetype};base64,${fs.readFileSync(f.path).toString('base64')}` })
    }

    // 첨부 사진이 없으면 방금 렌더링한 영상(fileName)에서 장면 몇 컷을 대신 뽑는다.
    if (candidates.length === 0 && req.body.videoFileName) {
      const videoPath = path.join(GENERATED_DIR, path.basename(req.body.videoFileName))
      if (!fs.existsSync(videoPath)) throw new Error('렌더링된 영상을 찾지 못했어요.')
      const durationSec = ffprobeDuration(videoPath) || 0
      if (!durationSec) throw new Error('영상 길이를 확인하지 못했습니다.')
      const frameCount = Math.min(6, Math.max(3, Math.round(durationSec / 5)))
      for (let i = 0; i < frameCount; i += 1) {
        const t = (durationSec * (i + 0.5)) / frameCount
        const framePath = path.join(uploadDir, `thumb-frame-${crypto.randomUUID()}.jpg`)
        framePaths.push(framePath)
        const shot = spawnSync(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', videoPath, '-frames:v', '1', framePath])
        if (shot.status === 0 && fs.existsSync(framePath)) {
          candidates.push({ dataUrl: `data:image/jpeg;base64,${fs.readFileSync(framePath).toString('base64')}` })
        }
      }
    }
    if (candidates.length === 0) throw new Error('썸네일에 쓸 사진이나 영상이 없어요. 상품 사진을 첨부하거나 먼저 영상을 만들어주세요.')

    const visionBlocks = candidates.map((c, i) => [
      { type: 'text', text: `[사진 ${i + 1}]` },
      { type: 'image', source: { type: 'base64', media_type: c.dataUrl.match(/^data:(.+?);/)[1], data: c.dataUrl.split(',')[1] } },
    ]).flat()

    const system = `당신은 유튜브 쇼츠/롱폼 썸네일 기획자입니다. 보여드린 사진들과 영상 내용을 보고,
클릭을 유도하는 강렬한 후킹 문구(썸네일에 큼직하게 들어갈 짧은 문구) 3개를 제안하고,
그 중 썸네일 배경으로 쓰기 가장 좋은 사진 번호를 하나 골라주세요.
- 각 문구는 15자 내외로 짧고 강렬하게
- 과장이나 거짓 정보 없이, 실제 내용에 기반한 궁금증 유발형으로
반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이):
{"hooks":["문구1","문구2","문구3"],"bestPhotoNumber":1}`

    const raw = await callClaude({
      system,
      messages: [{ role: 'user', content: [...visionBlocks, { type: 'text', text: `영상 내용: ${text || '(설명 없음)'}` }] }],
      maxTokens: 600,
    })

    let parsed
    try {
      parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw)
    } catch {
      throw new Error('추천 결과를 해석하지 못했습니다.')
    }
    const hooks = Array.isArray(parsed.hooks) ? parsed.hooks.slice(0, 3) : []
    if (hooks.length === 0) throw new Error('후킹 문구를 만들지 못했습니다.')
    const bestIndex = Number.isInteger(parsed.bestPhotoNumber) ? parsed.bestPhotoNumber - 1 : 0

    const thumbnails = await renderThumbnails(hooks, candidates, bestIndex, aspect)
    res.json({ hooks, thumbnails })
  } catch (err) {
    res.status(400).json({ error: `썸네일 추천 실패: ${err.message}` })
  } finally {
    ;(req.files || []).forEach((f) => fs.unlink(f.path, () => {}))
    for (const p of framePaths) fs.unlink(p, () => {})
  }
})

export default router
