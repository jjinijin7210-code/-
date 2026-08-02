import { useState, useRef, useEffect } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { uploadDataUrlToStorage } from '../lib/attachments'

export default function WatermarkEraser() {
  const drafts = useSupabaseTable('content_drafts', { select: 'id' })
  const canvasRef = useRef(null)
  const maskCanvasRef = useRef(document.createElement('canvas'))

  const [baseImage, setBaseImage] = useState(null)
  const [brushSize, setBrushSize] = useState(35)
  const [isDrawing, setIsDrawing] = useState(false)
  const [cleanedUrl, setCleanedUrl] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const img = new Image()
      img.src = evt.target.result
      img.onload = () => {
        setBaseImage(img)
        setCleanedUrl(null)

        const canvas = canvasRef.current
        const maskCanvas = maskCanvasRef.current
        if (canvas) {
          canvas.width = img.naturalWidth || 1000
          canvas.height = img.naturalHeight || 750
          maskCanvas.width = canvas.width
          maskCanvas.height = canvas.height

          const ctx = canvas.getContext('2d')
          const maskCtx = maskCanvas.getContext('2d')
          maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        }
      }
    }
    reader.readAsDataURL(file)
  }

  const redrawCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas || !baseImage) return
    const ctx = canvas.getContext('2d')
    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height)
    ctx.drawImage(maskCanvasRef.current, 0, 0)
  }

  const paintMask = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY

    const maskCtx = maskCanvasRef.current.getContext('2d')
    maskCtx.fillStyle = 'rgba(255, 0, 80, 0.6)'
    maskCtx.beginPath()
    maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
    maskCtx.fill()

    redrawCanvas()
  }

  const clearMask = () => {
    const maskCanvas = maskCanvasRef.current
    const maskCtx = maskCanvas.getContext('2d')
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    redrawCanvas()
  }

  const autoSelectCorners = () => {
    if (!baseImage) return
    const maskCanvas = maskCanvasRef.current
    const maskCtx = maskCanvas.getContext('2d')
    const w = maskCanvas.width
    const h = maskCanvas.height

    maskCtx.fillStyle = 'rgba(255, 0, 80, 0.6)'
    maskCtx.fillRect(10, 10, w * 0.22, h * 0.12)
    maskCtx.fillRect(w * 0.76, 10, w * 0.22, h * 0.12)
    maskCtx.fillRect(10, h * 0.86, w * 0.22, h * 0.12)
    maskCtx.fillRect(w * 0.76, h * 0.86, w * 0.22, h * 0.12)

    redrawCanvas()
  }

  const handleRunInpainting = async () => {
    if (!baseImage || !canvasRef.current) return
    setLoading(true)

    try {
      const canvas = canvasRef.current
      const w = canvas.width
      const h = canvas.height

      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = w
      tempCanvas.height = h
      const tempCtx = tempCanvas.getContext('2d')
      tempCtx.drawImage(baseImage, 0, 0, w, h)

      const imgData = tempCtx.getImageData(0, 0, w, h)
      const maskCtx = maskCanvasRef.current.getContext('2d')
      const maskData = maskCtx.getImageData(0, 0, w, h)
      const data = imgData.data
      const mask = maskData.data

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4
          if (mask[idx + 3] > 20) {
            let rSum = 0, gSum = 0, bSum = 0, count = 0
            const radius = 14

            for (let dy = -radius; dy <= radius; dy += 3) {
              for (let dx = -radius; dx <= radius; dx += 3) {
                const nx = x + dx
                const ny = y + dy
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  const nIdx = (ny * w + nx) * 4
                  if (mask[nIdx + 3] <= 20) {
                    rSum += data[nIdx]
                    gSum += data[nIdx + 1]
                    bSum += data[nIdx + 2]
                    count++
                  }
                }
              }
            }

            if (count > 0) {
              data[idx] = Math.floor(rSum / count)
              data[idx + 1] = Math.floor(gSum / count)
              data[idx + 2] = Math.floor(bSum / count)
            }
          }
        }
      }

      tempCtx.putImageData(imgData, 0, 0)
      const resultDataUrl = tempCanvas.toDataURL('image/png')
      setCleanedUrl(resultDataUrl)

      // 초안함에 지워진 사진 저장
      const attachment = await uploadDataUrlToStorage(resultDataUrl, {
        kind: 'image',
        filename: `watermark-removed-${Date.now()}.png`,
        note: 'AI 워터마크 제거 완료본',
      })

      await drafts.insertRow({
        title: '[워터마크 제거] 클린 이미지 소재',
        body: '워터마크 및 불필요한 글자가 제거된 깨끗한 이미지 소재입니다.',
        platform: '인스타/틱톡',
        category: '소재 가공',
        status: '초안',
        images: [attachment],
      })
    } catch (err) {
      console.error(err)
      alert('워터마크 제거 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-paper-card via-paper-card to-emerald-500/5 p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold">
            🧹
          </span>
          <div>
            <h2 className="text-base font-bold text-ink">AI 워터마크 & 불필요한 글자 지우개</h2>
            <p className="text-xs text-ink/50">사진이나 스크린샷의 워터마크, 로고, 자막을 1초 만에 깔끔하게 감쪽같이 지웁니다.</p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-600">
          ✨ 100% 무제한 지우개
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition-all">
            <span>📷 내 컴퓨터에서 사진 가져오기</span>
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>

          {baseImage && (
            <>
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-ink/15 text-xs">
                <span className="font-bold text-ink/70">브러시 굵기:</span>
                <input
                  type="range"
                  min="10"
                  max="80"
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-24 accent-emerald-600"
                />
                <span className="font-semibold text-emerald-600">{brushSize}px</span>
              </div>

              <button
                type="button"
                onClick={autoSelectCorners}
                className="rounded-lg border border-emerald-600/40 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                ✨ 모서리 워터마크 자동 선택
              </button>

              <button
                type="button"
                onClick={clearMask}
                className="rounded-lg border border-ink/20 px-3 py-1.5 text-xs text-ink/60 hover:bg-ink/5"
              >
                ↺ 영역 지우기
              </button>

              <button
                type="button"
                onClick={handleRunInpainting}
                disabled={loading}
                className="ml-auto rounded-lg bg-stamp-amber px-5 py-2 text-xs font-bold text-white shadow hover:bg-stamp-amber/90 disabled:opacity-50"
              >
                {loading ? '지우는 중...' : '🧹 워터마크 감쪽같이 지우기'}
              </button>
            </>
          )}
        </div>

        {baseImage ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div className="flex flex-col items-center bg-black/5 rounded-lg p-2 border border-ink/10 relative">
              <span className="text-xs font-bold text-ink/60 mb-2">💡 마우스로 지울 글자/워터마크를 붉은색으로 칠하세요</span>
              <canvas
                ref={canvasRef}
                onMouseDown={(e) => { setIsDrawing(true); paintMask(e); }}
                onMouseMove={(e) => { if (isDrawing) paintMask(e); }}
                onMouseUp={() => setIsDrawing(false)}
                className="max-h-72 rounded shadow-md cursor-crosshair max-w-full"
              />
            </div>

            <div className="flex flex-col items-center justify-center bg-black/5 rounded-lg p-2 border border-ink/10">
              {cleanedUrl ? (
                <>
                  <img src={cleanedUrl} alt="워터마크 제거 결과" className="max-h-72 rounded shadow-md object-contain" />
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-600">✅ 깔끔하게 지워진 클린 이미지! (초안함 자동 보관됨)</span>
                    <a
                      href={cleanedUrl}
                      download={`cleaned-${Date.now()}.png`}
                      className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white shadow hover:bg-emerald-700"
                    >
                      다운로드
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-ink/40 text-center py-12">
                  왼쪽 창에서 워터마크 위를 칠한 뒤<br />
                  <strong>[🧹 워터마크 감쪽같이 지우기]</strong>를 눌러주세요.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-ink/20 py-8 text-center text-xs text-ink/40">
            사진이나 스크린샷을 가져와서 워터마크나 글자를 지워보세요.
          </div>
        )}
      </div>
    </section>
  )
}
