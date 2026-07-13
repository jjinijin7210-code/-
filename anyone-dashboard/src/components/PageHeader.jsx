export default function PageHeader({ title, description, emoji, onAddClick, addLabel = '추가' }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink md:text-2xl">
          <span aria-hidden>{emoji}</span>
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-ink/60">{description}</p>}
      </div>
      {onAddClick && (
        <button
          onClick={onAddClick}
          className="rounded-lg bg-stamp-amber px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-stamp-amber/90"
        >
          + {addLabel}
        </button>
      )}
    </div>
  )
}
