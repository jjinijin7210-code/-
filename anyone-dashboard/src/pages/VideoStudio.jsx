import { useState, useEffect, useRef } from 'react'
import PageHeader from '../components/PageHeader'
import VoiceoverMixer from '../components/VoiceoverMixer'
import { renderVideoStudio, exportVideoStudioCapcut, deleteVideoStudioGenerated, getBgmList, suggestVideoThumbnail, removeVideoWatermark, autoDirectVideoStudio } from '../lib/apiClient'

// 2026-07-23: "사진 한 장으로 여러 장면 채우기" 요청 - 영상/사진을 매번 여러 개 구하지 않아도
// 같은 사진을 다른 모션으로 몇 번 반복해서 보여주면 장면이 여러 개 있는 것처럼 느껴진다는
// 아이디어. ffmpeg 렌더링 쪽은 기존 모션 옵션을 그대로 재사용하므로 새 서버 로직이 필요 없고,
// 프론트엔드에서 같은 파일로 씬을 여러 개 만들어주기만 하면 됨.
const SPLIT_MOTION_CYCLE = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'pan-up', 'pan-down', 'boomerang', 'pan-boomerang']

const MOTION_OPTIONS = [
  { value: 'zoom-in', label: '줌인' },
  { value: 'zoom-out', label: '줌아웃' },
  { value: 'pan-left', label: '좌로 팬' },
  { value: 'pan-right', label: '우로 팬' },
  { value: 'pan-up', label: '위로 팬' },
  { value: 'pan-down', label: '아래로 팬' },
  { value: 'boomerang', label: '앞뒤 반전 (줌인 후 다시 줌아웃)' },
  { value: 'pan-boomerang', label: '앞뒤 반전 (팬만, 줌 없음)' },
  { value: 'rotate', label: '회전 (한 바퀴 돌았다 복귀)' },
  { value: 'none', label: '효과 없음' },
]

const SIZE_PRESETS = [
  { value: '1080x1920', label: '세로 (숏폼·릴스·틱톡)', width: 1080, height: 1920 },
  { value: '1920x1080', label: '가로 (유튜브·일반 영상)', width: 1920, height: 1080 },
  { value: '1080x1080', label: '정사각 (인스타 피드)', width: 1080, height: 1080 },
]

let sceneSeq = 0
// 2026-07-30 벤치마킹: 다른 채널 사례에서 스토리보드에 "후킹" 구간을 명시적으로 태깅해두는
// 게 초반 이탈을 줄이는 데 도움된다고 함 - 우리 글쓰기 공식(경험 후킹→정보→의견→CTA)과도
// 결이 맞아서, 씬마다 역할(후킹/본문)을 표시만 해두는 태그 추가 (렌더링에는 영향 없음, 씬
// 구성할 때 초반 몇 개가 후킹인지 한눈에 보려는 용도).
const emptyScene = (role = '본문') => ({
  key: `s${sceneSeq++}`,
  imageFile: null,
  motion: 'zoom-in',
  effect: 'none',
  duration: 4,
  text: '',
  voiceFile: null,
  startTime: 0,
  role,
})

const EFFECT_OPTIONS = [
  { value: 'none', label: '효과 없음' },
  { value: 'heart', label: '🩷 하트 (감성/훈훈한 장면용)' },
]

// 2026-07-24: "씬 삭제가 너무 오래 걸린다" 버그 수정 - 기존엔 각 씬의 미리보기(img/video)를
// 렌더링할 때마다 URL.createObjectURL(file)을 매번 새로 호출하고 있어서, 씬 하나만 지워도
// scenes 배열 전체가 바뀌며 나머지 모든 씬의 영상이 새 blob URL로 다시 로딩/디코딩됐음(영상
// 개수·용량이 클수록 체감 지연이 커짐) + revoke도 안 해서 메모리 누수도 있었음. 파일별로 자기
// blob URL을 한 번만 만들고 유지하는 별도 컴포넌트로 분리해서 해결.
function ScenePreview({ file }) {
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
  if (file.type.startsWith('video/')) {
    return <video src={url} className="mt-2 h-24 rounded-md border border-ink/10 object-cover" muted controls />
  }
  if (file.type.startsWith('image/')) {
    return <img src={url} alt="" className="mt-2 h-24 rounded-md border border-ink/10 object-cover" />
  }
  return null
}

