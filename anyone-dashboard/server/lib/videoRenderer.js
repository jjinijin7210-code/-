// ============================================================
// 정지 이미지(줌/팬 효과) + 내레이션 오디오를 합쳐 mp4로 렌더링.
// video-maker/build.js의 렌더링 로직을 이 서버(ESM) 안으로 옮겨온 버전.
// (Render 배포 단위가 anyone-dashboard 폴더 하나라 video-maker를 직접 참조할 수 없어서
//  같은 로직을 여기로 복사했어요 - 원본은 video-maker/build.js 참고)
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// 메모리가 작은 환경(예: 무료 호스팅 512MB)에서도 안 죽도록 인코더 부담을 최소화한다.
const LOW_MEM_ENCODE_ARGS = ['-preset', 'ultrafast', '-threads', '1']

function run(args) {
  const res = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  if (res.status !== 0) {
    throw new Error(`ffmpeg exited with code ${res.status}: ffmpeg ${args.join(' ')}`)
  }
}

export function ffprobeDuration(file) {
  const res = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ])
  return parseFloat(res.stdout.toString().trim())
}

function kenBurnsFilter(motion, frames, fps, w, h, bw) {
  const step = 0.0018
  // pan 씬은 프레임마다 고정 2px씩 이동했는데, 씬 길이(프레임 수)가 길어질수록 실제
  // 이동 가능 범위(iw - iw/1.2)를 넘어서서 화면 끝에서 미세하게 떨리는 현상이 있었다.
  // 전체 이동 거리를 씬 길이에 맞춰 나눠서 마지막 프레임에 정확히 끝에 도달하도록 하고,
  // 혹시 모를 반올림 오차는 clamp(max/min)로 막는다.
  const panRange = bw - bw / 1.2
  const panStep = panRange / Math.max(frames - 1, 1)
  switch (motion) {
    case 'zoom-out':
      return `zoompan=z='if(eq(on,0),1.3,max(zoom-${step},1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
    case 'pan-left':
      return `zoompan=z=1.2:x='if(eq(on,0),iw-iw/1.2,max(x-${panStep},0))':y='ih/2-(ih/1.2/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
    case 'pan-right':
      return `zoompan=z=1.2:x='if(eq(on,0),0,min(x+${panStep},iw-iw/1.2))':y='ih/2-(ih/1.2/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
    case 'none':
      return null
    case 'zoom-in':
    default:
      return `zoompan=z='min(zoom+${step},1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
  }
}

function buildImageClip(scene, idx, cfg, tmpDir) {
  const { width: w, height: h, fps } = cfg
  const duration = scene.duration || cfg.defaultSceneDuration || 4
  const frames = Math.round(duration * fps)
  // 무료 인스턴스(512MB) 메모리 절약을 위해 오버샘플링 배율을 최소한으로만 둠
  const bw = Math.round(w * 1.2)
  const bh = Math.round(h * 1.2)
  const zoompan = kenBurnsFilter(scene.motion, frames, fps, w, h, bw)

  let filter = `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh}`
  filter += zoompan ? `,${zoompan}` : `,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps}`
  filter += ',format=yuv420p'

  if (scene.text) {
    const textFile = path.join(tmpDir, `text_${idx}.txt`)
    fs.writeFileSync(textFile, scene.text, 'utf8')
    filter += `,drawtext=font='Noto Sans CJK KR':textfile='${textFile}':fontcolor=white:fontsize=${(h * 0.045) | 0}:x=(w-text_w)/2:y=h-h*0.12:box=1:boxcolor=black@0.45:boxborderw=16`
  }

  const out = path.join(tmpDir, `clip_${idx}.mp4`)
  // 입력 프레임레이트를 씬 길이 전체에 1장으로 낮춰서 이미지를 딱 1개의 입력 프레임으로만 공급한다.
  // 기본값(25fps)으로 두면 zoompan이 매 입력 프레임마다 줌/팬을 초기값으로 리셋해서
  // 초당 25번씩 화면이 튀는 깜빡임(스트로브) 현상이 생긴다.
  run(['-framerate', `1/${duration}`, '-loop', '1', '-i', scene.src, '-t', String(duration), '-vf', filter, '-r', String(fps), '-an', ...LOW_MEM_ENCODE_ARGS, out])
  return { file: out, duration }
}

