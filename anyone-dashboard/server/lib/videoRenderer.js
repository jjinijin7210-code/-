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

// 로컬 PC에 방금 설치한 ffmpeg는 winget이 PATH에 등록해줘도 이미 켜져 있던 터미널/서버
// 프로세스는 그 변경을 못 보는 경우가 많아서, 절대 경로를 직접 지정할 수 있게 해둠
// (.env의 FFMPEG_PATH/FFPROBE_PATH - 안 정해져 있으면 기존처럼 PATH에서 그냥 찾음, Render는 그대로 동작).
// 함수 안에서 매번 process.env를 읽어야 함 - 모듈 최상단에서 한 번만 읽으면 server/index.js의
// dotenv.config()보다 이 import가 먼저 실행돼버려서(ESM은 import가 항상 먼저 실행됨) 항상 빈 값만 보임.
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

export function ffprobeDuration(file) {
  const res = spawnSync(ffprobeBin(), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ])
  if (res.error) {
    throw new Error(`ffprobe를 실행하지 못했어요 (${res.error.message}).`)
  }
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
    // "효과 없음"도 줌/팬 없는 zoompan(z=1 고정)으로 만든다 - zoompan 없이 낮은 입력
    // 프레임레이트(1/씬길이) 이미지를 바로 fps 필터로 늘리면 화면이 까맣게 나오는 버그가
    // 있었다(2026-07-19 발견, 심리학 영상에서 "동영상 플레이가 안 되는데" 리포트로 확인).
    // zoompan의 d= 파라미터가 저프레임레이트 입력을 프레임 수만큼 실제로 펼쳐주는 역할을
    // 하는데, zoompan 자체를 안 쓰면 그 역할을 아무도 안 해서 생긴 문제로 보임.
    case 'none':
      return `zoompan=z=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
    // "앞뒤 반전" - 부메랑처럼 씬 절반까지는 줌인, 나머지 절반은 다시 줌아웃해서 원래대로
    // 돌아오는 효과(2026-07-19 요청). zoom(이전 프레임 값)이 아니라 on(현재 프레임 번호)의
    // 순수 함수로 만들어서 - 예전에 zoom 누적 방식으로 pan을 만들었다가 떨림 버그가 났던
    // 전례가 있어서 이번엔 처음부터 프레임 번호 기준으로 계산함.
    case 'boomerang': {
      const half = Math.max(Math.floor(frames / 2), 1)
      return `zoompan=z='if(lte(on,${half}),min(1.0+${step}*on,1.3),max(1.3-${step}*(on-${half}),1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
    }
    // "앞뒤 반전 (팬만, 줌 없음)" - boomerang과 같은 왕복 구조지만 줌은 전혀 안 쓰고 좌우로만
    // 왕복함(2026-07-19 요청: "앞뒤반전도 줌아웃 없는것도"). pan-left/right와 같은 panStep
    // 방식으로 절반 지점에서 끝에 정확히 도달하게 해서 떨림을 방지.
    case 'pan-boomerang': {
      const half = Math.max(Math.floor(frames / 2), 1)
      const halfPanStep = panRange / Math.max(half - 1, 1)
      return `zoompan=z=1.2:x='if(lte(on,${half}),min(${halfPanStep}*on,${panRange}),max(${panRange}-${halfPanStep}*(on-${half}),0))':y='ih/2-(ih/1.2/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
    }
    case 'zoom-in':
    default:
      return `zoompan=z='min(zoom+${step},1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`
  }
}

