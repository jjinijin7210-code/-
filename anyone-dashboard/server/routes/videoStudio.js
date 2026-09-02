import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { renderVideo, ffprobeDuration } from '../lib/videoRenderer.js'
import { mixVoiceover } from '../lib/voiceoverMixer.js'
import { renderVideoRemotion } from '../lib/remotionRenderer.js'
import { renderThumbnails } from '../lib/thumbnailRenderer.js'
import { buildCapcutExport } from '../lib/capcutExport.js'
import { removeWatermark } from '../lib/watermarkRemover.js'
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

// /render와 /export-capcut이 공유하는 요청 파싱 - 씬 구성 규칙이 두 곳에서 어긋나지 않도록
// 한 곳에서만 관리한다.
function buildCfgFromRequest(req) {
  const scenesMeta = JSON.parse(req.body.scenesMeta || '[]')
  if (!scenesMeta.length) {
    throw new Error('씬이 하나도 없어요.')
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
    if (s.effect === 'heart') scene.effect = 'heart'
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
    decoration: ['hearts', 'stars', 'ribbon', 'gold'].includes(req.body.decoration) ? req.body.decoration : 'none',
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
  return cfg
}

router.post('/video-studio/render', upload.any(), async (req, res) => {
  try {
    const cfg = buildCfgFromRequest(req)

    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.mp4`
    const outPath = path.join(GENERATED_DIR, fileName)

    if (req.body.engine === 'remotion') {
      // 베타(Phase 1)는 사진 씬만 지원 - 영상 씬은 다음 phase로 미룸(계획 문서 참고)
      if (cfg.scenes.some((s) => s.isVideo)) {
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

// 2026-09-02 요청: "나래이션 나오는 동안은 음악을 줄이고 싶어" - CapCut이 어려워서 매직스튜디오
// 안에서 영상+나레이션+배경음악을 한 번에 자르고 섞는 믹서 엔드포인트. 나레이션이 들리는 동안
// 배경음악을 자동으로 줄이는 더킹은 voiceoverMixer.js(sidechaincompress)가 처리한다.
router.post('/video-studio/mix-voiceover', upload.any(), async (req, res) => {
  try {
    const fileMap = {}
    ;(req.files || []).forEach((f) => {
      fileMap[f.fieldname] = f
    })
    if (!fileMap.video) return res.status(400).json({ error: '영상 파일을 올려주세요.' })
    if (!fileMap.narration) return res.status(400).json({ error: '나레이션 파일을 올려주세요.' })

    // 음악은 직접 업로드(music) 또는 추천 목록(server/assets/bgm/)에서 고른 파일명 - 없어도 됨
    let musicPath = null
    if (fileMap.music) {
      musicPath = fileMap.music.path
    } else if (req.body.musicBgmFilename) {
      const bgmPath = path.join(BGM_DIR, path.basename(req.body.musicBgmFilename))
      if (fs.existsSync(bgmPath)) musicPath = bgmPath
    }

    const num = (v, fallback) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }
    const cfg = {
      video: fileMap.video.path,
      videoStart: num(req.body.videoStart, 0),
      videoEnd: req.body.videoEnd ? num(req.body.videoEnd, null) : null,
      videoAudioVolume: num(req.body.videoAudioVolume, 1),
      narration: fileMap.narration.path,
      narrStart: num(req.body.narrStart, 0),
      narrEnd: req.body.narrEnd ? num(req.body.narrEnd, null) : null,
      narrOffset: num(req.body.narrOffset, 0),
      narrVolume: num(req.body.narrVolume, 1),
      music: musicPath,
      musicStart: num(req.body.musicStart, 0),
      musicVolume: num(req.body.musicVolume, 0.6),
      musicFadeIn: num(req.body.musicFadeIn, 0),
      musicFadeOut: num(req.body.musicFadeOut, 0),
      duck: req.body.duck !== '0',
      duckAmount: ['soft', 'medium', 'strong'].includes(req.body.duckAmount) ? req.body.duckAmount : 'medium',
      lengthMode: req.body.lengthMode === 'video' ? 'video' : 'narration',
    }

    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.mp4`
    const outPath = path.join(GENERATED_DIR, fileName)
    mixVoiceover(cfg, outPath)

    res.json({ videoUrl: `/generated/${fileName}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    ;(req.files || []).forEach((f) => fs.unlink(f.path, () => {}))
  }
})

// 2026-07-30: 완전 자동 렌더링 대신 CapCut에서 마무리 편집하도록 소재(이미지/영상+오디오+자막)만
// zip으로 묶어서 내보내는 옵션 - 다른 창작자의 AI 영상 툴을 벤치마킹해서 추가함(렌더링 버그
// 리스크를 줄이는 대안 경로). autoCaptionVoice를 함께 보내면 whisper.cpp로 자동 자막까지 만든다.
router.post('/video-studio/export-capcut', upload.any(), async (req, res) => {
  try {
    const cfg = buildCfgFromRequest(req)

    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.zip`
    const outPath = path.join(GENERATED_DIR, fileName)

    await buildCapcutExport(cfg, outPath)

    res.json({ zipUrl: `/generated/${fileName}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    ;(req.files || []).forEach((f) => fs.unlink(f.path, () => {}))
  }
})

// 2026-08-01 요청: "노트북LM 워터마크 지우기 나도 할 수 있게 해줘" - 영상 하나 업로드하면
// 우측 하단 워터마크(기본은 노트북LM 위치)를 지워서 돌려줌. 결과는 기존 render/export-capcut과
// 같은 GENERATED_DIR/UUID 규칙을 써서, 위에 있는 DELETE 정리 엔드포인트를 그대로 재사용함.
router.post('/video-studio/remove-watermark', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '영상 파일이 필요해요.' })
    }
    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.mp4`
    const outPath = path.join(GENERATED_DIR, fileName)

    removeWatermark(req.file.path, outPath)

    res.json({ videoUrl: `/generated/${fileName}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {})
  }
})

// 렌더링 결과(mp4/zip)를 다 쓰고 나서 서버 디스크에서 지우는 정리용 - 우리가 만든 이름
// (UUID.mp4 / UUID.zip)만 허용해서 다른 경로를 못 건드리게 함.
router.delete('/video-studio/generated/:fileName', (req, res) => {
  const fileName = req.params.fileName
  if (!/^[a-f0-9-]{36}\.(mp4|zip)$/i.test(fileName)) {
    return res.status(400).json({ error: '삭제할 수 없는 파일 이름이에요.' })
  }
  const filePath = path.join(GENERATED_DIR, path.basename(fileName))
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '이미 삭제된 파일이에요.' })
  }
  fs.unlinkSync(filePath)
  res.json({ ok: true })
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
- 각 문구마다 sentiment도 같이 정해주세요: 손실·위기·경고성 내용이면 "warning", 기회·성장·꿀팁성
  내용이면 "opportunity" (색상이 여기에 맞춰 자동으로 빨강/노랑으로 바뀝니다)
반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이):
{"hooks":[{"text":"문구1","sentiment":"warning 또는 opportunity"},{"text":"문구2","sentiment":"..."},{"text":"문구3","sentiment":"..."}],"bestPhotoNumber":1}`

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
    // hooks가 {text,sentiment} 객체 배열이 기본이지만, 혹시 예전처럼 문자열만 왔을 때도
    // 깨지지 않게 방어(sentiment 없으면 렌더러가 알아서 opportunity로 기본 처리함).
    const rawHooks = Array.isArray(parsed.hooks) ? parsed.hooks.slice(0, 3) : []
    if (rawHooks.length === 0) throw new Error('후킹 문구를 만들지 못했습니다.')
    const hooks = rawHooks.map((h) => (typeof h === 'string' ? h : h.text))
    const sentiments = rawHooks.map((h) => (typeof h === 'object' && h.sentiment === 'warning' ? 'warning' : 'opportunity'))
    const bestIndex = Number.isInteger(parsed.bestPhotoNumber) ? parsed.bestPhotoNumber - 1 : 0

    const thumbnails = await renderThumbnails(hooks, candidates, bestIndex, aspect, sentiments)
    res.json({ hooks, thumbnails })
  } catch (err) {
    res.status(400).json({ error: `썸네일 추천 실패: ${err.message}` })
  } finally {
    ;(req.files || []).forEach((f) => fs.unlink(f.path, () => {}))
    for (const p of framePaths) fs.unlink(p, () => {})
  }
})

// 2026-08-02 요청: "대사나 나레이션 흐름을 읽고 장면에 맞는 줌/팬/하트 같은 걸 자동으로
// 넣어줄 수 있을까" - 씬마다 이미 입력해둔 자막/나레이션 텍스트만 보내면, 전체 흐름을 고려해서
// 장면별 모션+효과를 한 번에 추천해준다. 파일 업로드는 필요 없어서(텍스트만 판단 재료) JSON으로 받음.
const MOTION_VALUES = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'boomerang', 'pan-boomerang', 'rotate', 'none']

router.post('/video-studio/auto-direct', async (req, res) => {
  try {
    const scenes = Array.isArray(req.body.scenes) ? req.body.scenes : []
    if (!scenes.length) throw new Error('연출을 정할 장면이 없어요.')

    const sceneList = scenes
      .map((s, i) => `${i + 1}. (${s.isVideo ? '영상 씬' : '사진 씬'}) ${s.text?.trim() || '(자막/나레이션 없음)'}`)
      .join('\n')

    const system = `당신은 유튜브 쇼츠/롱폼 영상 편집 감독입니다. 아래는 영상의 장면별 자막/나레이션
순서입니다. 전체 흐름(도입-전개-강조-마무리 같은 리듬)을 읽고, 각 장면에 어울리는 카메라 연출을
정해주세요.

사용 가능한 motion: ${MOTION_VALUES.join(', ')} (zoom-in/out은 강조·긴장감, pan은 시선 이동,
boomerang 계열은 반전/임팩트, rotate는 눈에 띄는 전환, none은 차분한 장면에)
효과 effect는 "heart" 또는 "none" - 로맨틱하거나 훈훈하거나 감동적인 내용의 장면에만 "heart"를
쓰고, 그 외엔 전부 "none"으로 (하트를 남발하면 안 됨 - 전체 장면 중 정말 어울리는 곳에만).
"영상 씬"이라고 표시된 장면은 이미 자체적으로 움직이는 영상이라 motion은 반드시 "none"으로
고정하고, effect만 판단하세요.

반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이, 장면 개수와 순서를 정확히 맞춰서):
{"directions":[{"motion":"...","effect":"heart 또는 none"}]}`

    const raw = await callClaude({
      system,
      messages: [{ role: 'user', content: `장면 목록:\n${sceneList}` }],
      maxTokens: 800,
    })

    let parsed
    try {
      parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw)
    } catch {
      throw new Error('연출 추천 결과를 해석하지 못했습니다.')
    }
    const rawDirections = Array.isArray(parsed.directions) ? parsed.directions : []
    if (rawDirections.length === 0) throw new Error('연출을 추천하지 못했습니다.')

    // Claude가 씬 개수를 못 맞추거나 잘못된 값을 주는 경우를 대비 - 장면 수만큼 안전하게 보정.
    const directions = scenes.map((s, i) => {
      const d = rawDirections[i] || {}
      const motion = s.isVideo ? 'none' : (MOTION_VALUES.includes(d.motion) ? d.motion : 'zoom-in')
      const effect = d.effect === 'heart' ? 'heart' : 'none'
      return { motion, effect }
    })

    res.json({ directions })
  } catch (err) {
    res.status(400).json({ error: `자동 연출 실패: ${err.message}` })
  }
})

export default router
