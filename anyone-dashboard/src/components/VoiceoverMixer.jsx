import { useEffect, useRef, useState } from 'react'
import { mixVoiceoverStudio, deleteVideoStudioGenerated } from '../lib/apiClient'

// 2026-09-02 요청: "나래이션 나오는 동안은 음악을 줄이고 싶어" - CapCut 사용이 어려워서,
// CapCut처럼 영상/나레이션/음악 트랙을 위아래로 놓고 각 트랙을 드래그로 자른 뒤 한 번에
// 믹스하는 간단 편집기. 나레이션이 들리는 동안 배경음악을 자동으로 줄이는 더킹은 서버
// (voiceoverMixer.js, ffmpeg sidechaincompress)가 처리한다.

function readFileDuration(file, isVideo) {
  return new Promise((resolve) => {
    const el = document.createElement(isVideo ? 'video' : 'audio')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(el.src)
      resolve(el.duration && isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : 0)
    }
    el.onerror = () => resolve(0)
    el.src = URL.createObjectURL(file)
  })
}

// 추천 배경음악(서버 목록)은 File이 아니라 URL이라 별도로 길이를 읽는다
function readUrlDuration(url) {
  return new Promise((resolve) => {
    const el = document.createElement('audio')
    el.preload = 'metadata'
    el.onloadedmetadata = () => resolve(el.duration && isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : 0)
    el.onerror = () => resolve(0)
    el.src = url
  })
}

function fmt(sec) {
  if (!sec || sec <= 0) return '0초'
  if (sec >= 60) {
    const m = Math.floor(sec / 60)
    const s = Math.round((sec - m * 60) * 10) / 10
    return `${m}분 ${s}초`
  }
  return `${Math.round(sec * 10) / 10}초`
}

function FilePreview({ file, kind }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  if (!url) return null
  if (kind === 'video') return <video src={url} controls className="mt-2 max-h-40 rounded-md border border-ink/10 bg-black" />
  return <audio src={url} controls className="mt-2 h-8 w-full" />
}

// CapCut 타임라인처럼 트랙 막대 위에서 양쪽 끝 핸들을 드래그해 쓸 구간을 자르는 공용 컴포넌트.
// showEndHandle=false면 시작 지점만 고르는 트랙이 됨(배경음악은 모자라면 자동 반복이라 끝
// 지점이 필요 없음).
function TrimTrack({ duration, start, end, onChange, barClass, showEndHandle = true }) {
  const trackRef = useRef(null)
  const dragRef = useRef(null) // 'start' | 'end' | null

  useEffect(() => {
    const posToSec = (clientX) => {
      const track = trackRef.current
      if (!track || !duration) return 0
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return Math.round(ratio * duration * 10) / 10
    }
    const onMove = (e) => {
      if (!dragRef.current || !duration) return
      const sec = posToSec(e.clientX)
      if (dragRef.current === 'start') {
        onChange({ start: Math.min(sec, Math.max((showEndHandle ? end : duration) - 0.2, 0)), end })
      } else {
        onChange({ start, end: Math.max(sec, start + 0.2) })
      }
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [duration, start, end, onChange, showEndHandle])

  if (!duration) return null

  const startPct = (start / duration) * 100
  const endPct = ((showEndHandle ? end : duration) / duration) * 100
  const widthPct = Math.max(endPct - startPct, 0.5)

  return (
    <div className="mt-2">
      <div ref={trackRef} className="relative h-9 select-none rounded-md bg-ink/10">
        <div className={`absolute top-0 h-full rounded-md ${barClass}`} style={{ left: `${startPct}%`, width: `${widthPct}%` }} />
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            dragRef.current = 'start'
          }}
          className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-ink/80"
          style={{ left: `${startPct}%` }}
          title="드래그해서 시작 지점 자르기"
        />
        {showEndHandle && (
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              dragRef.current = 'end'
            }}
            className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-ink/80"
            style={{ left: `${endPct}%` }}
            title="드래그해서 끝 지점 자르기"
          />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink/40">
        <span>
          {showEndHandle
            ? `시작 ${fmt(start)} ~ 끝 ${fmt(end)} (쓰는 구간 ${fmt(Math.max(end - start, 0))})`
            : `시작 ${fmt(start)}부터 사용`}
        </span>
        <span>원본 길이 {fmt(duration)}</span>
      </div>
    </div>
  )
}

