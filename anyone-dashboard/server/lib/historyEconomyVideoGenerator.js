// ============================================================
// 역사경제 유튜브 콘텐츠 자동 생성 - 주제 하나를 받아서
// 대본(포인트 여러 개) → 포인트별 내레이션(TTS) → 포인트별 캐릭터 장면 합성(김 과장+고수
// 졸라맨, 로컬 ffmpeg) → 줌인/줌아웃을 랜덤으로 섞은 영상으로 합성한다 (psychologyVideoGenerator.js와
// 같은 뼈대, 일본어 번역 없이 역사경제 다큐용으로 새로 만듦).
//
// 2026-07-30 벤치마킹(뉴머니 채널, "글 한 줄로 영상 뽑는" 워크플로우) 반영: 줌인/줌아웃을
// 매번 랜덤으로 섞으면 "천편일률적인 영상"으로 안 보이고, 실제로 그 채널이 "이렇게 하면
// 양산형으로 걸릴 위험도 줄어든다"고 밝힌 이유이기도 함 - 우리도 같은 원리로 랜덤화함.
// 롱폼 위주(더타임/경제 채널 벤치마킹 다 5~10분대) 라 가로 포맷을 기본으로 함.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { callClaudeJson } from './anthropicClient.js'
import { buildHistoryEconomyScriptMessages, parseHistoryEconomyScriptResponse } from './historyEconomyScript.js'
import { generateSpeech } from './ttsClient.js'
import { searchPhotos } from './pexelsClient.js'
import { renderVideo, ffprobeDuration } from './videoRenderer.js'
import { pickBackgroundMusic } from './backgroundMusic.js'
import { GENERATED_DIR } from './shortsGenerator.js'
import { uploadGeneratedVideo } from './videoStorage.js'

const MIN_SCENE_DURATION = 3

// 차분하고 또렷한 다큐멘터리 내레이션에 어울리는 기본 목소리(ElevenLabs 멀티링구얼 기본값) -
// 코코로 전용 목소리(캐릭터 애니메이션용)와 달리 이 채널은 마스코트가 없는 다큐 톤이라 별도
// 지정 없이 서버 기본값(.env의 ELEVENLABS_VOICE_ID, 없으면 Rachel)을 그대로 씀.
const NARRATION_STABILITY = 0.75 // 차분한 낭독 톤 - 기본값(0.5)보다 톤 기복을 줄임

// 줌인/줌아웃만 랜덤으로 섞음 (뉴머니 채널 벤치마킹 - 팬/부메랑 등 다른 효과는 다큐 톤엔 과함)
const MOTIONS = ['zoom-in', 'zoom-out']
function randomMotion() {
  return MOTIONS[Math.floor(Math.random() * MOTIONS.length)]
}

// 2026-07-31 요청: "이 캐릭터를 역사경제 영상 제작에 쓰고 싶다" - 진희님이 직접 만든 2인조
// 마스코트(경제 캐릭터 폴더)를 다큐멘터리풍 무인물 일러스트 대신 매 장면 등장시킴. 실존 인물이
// 아닌 오리지널 캐릭터라 이미지 원칙(실존 인물 얼굴 금지)에 저촉되지 않음.
// - 김 과장: 안경 쓴 고민 많은 평범한 직장인 (질문하는/헷갈리는/걱정하는 입장)
// - 고수 졸라맨: 선글라스+망토+성장 그래프 방패를 든 흰색 스틱맨 (설명하는/조언하는 입장)
//
// 2026-08-01: 처음엔 매 장면 OpenAI(gpt-image-1)로 새로 그리려 했으나 OPENAI_API_KEY가 없어서
// 막힘(진희님 "무료 대안 찾기" 결정) - 대신 진희님이 직접 표정별로 만들어둔 배경 제거 PNG를
// ffmpeg로 배경 위에 합성하는 완전 무료/로컬 방식으로 바꿈. AI 이미지 생성 자체가 없어서
// OPENAI_API_KEY 없이도 항상 동작하고, 캐릭터 생김새도 100% 고정되어 흔들리지 않음.
const CHARACTER_DIR = 'C:\\Users\\aaa\\Desktop\\youtube\\경제 캐릭터'
// historyEconomyScript.js가 포인트마다 돌려주는 mood 값 → 김 과장 표정 이미지 매핑
const KIM_POSES = {
  neutral: '김과장-removebg-preview.png',
  worried: '걱정하는_김과장-removebg-preview.png',
  despair: '절망하는김과장__2.png',
  happy: '활짝_웃는_김과장1-removebg-preview.png',
  searching: '정보검색중인 김과장.png',
}
// 2026-08-01: "고수 졸라맨은 표정이 하나뿐이라 밋밋하다" 피드백 - 조언/방어 포즈를 추가로
// 받아서 위기 강도에 따라 3단계로 나눔: worried(가벼운 우려)엔 포인팅하며 설명하는 조언
// 포즈, despair(최악의 상황)엔 방어 태세 포즈, 그 외(neutral/happy/searching)엔 팔짱 끼고
// 자신감 있게 지켜보는 기본 포즈.
const JOLLAMAN_POSES = {
  confident: '고수_졸라맨-removebg-preview.png',
  advising: '조언하는 고수 졸라맨.png',
  defending: '방어자세하고있는_고수_졸라맨-removebg-preview.png',
}
function pickJollamanPose(mood) {
  if (mood === 'despair') return JOLLAMAN_POSES.defending
  if (mood === 'worried') return JOLLAMAN_POSES.advising
  return JOLLAMAN_POSES.confident
}
const SCENE_BACKGROUND_COLOR = '0xFAF3EA' // Pexels 배경을 못 구했을 때 대신 쓰는 크림색

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