function concatWithCrossfade(clips, transitionDuration, cfg, tmpDir) {
  const sceneStarts = [0]
  let cumulative = clips[0].duration

  if (clips.length === 1) {
    return { file: clips[0].file, sceneStarts, totalDuration: cumulative }
  }

  const inputArgs = []
  clips.forEach((c) => inputArgs.push('-i', c.file))

  let filterComplex = ''
  let prevLabel = '0'

  for (let i = 1; i < clips.length; i++) {
    const t = Math.min(transitionDuration, clips[i - 1].duration, clips[i].duration)
    const offset = Math.max(cumulative - t, 0)
    sceneStarts.push(offset)
    const outLabel = i === clips.length - 1 ? 'vout' : `v${i}`
    filterComplex += `[${prevLabel}][${i}]xfade=transition=fade:duration=${t}:offset=${offset}[${outLabel}];`
    cumulative = cumulative + clips[i].duration - t
    prevLabel = outLabel
  }
  filterComplex = filterComplex.replace(/;$/, '')

  const out = path.join(tmpDir, 'concatenated.mp4')
  run([...inputArgs, '-filter_complex', filterComplex, '-map', '[vout]', '-r', String(cfg.fps), ...LOW_MEM_ENCODE_ARGS, out])
  return { file: out, sceneStarts, totalDuration: cumulative }
}

// 배경음악/내레이션(cfg.audio, 전체 타임라인에 깔림) + 씬별 보이스(선택)를 하나의 트랙으로 믹싱
function buildAudioMix(videoFile, cfg, sceneStarts, totalDuration, tmpDir) {
  const tracks = []
  if (cfg.audio) {
    tracks.push({ file: cfg.audio, delaySec: 0, volume: cfg.audioVolume || 1, loop: cfg.loopAudio === true })
  }
  cfg.scenes.forEach((scene, i) => {
    if (scene.voice) {
      tracks.push({ file: scene.voice, delaySec: sceneStarts[i] || 0, volume: scene.voiceVolume || 1, loop: false })
    }
  })

  if (tracks.length === 0) return videoFile

  const out = path.join(tmpDir, 'with_audio.mp4')
  const args = ['-i', videoFile]

  tracks.forEach((t) => {
    if (t.loop) args.push('-stream_loop', '-1', '-t', String(totalDuration))
    args.push('-i', t.file)
  })

  const labels = tracks.map((t, i) => {
    const inputIdx = i + 1
    const label = `a${i}`
    let chain = `[${inputIdx}:a]volume=${t.volume}`
    if (t.delaySec > 0) chain += `,adelay=${Math.round(t.delaySec * 1000)}:all=1`
    chain += `[${label}]`
    return { chain, label }
  })

  let filterComplex = labels.map((l) => l.chain).join(';')
  let audioOutLabel
  if (labels.length === 1) {
    audioOutLabel = labels[0].label
  } else {
    audioOutLabel = 'aout'
    filterComplex += `;${labels.map((l) => `[${l.label}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[${audioOutLabel}]`
  }

  args.push(
    '-filter_complex', filterComplex,
    '-map', '0:v', '-map', `[${audioOutLabel}]`,
    '-t', String(totalDuration),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', out,
  )
  run(args)
  return out
}

// cfg: { width, height, fps, transitionDuration, defaultSceneDuration, audio, audioVolume, scenes: [{ src, duration, motion, text }] }
// scenes[].src / cfg.audio 는 전부 로컬 파일 경로여야 함 (원격 URL은 미리 다운로드해서 넘길 것)
export function renderVideo(cfg, outputPath) {
  cfg.width = cfg.width || 1080
  cfg.height = cfg.height || 1920
  cfg.fps = cfg.fps || 30
  cfg.transitionDuration = cfg.transitionDuration != null ? cfg.transitionDuration : 0.6

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-shorts-'))
  try {
    const clips = cfg.scenes.map((scene, idx) => buildImageClip(scene, idx, cfg, tmpDir))
    const { file: concatenated, sceneStarts, totalDuration } = concatWithCrossfade(clips, cfg.transitionDuration, cfg, tmpDir)
    const withAudio = buildAudioMix(concatenated, cfg, sceneStarts, totalDuration, tmpDir)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.copyFileSync(withAudio, outputPath)
    return outputPath
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
