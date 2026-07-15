import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { renderVideo } from '../lib/videoRenderer.js'
import { GENERATED_DIR } from './shorts.js'

// video-maker(독립 프로그램)의 씬 편집기를 그대로 대시보드 안으로 옮겨온 라우트.
// 렌더링 엔진(videoRenderer.js)은 video-maker/build.js와 동일한 로직을 공유한다.

const router = Router()
const uploadDir = path.join(os.tmpdir(), 'anyone-video-studio-uploads')
fs.mkdirSync(uploadDir, { recursive: true })
const upload = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } })

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
      const scene = { src: file.path, duration: Number(s.duration) || 4, motion: s.motion || 'zoom-in' }
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