// 2026-08-01 요청: "배경이 아무 그림도 없는 것보다 사진 있는 게 훨씬 낫다" - Pexels(무료
// 스톡사진, 이미 카드뉴스 등에서 쓰는 것과 같은 API)에서 포인트 내용에 맞는 사진을 받아 흐림+
// 어둡게 처리한 걸 배경으로 씀. PEXELS_API_KEY 없거나 검색/다운로드 실패하면 null을 돌려줘서
// compositeCharacterScene이 크림색 배경으로 조용히 대체하게 함 (weatherNote 등과 동일한
// best-effort 원칙 - 이 기능이 없다고 영상 생성 자체를 막으면 안 됨).
async function fetchPexelsBackground(query, tmpDir, index) {
  if (!process.env.PEXELS_API_KEY || !query) return null
  try {
    const results = await searchPhotos({ query, perPage: 1 })
    const photoUrl = results[0]?.full
    if (!photoUrl) return null
    const res = await fetch(photoUrl)
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    const bgPath = path.join(tmpDir, `bg_${index}.jpg`)
    fs.writeFileSync(bgPath, buffer)
    return bgPath
  } catch (err) {
    console.error('[historyEconomyVideoGenerator] Pexels 배경 조회 실패, 크림색 배경으로 대체:', err.message)
    return null
  }
}

