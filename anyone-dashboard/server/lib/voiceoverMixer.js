// ============================================================
// 2026-09-02 요청: "나래이션 나오는 동안은 음악을 줄이고 싶어" - CapCut 사용이 어려워서
// 매직스튜디오(영상 제작실) 안에서 영상+나레이션+배경음악을 한 번에 자르고 섞을 수 있게
// 하는 믹서. 핵심은 더킹(ducking): 나레이션 소리를 사이드체인 신호로 삼아, 나레이션이
// 들리는 동안만 배경음악 볼륨을 자동으로 눌러주는 ffmpeg sidechaincompress 필터를 쓴다
// (CapCut Pro의 "오디오 더킹" 기능과 같은 원리 - 나레이션이 멈추면 음악이 다시 커짐).
// videoRenderer.js처럼 작은 ffmpeg 호출 여러 번으로 나눠서 메모리 사용을 낮게 유지한다.
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const LOW_MEM_ENCODE_ARGS = ['-preset', 'ultrafast', '-threads', '1']

// videoRenderer.js와 같은 이유로 함수 안에서 매번 process.env를 읽는다
// (모듈 최상단에서 읽으면 dotenv.config()보다 먼저 실행돼서 항상 빈 값).
function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}
function ffprobeBin() {
  return process.env.FFPROBE_PATH || 'ffprobe'
}

function run(args) {
  const res = spawnSync(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  if (res.error) {
    throw new Error(`ffmpeg을 실행하지 못했어요 (${res.error.message}). ffmpeg이 설치되어 있는지, PATH에 잡혀 있는지 확인해주세요.`)
  }
  if (res.status !== 0) {
    throw new Error(`ffmpeg exited with code ${res.status}: ffmpeg ${args.join(' ')}`)
  }
}

function probeDuration(file) {
  const res = spawnSync(ffprobeBin(), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ])
  if (res.error) {
    throw new Error(`ffprobe를 실행하지 못했어요 (${res.error.message}).`)
  }
  const dur = parseFloat(res.stdout.toString().trim())
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error('파일 길이를 읽지 못했어요. 파일이 깨졌거나 지원하지 않는 형식일 수 있어요.')
  }
  return dur
}

// 영상 파일에 오디오 트랙이 아예 없을 수도 있어서(AI 생성 영상 등) 미리 확인한다 -
// 없는데 [0:a]를 참조하면 ffmpeg이 통째로 실패함.
function hasAudioStream(file) {
  const res = spawnSync(ffprobeBin(), [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file,
  ])
  if (res.error || res.status !== 0) return false
  return res.stdout.toString().trim().length > 0
}

