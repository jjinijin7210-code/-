// type: 'text' | 'textarea' | 'select' | 'checkbox' | 'number'
export default function FormField({ label, type = 'text', value, onChange, options, required, hint, disabled, error }) {
  const baseInput = `w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
    error
      ? 'border-stamp-reject focus:border-stamp-reject focus:ring-stamp-reject'
      : 'border-ink/15 focus:border-stamp-amber focus:ring-stamp-amber'
  }`

  if (type === 'checkbox') {
    return (
      <label className={`flex items-start gap-2 text-sm ${disabled ? 'text-ink/30' : 'text-ink/80'}`}>
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-ink/30 text-stamp-amber focus:ring-stamp-amber disabled:opacity-40"
        />
        <span>
          {label}
          {required && <span className="text-stamp-reject"> *</span>}
        </span>
      </label>
    )
  }

  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-semibold text-ink/70">
        {label}
        {required && <span className="text-stamp-reject"> *</span>}
      </label>
      {type === 'textarea' && (
        <textarea
          className={`${baseInput} min-h-[100px]`}
          value={value ?? ''}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {type === 'select' && (
        <select className={baseInput} value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)}>
          {options.map((opt) => {
            // options는 문자열 배열이거나 { value, label } 객체 배열일 수 있음
            const optValue = typeof opt === 'object' ? opt.value : opt
            const optLabel = typeof opt === 'object' ? opt.label : opt
            return (
              <option key={optValue} value={optValue}>
                {optLabel}
              </option>
            )
          })}
        </select>
      )}
      {(type === 'text' || type === 'number') && (
        <input
          type={type}
          className={baseInput}
          value={value ?? ''}
          required={required}
          onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        />
      )}
      {hint && <p className={`mt-1 text-[11px] ${error ? 'text-stamp-reject' : 'text-ink/40'}`}>{hint}</p>}
    </div>
  )
}
