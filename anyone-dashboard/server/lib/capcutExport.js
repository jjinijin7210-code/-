// ============================================================
// 영상 제작실의 "📦 CapCut 프로젝트로 내보내기" 버튼용 익스포터.
// 완전 자동 렌더링 대신, 씬 이미지/영상 + 내레이션·배경음악을 합친 audio.mp3 +
// 자동 자막 subtitle.srt를 zip으로 묶어서, 마지막 편집은 CapCut에서 직접 하도록 한다.
// (2026-07-30 벤치마킹 - 다른 창작자가 만든 AI 영상 툴도 완전자동 렌더링 없이 CapCut
// 프로젝트로 export만 해주고 사람이 마무리하는 구조였음 - 렌더링 버그 리스크를 줄이는 방식)
//
// 오디오 믹싱은 server/lib/videoRenderer.js의 buildAudioMix()와 같은 필터그래프 로직이지만
// 비디오 트랙 없이 오디오만 출력한다. 자동 자막은 remotionRenderer.js의 transcribeVoice()를
// 그대로 재사용한다(whisper.cpp, 로컬 전용 - Remotion 베타와 같은 이유).
// ============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { spawnSync } from 'node:child_process'
import { transcribeVoice, sniffExtension } from './remotionRenderer.js'

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