// 더킹 세기 프리셋 - threshold(나레이션이 이 크기를 넘으면 누르기 시작)와
// ratio(얼마나 세게 누를지)를 함께 조절. 수치는 스피치+BGM 믹싱에서 흔히 쓰는 범위.
const DUCK_PRESETS = {
  soft: { threshold: 0.1, ratio: 4 },   // 살짝만 줄임
  medium: { threshold: 0.05, ratio: 8 }, // 나레이션이 또렷하게 들릴 정도 (기본)
  strong: { threshold: 0.02, ratio: 15 }, // 나레이션 동안 음악이 거의 안 들림
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

// cfg: {
//   video, videoStart, videoEnd, videoAudioVolume,            // 영상 + 자르기 + 원본 소리 볼륨(0이면 제거)
//   narration, narrStart, narrEnd, narrOffset, narrVolume,    // 나레이션 + 자르기 + 시작 위치(영상 기준 초)
//   music, musicStart, musicVolume, musicFadeIn, musicFadeOut, // 배경음악(선택) - 모자라면 자동 반복
//   duck, duckAmount('soft'|'medium'|'strong'),               // 나레이션 동안 음악 자동 줄이기
//   lengthMode('narration'|'video'),                          // 완성 길이 기준 (narration이면 영상을 반복해서 채움)
// }
// 모든 파일은 로컬 경로여야 함. 결과는 outputPath(mp4)로 저장.
export function mixVoiceover(cfg, outputPath) {
  if (!cfg.video) throw new Error('영상 파일이 없어요.')
  if (!cfg.narration) throw new Error('나레이션 파일이 없어요.')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-voiceover-mix-'))
  try {
    // ---- 구간 계산 (잘못된 입력은 조용히 전체 범위로 보정) ----
    const videoDur = probeDuration(cfg.video)
    const videoStart = clamp(Number(cfg.videoStart) || 0, 0, Math.max(videoDur - 0.2, 0))
    const videoEnd = cfg.videoEnd ? clamp(Number(cfg.videoEnd), videoStart + 0.2, videoDur) : videoDur
    const videoTrimDur = videoEnd - videoStart

    const narrDur = probeDuration(cfg.narration)
    const narrStart = clamp(Number(cfg.narrStart) || 0, 0, Math.max(narrDur - 0.2, 0))
    const narrEnd = cfg.narrEnd ? clamp(Number(cfg.narrEnd), narrStart + 0.2, narrDur) : narrDur
    const narrTrimDur = narrEnd - narrStart
    const narrOffset = Math.max(Number(cfg.narrOffset) || 0, 0)

    // 완성 영상 길이 - "나레이션 길이에 맞추기"면 (시작 위치 + 나레이션 길이)만큼 만들고
    // 짧은 영상은 뒤에서 반복해서 채운다 (8초짜리 분위기 영상 + 4분 나레이션 조합용).
    const total = cfg.lengthMode === 'video' ? videoTrimDur : narrOffset + narrTrimDur
    if (total < 0.5) throw new Error('완성 영상이 0.5초보다 짧아요. 자르기 구간을 확인해주세요.')

    // ---- 1) 영상 자르기 (정확한 프레임에서 자르기 위해 재인코딩) ----
    const videoCut = path.join(tmpDir, 'video_cut.mp4')
    run([
      '-ss', String(videoStart), '-i', cfg.video, '-t', String(videoTrimDur),
      '-map', '0:v', '-map', '0:a?',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...LOW_MEM_ENCODE_ARGS,
      '-c:a', 'aac', '-b:a', '192k', videoCut,
    ])

    // 완성 길이가 영상보다 길면 잘라둔 영상을 반복해서 채움. 이미 0초부터 시작하는
    // 클립이라 -ss+stream_loop 조합의 seek 무시 버그(videoRenderer.js 참고)는 안 밟는다.
    let videoFull = videoCut
    if (total > videoTrimDur + 0.05) {
      videoFull = path.join(tmpDir, 'video_full.mp4')
      run([
        '-stream_loop', '-1', '-i', videoCut, '-t', String(total),
        '-map', '0:v', '-map', '0:a?',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...LOW_MEM_ENCODE_ARGS,
        '-c:a', 'aac', '-b:a', '192k', videoFull,
      ])
    }

    // ---- 2) 나레이션 자르기 (wav로 통일해서 이후 필터 처리를 단순하게) ----
    const narrCut = path.join(tmpDir, 'narr_cut.wav')
    run([
      '-ss', String(narrStart), '-i', cfg.narration, '-t', String(narrTrimDur),
      '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', narrCut,
    ])

    // ---- 3) 배경음악 준비: 시작 지점부터 자르고 → 완성 길이만큼 반복 + 볼륨/페이드 ----
    let musicFull = null
    if (cfg.music) {
      const musicDur = probeDuration(cfg.music)
      const musicStart = clamp(Number(cfg.musicStart) || 0, 0, Math.max(musicDur - 0.5, 0))
      const musicVolume = clamp(Number(cfg.musicVolume) ?? 0.6, 0, 2) || 0
      const musicCut = path.join(tmpDir, 'music_cut.wav')
      run(['-ss', String(musicStart), '-i', cfg.music, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', musicCut])

      const fadeIn = clamp(Number(cfg.musicFadeIn) || 0, 0, total / 2)
      const fadeOut = clamp(Number(cfg.musicFadeOut) || 0, 0, total / 2)
      const musicFilters = [`volume=${musicVolume}`]
      if (fadeIn > 0) musicFilters.push(`afade=t=in:st=0:d=${fadeIn}`)
      if (fadeOut > 0) musicFilters.push(`afade=t=out:st=${Math.max(total - fadeOut, 0)}:d=${fadeOut}`)
      musicFull = path.join(tmpDir, 'music_full.wav')
      run(['-stream_loop', '-1', '-i', musicCut, '-t', String(total), '-af', musicFilters.join(','), musicFull])
    }

    // ---- 4) 최종 믹스: 영상(+원본 소리) + 나레이션 + (더킹된) 음악 ----
    const narrVolume = clamp(Number(cfg.narrVolume) ?? 1, 0, 2) || 0
    const videoAudioVolume = clamp(Number(cfg.videoAudioVolume) ?? 1, 0, 2)
    const useVideoAudio = videoAudioVolume > 0 && hasAudioStream(videoFull)
    const duck = cfg.duck !== false && Boolean(musicFull)
    const preset = DUCK_PRESETS[cfg.duckAmount] || DUCK_PRESETS.medium

    const args = ['-i', videoFull, '-i', narrCut]
    if (musicFull) args.push('-i', musicFull)

    // 나레이션: 볼륨 → 시작 위치만큼 지연 → 완성 길이까지 무음 채움(apad).
    // apad로 끝까지 채워두면 사이드체인 신호가 나레이션 끝난 뒤 무음이 되면서
    // 컴프레서가 풀려 음악이 자연스럽게 다시 커진다.
    const narrChain = [`volume=${narrVolume}`]
    if (narrOffset > 0) narrChain.push(`adelay=${Math.round(narrOffset * 1000)}:all=1`)
    narrChain.push(`apad=whole_dur=${total}`)

    let filterComplex = `[1:a]${narrChain.join(',')}[narr]`
    const mixLabels = []
    if (useVideoAudio) {
      filterComplex += `;[0:a]volume=${videoAudioVolume}[vida]`
      mixLabels.push('vida')
    }
    if (musicFull && duck) {
      // 나레이션을 둘로 나눠서 하나는 사이드체인 신호(음악 누르기용), 하나는 실제 믹스에 사용.
      // attack/release(ms)를 완만하게 줘서 음악이 훅 꺼지지 않고 스르륵 줄었다 돌아오게 함.
      filterComplex +=
        `;[narr]asplit=2[narrduck][narrmix]` +
        `;[2:a][narrduck]sidechaincompress=threshold=${preset.threshold}:ratio=${preset.ratio}:attack=100:release=600[music]`
      mixLabels.push('narrmix', 'music')
    } else if (musicFull) {
      mixLabels.push('narr')
      filterComplex += `;[2:a]anull[music]`
      mixLabels.push('music')
    } else {
      mixLabels.push('narr')
    }

    let audioOutLabel
    if (mixLabels.length === 1) {
      audioOutLabel = mixLabels[0]
    } else {
      audioOutLabel = 'aout'
      filterComplex += `;${mixLabels.map((l) => `[${l}]`).join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[${audioOutLabel}]`
    }

    args.push(
      '-filter_complex', filterComplex,
      '-map', '0:v', '-map', `[${audioOutLabel}]`,
      '-t', String(total),
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    )
    const mixed = path.join(tmpDir, 'mixed.mp4')
    args.push(mixed)
    run(args)

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.copyFileSync(mixed, outputPath)
    return outputPath
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
