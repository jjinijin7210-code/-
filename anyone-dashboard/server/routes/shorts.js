import { Router } from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { callClaude } from '../lib/anthropicClient.js'
import { buildShortsScriptMessages, parseShortsScriptResponse } from '../lib/shortsScript.js'
import { generateSpeech } from '../lib/ttsClient.js'
import { downloadToFile } from '../lib/mediaDownload.js'
import { renderVideo, ffprobeDuration } from '../lib/videoRenderer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const GENERATED_DIR = path.join(__dirname, '..', '..', 'generated')

const MOTIONS = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right']
const MIN_SCENE_DURATION = 2.5
const MAX_IMAGES = 8

const router = Router()

router.post('/shorts/generate', async (req, res) => {
  const { title, imageUrls, note } = req.body || {}

  if (!title || !title.trim()) {
    return res.status(400).json({ error: '제목(title)은 필수예요.' })
  }
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ error: '이미지(imageUrls)는 최소 1개 필요해요.' })
  }
  const images = imageUrls.slice(0, MAX_IMAGES)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-shorts-src-'))

  try {
    // 1. 후크/자막/내레이션 스크립트 생성
    const { system, messages } = buildShortsScriptMessages({ title, note, sceneCount: images.length })
    const scriptText = await callClaude({ system, messages, maxTokens: 1024 })
    const script = parseShortsScriptResponse(scriptText)

    // 2. 내레이션 TTS 생성
    const audioBuffer = await generateSpeech({ text: script.narration })
    const audioPath = path.join(tmpDir, 'narration.mp3')
    fs.writeFileSync(audioPath, audioBuffer)
    const audioDuration = ffprobeDuration(audioPath)

    // 3. 상품 이미지 다운로드
    const imagePaths = await Promise.all(
      images.map((url, idx) => downloadToFile(url, path.join(tmpDir, `image_${idx}.jpg`))),
    )

    // 4. 씬 구성 (내레이션 길이에 맞춰 이미지당 노출 시간 배분)
    const sceneDuration = Math.max(audioDuration / imagePaths.length, MIN_SCENE_DURATION)
    const scenes = imagePaths.map((src, idx) => ({
      src,
      duration: sceneDuration,
      motion: MOTIONS[idx % MOTIONS.length],
      text: script.captions[idx] || script.hook,
    }))

    // 5. 렌더링
    const fileName = `${crypto.randomUUID()}.mp4`
    const outputPath = path.join(GENERATED_DIR, fileName)
    renderVideo({ width: 1080, height: 1920, fps: 30, transitionDuration: 0.5, audio: audioPath, scenes }, outputPath)

    res.json({ videoUrl: `/generated/${fileName}`, script })
  } catch (err) {
    res.status(502).json({ error: err.message })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

export default router
