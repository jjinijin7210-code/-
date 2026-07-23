import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { renderVideo } from '../lib/videoRenderer.js'
import { GENERATED_DIR } from './shorts.js'
import { BGM_DIR } from '../lib/backgroundMusic.js'

// video-maker(독립 프로그램)의 씬 편집기를 그대로 대시보드 안으로 옮겨온 라우트.
// 렌더링 엔진(videoRenderer.js)은 video-maker/build.js와 동일한 로직을 공유한다.

const router = Router()
const uploadDir = path.join(os.tmpdir(), 'anyone-video-studio-uploads')
fs.mkdirSync(uploadDir, { recursive: true })
const upload = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } })

// 2026-07-23: "배경음악 추천 + 직접 고르기" 요청 - server/assets/bgm/에 넣어둔 무료 음악
// 목록을 보여줘서, 매번 파일을 새로 업로드하지 않고 목록에서 골라 쓸 수 있게 함.
router.get('/video-studio/bgm-list', (req, res) => {
  if (!fs.existsSync(BGM_DIR)) return res.json({ tracks: [] })
  const files = fs.readdirSync(BGM_DIR).filter((f) => /\.(mp3|wav)$/i.test(f))
  res.json({ tracks: files.map((f) => ({ filename: f, url: `/bgm-assets/${encodeURIComponent(f)}` })) })
})

router.post('/video-studio/render', upload.any(), (req, res) => {
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
    renderVideo(cfg, path.join(GENERATED_DIR, fileName))

    res.json({ videoUrl: `/generated/${fileName}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    ;(req.files || []).forEach((f) => fs.unlink(f.path, () => {}))
  }
})

export default router