function run(args) {
  const res = spawnSync(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  if (res.error) {
    throw new Error(`ffmpeg을 실행하지 못했어요 (${res.error.message}).`)
  }
  if (res.status !== 0) {
    throw new Error(`ffmpeg exited with code ${res.status}: ffmpeg ${args.join(' ')}`)
  }
}

// videoRenderer.js의 buildAudioMix()와 같은 트랙 믹싱이지만, 비디오 입력 없이 오디오만 출력.
function buildAudioOnlyMix(tracks, totalDuration, outPath) {
  const args = []
  tracks.forEach((t) => {
    if (t.loop) args.push('-stream_loop', '-1', '-t', String(totalDuration))
    args.push('-i', t.file)
  })

  const labels = tracks.map((t, i) => {
    const label = `a${i}`
    let chain = `[${i}:a]volume=${t.volume}`
    if (t.tempo && t.tempo !== 1) chain += `,atempo=${t.tempo}`
    if (t.delaySec > 0) chain += `,adelay=${Math.round(t.delaySec * 1000)}:all=1`
    chain += `[${label}]`
    return { chain, label }
  })

  let filterComplex = labels.map((l) => l.chain).join(';')
  let outLabel
  if (labels.length === 1) {
    outLabel = labels[0].label
  } else {
    outLabel = 'aout'
    filterComplex += `;${labels.map((l) => `[${l.label}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[${outLabel}]`
  }

  run([...args, '-filter_complex', filterComplex, '-map', `[${outLabel}]`, '-t', String(totalDuration), '-c:a', 'libmp3lame', '-b:a', '192k', outPath])
}

// whisper.cpp가 단어 단위로 쪼개서 주는 결과(splitOnWord: true)를, 자막으로 읽기 편하게
// 2.2초 또는 20자 중 먼저 차는 쪽에서 끊어 하나의 SRT 큐로 묶는다.
function groupWordsIntoCues(words, sceneStartSec) {
  const offsetMs = sceneStartSec * 1000
  const cues = []
  let buf = []
  let bufStart = null

  const flush = () => {
    if (!buf.length) return
    cues.push({
      startMs: offsetMs + bufStart,
      endMs: offsetMs + buf[buf.length - 1].endMs,
      text: buf.map((w) => w.text).join('').trim(),
    })
    buf = []
    bufStart = null
  }

  for (const w of words) {
    if (bufStart === null) bufStart = w.startMs
    buf.push(w)
    const durMs = w.endMs - bufStart
    const textLen = buf.map((x) => x.text).join('').length
    if (durMs >= 2200 || textLen >= 20) flush()
  }
  flush()
  return cues
}

function msToSrtTime(ms) {
  const clamped = Math.max(0, Math.round(ms))
  const h = Math.floor(clamped / 3600000)
  const m = Math.floor((clamped % 3600000) / 60000)
  const s = Math.floor((clamped % 60000) / 1000)
  const rem = clamped % 1000
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rem, 3)}`
}

function cuesToSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.text}\n`).join('\n')
}

function buildReadme(sceneFiles, durations, hasAudio, hasSubtitle) {
  const sceneList = sceneFiles.map((f, i) => `  ${i + 1}. ${f} (${durations[i]}초)`).join('\n')
  return `CapCut으로 이어서 편집하기
========================

1) CapCut에서 새 프로젝트를 만들고, images 폴더의 파일들을 아래 순서 그대로 타임라인에 드래그하세요.
   각 씬 목표 길이는 참고용이에요 (아래 목록).
${sceneList}
${hasAudio ? '\n2) audio.mp3를 오디오 트랙에 넣으세요 (내레이션 + 배경음악이 이미 합쳐져 있어요).' : '\n2) 오디오 파일 없음 - 씬 이미지/영상만 내보냈어요.'}
${hasSubtitle ? '\n3) subtitle.srt를 자막 트랙으로 가져오세요 (CapCut: 자막 > 자막 불러오기 > SRT 가져오기).' : '\n3) 자막 파일 없음 - 자동 자막 옵션을 켜지 않았거나, 씬에 텍스트가 없었어요.'}

※ 애니원 영상 제작실에서 자동 생성한 소재예요. 전환 효과·타이밍은 CapCut에서 자유롭게 다듬어주세요.
`
}

function zipDirectory(srcDir, outZipPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outZipPath), { recursive: true })
    const output = fs.createWriteStream(outZipPath)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(srcDir, false)
    archive.finalize()
  })
}

// cfg: renderVideo()와 같은 모양 { scenes: [{ src, duration, text, isVideo, voice, voiceVolume,
// voiceSpeed }], audio, audioVolume, autoCaptionVoice }
export async function buildCapcutExport(cfg, outZipPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyone-capcut-'))
  const imagesDir = path.join(tmpDir, 'images')
  fs.mkdirSync(imagesDir, { recursive: true })

  try {
    const durations = cfg.scenes.map((s) => s.duration || 4)
    const sceneStarts = []
    let cumulative = 0
    durations.forEach((d) => {
      sceneStarts.push(cumulative)
      cumulative += d
    })
    const totalDuration = cumulative

    const sceneFiles = cfg.scenes.map((scene, i) => {
      const ext = sniffExtension(scene.src, scene.isVideo ? '.mp4' : '.jpg')
      const destName = `scene_${String(i + 1).padStart(3, '0')}${ext}`
      fs.copyFileSync(scene.src, path.join(imagesDir, destName))
      return destName
    })

    const voiceTracks = cfg.scenes
      .map((scene, i) =>
        scene.voice
          ? { file: scene.voice, delaySec: sceneStarts[i], volume: scene.voiceVolume || 1, tempo: scene.voiceSpeed || 1, loop: false }
          : null
      )
      .filter(Boolean)
    const bgmTrack = cfg.audio ? { file: cfg.audio, delaySec: 0, volume: cfg.audioVolume || 1, loop: true } : null
    const allTracks = bgmTrack ? [bgmTrack, ...voiceTracks] : voiceTracks

    let hasAudio = false
    if (allTracks.length) {
      buildAudioOnlyMix(allTracks, totalDuration, path.join(tmpDir, 'audio.mp3'))
      hasAudio = true
    }

    const cues = []
    for (let i = 0; i < cfg.scenes.length; i += 1) {
      const scene = cfg.scenes[i]
      let handled = false
      if (cfg.autoCaptionVoice && scene.voice) {
        const words = await transcribeVoice(scene.voice, tmpDir)
        if (words && words.length) {
          groupWordsIntoCues(words, sceneStarts[i]).forEach((c) => cues.push(c))
          handled = true
        }
      }
      if (!handled && scene.text) {
        cues.push({ startMs: sceneStarts[i] * 1000, endMs: (sceneStarts[i] + durations[i]) * 1000, text: scene.text })
      }
    }
    const hasSubtitle = cues.length > 0
    if (hasSubtitle) {
      fs.writeFileSync(path.join(tmpDir, 'subtitle.srt'), cuesToSrt(cues), 'utf8')
    }

    fs.writeFileSync(path.join(tmpDir, '읽어주세요.txt'), buildReadme(sceneFiles, durations, hasAudio, hasSubtitle), 'utf8')

    await zipDirectory(tmpDir, outZipPath)
    return outZipPath
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
