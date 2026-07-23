import { useState, useEffect } from 'react'
import PageHeader from '../components/PageHeader'
import { renderVideoStudio, getBgmList } from '../lib/apiClient'

// 2026-07-23: "사진 한 장으로 여러 장면 채우기" 요청 - 영상/사진을 매번 여러 개 구하지 않아도
// 같은 사진을 다른 모션으로 몇 번 반복해서 보여주면 장면이 여러 개 있는 것처럼 느껴진다는
// 아이디어. ffmpeg 렌더링 쪽은 기존 모션 옵션을 그대로 재사용하므로 새 서버 로직이 필요 없고,
// 프론트엔드에서 같은 파일로 씬을 여러 개 만들어주기만 하면 됨.
const SPLIT_MOTION_CYCLE = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'boomerang', 'pan-boomerang']

const MOTION_OPTIONS = [
  { value: 'zoom-in', label: '줌인' },
  { value: 'zoom-out', label: '줌아웃' },
  { value: 'pan-left', label: '좌로 팬' },
  { value: 'pan-right', label: '우로 팬' },
  { value: 'boomerang', label: '앞뒤 반전 (줌인 후 다시 줌아웃)' },
  { value: 'pan-boomerang', label: '앞뒤 반전 (팬만, 줌 없음)' },
  { value: 'none', label: '효과 없음' },
]

const SIZE_PRESETS = [
  { value: '1080x1920', label: '세로 (숏폼·릴스·틱톡)', width: 1080, height: 1920 },
  { value: '1920x1080', label: '가로 (유튜브·일반 영상)', width: 1920, height: 1080 },
  { value: '1080x1080', label: '정사각 (인스타 피드)', width: 1080, height: 1080 },
]

let sceneSeq = 0
const emptyScene = () => ({ key: `s${sceneSeq++}`, imageFile: null, motion: 'zoom-in', duration: 4, text: '', voiceFile: null })

// 영상 파일의 실제 길이를 읽어서, 여러 영상을 한 번에 추가할 때 기본 노출 시간으로 씀
// (안 그러면 기본값 4초로 다 잘려버림 - 실제 영상 길이 그대로 이어붙이는 게 자연스러움)
function readVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src)
      resolve(video.duration && isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : 4)
    }
    video.onerror = () => resolve(4)
    video.src = URL.createObjectURL(file)
  })
}