export default function VoiceoverMixer({ bgmTracks = [] }) {
  const [open, setOpen] = useState(true)

  // 🎬 영상 트랙
  const [videoFile, setVideoFile] = useState(null)
  const [videoDur, setVideoDur] = useState(0)
  const [videoRange, setVideoRange] = useState({ start: 0, end: 0 })
  const [videoAudioOn, setVideoAudioOn] = useState(true)
  const [videoAudioVolume, setVideoAudioVolume] = useState(1)

  // 🎙 나레이션 트랙
  const [narrFile, setNarrFile] = useState(null)
  const [narrDur, setNarrDur] = useState(0)
  const [narrRange, setNarrRange] = useState({ start: 0, end: 0 })
  const [narrOffset, setNarrOffset] = useState(0)
  const [narrVolume, setNarrVolume] = useState(1)

  // 🎵 음악 트랙 (직접 업로드 또는 추천 목록에서 선택 - 없어도 됨)
  const [musicFile, setMusicFile] = useState(null)
  const [musicBgm, setMusicBgm] = useState('')
  const [musicDur, setMusicDur] = useState(0)
  const [musicStart, setMusicStart] = useState(0)
  const [musicVolume, setMusicVolume] = useState(0.6)
  const [musicFadeIn, setMusicFadeIn] = useState(1)
  const [musicFadeOut, setMusicFadeOut] = useState(2)
  const [duck, setDuck] = useState(true)
  const [duckAmount, setDuckAmount] = useState('medium')

  const [lengthMode, setLengthMode] = useState('narration')
  const [mixing, setMixing] = useState(false)
  const [error, setError] = useState(null)
  const [resultUrl, setResultUrl] = useState(null)

  const handleVideoFile = async (file) => {
    setVideoFile(file)
    setVideoDur(0)
    setVideoRange({ start: 0, end: 0 })
    if (!file) return
    const dur = await readFileDuration(file, true)
    setVideoDur(dur)
    setVideoRange({ start: 0, end: dur })
  }

  const handleNarrFile = async (file) => {
    setNarrFile(file)
    setNarrDur(0)
    setNarrRange({ start: 0, end: 0 })
    if (!file) return
    const dur = await readFileDuration(file, false)
    setNarrDur(dur)
    setNarrRange({ start: 0, end: dur })
  }

  const handleMusicFile = async (file) => {
    setMusicFile(file)
    setMusicStart(0)
    setMusicDur(0)
    if (file) {
      setMusicBgm('')
      setMusicDur(await readFileDuration(file, false))
    }
  }

  const handleMusicBgm = async (filename) => {
    setMusicBgm(filename)
    setMusicStart(0)
    setMusicDur(0)
    if (filename) {
      setMusicFile(null)
      const track = bgmTracks.find((t) => t.filename === filename)
      if (track) setMusicDur(await readUrlDuration(track.url))
    }
  }

  const videoTrimDur = Math.max(videoRange.end - videoRange.start, 0)
  const narrTrimDur = Math.max(narrRange.end - narrRange.start, 0)
  const totalDur = lengthMode === 'video' ? videoTrimDur : narrOffset + narrTrimDur
  const hasMusic = Boolean(musicFile || musicBgm)
  const selectedBgmUrl = musicBgm ? bgmTracks.find((t) => t.filename === musicBgm)?.url : null

  const handleMix = async () => {
    setError(null)
    setResultUrl(null)
    if (!videoFile) {
      setError('영상 파일을 올려주세요.')
      return
    }
    if (!narrFile) {
      setError('나레이션 파일을 올려주세요.')
      return
    }
    setMixing(true)
    try {
      const fd = new FormData()
      fd.append('video', videoFile)
      fd.append('narration', narrFile)
      if (musicFile) fd.append('music', musicFile)
      else if (musicBgm) fd.append('musicBgmFilename', musicBgm)
      fd.append('videoStart', String(videoRange.start))
      if (videoRange.end > 0) fd.append('videoEnd', String(videoRange.end))
      fd.append('videoAudioVolume', String(videoAudioOn ? videoAudioVolume : 0))
      fd.append('narrStart', String(narrRange.start))
      if (narrRange.end > 0) fd.append('narrEnd', String(narrRange.end))
      fd.append('narrOffset', String(narrOffset))
      fd.append('narrVolume', String(narrVolume))
      fd.append('musicStart', String(musicStart))
      fd.append('musicVolume', String(musicVolume))
      fd.append('musicFadeIn', String(musicFadeIn))
      fd.append('musicFadeOut', String(musicFadeOut))
      fd.append('duck', duck ? '1' : '0')
      fd.append('duckAmount', duckAmount)
      fd.append('lengthMode', lengthMode)
      const { videoUrl } = await mixVoiceoverStudio(fd)
      setResultUrl(videoUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setMixing(false)
    }
  }

  const handleDeleteResult = async () => {
    if (resultUrl) await deleteVideoStudioGenerated(resultUrl).catch(() => {})
    setResultUrl(null)
  }

  return (
    <div className="mb-4 rounded-xl border border-stamp-amber/40 bg-paper-card p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-bold text-ink/80">
          🎛 나레이션+음악 믹스 편집실
          <span className="ml-2 text-xs font-normal text-ink/40">영상·나레이션·음악을 같이 자르고, 나레이션 나올 땐 음악이 자동으로 작아져요</span>
        </span>
        <span className="text-xs text-ink/40">{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* 🎬 영상 트랙 */}
          <div className="rounded-lg border border-teal-600/30 bg-teal-600/5 p-3">
            <label className="mb-1 block text-xs font-semibold text-ink/70">🎬 영상 트랙 *</label>
            <input type="file" accept="video/*" onChange={(e) => handleVideoFile(e.target.files?.[0] || null)} className="w-full text-xs" />
            <FilePreview file={videoFile} kind="video" />
            {videoDur > 0 && (
              <TrimTrack
                duration={videoDur}
                start={videoRange.start}
                end={videoRange.end}
                onChange={setVideoRange}
                barClass="bg-teal-600/60"
              />
            )}
            {videoFile && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink/60">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={videoAudioOn} onChange={(e) => setVideoAudioOn(e.target.checked)} />
                  영상 원본 소리 사용
                </label>
                {videoAudioOn && (
                  <label className="flex items-center gap-1.5">
                    볼륨
                    <input type="range" min="0" max="1" step="0.05" value={videoAudioVolume} onChange={(e) => setVideoAudioVolume(Number(e.target.value))} />
                    {Math.round(videoAudioVolume * 100)}%
                  </label>
                )}
              </div>
            )}
          </div>

          {/* 🎙 나레이션 트랙 */}
          <div className="rounded-lg border border-sky-600/30 bg-sky-600/5 p-3">
            <label className="mb-1 block text-xs font-semibold text-ink/70">🎙 나레이션 트랙 *</label>
            <input type="file" accept="audio/*" onChange={(e) => handleNarrFile(e.target.files?.[0] || null)} className="w-full text-xs" />
            <FilePreview file={narrFile} kind="audio" />
            {narrDur > 0 && (
              <TrimTrack
                duration={narrDur}
                start={narrRange.start}
                end={narrRange.end}
                onChange={setNarrRange}
                barClass="bg-sky-600/60"
              />
            )}
            {narrFile && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink/60">
                <label className="flex items-center gap-1.5">
                  영상 시작
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={narrOffset}
                    onChange={(e) => setNarrOffset(Math.max(Number(e.target.value) || 0, 0))}
                    className="w-16 rounded-md border border-ink/15 px-2 py-1"
                  />
                  초 뒤부터 나레이션 시작
                </label>
                <label className="flex items-center gap-1.5">
                  볼륨
                  <input type="range" min="0" max="2" step="0.05" value={narrVolume} onChange={(e) => setNarrVolume(Number(e.target.value))} />
                  {Math.round(narrVolume * 100)}%
                </label>
              </div>
            )}
          </div>

          {/* 🎵 음악 트랙 */}
          <div className="rounded-lg border border-violet-600/30 bg-violet-600/5 p-3">
            <label className="mb-1 block text-xs font-semibold text-ink/70">🎵 배경음악 트랙 (선택)</label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" accept="audio/*" onChange={(e) => handleMusicFile(e.target.files?.[0] || null)} className="min-w-[180px] flex-1 text-xs" />
              {bgmTracks.length > 0 && (
                <select
                  value={musicBgm}
                  onChange={(e) => handleMusicBgm(e.target.value)}
                  className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-xs focus:border-stamp-amber focus:outline-none"
                >
                  <option value="">또는 추천 목록에서 고르기</option>
                  {bgmTracks.map((t) => (
                    <option key={t.filename} value={t.filename}>
                      {t.filename}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <FilePreview file={musicFile} kind="audio" />
            {selectedBgmUrl && <audio src={selectedBgmUrl} controls className="mt-2 h-8 w-full" />}
            {hasMusic && musicDur > 0 && (
              <TrimTrack
                duration={musicDur}
                start={musicStart}
                end={musicDur}
                onChange={({ start }) => setMusicStart(start)}
                barClass="bg-violet-600/60"
                showEndHandle={false}
              />
            )}
            {hasMusic && (
              <>
                <p className="mt-1 text-[10px] text-ink/40">음악이 영상보다 짧으면 자동으로 반복되고, 영상 끝에서 같이 잘려요.</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink/60">
                  <label className="flex items-center gap-1.5">
                    볼륨
                    <input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} />
                    {Math.round(musicVolume * 100)}%
                  </label>
                  <label className="flex items-center gap-1.5">
                    페이드 인
                    <input type="number" step="0.5" min="0" value={musicFadeIn} onChange={(e) => setMusicFadeIn(Math.max(Number(e.target.value) || 0, 0))} className="w-14 rounded-md border border-ink/15 px-2 py-1" />
                    초
                  </label>
                  <label className="flex items-center gap-1.5">
                    페이드 아웃
                    <input type="number" step="0.5" min="0" value={musicFadeOut} onChange={(e) => setMusicFadeOut(Math.max(Number(e.target.value) || 0, 0))} className="w-14 rounded-md border border-ink/15 px-2 py-1" />
                    초
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink/60">
                  <label className="flex items-center gap-1.5 font-semibold text-ink/70">
                    <input type="checkbox" checked={duck} onChange={(e) => setDuck(e.target.checked)} />
                    🔉 나레이션 나올 때 음악 자동으로 줄이기
                  </label>
                  {duck && (
                    <select
                      value={duckAmount}
                      onChange={(e) => setDuckAmount(e.target.value)}
                      className="rounded-md border border-ink/15 bg-white px-2 py-1 text-xs focus:border-stamp-amber focus:outline-none"
                    >
                      <option value="soft">조금만 줄이기</option>
                      <option value="medium">보통 (추천)</option>
                      <option value="strong">많이 줄이기</option>
                    </select>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 길이 기준 + 만들기 */}
          <div className="rounded-lg bg-ink/[0.03] p-3">
            <p className="mb-1 text-xs font-semibold text-ink/70">완성 영상 길이 기준</p>
            <div className="flex flex-col gap-1 text-xs text-ink/60">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="voMixLengthMode" checked={lengthMode === 'narration'} onChange={() => setLengthMode('narration')} />
                나레이션 길이에 맞추기 - 영상이 짧으면 자동으로 반복돼요 (추천)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="voMixLengthMode" checked={lengthMode === 'video'} onChange={() => setLengthMode('video')} />
                영상 길이에 맞추기 - 나레이션·음악이 영상 끝에서 잘려요
              </label>
            </div>
            {totalDur > 0 && (
              <p className="mt-2 text-xs text-ink/60">
                예상 완성 길이: <span className="font-semibold text-stamp-amber">{fmt(totalDur)}</span>
              </p>
            )}
            {lengthMode === 'video' && narrTrimDur > 0 && narrOffset + narrTrimDur > videoTrimDur + 0.05 && (
              <p className="mt-1 text-[11px] text-stamp-reject">
                ⚠️ 나레이션이 영상보다 길어서 영상 끝({fmt(videoTrimDur)})에서 잘려요. 전부 넣으려면 "나레이션 길이에 맞추기"를 고르세요.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-stamp-reject">⚠️ {error}</p>}

          <button
            type="button"
            onClick={handleMix}
            disabled={!videoFile || !narrFile || mixing}
            className="rounded-lg bg-stamp-amber px-5 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            {mixing ? '믹스해서 만드는 중... (영상 길이에 따라 시간이 걸려요)' : '🎛 자르고 섞어서 영상 만들기'}
          </button>

          {resultUrl && (
            <div className="rounded-lg bg-paper p-3">
              <p className="mb-2 text-sm font-bold text-ink/80">완성됐어요! 나레이션 구간에서 음악이 자동으로 작아졌는지 들어보세요.</p>
              <video src={resultUrl} controls className="max-h-[60vh] rounded-lg bg-black" />
              <div className="mt-2 flex gap-3">
                <a href={resultUrl} download className="text-xs text-ink/60 underline decoration-dotted hover:text-stamp-amber">
                  다운로드
                </a>
                <button type="button" onClick={handleDeleteResult} className="text-xs text-stamp-reject hover:underline">
                  삭제
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
