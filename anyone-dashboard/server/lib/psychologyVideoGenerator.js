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
import { callClaudeJson } from './anthropicClient.js'
import { buildPsychologyScriptMessages, parsePsychologyScriptResponse } from './psychologyScript.js'
import { buildPsychologyTranslateMessages, parsePsychologyTranslateResponse } from './psychologyTranslate.js'
import { generateSpeech } from './ttsClient.js'
import { generateImage } from './imageClient.js'
import { listCharacterAssets } from './characterImages.js'
import { renderVideo, ffprobeDuration, generateSolidBackground } from './videoRenderer.js'
import { pickBackgroundMusic } from './backgroundMusic.js'
import { GENERATED_DIR } from './shortsGenerator.js'
import { uploadGeneratedVideo } from './videoStorage.js'

const MIN_SCENE_DURATION = 2.5

// 2026-07-20: server/assets/characters/의 코코로 7종을 투명 배경으로 교체 완료.
// (remove.bg로 먼저 시도했는데 흰 몸통까지 같이 지워지는 문제가 있어서, 모서리에서부터
// 연결된 흰색만 배경으로 간주하는 플러드필 스크립트로 직접 처리함 - 검은 윤곽선에 막힌
// 몸통 내부는 안 건드림. 실제 합성 렌더링까지 확인 후 켬.)
const KOKORO_TRANSPARENT_BG = true
// 캐릭터 바이블 포인트컬러(민트/하늘색)에 맞춘 크림·민트·하늘 파스텔 3색을 씬마다 돌아가며 사용.
const PASTEL_BACKGROUNDS = ['#FFF6EC', '#EAF7F1', '#EAF2FB']

// 2026-07-19: 일본 심리학 채널 전용 마스코트 "Kokoro(こころ)" 확정(사용자가 만든 캐릭터 바이블
// 기준) - server/assets/characters/에 실제 캐릭터 파일을 넣어두면 이 프롬프트 대신 그 파일을
// 그대로 씀(더 정확함). 파일이 아직 없을 때의 AI 생성 폴백이 이 캐릭터 디자인에 최대한 맞도록
// 여기 묘사를 최대한 자세히 적어둠 - 정확히 똑같은 그림은 아니지만 톤/실루엣은 맞출 수 있음.
const KOKORO_CHARACTER_PROMPT = `캐릭터: "Kokoro(こころ)" - 심리를 쉽게 설명해주는 친구 같은 마스코트.
- 실루엣: 머리와 몸이 하나로 이어진 둥글고 통통한 물방울/블롭 모양, 짧은 다리 두 개만 있고 팔은
  포즈에 따라 아주 단순하게만 표현 (선생님이 아니라 옆에서 같이 고민해주는 친구 느낌)
- 색상: 흰색/크림색 몸통 + 굵고 깔끔한 검은색 윤곽선. 포인트 컬러는 민트그린(정수리에 작은
  하트 모양 더듬이/새싹 하나)과 연한 하늘색뿐 - 그 외 색은 거의 안 씀
- 얼굴: 아주 단순한 검은 점 두 개(눈)와 옅은 분홍색 볼터치. 입은 표정에 따라 곡선 하나로만.
  이목구비를 복잡하게 그리지 말고 "1초 안에 알아볼 수 있게" 최대한 단순하게
- 스타일: 플랫 벡터/라인아트, 그림자·그라데이션 없이 평면적으로, 귀엽고 친근한 톤
- 표정/포즈는 웃음·놀람·슬픔·화남·고민·기쁨·피곤·민망·설렘·울음 등 순수하고 단순한 감정 표현 위주`

// 진희님이 ElevenLabs Voice Library에서 직접 골라 지정한 목소리 (2026-07-22).
// 이전엔 River(SAz9YHcvj6GT2YYXdXww)를 썼음 - 기본 목소리(Rachel)가 상품 홍보용 톤이라
// 심리학 콘텐츠엔 안 맞아서(2026-07-19 피드백) River로 바꿨다가, 이번에 다시 교체.
const PSYCHOLOGY_VOICE_ID = 't3iNwCjYhE9IEQPVBlys'
// stability를 높여서(기본 0.5→0.8) 톤 기복(음성이 "떨리는" 느낌)을 줄임 - 차분한 낭독 톤에 맞춤.
const PSYCHOLOGY_VOICE_STABILITY = 0.8

// 쇼츠는 포인트=이미지 1:1(짧으니 굳이 돌려쓸 필요 없음), 롱폼은 이미지 몇 장을 여러 포인트에
// 걸쳐 돌려쓴다(진희님 요청 - "이미지를 길게 해서 몇 장으로 상황에 맞게 돌려가며").
const FORMAT_CONFIG = {
  shorts: { width: 540, height: 960, fps: 24, pointCount: 5, maxUniqueImages: 6 },
  long: { width: 1280, height: 720, fps: 24, pointCount: 9, maxUniqueImages: 6 },
}