export default function VideoStudio() {
  const [scenes, setScenes] = useState([emptyScene()])
  const [sizePreset, setSizePreset] = useState(SIZE_PRESETS[0].value)
  const [fps, setFps] = useState(30)
  const [transitionDuration, setTransitionDuration] = useState(0.6)
  const [musicFile, setMusicFile] = useState(null)
  const [musicVolume, setMusicVolume] = useState(0.8)
  const [bulkAdding, setBulkAdding] = useState(false)

  // 추천 배경음악 (server/assets/bgm/) - 직접 업로드 대신 목록에서 미리 듣고 고를 수 있게
  const [bgmTracks, setBgmTracks] = useState([])
  const [bgmLoading, setBgmLoading] = useState(true)
  const [selectedBgm, setSelectedBgm] = useState(null) // filename or null
  useEffect(() => {
    getBgmList()
      .then(setBgmTracks)
      .catch(() => setBgmTracks([]))
      .finally(() => setBgmLoading(false))
  }, [])

  // 사진 한 장을 여러 장면으로 자동 분할 (모션을 다르게 돌려가며 같은 사진을 반복 사용)
  const [splitFile, setSplitFile] = useState(null)
  const [splitCount, setSplitCount] = useState(3)
  const addSplitScenes = () => {
    if (!splitFile) return
    const newScenes = Array.from({ length: splitCount }, (_, i) => ({
      key: `s${sceneSeq++}`,
      imageFile: splitFile,
      motion: SPLIT_MOTION_CYCLE[i % SPLIT_MOTION_CYCLE.length],
      duration: 3,
      text: '',
      voiceFile: null,
    }))
    setScenes((prev) => (prev.length === 1 && !prev[0].imageFile ? newScenes : [...prev, ...newScenes]))
    setSplitFile(null)
  }

  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)

  const updateScene = (key, patch) => {
    setScenes((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }
  const addScene = () => setScenes((prev) => [...prev, emptyScene()])
  const removeScene = (key) => setScenes((prev) => (prev.length > 1 ? prev.filter((s) => s.key !== key) : prev))

  // 영상 파일 여러 개를 한 번에 골라서 순서대로 씬으로 자동 추가 (이어붙이기) - 효과 없이
  // 원본 길이 그대로, 매번 "씬 추가" 누르고 하나씩 올릴 필요 없게 함(2026-07-19 요청).
  const addVideosBulk = async (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setBulkAdding(true)
    try {
      const newScenes = []
      for (const file of files) {
        const duration = await readVideoDuration(file)
        newScenes.push({ key: `s${sceneSeq++}`, imageFile: file, motion: 'none', duration, text: '', voiceFile: null })
      }
      setScenes((prev) => (prev.length === 1 && !prev[0].imageFile ? newScenes : [...prev, ...newScenes]))
    } finally {
      setBulkAdding(false)
    }
  }

  const canRender = scenes.every((s) => s.imageFile) && !rendering

  const handleRender = async () => {
    setError(null)
    setVideoUrl(null)

    if (!scenes.every((s) => s.imageFile)) {
      setError('모든 씬에 이미지를 넣어주세요.')
      return
    }

    const preset = SIZE_PRESETS.find((p) => p.value === sizePreset) || SIZE_PRESETS[0]
    const fd = new FormData()
    fd.append('width', String(preset.width))
    fd.append('height', String(preset.height))
    fd.append('fps', String(fps))
    fd.append('transitionDuration', String(transitionDuration))
    if (musicFile) {
      fd.append('audio', musicFile)
      fd.append('audioVolume', String(musicVolume))
    } else if (selectedBgm) {
      fd.append('bgmFilename', selectedBgm)
      fd.append('audioVolume', String(musicVolume))
    }
    fd.append(
      'scenesMeta',
      JSON.stringify(scenes.map((s) => ({ duration: s.duration, motion: s.motion, text: s.text })))
    )
    scenes.forEach((s, i) => {
      fd.append(`scene_image_${i}`, s.imageFile)
      if (s.voiceFile) fd.append(`scene_voice_${i}`, s.voiceFile)
    })

    setRendering(true)
    try {
      const { videoUrl: url } = await renderVideoStudio(fd)
      setVideoUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setRendering(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="영상 제작실"
        emoji="🎬"
        description="씬마다 이미지·효과·자막·보이스를 직접 골라서 mp4 영상을 만들어요 (video-maker 프로그램을 그대로 옮겨왔어요)"
      />

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl bg-paper-card p-4 shadow-card sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/70">화면 비율</label>
          <select
            value={sizePreset}
            onChange={(e) => setSizePreset(e.target.value)}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
          >
            {SIZE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/70">전환 효과 길이 (초)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={transitionDuration}
            onChange={(e) => setTransitionDuration(e.target.value)}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/70">배경음악 볼륨</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={musicVolume}
            onChange={(e) => setMusicVolume(Number(e.target.value))}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
          />
        </div>
      </div>

      <div className="mb-4 rounded-xl bg-paper-card p-4 shadow-card">
        <label className="mb-2 block text-sm font-semibold text-ink/80">🎵 배경음악 (선택)</label>
        {bgmLoading ? (
          <p className="text-xs text-ink/40">추천 음악 불러오는 중...</p>
        ) : bgmTracks.length === 0 ? (
          <p className="text-xs text-ink/40">
            아직 추천 음악이 없어요 (server/assets/bgm/ 폴더가 비어있음) - 아래에서 직접 파일을 올려도 돼요.
          </p>
        ) : (
          <div className="mb-3 space-y-2">
            {bgmTracks.map((t) => (
              <label
                key={t.filename}
                className={`flex items-center gap-3 rounded-md border p-2 text-xs ${
                  selectedBgm === t.filename ? 'border-stamp-amber bg-stamp-amber/5' : 'border-ink/10'
                }`}
              >
                <input
                  type="radio"
                  name="bgmTrack"
                  checked={selectedBgm === t.filename}
                  onChange={() => {
                    setSelectedBgm(t.filename)
                    setMusicFile(null)
                  }}
                />
                <span className="flex-1">{t.filename}</span>
                <audio src={t.url} controls className="h-8" style={{ maxWidth: '200px' }} />
              </label>
            ))}
            {selectedBgm && (
              <button
                type="button"
                onClick={() => setSelectedBgm(null)}
                className="text-[11px] text-ink/40 underline decoration-dotted hover:text-stamp-amber"
              >
                선택 해제
              </button>
            )}
          </div>
        )}
        <label className="mb-1 block text-[11px] text-ink/50">또는 직접 음악 파일 올리기</label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            setMusicFile(e.target.files?.[0] || null)
            if (e.target.files?.[0]) setSelectedBgm(null)
          }}
          className="w-full text-xs"
        />
      </div>

      <div className="mb-4 rounded-xl border border-dashed border-stamp-amber/40 bg-stamp-amber/5 p-4">
        <label className="mb-1 block text-sm font-semibold text-ink/80">🎬 영상 여러 개 한 번에 추가 (이어붙이기)</label>
        <input
          type="file"
          accept="video/*"
          multiple
          disabled={bulkAdding}
          onChange={(e) => {
            addVideosBulk(e.target.files)
            e.target.value = ''
          }}
          className="w-full text-xs"
        />
        <p className="mt-1 text-[11px] text-ink/40">
          {bulkAdding
            ? '영상 길이 확인 중...'
            : '고른 순서대로 씬이 자동으로 만들어져요. 효과 없이 원본 그대로 이어붙고, 아래에서 순서·길이는 나중에 바꿀 수 있어요.'}
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-dashed border-stamp-amber/40 bg-stamp-amber/5 p-4">
        <label className="mb-1 block text-sm font-semibold text-ink/80">
          🖼 사진 한 장으로 여러 장면 채우기
        </label>
        <p className="mb-2 text-[11px] text-ink/40">
          영상이나 사진이 부족할 때, 같은 사진 하나를 줌/팬 효과를 바꿔가며 여러 장면으로 나눠서 써요.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSplitFile(e.target.files?.[0] || null)}
            className="min-w-[160px] flex-1 text-xs"
          />
          <label className="flex items-center gap-1 text-xs text-ink/60">
            장면 개수
            <input
              type="number"
              min="2"
              max="6"
              value={splitCount}
              onChange={(e) => setSplitCount(Number(e.target.value))}
              className="w-14 rounded-md border border-ink/15 px-2 py-1 text-xs"
            />
          </label>
          <button
            type="button"
            onClick={addSplitScenes}
            disabled={!splitFile}
            className="rounded-md bg-stamp-amber px-3 py-1.5 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
          >
            + {splitCount}개 장면 만들기
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {scenes.map((s, i) => (
          <div key={s.key} className="rounded-xl bg-paper-card p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-ink/80">씬 {i + 1}</span>
              {scenes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeScene(s.key)}
                  className="text-xs text-stamp-reject hover:underline"
                >
                  씬 삭제
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink/70">이미지 또는 영상 *</label>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => updateScene(s.key, { imageFile: e.target.files?.[0] || null })}
                  className="w-full text-xs"
                />
                <p className="mt-1 text-[11px] text-ink/40">
                  직접 만든 영상을 넣으면 줌/팬 효과 없이 그 영상 그대로 씬 길이에 맞춰 잘리거나 반복돼요.
                </p>
                {s.imageFile && s.imageFile.type.startsWith('video/') && (
                  <video
                    src={URL.createObjectURL(s.imageFile)}
                    className="mt-2 h-24 rounded-md border border-ink/10 object-cover"
                    muted
                    controls
                  />
                )}
                {s.imageFile && s.imageFile.type.startsWith('image/') && (
                  <img
                    src={URL.createObjectURL(s.imageFile)}
                    alt=""
                    className="mt-2 h-24 rounded-md border border-ink/10 object-cover"
                  />
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink/70">보이스/내레이션 (선택)</label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => updateScene(s.key, { voiceFile: e.target.files?.[0] || null })}
                  className="w-full text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink/70">효과</label>
                <select
                  value={s.motion}
                  onChange={(e) => updateScene(s.key, { motion: e.target.value })}
                  className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
                >
                  {MOTION_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink/70">노출 시간 (초)</label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  value={s.duration}
                  onChange={(e) => updateScene(s.key, { duration: Number(e.target.value) })}
                  className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-ink/70">자막 (선택)</label>
                <input
                  type="text"
                  value={s.text}
                  onChange={(e) => updateScene(s.key, { text: e.target.value })}
                  className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addScene}
        className="mt-3 rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink/70 hover:bg-ink/5"
      >
        + 씬 추가
      </button>

      {error && <p className="mt-3 text-sm text-stamp-reject">{error}</p>}

      <div className="mt-4">
        <button
          type="button"
          onClick={handleRender}
          disabled={!canRender}
          className="rounded-lg bg-stamp-amber px-5 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-stamp-amber/90 disabled:opacity-50"
        >
          {rendering ? '영상 만드는 중... (시간이 좀 걸려요)' : '🎬 영상 만들기'}
        </button>
      </div>

      {videoUrl && (
        <div className="mt-4 rounded-xl bg-paper-card p-4 shadow-card">
          <p className="mb-2 text-sm font-bold text-ink/80">완성됐어요!</p>
          <video src={videoUrl} controls className="max-h-[70vh] rounded-lg bg-black" />
          <div className="mt-2 flex gap-3">
            <a href={videoUrl} download className="text-xs text-ink/60 underline decoration-dotted hover:text-stamp-amber">
              다운로드
            </a>
          </div>
          <p className="mt-2 text-[11px] text-ink/40">
            이 영상을 콘텐츠에 쓰려면 "콘텐츠 관리"에서 초안을 만들고 이미지 첨부란에 다운로드한 파일을 올려주세요.
          </p>
        </div>
      )}
    </div>
  )
}
