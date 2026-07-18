import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import { renderVideoStudio } from '../lib/apiClient'

const MOTION_OPTIONS = [
  { value: 'zoom-in', label: '줌인' },
  { value: 'zoom-out', label: '줌아웃' },
  { value: 'pan-left', label: '좌로 팬' },
  { value: 'pan-right', label: '우로 팬' },
  { value: 'boomerang', label: '앞뒤 반전 (줌인 후 다시 줌아웃)' },
  { value: 'none', label: '효과 없음' },
]

const SIZE_PRESETS = [
  { value: '1080x1920', label: '세로 (숏폼·릴스·틱톡)', width: 1080, height: 1920 },
  { value: '1920x1080', label: '가로 (유튜브·일반 영상)', width: 1920, height: 1080 },
  { value: '1080x1080', label: '정사각 (인스타 피드)', width: 1080, height: 1080 },
]

let sceneSeq = 0
const emptyScene = () => ({ key: `s${sceneSeq++}`, imageFile: null, motion: 'zoom-in', duration: 4, text: '', voiceFile: null })

export default function VideoStudio() {
  const [scenes, setScenes] = useState([emptyScene()])
  const [sizePreset, setSizePreset] = useState(SIZE_PRESETS[0].value)
  const [fps, setFps] = useState(30)
  const [transitionDuration, setTransitionDuration] = useState(0.6)
  const [musicFile, setMusicFile] = useState(null)
  const [musicVolume, setMusicVolume] = useState(0.8)

  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)

  const updateScene = (key, patch) => {
    setScenes((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }
  const addScene = () => setScenes((prev) => [...prev, emptyScene()])
  const removeScene = (key) => setScenes((prev) => (prev.length > 1 ? prev.filter((s) => s.key !== key) : prev))

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
          <label className="mb-1 block text-xs font-semibold text-ink/70">배경음악 (선택)</label>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setMusicFile(e.target.files?.[0] || null)}
            className="w-full text-xs"
          />
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
