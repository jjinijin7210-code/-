// ============================================================
// 영상 제작실의 "✨ Remotion으로 만들기 (베타)" 버튼용 렌더러.
// server/lib/videoRenderer.js(ffmpeg 버전)의 renderVideo(cfg, outputPath)와 완전히
// 같은 cfg 모양을 받아서, 같은 결과 위치(outputPath)에 mp4를 만든다 - 기존 ffmpeg
// 경로는 이 파일과 무관하게 그대로 동작한다.
//
// 이번 phase(Phase 1) 범위: 이미지 씬 + zoom-in/zoom-out/pan-left/pan-right/boomerang/
// pan-boomerang 모션 + 페이드 전환만. rotate 모션과 영상(비디오) 씬, diagonal/rotate
// 전환은 다음 phase로 미룸 (server/routes/videoStudio.js에서 베타 진입 전에 걸러줌).
//
// Remotion은 로컬 PC에서 헤드리스 크롬을 띄워 렌더링하므로, Render 무료 플랜(512MB)에는
// 배포하지 않는다 - Dockerfile의 Playwright(로컬 전용) 처리와 같은 이유.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { installWhisperCpp, downloadWhisperModel, transcribe } from '@remotion/install-whisper-cpp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENTRY_POINT = path.join(__dirname, '..', '..', 'remotion', 'index.jsx')
const COMPOSITION_ID = 'VideoStudioScene'

// server/lib/videoRenderer.js의 ffmpegBin()과 같은 이유로 여기서도 매번 process.env를 읽음
// (.env의 FFMPEG_PATH - 없으면 PATH에서 그냥 찾음)
function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

// whisper.cpp + 모델은 한 번만 받아서 재사용 (렌더마다 새로 안 받음) - 레포 안 고정 경로,
// .gitignore에 등록돼 있음. 영어 전용(.en) 모델은 한국어를 못 알아들으므로 반드시 다국어 모델 사용.
const WHISPER_DIR = path.join(__dirname, '..', 'whisper-cpp')
const WHISPER_VERSION = '1.5.5'
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'small'

// 씬의 내레이션 음성을 텍스트+타이밍으로 자동 변환 (자막 자동 싱크 베타).
// whisper.cpp의 토큰 단위(tokenLevelTimestamps) 출력은 한글이 멀티바이트 경계에서 깨지는
// 문제가 실측으로 확인돼서(예: "주도"가 "주�"+"�"로 쪼개짐), 대신 splitOnWord로 단어 단위
// 세그먼트를 받아 최상위 text 필드만 사용함 - 이쪽은 완전한 단어라 안 깨짐.
async function transcribeVoice(voicePath, jobDir) {
  try {
    const wavPath = path.join(jobDir, `${path.basename(voicePath)}-16k.wav`)
    const conv = spawnSync(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', voicePath, '-ar', '16000', '-ac', '1', wavPath])
    if (conv.status !== 0) return null

    await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION })
    await downloadWhisperModel({ model: WHISPER_MODEL, folder: WHISPER_DIR })

    const result = await transcribe({
      model: WHISPER_MODEL,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      inputPath: wavPath,
      tokenLevelTimestamps: false,
      splitOnWord: true,
      language: 'ko',
    })

    const captions = result.transcription
      // whisper.cpp의 특수 마커([_BEG_] 등)나 빈 세그먼트는 자막이 아니므로 먼저 걸러냄
      .filter((item) => item.text.trim() && !/^\[_.*_\]$/.test(item.text.trim()))
      .map((item) => ({
        // 앞쪽 공백은 원본 그대로 유지 - @remotion/captions가 단어 사이 띄어쓰기로 씀
        // (trim해버리면 단어들이 다 붙어서 나옴 - 실측으로 확인한 버그)
        text: item.text,
        startMs: item.offsets.from,
        endMs: item.offsets.to,
        timestampMs: null,
        confidence: null,
      }))

    return captions.length ? captions : null
  } catch {
    // 실패해도 렌더링 전체를 막지 않고, 그 씬은 고정 자막으로 폴백함 (호출부에서 처리)
    return null
  }
}

// multer가 임시 업로드 파일을 확장자 없이 저장해서, Remotion의 public/ 폴더에 복사할 때
// 파일 내용(매직 바이트)으로 실제 형식을 알아내야 함 (mimetype을 cfg까지 끌고 오지 않기 위함).
function sniffExtension(filePath, fallback) {
  const buf = Buffer.alloc(12)
  const fd = fs.openSync(filePath, 'r')
  fs.readSync(fd, buf, 0, 12, 0)
  fs.closeSync(fd)

  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return '.webp'
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE') return '.wav'
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return '.gif'
  if (buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return '.mp3'
  return fallback
}

function copyIntoPublic(publicDir, srcPath, baseName, fallbackExt) {
  const ext = sniffExtension(srcPath, fallbackExt)
  const fileName = `${baseName}${ext}`
  fs.copyFileSync(srcPath, path.join(publicDir, fileName))
  return fileName
}

export async function renderVideoRemotion(cfg, outputPath) {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-remotion-'))
  const publicDir = path.join(jobDir, 'public')
  fs.mkdirSync(publicDir, { recursive: true })
  let bundleLocation = null

  try {
    const fps = cfg.fps || 30

    const scenes = []
    for (let i = 0; i < cfg.scenes.length; i++) {
      const scene = cfg.scenes[i]
      const fileName = copyIntoPublic(publicDir, scene.src, `scene_${i}`, '.jpg')
      const voice = scene.voice
        ? { fileName: copyIntoPublic(publicDir, scene.voice, `voice_${i}`, '.mp3'), volume: scene.voiceVolume ?? 1 }
        : null

      // 보이스가 있고 자동 자막을 켰으면 그 씬만 단어 싱크 자막으로, 실패하면 고정 자막 폴백
      const captions = cfg.autoCaptionVoice && scene.voice ? await transcribeVoice(scene.voice, jobDir) : null

      scenes.push({
        fileName,
        // rotate는 이번 phase 미구현 - zoom-in으로 대체 (영상 자체는 만들어지게)
        motion: scene.motion === 'rotate' ? 'zoom-in' : scene.motion || 'zoom-in',
        durationInFrames: Math.max(1, Math.round((scene.duration || 4) * fps)),
        text: scene.text || '',
        voice,
        captions,
      })
    }

    // 배경음악 가사도 자동 자막 대상 - 노래라 내레이션보다 인식률이 떨어질 수 있음(사용자에게
    // 이미 안내함, 2026-07-26). 실패하면 그냥 가사 자막 없이 진행(에러로 안 막음).
    const bgm = cfg.audio
      ? {
          fileName: copyIntoPublic(publicDir, cfg.audio, 'bgm', '.mp3'),
          volume: cfg.audioVolume ?? 1,
          captions: cfg.autoCaptionBgm ? await transcribeVoice(cfg.audio, jobDir) : null,
        }
      : null

    const inputProps = {
      width: cfg.width || 1080,
      height: cfg.height || 1920,
      fps,
      transitionFrames: Math.max(0, Math.round((cfg.transitionDuration ?? 0.6) * fps)),
      // diagonal은 아직 미구현 - fade로 대체. rotate(포토카드 회전)는 지원.
      transitionType: cfg.transitionType === 'rotate' ? 'rotate' : 'fade',
      bgm,
      scenes,
    }

    bundleLocation = await bundle({ entryPoint: ENTRY_POINT, publicDir })

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: COMPOSITION_ID,
      inputProps,
    })

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
    })
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true })
    if (bundleLocation) fs.rmSync(bundleLocation, { recursive: true, force: true })
  }
}
