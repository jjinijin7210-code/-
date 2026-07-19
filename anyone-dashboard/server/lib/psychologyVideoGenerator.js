// ============================================================
// 심리학 유튜브 콘텐츠 자동 생성 - 주제 하나를 받아서
// 대본(포인트 여러 개) → 포인트별 내레이션(TTS) → 이미지 몇 장(부족하면 돌려씀) →
// 잔잔한 배경음악과 함께 영상으로 합성한다.
// 쇼츠(세로)와 롱폼(가로, 같은 이미지 몇 장을 돌려가며 더 길게)을 모두 지원.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { callClaude } from './anthropicClient.js'
import { buildPsychologyScriptMessages, parsePsychologyScriptResponse } from './psychologyScript.js'
import { generateSpeech } from './ttsClient.js'
import { generateImage } from './imageClient.js'
import { renderVideo, ffprobeDuration } from './videoRenderer.js'
import { pickBackgroundMusic } from './backgroundMusic.js'
import { GENERATED_DIR } from './shortsGenerator.js'

const MIN_SCENE_DURATION = 2.5

// 20대~시니어까지 편하게 들을 수 있는 차분한 목소리 (River - ElevenLabs 자체 라벨이 "calm").
// 기본 목소리(Rachel)는 좀 더 또렷하고 상품 홍보용 톤이라 심리학 콘텐츠엔 안 맞았음(2026-07-19 피드백).
const PSYCHOLOGY_VOICE_ID = 'SAz9YHcvj6GT2YYXdXww' // River
// stability를 높여서(기본 0.5→0.8) 톤 기복(음성이 "떨리는" 느낌)을 줄임 - 차분한 낭독 톤에 맞춤.
const PSYCHOLOGY_VOICE_STABILITY = 0.8

// 쇼츠는 포인트=이미지 1:1(짧으니 굳이 돌려쓸 필요 없음), 롱폼은 이미지 몇 장을 여러 포인트에
// 걸쳐 돌려쓴다(진희님 요청 - "이미지를 길게 해서 몇 장으로 상황에 맞게 돌려가며").
const FORMAT_CONFIG = {
  shorts: { width: 540, height: 960, fps: 24, pointCount: 5, maxUniqueImages: 5 },
  long: { width: 1280, height: 720, fps: 24, pointCount: 9, maxUniqueImages: 5 },
}

export async function generatePsychologyVideo({ topic, format = 'shorts', referenceNote }) {
  const cfg = FORMAT_CONFIG[format] || FORMAT_CONFIG.shorts
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-psych-video-'))

  try {
    // 1. 대본 생성 (포인트 여러 개, 포인트마다 자막+내레이션)
    const { system, messages } = buildPsychologyScriptMessages({ topic, pointCount: cfg.pointCount, referenceNote })
    const scriptText = await callClaude({ system, messages, maxTokens: 2048 })
    const script = parsePsychologyScriptResponse(scriptText)

    // 2. 포인트별 내레이션 TTS + 길이 측정 - 차분한 목소리로, 배속 없이(1.0배) 재생
    const points = []
    for (let i = 0; i < script.points.length; i++) {
      const point = script.points[i]
      const audioBuffer = await generateSpeech({
        text: point.narration,
        voiceId: PSYCHOLOGY_VOICE_ID,
        stability: PSYCHOLOGY_VOICE_STABILITY,
      })
      const voicePath = path.join(tmpDir, `voice_${i}.mp3`)
      fs.writeFileSync(voicePath, audioBuffer)
      const duration = Math.max(ffprobeDuration(voicePath), MIN_SCENE_DURATION)
      points.push({ caption: point.caption, voicePath, duration })
    }

    // 3. 이미지 생성 (포인트 수보다 적게 만들어서 돌려씀 - 비용/속도 절감)
    const imageCount = Math.min(points.length, cfg.maxUniqueImages)
    const imagePaths = []
    for (let i = 0; i < imageCount; i++) {
      const prompt = `심리학 유튜브 영상용 이미지. "${topic}" 주제와 어울리는 추상적/상징적 일러스트
또는 사물·풍경 중심 구도. 실존 인물의 얼굴을 클로즈업으로 그리지 말 것. 차분하고 신뢰감 있는
톤(차가운 블루톤이나 파스텔 톤). 저작권 문제 없는 완전히 새로운 창작 이미지여야 함.`
      const dataUrl = await generateImage({ prompt, size: format === 'shorts' ? '1024x1536' : '1536x1024' })
      const base64 = dataUrl.split(',')[1]
      const imgPath = path.join(tmpDir, `img_${i}.png`)
      fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'))
      imagePaths.push(imgPath)
    }

    // 4. 씬 구성 - 이미지는 모자라면 순환(modulo)해서 돌려씀. 줌/팬 효과를 쓰면 화면이
    // 흔들려 보인다는 피드백(2026-07-19)이 있어서, 이 콘텐츠는 효과 없이 정지 화면으로 둔다.
    // 내레이션도 숏폼 기본 배속(1.2배)을 쓰지 않고 원래 속도(1.0배) 그대로 재생.
    const scenes = points.map((p, i) => ({
      src: imagePaths[i % imagePaths.length],
      duration: p.duration,
      motion: 'none',
      text: p.caption,
      voice: p.voicePath,
      voiceSpeed: 1.0,
    }))

    // 5. 배경음악(있으면) + 렌더링
    const musicPath = pickBackgroundMusic()
    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.mp4`
    const outputPath = path.join(GENERATED_DIR, fileName)
    renderVideo(
      {
        width: cfg.width,
        height: cfg.height,
        fps: cfg.fps,
        transitionDuration: 0.5,
        audio: musicPath || undefined,
        audioVolume: 0.15, // 내레이션이 잘 들리도록 아주 낮게
        loopAudio: true,
        scenes,
      },
      outputPath
    )

    return { fileName, title: script.title, hook: script.hook, hasMusic: Boolean(musicPath) }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
