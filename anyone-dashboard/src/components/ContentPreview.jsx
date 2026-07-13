import { useState } from 'react'
import { PREVIEW_PLATFORMS, getPreviewModel } from '../lib/contentPreview'

export default function ContentPreview({ draft }) {
  const [platform, setPlatform] = useState(PREVIEW_PLATFORMS[0])
  const model = getPreviewModel(draft, platform)

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {PREVIEW_PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlatform(p)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              platform === p
                ? 'border-stamp-amber bg-stamp-amber/10 text-stamp-amber'
                : 'border-ink/15 text-ink/50 hover:bg-ink/5'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex justify-center rounded-xl border border-ink/10 bg-ink/[0.03] p-4">
        {model.aspect === 'vertical' ? (
          <div className="relative flex h-72 w-40 flex-col justify-end overflow-hidden rounded-xl bg-ink text-white shadow-card">
            {model.firstImage ? (
              <img src={model.firstImage.data_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-4xl">🎬</div>
            )}
            <div className="relative z-10 space-y-1 bg-gradient-to-t from-black/80 to-transparent p-2.5">
              <p className="text-[11px] font-semibold leading-snug">{model.title}</p>
              <p className="text-[10px] leading-snug text-white/80">{model.bodyPreview}</p>
              {model.showHashtagsInline && (
                <p className="text-[10px] text-stamp-amber">{model.hashtags.join(' ')}</p>
              )}
            </div>
          </div>
        ) : model.aspect === 'square' ? (
          <div className="w-64 overflow-hidden rounded-xl bg-white shadow-card">
            <div className="flex aspect-square items-center justify-center bg-ink/10">
              {model.firstImage ? (
                <img src={model.firstImage.data_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-4xl">🖼️</span>
              )}
            </div>
            <div className="space-y-1 p-2.5">
              <p className="text-xs font-semibold">{model.title}</p>
              <p className="text-[11px] text-ink/60">{model.bodyPreview}</p>
              {model.showHashtagsInline && (
                <p className="text-[11px] text-stamp-amber">{model.hashtags.join(' ')}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-md space-y-2 rounded-xl bg-white p-4 shadow-card">
            <p className="text-sm font-bold">{model.title}</p>
            {model.firstImage && (
              <img src={model.firstImage.data_url} alt="" className="max-h-40 w-full rounded-md object-cover" />
            )}
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink/70">{model.bodyPreview}</p>
            {model.hashtags.length > 0 && (
              <p className="text-xs text-stamp-amber">{model.hashtags.join(' ')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
