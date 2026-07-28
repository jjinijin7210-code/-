import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import StatusBadge from '../components/StatusBadge'
import AttachmentSection from '../components/AttachmentSection'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { fileToDataUrl } from '../lib/attachments'
import { convertImageFormat } from '../lib/apiClient'
import {
  DEFAULT_BRAND_NAMES,
  ASSET_CATEGORIES,
  COPYRIGHT_STATUS_OPTIONS,
  APPROVAL_STATUS_OPTIONS,
  getEmptyAsset,
} from '../data/brandCenter'

const CONVERT_FORMAT_OPTIONS = ['jpg', 'png', 'webp']

const FILE_KIND = [{ key: 'file', label: '파일' }]

export default function AssetVault() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('assets', {
    orderBy: 'created_date',
  })
  const { rows: brands } = useSupabaseTable('brands', { orderBy: 'name', ascending: true })
  const { rows: drafts } = useSupabaseTable('content_drafts')
  const confirm = useConfirm()

  const brandNames = brands.length > 0 ? brands.map((b) => b.name) : DEFAULT_BRAND_NAMES

  const [filterBrand, setFilterBrand] = useState('전체')
  const [filterCategory, setFilterCategory] = useState('전체')

  const [convertFormat, setConvertFormat] = useState('jpg')
  const [convertLoading, setConvertLoading] = useState(false)
  const [convertError, setConvertError] = useState(null)
  const [convertResults, setConvertResults] = useState([])

  const handleConvertFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setConvertLoading(true)
    setConvertError(null)
    try {
      const imageDataUrl = await fileToDataUrl(file)
      const { dataUrl } = await convertImageFormat({ imageDataUrl, format: convertFormat })
      const baseName = file.name.replace(/\.[^.]+$/, '')
      setConvertResults((prev) => [
        { id: crypto.randomUUID(), name: `${baseName}.${convertFormat}`, dataUrl },
        ...prev,
      ])
    } catch (err) {
      setConvertError(err.message)
    } finally {
      setConvertLoading(false)
    }
  }

  const removeConvertResult = (id) => {
    setConvertResults((prev) => prev.filter((r) => r.id !== id))
  }

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(getEmptyAsset())

  const openAdd = () => {
    setEditing(null)
    setForm(getEmptyAsset())
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm({ ...getEmptyAsset(), ...row, files: row.files || [] })
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  const filtered = rows.filter(
    (r) => (filterBrand === '전체' || r.brand === filterBrand) && (filterCategory === '전체' || r.category === filterCategory)
  )

  const draftTitle = (id) => drafts.find((d) => d.id === id)?.title

  return (
    <div>
      <PageHeader
        title="에셋 보관함"
        emoji="🗂️"
        description="이미지·썸네일·로고·배너·캐릭터·영상·음원·프롬프트·문서·게시물 완성본을 브랜드별로 보관"
        onAddClick={openAdd}
        addLabel="에셋 추가"
      />

      <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
        <p className="mb-1 text-xs font-bold text-ink/70">🔄 이미지 형식 변환</p>
        <p className="mb-2 text-[11px] text-ink/40">
          webp 등으로 받은 이미지를 jpg/png/webp로 바꿔요. 서버에 저장하지 않고 바로 변환해서 돌려줘요.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={convertFormat}
            onChange={(e) => setConvertFormat(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-xs"
          >
            {CONVERT_FORMAT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}로 변환
              </option>
            ))}
          </select>
          <label className="cursor-pointer rounded-md bg-stamp-amber px-3 py-2 text-xs font-semibold text-white hover:bg-stamp-amber/90">
            {convertLoading ? '변환 중...' : '📁 이미지 선택'}
            <input type="file" accept="image/*" className="hidden" disabled={convertLoading} onChange={handleConvertFile} />
          </label>
        </div>
        {convertError && <p className="mt-2 text-xs text-stamp-reject">⚠️ {convertError}</p>}
        {convertResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {convertResults.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg bg-white p-2 shadow-card">
                <img src={r.dataUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded object-cover" />
                <p className="min-w-0 flex-1 truncate text-xs text-ink/60">{r.name}</p>
                <a
                  href={r.dataUrl}
                  download={r.name}
                  className="flex-shrink-0 text-xs font-semibold text-stamp-amber hover:underline"
                >
                  저장
                </a>
                <button
                  type="button"
                  onClick={() => removeConvertResult(r.id)}
                  className="flex-shrink-0 text-xs text-stamp-reject hover:underline"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={filterBrand}
          onChange={(e) => setFilterBrand(e.target.value)}
          className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-xs"
        >
          <option value="전체">전체 브랜드</option>
          {brandNames.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-xs"
        >
          <option value="전체">전체 분류</option>
          {ASSET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && filtered.length === 0 && <EmptyView />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-stamp-amber">{row.category}</span>
              <StatusBadge status={row.approval_status} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{row.brand}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ink/50">
              <span>{row.creator || '제작자 미입력'}</span>
              <span>·</span>
              <span>{row.version || 'v-'}</span>
              <span>·</span>
              <span>{row.copyright_status}</span>
            </div>
            {row.linked_post_id && draftTitle(row.linked_post_id) && (
              <p className="mt-1 truncate text-[11px] text-ink/40">관련 게시물: {draftTitle(row.linked_post_id)}</p>
            )}
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '에셋 수정' : '에셋 추가'}>
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="브랜드"
              type="select"
              options={brandNames}
              value={form.brand}
              onChange={(v) => setForm({ ...form, brand: v })}
            />
            <FormField
              label="분류"
              type="select"
              options={ASSET_CATEGORIES}
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="제작자" value={form.creator} onChange={(v) => setForm({ ...form, creator: v })} />
            <FormField
              label="제작일"
              value={form.created_date}
              hint="예: 2026-07-20"
              onChange={(v) => setForm({ ...form, created_date: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="저작권 상태"
              type="select"
              options={COPYRIGHT_STATUS_OPTIONS}
              value={form.copyright_status}
              onChange={(v) => setForm({ ...form, copyright_status: v })}
            />
            <FormField
              label="승인 상태"
              type="select"
              options={APPROVAL_STATUS_OPTIONS}
              value={form.approval_status}
              onChange={(v) => setForm({ ...form, approval_status: v })}
            />
          </div>
          <FormField label="버전" value={form.version} onChange={(v) => setForm({ ...form, version: v })} />
          <FormField
            label="연결 게시물"
            type="select"
            options={[{ value: '', label: '(연결 안 함)' }, ...drafts.map((d) => ({ value: d.id, label: d.title }))]}
            value={form.linked_post_id}
            onChange={(v) => setForm({ ...form, linked_post_id: v })}
          />

          <div className="my-3">
            <p className="mb-2 text-xs font-bold text-ink/70">파일</p>
            <AttachmentSection attachments={form.files} kinds={FILE_KIND} onChange={(next) => setForm({ ...form, files: next })} />
          </div>

          <FormField label="메모" type="textarea" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 에셋을 삭제할까요? 휴지통으로 이동해요.')
                  if (!ok) return
                  await deleteRow(editing.id)
                  setModalOpen(false)
                }}
                className="text-sm text-stamp-reject hover:underline"
              >
                삭제
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <SaveStatusIndicator status={saveStatus} />
              <button type="submit" className="rounded-md bg-stamp-amber px-4 py-2 text-sm font-semibold text-white hover:bg-stamp-amber/90">
                저장
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
