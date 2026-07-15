#!/usr/bin/env node
// 뮤직비디오 조립기 — 정지 이미지(팬/줌 효과) + 미리 만든 AI 영상 클립을 이어붙여
// 배경음악과 함께 하나의 mp4로 렌더링한다. 외부 npm 의존성 없이 시스템 ffmpeg만 사용한다.
//
// 사용법: node build.js <project.json>
//
// project.json 스키마는 README.md 참고.
// AI 영상 클립 연동: scene.type === 'video' 로 미리 생성된 클립 파일 경로를 넣으면
// 정지 이미지 대신 그 영상을 타임라인에 그대로 사용한다. Higgsfield 등에서 생성한
// mp4를 이 자리에 넣기만 하면 되는 구조.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// 메모리가 작은 환경(예: 무료 호스팅 512MB)에서도 안 죽도록 인코더 부담을 최소화한다.
const LOW_MEM_ENCODE_ARGS = ['-preset', 'ultrafast', '-threads', '1'];

function run(args) {
  const res = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`ffmpeg exited with code ${res.status}: ffmpeg ${args.join(' ')}`);
  }
}

function ffprobeDuration(file) {
  const res = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return parseFloat(res.stdout.toString().trim());
}

function kenBurnsFilter(motion, frames, fps, w, h, bw) {
  const step = 0.0018;
  // pan 씬은 프레임마다 고정 2px씩 이동했는데, 씬 길이(프레임 수)가 길어질수록 실제
  // 이동 가능 범위(iw - iw/1.2)를 넘어서서 화면 끝에서 미세하게 떨리는 현상이 있었다.
  // 전체 이동 거리를 씬 길이에 맞춰 나눠서 마지막 프레임에 정확히 끝에 도달하도록 하고,
  // 혹시 모를 반올림 오차는 clamp(max/min)로 막는다.
  const panRange = bw - bw / 1.2;
  const panStep = panRange / Math.max(frames - 1, 1);
  switch (motion) {
    case 'zoom-out':
      return `zoompan=z='if(eq(on,0),1.3,max(zoom-${step},1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`;
    case 'pan-left':
      return `zoompan=z=1.2:x='if(eq(on,0),iw-iw/1.2,max(x-${panStep},0))':y='ih/2-(ih/1.2/2)':d=${frames}:s=${w}x${h}:fps=${fps}`;
    case 'pan-right':
      return `zoompan=z=1.2:x='if(eq(on,0),0,min(x+${panStep},iw-iw/1.2))':y='ih/2-(ih/1.2/2)':d=${frames}:s=${w}x${h}:fps=${fps}`;
    case 'none':
      return null;
    case 'zoom-in':
    default:
      return `zoompan=z='min(zoom+${step},1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`;
  }
}

function buildImageClip(scene, idx, cfg, tmpDir) {
  const { width: w, height: h, fps } = cfg;
  const duration = scene.duration || cfg.defaultSceneDuration || 4;
  const frames = Math.round(duration * fps);
  // 줌 최대 배율(1.3)보다 살짝 크게만 오버샘플링 — 2배로 하면 메모리를 훨씬 많이 써서
  // 작은 서버(512MB)에서 죽는 원인이 됐다. 1.4배면 화질 손실 없이 메모리를 크게 아낀다.
  const bw = Math.round(w * 1.4);
  const bh = Math.round(h * 1.4);
  const zoompan = kenBurnsFilter(scene.motion, frames, fps, w, h, bw);

  let filter = `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh}`;
  filter += zoompan ? `,${zoompan}` : `,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps}`;
  filter += ',format=yuv420p';

  if (scene.text) {
    const textFile = path.join(tmpDir, `text_${idx}.txt`);
    fs.writeFileSync(textFile, scene.text, 'utf8');
    filter += `,drawtext=font='Noto Sans CJK KR':textfile='${textFile}':fontcolor=white:fontsize=${h * 0.045 | 0}:x=(w-text_w)/2:y=h-h*0.12:box=1:boxcolor=black@0.45:boxborderw=16`;
  }

  const out = path.join(tmpDir, `clip_${idx}.mp4`);
  // 입력 프레임레이트를 씬 길이 전체에 1장으로 낮춰서 이미지를 딱 1개의 입력 프레임으로만 공급한다.
  // 기본값(25fps)으로 두면 zoompan이 매 입력 프레임마다 줌/팬을 초기값으로 리셋해서
  // 초당 25번씩 화면이 튀는 깜빡임(스트로브) 현상이 생긴다.
  run(['-framerate', `1/${duration}`, '-loop', '1', '-i', scene.src, '-t', String(duration), '-vf', filter, '-r', String(fps), '-an', ...LOW_MEM_ENCODE_ARGS, out]);
  return { file: out, duration };
}