// 영상 씬에서 "원하는 장면부터" 잘라 쓸 수 있게, 원본 영상 길이 위에 시작 지점을 드래그/클릭으로
// 고르는 간단한 타임라인. 하이라이트된 구간(주황색)이 시작 지점부터 씬 길이(초)만큼 실제로
// 쓰이는 부분 - 노출 시간(초) 입력값이 바뀌면 하이라이트 길이도 같이 바뀜.
function VideoTimeline({ file, startTime, sceneDuration, onStartTimeChange }) {
  const [url, setUrl] = useState(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const trackRef = useRef(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const seekTo = (clientX) => {
    const track = trackRef.current
    if (!track || !videoDuration) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onStartTimeChange(Number((ratio * videoDuration).toFixed(1)))
  }

  useEffect(() => {
    const onMove = (e) => {
      if (draggingRef.current) seekTo(e.clientX)
    }
    const onUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDuration])

  if (!url) return null

  const startPct = videoDuration ? (startTime / videoDuration) * 100 : 0
  const widthPct = videoDuration ? (Math.min(sceneDuration, Math.max(videoDuration - startTime, 0)) / videoDuration) * 100 : 0

  return (
    <div className="mt-2">
      <video src={url} className="hidden" preload="metadata" onLoadedMetadata={(e) => setVideoDuration(e.target.duration)} />
      <div
        ref={trackRef}
        onMouseDown={(e) => {
          draggingRef.current = true
          seekTo(e.clientX)
        }}
        className="relative h-5 cursor-pointer rounded-md bg-ink/10"
      >
        <div className="absolute top-0 h-full rounded-md bg-stamp-amber/80" style={{ left: `${startPct}%`, width: `${Math.max(widthPct, 1)}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink/40">
        <span>시작 {startTime.toFixed(1)}초 (드래그해서 고르기)</span>
        <span>원본 길이 {videoDuration ? videoDuration.toFixed(1) : '...'}초</span>
      </div>
    </div>
  )
}

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
  const [scenes, setScenes] = useState([emptyScene('후킹')])
  const [sizePreset, setSizePreset] = useState(SIZE_PRESETS[0].value)
  const [fps, setFps] = useState(30)
  const [transitionDuration, setTransitionDuration] = useState(0.6)
  const [transitionType, setTransitionType] = useState('fade')
  const [decoration, setDecoration] = useState('none')
  const [musicFile, setMusicFile] = useState(null)
  const [musicVolume, setMusicVolume] = useState(0.8)
  const [bulkAdding, setBulkAdding] = useState(false)

  // 추천 배경음악 (server/assets/bgm/) - 직접 업로드 대신 목록에서 미리 듣고 고를 수 있게
  const [bgmTracks, setBgmTracks] = useState([])
  const [bgmLoading, setBgmLoading] = useState(true)
  const [selectedBgm, setSelectedBgm] = useState(null) // filename or null
  const [playingBgm, setPlayingBgm] = useState(null) // 지금 미리듣기 중인 트랙 (선택 여부와 무관)
  const [bgmSectionOpen, setBgmSectionOpen] = useState(true) // 목록이 길어서 접을 수 있게(2026-07-26 요청)
  const bgmListRef = useRef(null)
  const handleBgmPlay = (e, filename) => {
    setPlayingBgm(filename)
    bgmListRef.current?.querySelectorAll('audio').forEach((audio) => {
      if (audio !== e.target) audio.pause()
    })
  }
  const handleBgmPause = (filename) => {
    setPlayingBgm((cur) => (cur === filename ? null : cur))
  }
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
  const [renderEngine, setRenderEngine] = useState(null)
  const [autoCaptionVoice, setAutoCaptionVoice] = useState(false)
  const [autoCaptionBgm, setAutoCaptionBgm] = useState(false)
  const [exportingCapcut, setExportingCapcut] = useState(false)
  const [capcutZipUrl, setCapcutZipUrl] = useState(null)

  // 2026-08-01 요청: "노트북LM 워터마크 지우기 나도 할 수 있게 해줘" - 위 씬 편집기와는 별개로,
  // 이미 갖고 있는 영상 파일 하나를 그냥 업로드해서 우측 하단 고정 워터마크만 지우는 독립 도구.
  const [watermarkFile, setWatermarkFile] = useState(null)
  const [removingWatermark, setRemovingWatermark] = useState(false)
  const [watermarkResultUrl, setWatermarkResultUrl] = useState(null)
  const [watermarkError, setWatermarkError] = useState(null)

  // 2026-07-27: 후킹 썸네일 추천 - 상품 사진을 직접 첨부하거나(우선), 없으면 방금 렌더링한
  // 영상 장면에서 골라서 후킹 문구+완성 썸네일 이미지를 만들어줌.
  const [thumbnailPhotos, setThumbnailPhotos] = useState([])
  const [thumbnailAspect, setThumbnailAspect] = useState('vertical')
  const [thumbnailLoading, setThumbnailLoading] = useState(false)
  const [thumbnailResult, setThumbnailResult] = useState(null)
  const [thumbnailError, setThumbnailError] = useState(null)

  const handleSuggestThumbnail = async () => {
    setThumbnailLoading(true)
    setThumbnailError(null)
    setThumbnailResult(null)
    try {
      const fd = new FormData()
      fd.append('text', scenes.map((s) => s.text).filter(Boolean).join(' '))
      fd.append('aspect', thumbnailAspect)
      thumbnailPhotos.forEach((f) => fd.append('photos', f))
      if (thumbnailPhotos.length === 0 && videoUrl) {
        fd.append('videoFileName', videoUrl.split('/').pop())
      }
      const data = await suggestVideoThumbnail(fd)
      setThumbnailResult(data)
    } catch (err) {
      setThumbnailError(err.message)
    } finally {
      setThumbnailLoading(false)
    }
  }

  const updateScene = (key, patch) => {
    setScenes((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }
  const addScene = () => setScenes((prev) => [...prev, emptyScene()])

  // 2026-08-02 요청: "대사/나레이션 흐름 읽고 장면에 맞는 모션·하트 같은 효과를 자동으로
  // 넣어줄 수 있을까" - 씬마다 이미 입력해둔 자막(text)만 서버로 보내서, AI가 전체 흐름을 보고
  // 장면별 모션+효과를 한 번에 추천해준 뒤 그대로 각 씬에 적용한다.
  const [autoDirecting, setAutoDirecting] = useState(false)
  const [autoDirectError, setAutoDirectError] = useState(null)
  const handleAutoDirect = async () => {
    setAutoDirecting(true)
    setAutoDirectError(null)
    try {
      const sceneInputs = scenes.map((s) => ({ text: s.text, isVideo: Boolean(s.imageFile?.type?.startsWith('video/')) }))
      const { directions } = await autoDirectVideoStudio(sceneInputs)
      setScenes((prev) => prev.map((s, i) => ({ ...s, motion: directions[i]?.motion || s.motion, effect: directions[i]?.effect || 'none' })))
    } catch (err) {
      setAutoDirectError(err.message)
    } finally {
      setAutoDirecting(false)
    }
  }
  const removeScene = (key) => setScenes((prev) => (prev.length > 1 ? prev.filter((s) => s.key !== key) : prev))
  const insertSceneAfter = (key) =>
    setScenes((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      const next = [...prev]
      next.splice(idx + 1, 0, emptyScene())
      return next
    })

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

  const buildRenderFormData = () => {
    const preset = SIZE_PRESETS.find((p) => p.value === sizePreset) || SIZE_PRESETS[0]
    const fd = new FormData()
    fd.append('width', String(preset.width))
    fd.append('height', String(preset.height))
    fd.append('fps', String(fps))
    fd.append('transitionDuration', String(transitionDuration))
    fd.append('transitionType', transitionType)
    fd.append('decoration', decoration)
    if (musicFile) {
      fd.append('audio', musicFile)
      fd.append('audioVolume', String(musicVolume))
    } else if (selectedBgm) {
      fd.append('bgmFilename', selectedBgm)
      fd.append('audioVolume', String(musicVolume))
    }
    fd.append(
      'scenesMeta',
      JSON.stringify(scenes.map((s) => ({ duration: s.duration, motion: s.motion, effect: s.effect || 'none', text: s.text, startTime: s.startTime || 0 })))
    )
    scenes.forEach((s, i) => {
      fd.append(`scene_image_${i}`, s.imageFile)
      if (s.voiceFile) fd.append(`scene_voice_${i}`, s.voiceFile)
    })
    return fd
  }

  const runRender = async (fd, engine) => {
    setError(null)
    setVideoUrl(null)

    if (!scenes.every((s) => s.imageFile)) {
      setError('모든 씬에 이미지를 넣어주세요.')
      return
    }

    setRendering(true)
    try {
      const { videoUrl: url } = await renderVideoStudio(fd)
      setVideoUrl(url)
      setRenderEngine(engine)
    } catch (err) {
      setError(err.message)
    } finally {
      setRendering(false)
    }
  }

  const handleRender = () => runRender(buildRenderFormData(), 'ffmpeg')

  // ✨ Remotion 베타 - Phase 1이라 사진 씬 + 페이드 전환만 지원(계획 문서 참고).
  // transitionType이 fade가 아니면 서버가 자동으로 페이드로 렌더링하므로 여기서 미리 안내만 함.
  const handleRenderRemotion = () => {
    const fd = buildRenderFormData()
    fd.append('engine', 'remotion')
    if (autoCaptionVoice) fd.append('autoCaptionVoice', '1')
    if (autoCaptionBgm) fd.append('autoCaptionBgm', '1')
    runRender(fd, 'remotion')
  }

  // 📦 CapCut 프로젝트로 내보내기 - 완전 자동 렌더링 대신, 씬 소재+오디오+자막만 zip으로 묶어서
  // 마지막 편집은 CapCut에서 직접 하는 방식 (2026-07-30 벤치마킹으로 추가).
  const handleExportCapcut = async () => {
    setError(null)
    setCapcutZipUrl(null)
    if (!scenes.every((s) => s.imageFile)) {
      setError('모든 씬에 이미지를 넣어주세요.')
      return
    }
    const fd = buildRenderFormData()
    if (autoCaptionVoice) fd.append('autoCaptionVoice', '1')
    setExportingCapcut(true)
    try {
      const { zipUrl } = await exportVideoStudioCapcut(fd)
      setCapcutZipUrl(zipUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setExportingCapcut(false)
    }
  }

  const handleDeleteVideoUrl = async () => {
    if (videoUrl) await deleteVideoStudioGenerated(videoUrl).catch(() => {})
    setVideoUrl(null)
  }

  const handleDeleteCapcutZip = async () => {
    if (capcutZipUrl) await deleteVideoStudioGenerated(capcutZipUrl).catch(() => {})
    setCapcutZipUrl(null)
  }

  const handleRemoveWatermark = async () => {
    if (!watermarkFile) return
    setWatermarkError(null)
    setWatermarkResultUrl(null)
    setRemovingWatermark(true)
    try {
      const fd = new FormData()
      fd.append('video', watermarkFile)
      const { videoUrl: resultUrl } = await removeVideoWatermark(fd)
      setWatermarkResultUrl(resultUrl)
    } catch (err) {
      setWatermarkError(err.message)
    } finally {
      setRemovingWatermark(false)
    }
  }

  const handleDeleteWatermarkResult = async () => {
    if (watermarkResultUrl) await deleteVideoStudioGenerated(watermarkResultUrl).catch(() => {})
    setWatermarkResultUrl(null)
  }

  return (
    <div>
      <PageHeader
        title="영상 제작실"
        emoji="🎬"
        description="씬마다 이미지·효과·자막·보이스를 직접 골라서 mp4 영상을 만들어요 (video-maker 프로그램을 그대로 옮겨왔어요)"
      />

      {/* 2026-09-02 요청: CapCut 대신 여기서 영상+나레이션+음악을 같이 자르고 더킹 믹스 */}
      <VoiceoverMixer bgmTracks={bgmTracks} />

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
          <label className="mb-1 block text-xs font-semibold text-ink/70">전환 효과 종류</label>
          <select
            value={transitionType}
            onChange={(e) => setTransitionType(e.target.value)}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
          >
            <option value="fade">페이드 (기본)</option>
            <option value="rotate">회전 전환 (포토카드처럼 젖혀짐)</option>
            <option value="diagonal">교차 전환 (대각선으로 겹치며 넘어감)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/70">폴라로이드 장식</label>
          <select
            value={decoration}
            onChange={(e) => setDecoration(e.target.value)}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
          >
            <option value="none">장식 없음</option>
            <option value="hearts">🩷 네온 하트</option>
            <option value="stars">🌟 파스텔 별</option>
            <option value="ribbon">🎀 리본 큐트</option>
            <option value="gold">✨ 골드 럭셔리</option>
          </select>
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
        <button
          type="button"
          onClick={() => setBgmSectionOpen((v) => !v)}
          className="mb-2 flex w-full items-center justify-between text-left"
        >
          <span className="text-sm font-semibold text-ink/80">
            🎵 배경음악 (선택){selectedBgm && <span className="ml-2 text-xs font-normal text-stamp-amber">{selectedBgm} 선택됨</span>}
            {musicFile && <span className="ml-2 text-xs font-normal text-stamp-amber">{musicFile.name} 선택됨</span>}
          </span>
          <span className="text-xs text-ink/40">{bgmSectionOpen ? '접기 ▲' : '펼치기 ▼'}</span>
        </button>
        {bgmSectionOpen && (bgmLoading ? (
          <p className="text-xs text-ink/40">추천 음악 불러오는 중...</p>
        ) : bgmTracks.length === 0 ? (
          <p className="text-xs text-ink/40">
            아직 추천 음악이 없어요 (server/assets/bgm/ 폴더가 비어있음) - 아래에서 직접 파일을 올려도 돼요.
          </p>
        ) : (
          <div className="mb-3 space-y-2" ref={bgmListRef}>
            {bgmTracks.map((t) => (
              <div
                key={t.filename}
                className={`flex items-center gap-3 rounded-md border p-2 text-xs ${
                  selectedBgm === t.filename ? 'border-stamp-amber bg-stamp-amber/5' : 'border-ink/10'
                }`}
              >
                <label className="flex flex-1 items-center gap-3">
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
                </label>
                <audio
                  src={t.url}
                  controls
                  onPlay={(e) => handleBgmPlay(e, t.filename)}
                  onPause={() => handleBgmPause(t.filename)}
                  onEnded={() => handleBgmPause(t.filename)}
                  className="h-8"
                  style={{ maxWidth: '200px' }}
                />
                {(selectedBgm === t.filename || playingBgm === t.filename) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.parentElement?.querySelector('audio')?.pause()
                      if (selectedBgm === t.filename) setSelectedBgm(null)
                      setPlayingBgm(null)
                    }}
                    className="shrink-0 rounded-md border border-stamp-reject/40 px-2 py-1 text-[11px] font-semibold text-stamp-reject hover:bg-stamp-reject/10"
                  >
                    ✕ 취소
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        {bgmSectionOpen && (
          <>
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
          </>
        )}
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

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-paper-card p-3 shadow-card">
        <button
          type="button"
          onClick={handleAutoDirect}
          disabled={autoDirecting || scenes.every((s) => !s.text?.trim())}
          className="rounded-md bg-stamp-amber px-3 py-1.5 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
        >
          {autoDirecting ? '연출 정하는 중...' : '🪄 AI 자동 연출'}
        </button>
        <span className="text-[11px] text-ink/40">각 씬 자막을 먼저 채워두면, 흐름 읽고 모션·하트 효과를 한 번에 배정해줘요.</span>
        {autoDirectError && <span className="text-[11px] text-stamp-reject">⚠️ {autoDirectError}</span>}
      </div>

      <div className="space-y-3">
        {scenes.map((s, i) => (
          <div key={s.key} className="rounded-xl bg-paper-card p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink/80">씬 {i + 1}</span>
                <select
                  value={s.role || '본문'}
                  onChange={(e) => updateScene(s.key, { role: e.target.value })}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    s.role === '후킹'
                      ? 'border-stamp-amber/40 bg-stamp-amber/10 text-stamp-amber'
                      : 'border-ink/15 bg-ink/5 text-ink/50'
                  }`}
                >
                  <option value="후킹">🪝 후킹</option>
                  <option value="본문">본문</option>
                </select>
              </div>
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
                <ScenePreview file={s.imageFile} />
                {s.imageFile?.type?.startsWith('video/') && (
                  <VideoTimeline
                    file={s.imageFile}
                    startTime={s.startTime || 0}
                    sceneDuration={s.duration}
                    onStartTimeChange={(t) => updateScene(s.key, { startTime: t })}
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
                <label className="mb-1 block text-xs font-semibold text-ink/70">모션</label>
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
                <label className="mb-1 block text-xs font-semibold text-ink/70">오버레이 효과</label>
                <select
                  value={s.effect || 'none'}
                  onChange={(e) => updateScene(s.key, { effect: e.target.value })}
                  className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm focus:border-stamp-amber focus:outline-none focus:ring-1 focus:ring-stamp-amber"
                >
                  {EFFECT_OPTIONS.map((m) => (
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
            <button
              type="button"
              onClick={() => insertSceneAfter(s.key)}
              className="mt-3 w-full rounded-md border border-dashed border-ink/20 py-1.5 text-xs font-semibold text-ink/50 hover:border-stamp-amber hover:text-stamp-amber"
            >
              + 이 아래에 씬 추가
            </button>
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRender}
          disabled={!canRender}
          className="rounded-lg bg-stamp-amber px-5 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-stamp-amber/90 disabled:opacity-50"
        >
          {rendering ? '영상 만드는 중... (시간이 좀 걸려요)' : '🎬 영상 만들기'}
        </button>
        <button
          type="button"
          onClick={handleRenderRemotion}
          disabled={!canRender}
          title="사진 씬 + 페이드 전환만 지원하는 베타예요 (로컬 실행 전용)"
          className="rounded-lg border border-stamp-amber px-5 py-2.5 text-sm font-semibold text-stamp-amber shadow-card hover:bg-stamp-amber/10 disabled:opacity-50"
        >
          {rendering ? '만드는 중...' : '✨ Remotion으로 만들기 (베타)'}
        </button>
        <button
          type="button"
          onClick={handleExportCapcut}
          disabled={!canRender || exportingCapcut}
          title="영상으로 바로 렌더링하지 않고, 소재+오디오+자막만 zip으로 묶어서 CapCut에서 마무리 편집해요"
          className="rounded-lg border border-ink/20 px-5 py-2.5 text-sm font-semibold text-ink/70 shadow-card hover:bg-ink/5 disabled:opacity-50"
        >
          {exportingCapcut ? '내보내는 중...' : '📦 CapCut 프로젝트로 내보내기'}
        </button>
      </div>
      <div className="mt-2 space-y-1">
        <label className="flex items-center gap-1.5 text-[11px] text-ink/50">
          <input type="checkbox" checked={autoCaptionVoice} onChange={(e) => setAutoCaptionVoice(e.target.checked)} />
          🎤 보이스 자동 자막 (베타, 보이스 넣은 씬만 적용 · 처음 한 번은 자막 엔진 받느라 오래 걸려요)
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-ink/50">
          <input type="checkbox" checked={autoCaptionBgm} onChange={(e) => setAutoCaptionBgm(e.target.checked)} />
          🎵 배경음악 가사 자막 (베타, 노래라 보이스보다 인식률이 떨어질 수 있어요)
        </label>
      </div>
      {transitionType === 'diagonal' && (
        <p className="mt-2 text-[11px] text-ink/40">
          ※ 베타 모드는 교차(대각선) 전환은 아직 지원 안 해요 (선택한 전환 효과 대신 페이드로 렌더링돼요). 페이드·회전 전환은 지원돼요.
        </p>
      )}

      {videoUrl && (
        <div className="mt-4 rounded-xl bg-paper-card p-4 shadow-card">
          <p className="mb-2 text-sm font-bold text-ink/80">
            완성됐어요!{renderEngine === 'remotion' && <span className="ml-2 text-xs font-normal text-stamp-amber">✨ Remotion 베타로 렌더링됨</span>}
          </p>
          <video src={videoUrl} controls className="max-h-[70vh] rounded-lg bg-black" />
          <div className="mt-2 flex gap-3">
            <a href={videoUrl} download className="text-xs text-ink/60 underline decoration-dotted hover:text-stamp-amber">
              다운로드
            </a>
            <button
              type="button"
              onClick={handleDeleteVideoUrl}
              className="text-xs text-stamp-reject hover:underline"
            >
              삭제
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink/40">
            이 영상을 콘텐츠에 쓰려면 "콘텐츠 관리"에서 초안을 만들고 이미지 첨부란에 다운로드한 파일을 올려주세요.
          </p>
        </div>
      )}

      {capcutZipUrl && (
        <div className="mt-4 rounded-xl bg-paper-card p-4 shadow-card">
          <p className="mb-2 text-sm font-bold text-ink/80">📦 CapCut 소재 준비됐어요!</p>
          <p className="text-[11px] text-ink/40">
            이미지/영상 씬 + 오디오(audio.mp3) + 자막(subtitle.srt)이 zip 안에 들어있어요. 압축을 풀고 CapCut에서
            새 프로젝트를 만들어 이어서 편집해주세요 (안에 읽어주세요.txt 참고).
          </p>
          <div className="mt-2 flex gap-3">
            <a href={capcutZipUrl} download className="text-xs text-ink/60 underline decoration-dotted hover:text-stamp-amber">
              zip 다운로드
            </a>
            <button type="button" onClick={handleDeleteCapcutZip} className="text-xs text-stamp-reject hover:underline">
              삭제
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-dashed border-ink/20 bg-ink/[0.02] p-4">
        <label className="mb-1 block text-sm font-semibold text-ink/80">🧹 워터마크 지우기</label>
        <p className="mb-2 text-[11px] text-ink/40">
          우측 하단에 고정된 워터마크(기본은 노트북LM 위치)가 있는 영상을 올리면 지워서 돌려줘요. 위 씬 편집기와는 별개로,
          이미 갖고 있는 영상 파일을 그냥 업로드하면 돼요.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setWatermarkFile(e.target.files?.[0] || null)}
            className="text-xs"
          />
          <button
            type="button"
            onClick={handleRemoveWatermark}
            disabled={!watermarkFile || removingWatermark}
            className="rounded-md bg-ink/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink disabled:opacity-50"
          >
            {removingWatermark ? '지우는 중... (영상 길이에 따라 시간이 걸려요)' : '워터마크 지우기'}
          </button>
        </div>
        {watermarkError && <p className="mt-2 text-xs text-stamp-reject">⚠️ {watermarkError}</p>}
        {watermarkResultUrl && (
          <div className="mt-3 rounded-lg bg-paper-card p-3 shadow-card">
            <p className="mb-2 text-xs font-bold text-ink/70">완성됐어요!</p>
            <video src={watermarkResultUrl} controls className="max-h-[50vh] rounded-lg bg-black" />
            <div className="mt-2 flex gap-3">
              <a href={watermarkResultUrl} download className="text-xs text-ink/60 underline decoration-dotted hover:text-stamp-amber">
                다운로드
              </a>
              <button type="button" onClick={handleDeleteWatermarkResult} className="text-xs text-stamp-reject hover:underline">
                삭제
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-stamp-amber/40 bg-stamp-amber/5 p-4">
        <label className="mb-1 block text-sm font-semibold text-ink/80">📌 후킹 썸네일 추천</label>
        <p className="mb-2 text-[11px] text-ink/40">
          상품 사진을 첨부하거나(우선), 안 올리면 방금 만든 영상 장면 중에서 골라서 후킹 문구+완성 썸네일을 만들어줘요.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setThumbnailPhotos(Array.from(e.target.files || []))}
            className="min-w-[200px] flex-1 text-xs"
          />
          <select
            value={thumbnailAspect}
            onChange={(e) => setThumbnailAspect(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-2 text-xs focus:border-stamp-amber focus:outline-none"
          >
            <option value="vertical">세로 (쇼츠)</option>
            <option value="horizontal">가로 (롱폼)</option>
          </select>
          <button
            type="button"
            onClick={handleSuggestThumbnail}
            disabled={thumbnailLoading || (thumbnailPhotos.length === 0 && !videoUrl)}
            className="rounded-md bg-stamp-amber px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {thumbnailLoading ? '만드는 중...' : '추천받기'}
          </button>
        </div>
        {thumbnailPhotos.length === 0 && !videoUrl && (
          <p className="mt-1 text-[11px] text-ink/40">사진을 첨부하거나, 먼저 영상을 만들어주세요.</p>
        )}
        {thumbnailError && <p className="mt-2 text-xs text-stamp-reject">{thumbnailError}</p>}
        {thumbnailResult && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-3">
              {thumbnailResult.thumbnails.map((src, i) => (
                <a key={i} href={src} download={`썸네일_${i + 1}.png`} className="block">
                  <img src={src} alt={`썸네일 후보 ${i + 1}`} className="h-40 rounded-lg border border-ink/10 object-cover" />
                </a>
              ))}
            </div>
            <p className="text-[11px] text-ink/40">이미지 클릭하면 다운로드돼요.</p>
          </div>
        )}
      </div>
    </div>
  )
}
