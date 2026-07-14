// ============================================================
// 상품 이미지 여러 장 + 제목/메모를 받아서 후크/자막/내레이션 스크립트를 만들고
// 팬/줌 효과로 짧은 영상을 렌더링한다. shorts.js(수동)와 auto.js(자동)가 공유해서 쓴다.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { callClaude } from './anthropicClient.js'
import { buildShortsScriptMessages, parseShortsScriptResponse } from './shortsScript.js'
import { generateSpeech } from './ttsClient.js'
import { downloadToFile } from './mediaDownload.js'
import { renderVideo, ffprobeDuration } from './videoRenderer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const GENERATED_DIR = path.join(__dirname, '..', '..', 'generated')

const MOTIONS = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right']
const MIN_SCENE_DURATION = 2.5
const MAX_IMAGES = 8

export async function generateShortsVideo({ title, imageUrls, note }) {
  if (!title || !title.trim()) {
    throw new Error('제목(title)은 필수예요.')
  }
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw new Error('이미지(imageUrls)는 최소 1개 필요해요.')
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

    // 3. 이미지 다운로드 (비슷한 상품 여러 개를 조합 - 특정 한 상품 소재를 그대로 재사용하지 않기 위함)
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

    // 5. 렌더링 (무료 인스턴스 512MB 메모리 안에서 돌아가도록 해상도/fps를 가볍게 유지)
    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.mp4`
    const outputPath = path.join(GENERATED_DIR, fileName)
    renderVideo({ width: 540, height: 960, fps: 24, transitionDuration: 0.5, audio: audioPath, scenes }, outputPath)

    return { fileName, script }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