function buildVideoClip(scene, idx, cfg, tmpDir) {
  const { width: w, height: h, fps } = cfg;
  const srcDuration = ffprobeDuration(scene.src);
  const duration = scene.duration ? Math.min(scene.duration, srcDuration) : srcDuration;

  let filter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},setsar=1,format=yuv420p`;
  if (scene.text) {
    const textFile = path.join(tmpDir, `text_${idx}.txt`);
    fs.writeFileSync(textFile, scene.text, 'utf8');
    filter += `,drawtext=font='Noto Sans CJK KR':textfile='${textFile}':fontcolor=white:fontsize=${h * 0.045 | 0}:x=(w-text_w)/2:y=h-h*0.12:box=1:boxcolor=black@0.45:boxborderw=16`;
  }

  const out = path.join(tmpDir, `clip_${idx}.mp4`);
  run(['-i', scene.src, '-t', String(duration), '-vf', filter, '-an', ...LOW_MEM_ENCODE_ARGS, out]);
  return { file: out, duration };
}

function concatWithCrossfade(clips, transitionDuration, cfg, tmpDir) {
  // 씬별 시작 시각(초)도 함께 계산해서 반환 — 씬별 보이스를 정확한 타이밍에 얹기 위함
  const sceneStarts = [0];
  let cumulative = clips[0].duration;

  if (clips.length === 1) {
    return { file: clips[0].file, sceneStarts, totalDuration: cumulative };
  }

  const inputArgs = [];
  clips.forEach((c) => inputArgs.push('-i', c.file));

  let filterComplex = '';
  let prevLabel = '0';

  for (let i = 1; i < clips.length; i++) {
    const t = Math.min(transitionDuration, clips[i - 1].duration, clips[i].duration);
    const offset = Math.max(cumulative - t, 0);
    sceneStarts.push(offset);
    const outLabel = i === clips.length - 1 ? 'vout' : `v${i}`;
    filterComplex += `[${prevLabel}][${i}]xfade=transition=fade:duration=${t}:offset=${offset}[${outLabel}];`;
    cumulative = cumulative + clips[i].duration - t;
    prevLabel = outLabel;
  }
  filterComplex = filterComplex.replace(/;$/, '');

  const out = path.join(tmpDir, 'concatenated.mp4');
  run([...inputArgs, '-filter_complex', filterComplex, '-map', '[vout]', '-r', String(cfg.fps), ...LOW_MEM_ENCODE_ARGS, out]);
  return { file: out, sceneStarts, totalDuration: cumulative };
}

// 배경음악(선택) + 씬별 보이스/내레이션(선택, 여러 개 가능)을 하나의 오디오 트랙으로 믹싱한다.
// 씬별 보이스는 해당 씬이 화면에 나오기 시작하는 시점에 맞춰 자동으로 딜레이된다.
function buildAudioMix(videoFile, cfg, sceneStarts, totalDuration, tmpDir) {
  const tracks = [];
  if (cfg.audio) {
    tracks.push({ file: cfg.audio, delaySec: 0, volume: cfg.audioVolume || 1, loop: cfg.loopAudio !== false });
  }
  cfg.scenes.forEach((scene, i) => {
    if (scene.voice) {
      tracks.push({ file: scene.voice, delaySec: sceneStarts[i] || 0, volume: scene.voiceVolume || 1, loop: false });
    }
  });

  if (tracks.length === 0) return videoFile;

  const out = path.join(tmpDir, 'with_audio.mp4');
  const args = ['-i', videoFile];

  tracks.forEach((t) => {
    if (t.loop) args.push('-stream_loop', '-1', '-t', String(totalDuration));
    args.push('-i', t.file);
  });

  const labels = tracks.map((t, i) => {
    const inputIdx = i + 1; // 0번은 비디오
    const label = `a${i}`;
    let chain = `[${inputIdx}:a]volume=${t.volume}`;
    if (t.delaySec > 0) chain += `,adelay=${Math.round(t.delaySec * 1000)}:all=1`;
    chain += `[${label}]`;
    return { chain, label };
  });

  let filterComplex = labels.map((l) => l.chain).join(';');
  let audioOutLabel;
  if (labels.length === 1) {
    audioOutLabel = labels[0].label;
  } else {
    audioOutLabel = 'aout';
    filterComplex += `;${labels.map((l) => `[${l.label}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[${audioOutLabel}]`;
  }

  args.push(
    '-filter_complex', filterComplex,
    '-map', '0:v', '-map', `[${audioOutLabel}]`,
    '-t', String(totalDuration),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', out,
  );
  run(args);
  return out;
}

function main() {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error('사용법: video-maker <project.json>  (또는 node build.js <project.json>)');
    process.exit(1);
  }

  const cfg = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const baseDir = path.dirname(path.resolve(projectPath));
  cfg.width = cfg.width || 1920;
  cfg.height = cfg.height || 1080;
  cfg.fps = cfg.fps || 30;
  cfg.transitionDuration = cfg.transitionDuration != null ? cfg.transitionDuration : 0.6;

  const resolvePath = (p) => (path.isAbsolute(p) ? p : path.join(baseDir, p));
  cfg.scenes.forEach((s) => {
    s.src = resolvePath(s.src);
    if (s.voice) s.voice = resolvePath(s.voice);
  });
  if (cfg.audio) cfg.audio = resolvePath(cfg.audio);
  const outputPath = resolvePath(cfg.output || 'output.mp4');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-maker-'));
  console.log(`[video-maker] 작업 디렉토리: ${tmpDir}`);

  const clips = cfg.scenes.map((scene, idx) => {
    console.log(`[video-maker] 씬 ${idx + 1}/${cfg.scenes.length} 렌더링 중 (${scene.type || 'image'})`);
    if (scene.type === 'video') return buildVideoClip(scene, idx, cfg, tmpDir);
    return buildImageClip(scene, idx, cfg, tmpDir);
  });

  console.log('[video-maker] 씬 이어붙이는 중 (크로스페이드)');
  const { file: concatenated, sceneStarts, totalDuration } = concatWithCrossfade(clips, cfg.transitionDuration, cfg, tmpDir);

  console.log('[video-maker] 오디오 합성 중 (배경음악/씬별 보이스)');
  const withAudio = buildAudioMix(concatenated, cfg, sceneStarts, totalDuration, tmpDir);

  fs.copyFileSync(withAudio, outputPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`[video-maker] 완료: ${outputPath}`);
}

main();