export async function generatePsychologyVideo({ topic, format = 'shorts', referenceNote, storyMaterial }) {
  const cfg = FORMAT_CONFIG[format] || FORMAT_CONFIG.shorts
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-psych-video-'))

  try {
    // 1. 대본 생성 (한국어, 포인트 여러 개 - 사실관계 작성/검토가 한국어 프롬프트 체계에서 더 안정적)
    // JSON 파싱이 한 번 깨지면 영상 제작 전체가 날아가는 문제가 있어서(2026-07-19, benchmark.js와
    // 동일한 원인) 같은 프롬프트로 최대 2번까지 자동 재시도.
    const { system, messages } = buildPsychologyScriptMessages({ topic, pointCount: cfg.pointCount, referenceNote, storyMaterial })
    const script = await callClaudeJson({ system, messages, maxTokens: 2048, parse: parsePsychologyScriptResponse })

    // 1.5. 일본 채널이므로 실제 내레이션/자막은 일본어로 번역 (2026-07-19 피드백: "일본이라면서
    // 음성은 한국말로 나와" - 직역이 아니라 자연스러운 일본어 구어체로, 사실관계는 그대로 유지)
    const { system: trSystem, messages: trMessages } = buildPsychologyTranslateMessages({ script })
    const jaScript = await callClaudeJson({
      system: trSystem,
      messages: trMessages,
      maxTokens: 2048,
      parse: (text) => parsePsychologyTranslateResponse(text, script.points.length),
    })

    // 2. 포인트별 내레이션 TTS(일본어) + 길이 측정 - 차분한 목소리로, 배속 없이(1.0배) 재생
    const points = []
    for (let i = 0; i < jaScript.points.length; i++) {
      const point = jaScript.points[i]
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

    // 3. 캐릭터 소스 - 진희님이 만든 입모양 애니메이션 클립/정지 이미지가 있으면 그걸 그대로 씀
    // (비용 절감 + 채널 정체성), 둘 다 없으면 기존처럼 AI로 정지 이미지를 생성 (포인트 수보다
    // 적게 만들어서 돌려씀). listCharacterAssets()는 영상을 이미지보다 앞에 두므로, 영상이
    // maxUniqueImages개 이상이면 정지 이미지는 아예 안 쓰인다.
    const characterAssets = listCharacterAssets()
    let assets
    if (characterAssets.length > 0) {
      assets = characterAssets.slice(0, cfg.maxUniqueImages)
    } else {
      const imageCount = Math.min(points.length, cfg.maxUniqueImages)
      assets = []
      for (let i = 0; i < imageCount; i++) {
        const prompt = `${KOKORO_CHARACTER_PROMPT}

이 캐릭터가 "${topic}" 주제의 포인트를 설명/공감하는 장면. 표정과 포즈는 이 포인트의 감정(놀람,
공감, 위로, 생각에 잠김 등)에 맞게 골라서 그려줘. 배경은 아주 단순하게(단색 또는 옅은 파스텔),
캐릭터가 화면 중심에서 잘 보이도록. 저작권 문제 없는 완전히 새로운 창작 이미지여야 함.`
        const dataUrl = await generateImage({ prompt, size: format === 'shorts' ? '1024x1536' : '1536x1024' })
        const base64 = dataUrl.split(',')[1]
        const imgPath = path.join(tmpDir, `img_${i}.png`)
        fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'))
        assets.push({ src: imgPath, isVideo: false })
      }
    }

    // 4. 씬 구성 - 소스는 모자라면 순환(modulo)해서 돌려씀. 줌/팬 효과를 쓰면 화면이
    // 흔들려 보인다는 피드백(2026-07-19)이 있어서, 정지 이미지는 효과 없이 그대로 둔다.
    // 내레이션도 숏폼 기본 배속(1.2배)을 쓰지 않고 원래 속도(1.0배) 그대로 재생.
    // 코코로 정지 이미지가 투명 배경일 때만(KOKORO_TRANSPARENT_BG) 씬마다 파스텔 배경을 하나씩
    // 만들어 캐릭터 뒤에 깔아준다. 입모양 영상 자체는 배경이 이미 있어서 평소엔 안 쓰지만,
    // 영상이 실패해서 정지 이미지(fallbackSrc)로 대체될 때 필요하니 항상 미리 만들어둔다.
    const hasImageAssets = characterAssets.some((a) => !a.isVideo || a.fallbackSrc)
    const useBackground = KOKORO_TRANSPARENT_BG && hasImageAssets
    const backgroundPaths = useBackground
      ? PASTEL_BACKGROUNDS.map((hex, i) => {
          const bgPath = path.join(tmpDir, `bg_${i}.png`)
          generateSolidBackground(hex, cfg.width, cfg.height, bgPath)
          return bgPath
        })
      : []

    const scenes = points.map((p, i) => {
      const asset = assets[i % assets.length]
      return {
        src: asset.src,
        isVideo: asset.isVideo,
        // fallbackSrc가 있을 때만 background도 같이 넘김 - videoRenderer.js가 영상 렌더링 실패 시
        // 이 정지 이미지로 대체하면서 background를 함께 합성한다(평소엔 안 쓰임, 실패 시에만 참조).
        fallbackSrc: asset.isVideo ? asset.fallbackSrc : undefined,
        background: useBackground ? backgroundPaths[i % backgroundPaths.length] : undefined,
        duration: p.duration,
        motion: 'none',
        text: p.caption,
        voice: p.voicePath,
        voiceSpeed: 1.0,
      }
    })

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

    // Render 무료 디스크는 재배포마다 초기화돼서(에페메럴), 영구 보관용으로 Supabase Storage에도 올림
    // (2026-07-19 발견 - 오늘 여러 번 재배포하는 사이 만들어둔 영상이 실제로 사라져서 재생이 안 됐음)
    const videoUrl = await uploadGeneratedVideo(outputPath, fileName)

    return { fileName, videoUrl, title: jaScript.title, hook: jaScript.hook, hasMusic: Boolean(musicPath) }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