// 김 과장(왼쪽, mood별 표정) + 고수 졸라맨(오른쪽, mood에 따라 조언/자신감 포즈)을 배경(Pexels
// 사진을 흐림+어둡게 처리한 것, 없으면 크림색 단색) 위에 하단 정렬로 합성해 씬 이미지 한 장을
// 만든다 - 캐릭터 자체는 순수 로컬 ffmpeg 합성이라 AI 이미지 생성 비용/키가 전혀 필요 없음.
function compositeCharacterScene({ mood, width, height, outPath, bgImagePath }) {
  const kimFile = KIM_POSES[mood] || KIM_POSES.neutral
  const kimPath = path.join(CHARACTER_DIR, kimFile)
  const jollamanPath = path.join(CHARACTER_DIR, pickJollamanPose(mood))
  if (!fs.existsSync(kimPath)) throw new Error(`캐릭터 이미지를 찾을 수 없어요: ${kimPath}`)
  if (!fs.existsSync(jollamanPath)) throw new Error(`캐릭터 이미지를 찾을 수 없어요: ${jollamanPath}`)

  // 2026-08-01 실측 확인: 캔버스 가장자리에 작게 배치하면 화면에 붕 떠 보임 - 크게(85%/95%)
  // 키우고 30%/72% 지점(중앙 쪽으로 당김)에 배치하는 게 훨씬 자연스러움(진희님 확인).
  const kimHeight = Math.round(height * 0.85)
  const jollaHeight = Math.round(height * 0.95)
  const marginBottom = Math.round(height * 0.02)

  // 배경 소스: Pexels 사진이 있으면 캔버스에 꽉 차게 잘라 흐림+어둡게, 없으면 크림색 단색
  const bgInput = bgImagePath
    ? ['-i', bgImagePath]
    : ['-f', 'lavfi', '-i', `color=c=${SCENE_BACKGROUND_COLOR}:s=${width}x${height}`]
  const bgFilter = bgImagePath
    ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=6,eq=brightness=-0.18[bg];`
    : `[0:v]copy[bg];`

  const filter =
    bgFilter +
    `[1:v]scale=-1:${kimHeight}[kim];` +
    `[2:v]scale=-1:${jollaHeight}[jolla];` +
    `[bg][kim]overlay=x=(0.3*W-w/2):y=H-h-${marginBottom}[bg1];` +
    `[bg1][jolla]overlay=x=(0.72*W-w/2):y=H-h-${marginBottom}`

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...bgInput,
    '-i', kimPath,
    '-i', jollamanPath,
    '-filter_complex', filter,
    '-frames:v', '1',
    outPath,
  ]
  const res = spawnSync(ffmpegBin(), args, { stdio: 'inherit' })
  if (res.error) {
    throw new Error(`ffmpeg을 실행하지 못했어요 (${res.error.message}).`)
  }
  if (res.status !== 0) {
    throw new Error(`캐릭터 장면 합성 실패 (ffmpeg exit ${res.status})`)
  }
}

const FORMAT_CONFIG = {
  long: { width: 1280, height: 720, fps: 24, pointCount: 9, maxUniqueImages: 9 },
  shorts: { width: 540, height: 960, fps: 24, pointCount: 6, maxUniqueImages: 6 },
}

export async function generateHistoryEconomyVideo({ topic, format = 'long', referenceNote }) {
  const cfg = FORMAT_CONFIG[format] || FORMAT_CONFIG.long
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-histecon-video-'))

  try {
    // 1. 대본 생성 (한국어 - JSON 파싱 실패 시 최대 2번 재시도, 다른 파이프라인과 동일 이유)
    const { system, messages } = buildHistoryEconomyScriptMessages({ topic, pointCount: cfg.pointCount, referenceNote })
    // 2026-07-30 실측 확인: 포인트마다 caption+narration까지 있어서 롱폼(9포인트) 기준 2560으로는
    // JSON이 중간에 잘려 파싱이 3번 다 실패하는 문제가 있었음 - 여유 있게 올림(다른 파이프라인의
    // 같은 종류 버그와 동일 원인/해결). imageHint 필드는 2026-08-01 캐릭터 합성 방식으로 바뀌며
    // 빠져서 여유가 더 생겼지만, 굳이 줄이지 않고 그대로 둠(안전 마진).
    const script = await callClaudeJson({ system, messages, maxTokens: 4096, parse: parseHistoryEconomyScriptResponse })

    // 2026-08-01: "경제 한입" 채널 브랜딩 확정 - 매 영상 첫 인사말을 AI가 매번 다르게 쓰게
    // 두지 않고("안녕하세요! 오늘도 경제 한입입니다." 문구를 채널 시그니처로 고정하고 싶다는
    // 요청) 코드에서 고정 오프닝 포인트를 항상 맨 앞에 붙임 - 나머지 포인트는 기존처럼 AI가 생성.
    script.points.unshift({
      caption: '오늘도 경제 한입!',
      narration: '안녕하세요! 오늘도 경제 한입입니다.',
      mood: 'happy',
      backgroundQuery: 'sunrise city skyline',
    })

    // 2. 포인트별 내레이션 TTS + 길이 측정, 동시에 포인트별 캐릭터 장면 합성(로컬 ffmpeg, 무료)
    const points = []
    for (let i = 0; i < script.points.length; i++) {
      const point = script.points[i]
      const audioBuffer = await generateSpeech({ text: point.narration, stability: NARRATION_STABILITY })
      const voicePath = path.join(tmpDir, `voice_${i}.mp3`)
      fs.writeFileSync(voicePath, audioBuffer)
      const duration = Math.max(ffprobeDuration(voicePath), MIN_SCENE_DURATION)

      const bgImagePath = await fetchPexelsBackground(point.backgroundQuery, tmpDir, i)
      const imgPath = path.join(tmpDir, `img_${i}.png`)
      compositeCharacterScene({ mood: point.mood, width: cfg.width, height: cfg.height, outPath: imgPath, bgImagePath })

      points.push({ caption: point.caption, voicePath, duration, imgPath })
    }

    // 3. 씬 구성 - 줌인/줌아웃 랜덤 (뉴머니 벤치마킹), 포인트마다 새로 생성한 이미지라 순환 불필요
    const scenes = points.map((p) => ({
      src: p.imgPath,
      duration: p.duration,
      motion: randomMotion(),
      text: p.caption,
      voice: p.voicePath,
      voiceSpeed: 1.0,
    }))

    // 4. 배경음악(있으면, 아주 낮은 볼륨) + 렌더링
    const musicPath = pickBackgroundMusic()
    fs.mkdirSync(GENERATED_DIR, { recursive: true })
    const fileName = `${crypto.randomUUID()}.mp4`
    const outputPath = path.join(GENERATED_DIR, fileName)
    renderVideo(
      {
        width: cfg.width,
        height: cfg.height,
        fps: cfg.fps,
        transitionDuration: 0.6,
        audio: musicPath || undefined,
        audioVolume: 0.12,
        loopAudio: true,
        scenes,
      },
      outputPath
    )

    // Render 무료 디스크는 재배포마다 초기화되므로 영구 보관용으로 Supabase Storage에도 업로드
    const videoUrl = await uploadGeneratedVideo(outputPath, fileName)

    return { fileName, videoUrl, title: script.title, hook: script.hook, hasMusic: Boolean(musicPath) }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