function buildImageClip(scene, idx, cfg, tmpDir) {
  const { width: w, height: h, fps } = cfg
  const duration = scene.duration || cfg.defaultSceneDuration || 4

  const textFilter = (() => {
    if (!scene.text) return ''
    const textFile = path.join(tmpDir, `text_${idx}.txt`)
    fs.writeFileSync(textFile, scene.text, 'utf8')
    // ffmpeg 필터그래프 문법에서 ':'는 옵션 구분자라 경로 안에 그대로 들어가면 파싱이 깨짐
    // (Windows 경로 "C:\Users\..."는 드라이브 콜론 때문에 특히 문제) - 콜론/백슬래시를 이스케이프.
    // 로컬 개발 검증(scripts/test-*)에서 실제로 발견된 버그(2026-07-19) - Render(Linux)는 경로에
    // 콜론이 없어서 지금까지 드러나지 않았을 뿐, 어느 OS에서든 안전하도록 항상 이스케이프함.
    const escapedPath = textFile.replace(/\\/g, '/').replace(/:/g, '\\:')
    return `,drawtext=font='Noto Sans CJK KR':textfile='${escapedPath}':fontcolor=white:fontsize=${(h * 0.045) | 0}:x=(w-text_w)/2:y=h-h*0.12:box=1:boxcolor=black@0.45:boxborderw=16`
  })()

  const out = path.join(tmpDir, `clip_${idx}.mp4`)

  // 진희님이 직접 만든 영상을 씬 소스로 그대로 쓸 수 있게 함(2026-07-19) - 정지 이미지가
  // 아니라서 loop/zoompan(줌·팬 효과)을 적용하면 안 되고, 이미 있는 움직임을 그대로 살려서
  // 원하는 씬 길이에 맞게 자르거나(길면) 반복해서 채움(짧으면).
  // 2026-07-22: 입모양 영상이 깨졌거나(코덱 문제 등) ffmpeg이 처리 못 하면 그 씬만 통째로
  // 실패해서 영상 전체가 날아가는 문제가 있어 - scene.fallbackSrc(같은 표정의 정지 이미지)가
  // 있으면 그걸로 대체해서 계속 진행한다("혹시 모르니까" 안전장치, 사용자 요청).
  if (scene.isVideo) {
    const filter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},format=yuv420p${textFilter}`
    try {
      run(['-stream_loop', '-1', '-i', scene.src, '-t', String(duration), '-vf', filter, '-r', String(fps), '-an', ...LOW_MEM_ENCODE_ARGS, out])
      return { file: out, duration }
    } catch (err) {
      if (!scene.fallbackSrc) throw err
      console.error(`[videoRenderer] 입모양 영상 렌더링 실패, 정지 이미지로 대체: ${err.message}`)
      return buildImageClip({ ...scene, isVideo: false, src: scene.fallbackSrc }, idx, cfg, tmpDir)
    }
  }

  // "화면이 한 바퀴 돌았다가 돌아오는" 회전 효과(2026-07-24 요청). zoompan은 x/y/zoom만
  // 다룰 수 있어서 회전은 별도의 rotate 필터로 처리해야 함 - 그냥 w×h 프레임을 돌리면 45도
  // 부근에서 모서리가 새까맣게 비게 되므로, 회전 중 어떤 각도에서도 중앙 w×h 영역이 항상
  // 실제 이미지로 덮이도록 (w+h)/√2 크기의 정사각형 캔버스로 먼저 오버샘플링한 뒤 그 위에서
  // 회전시키고, 마지막에 중앙 w×h만 잘라낸다(회전 사각형이 원본 사각형을 항상 덮는 최소
  // 크기 공식 - 이 값보다 작으면 회전 도중 모서리가 비어 보임).
  if (scene.motion === 'rotate') {
    const rw = Math.ceil((w + h) / Math.SQRT2)
    const peak = 2 * Math.PI // 한 바퀴(360도) 돌았다가 원래 각도로 복귀
    // 2026-07-24: "완급조절도 되면 좋겠다" 요청 - 기존엔 각도가 시간에 선형으로 늘었다가
    // 중간 지점에서 속도가 뚝 바뀌며 반대로 줄어드는 방식이라 반환점이 부자연스러웠음.
    // 순수 사인 곡선(1-cos)으로 바꿔서 시작·중간(최고 각도)·끝에서 모두 속도가 0에 가깝게
    // 부드럽게 감속/가속되도록 함 - 별도 구간 분기 없이 식 하나로 전체 왕복을 표현.
    const angleExpr = `(${peak}/2)*(1-cos(2*PI*t/${duration}))`
    // 2026-07-25 요청 - "돌면서 같이 살짝 커지는" 줌 추가. 회전이랑 같은 사인 곡선(1-cos)을
    // 타이밍만 공유해서 중간(최고 각도)에서 가장 확대되고, 시작·끝에서는 원래 크기로 돌아옴.
    // zoompan은 여기서 안 씀(정지 이미지 1프레임 입력 구조와 안 맞아 앞서 실패) - scale을
    // eval=frame으로 매 프레임 재계산해서 확대하고, crop으로 중앙만 다시 잘라내는 방식.
    const zoomAmount = 0.15 // 최대 15% 확대
    const zoomExpr = `(1+${zoomAmount}*(1-cos(2*PI*t/${duration}))/2)`
    const filter =
      `scale=${rw}:${rw}:force_original_aspect_ratio=increase,crop=${rw}:${rw},` +
      `rotate='${angleExpr}':ow=${rw}:oh=${rw}:fillcolor=black,` +
      `crop=${w}:${h},` +
      `scale=w='iw*${zoomExpr}':h='ih*${zoomExpr}':eval=frame,` +
      `crop=${w}:${h}:x='(in_w-out_w)/2':y='(in_h-out_h)/2',` +
      `format=yuv420p${textFilter}`
    // 다른 효과(zoompan 기반)는 정지 이미지를 씬 전체에 딱 1프레임만 넣어도 zoompan의
    // d= 파라미터가 알아서 프레임 수만큼 펼쳐주지만, rotate 필터엔 그런 기능이 없다. 그래서
    // 1/${duration}fps로 입력하면(즉 프레임이 딱 1장) rotate의 각도(t)가 그 한 프레임에서
    // 딱 한 번만 계산되고 그대로 복제돼 전혀 안 도는 것처럼 보였던 실제 버그가 있었음
    // (2026-07-25 실제 렌더링 결과로 확인) - 입력 프레임레이트를 fps로 올려서 매 프레임마다
    // rotate가 실제로 다른 t값으로 재계산되도록 수정.
    run(['-framerate', String(fps), '-loop', '1', '-i', scene.src, '-t', String(duration), '-vf', filter, '-r', String(fps), '-an', ...LOW_MEM_ENCODE_ARGS, out])
    return { file: out, duration }
  }

  const frames = Math.round(duration * fps)
  // 무료 인스턴스(512MB) 메모리 절약을 위해 오버샘플링 배율을 최소한으로만 둠
  const bw = Math.round(w * 1.2)
  const bh = Math.round(h * 1.2)
  const zoompan = kenBurnsFilter(scene.motion, frames, fps, w, h, bw)
  const postFilter = (zoompan ? `,${zoompan}` : `,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps}`) + ',format=yuv420p' + textFilter

  // 배경(scene.background) + 투명 배경 캐릭터(scene.src, PNG alpha)를 합성한 뒤 같은 방식으로
  // 줌/팬 처리 (2026-07-20 추가 - 코코로가 배경 없이 화면을 꽉 채우던 문제 해결용).
  // scene.src가 알파 채널이 없는 불투명 이미지면 배경이 안 보이고 캐릭터가 그대로 화면을
  // 덮어버리니, 투명 PNG일 때만 의미가 있음.
  if (scene.background) {
    const filterComplex =
      `[0:v]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh}[bg];` +
      `[1:v]scale=-1:${Math.round(bh * 0.85)}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)*0.6[merged];` +
      `[merged]${postFilter.slice(1)}[vout]`
    run([
      '-framerate', `1/${duration}`, '-loop', '1', '-i', scene.background,
      '-framerate', `1/${duration}`, '-loop', '1', '-i', scene.src,
      '-t', String(duration),
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-r', String(fps), '-an', ...LOW_MEM_ENCODE_ARGS, out,
    ])
    return { file: out, duration }
  }

  const filter = `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh}${postFilter}`

  // 입력 프레임레이트를 씬 길이 전체에 1장으로 낮춰서 이미지를 딱 1개의 입력 프레임으로만 공급한다.
  // 기본값(25fps)으로 두면 zoompan이 매 입력 프레임마다 줌/팬을 초기값으로 리셋해서
  // 초당 25번씩 화면이 튀는 깜빡임(스트로브) 현상이 생긴다.
  run(['-framerate', `1/${duration}`, '-loop', '1', '-i', scene.src, '-t', String(duration), '-vf', filter, '-r', String(fps), '-an', ...LOW_MEM_ENCODE_ARGS, out])
  return { file: out, duration }
}

// 단색 배경 이미지 한 장 생성 (코코로 같은 투명 PNG 캐릭터 뒤에 깔 용도). 사진이 아니라
// 브랜드 포인트컬러 단색/그라데이션이라 해상도가 크게 중요치 않아 씬 실제 해상도로 바로 생성.
export function generateSolidBackground(hex, w, h, outPath) {
  run(['-f', 'lavfi', '-i', `color=c=${hex}:s=${w}x${h}`, '-update', '1', '-frames:v', '1', outPath])
  return outPath
}

// 2026-07-25: "이미지 두 장이 교차하는" 전환 요청 - ffmpeg xfade에 이미 대각선으로 교차하며
// 넘어가는 전환(diagtl 등)이 내장되어 있어서, 커스텀 필터 없이 transition 종류만 바꿔서 재사용.
function concatWithCrossfade(clips, transitionDuration, cfg, tmpDir, transition = 'fade') {
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
    filterComplex += `[${prevLabel}][${i}]xfade=transition=${transition}:duration=${t}:offset=${offset}[${outLabel}];`
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
      // 숏폼은 빠른 템포가 몰입감을 높여서 내레이션만 기본 1.2배속으로 재생 (배경음악은 그대로 둠).
      // scene.voiceSpeed로 씬마다 다르게 지정 가능 (0.5~2.0 범위, atempo 필터 제약).
      tracks.push({
        file: scene.voice,
        delaySec: sceneStarts[i] || 0,
        volume: scene.voiceVolume || 1,
        loop: false,
        tempo: scene.voiceSpeed || 1.2,
      })
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
    if (t.tempo && t.tempo !== 1) chain += `,atempo=${t.tempo}`
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

// 2026-07-24: "포토카드가 젖혀지듯 회전하며 넘어가는" 씬 전환 효과 요청 - 참고 영상
// (트롯충전소 완성본/반짝반짝.mp4)을 프레임 단위로 뜯어보니 완전한 3D 큐브 회전이 아니라,
// 나가는 사진이 제자리에서 살짝 회전하며 투명해지고 그 아래 다음 사진이 드러나는 2D 효과였음.
// 회전 중 모서리가 비는 문제는, 어차피 그 아래 다음 사진(clip B)이 화면 전체를 이미 채우고
// 있어서 별도 오버샘플링 없이 그냥 겹쳐 보이면 되므로(단일 씬 회전 모션과 달리 신경 안 써도 됨).
function buildRotateTransitionClip(clipA, clipB, t, cfg, tmpDir, idx) {
  const peak = Math.PI / 8 // 약 22.5도 - 계속 도는 게 아니라 살짝 기울며 넘어가는 정도
  // 완급조절(2026-07-24) - 등속 대신 처음엔 천천히 기울다가 끝으로 갈수록 빨라지는 이즈인 곡선
  const angleExpr = `${peak}*(1-cos(PI*t/${t}/2))`
  const startA = Math.max(clipA.duration - t, 0)
  const filterComplex =
    `[0:v]trim=start=${startA}:end=${clipA.duration},setpts=PTS-STARTPTS,format=rgba,` +
    `rotate='${angleExpr}':ow=iw:oh=ih:fillcolor=none,fade=t=out:st=0:d=${t}:alpha=1,format=yuva420p[outA];` +
    `[1:v]trim=start=0:end=${t},setpts=PTS-STARTPTS[inB];` +
    `[inB][outA]overlay=format=auto,format=yuv420p[vout]`
  const out = path.join(tmpDir, `rottrans_${idx}.mp4`)
  run(['-i', clipA.file, '-i', clipB.file, '-filter_complex', filterComplex, '-map', '[vout]', '-r', String(cfg.fps), ...LOW_MEM_ENCODE_ARGS, out])
  return out
}

// concatWithCrossfade와 같은 입출력 계약(sceneStarts/totalDuration)을 지키되, 씬 사이를
// xfade(페이드) 대신 회전 전환 클립으로 이어붙임. 각 경계마다 별도 ffmpeg 호출로 작은 전환
// 클립을 만들고, 마지막에 concat 데뮤서(재인코딩)로 한 번에 합친다 - 여러 개의 작은 ffmpeg
// 호출로 나누는 기존 코드베이스 패턴(buildImageClip 등)과 동일하게, 메모리 사용을 낮게 유지.
function concatWithRotateTransition(clips, transitionDuration, cfg, tmpDir) {
  const sceneStarts = [0]
  let cumulative = clips[0].duration

  if (clips.length === 1) {
    return { file: clips[0].file, sceneStarts, totalDuration: cumulative }
  }

  const segments = []
  for (let i = 0; i < clips.length; i++) {
    const tNext = i < clips.length - 1 ? Math.min(transitionDuration, clips[i].duration, clips[i + 1].duration) : 0
    const tPrev = i > 0 ? Math.min(transitionDuration, clips[i - 1].duration, clips[i].duration) : 0
    const start = tPrev
    const end = clips[i].duration - tNext
    if (end > start + 0.05) {
      const mainOut = path.join(tmpDir, `rotmain_${i}.mp4`)
      run(['-i', clips[i].file, '-vf', `trim=start=${start}:end=${end},setpts=PTS-STARTPTS`, '-r', String(cfg.fps), ...LOW_MEM_ENCODE_ARGS, mainOut])
      segments.push(mainOut)
    }
    if (i < clips.length - 1) {
      segments.push(buildRotateTransitionClip(clips[i], clips[i + 1], tNext, cfg, tmpDir, i))
      sceneStarts.push(cumulative - tNext)
      cumulative = cumulative + clips[i + 1].duration - tNext
    }
  }

  const listFile = path.join(tmpDir, 'rotate_concat_list.txt')
  fs.writeFileSync(listFile, segments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
  const out = path.join(tmpDir, 'concatenated.mp4')
  run(['-f', 'concat', '-safe', '0', '-i', listFile, '-r', String(cfg.fps), ...LOW_MEM_ENCODE_ARGS, out])
  return { file: out, sceneStarts, totalDuration: cumulative }
}

// cfg: { width, height, fps, transitionDuration, transitionType, defaultSceneDuration, audio,
// audioVolume, scenes: [{ src, duration, motion, text }] }
// scenes[].src / cfg.audio 는 전부 로컬 파일 경로여야 함 (원격 URL은 미리 다운로드해서 넘길 것)
export function renderVideo(cfg, outputPath) {
  cfg.width = cfg.width || 1080
  cfg.height = cfg.height || 1920
  cfg.fps = cfg.fps || 30
  cfg.transitionDuration = cfg.transitionDuration != null ? cfg.transitionDuration : 0.6

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-shorts-'))
  try {
    const clips = cfg.scenes.map((scene, idx) => buildImageClip(scene, idx, cfg, tmpDir))
    const { file: concatenated, sceneStarts, totalDuration } =
      cfg.transitionType === 'rotate'
        ? concatWithRotateTransition(clips, cfg.transitionDuration, cfg, tmpDir)
        : concatWithCrossfade(clips, cfg.transitionDuration, cfg, tmpDir, cfg.transitionType === 'diagonal' ? 'diagtl' : 'fade')
    const withAudio = buildAudioMix(concatenated, cfg, sceneStarts, totalDuration, tmpDir)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.copyFileSync(withAudio, outputPath)
    return outputPath
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

// 사진 1~3장을 간단한 슬라이드쇼 영상으로 합성 (틱톡이 사진 업로드 모드를 없애고 영상만
// 받게 되면서, 사진을 그대로 못 올리니까 짧은 영상으로 만들어서 올리기 위한 용도).
// imageFiles: 로컬 파일 경로 배열. 사진 하나당 3초씩, 줌인 효과.
export function composeSimpleSlideshow(imageFiles, outputPath) {
  if (!imageFiles || imageFiles.length === 0) {
    throw new Error('슬라이드쇼를 만들 이미지가 없어요.')
  }
  // 계속 줌인만 하면 단조로워서 사진마다 줌인/부메랑(줌인 후 다시 줌아웃)을 번갈아 씀
  // (2026-07-19 요청 - 다른 쇼츠들도 앞뒤 반전 효과를 많이 쓰더라는 피드백 반영)
  const scenes = imageFiles.map((src, i) => ({ src, duration: 3, motion: i % 2 === 0 ? 'zoom-in' : 'boomerang' }))
  return renderVideo({ scenes }, outputPath)
}
