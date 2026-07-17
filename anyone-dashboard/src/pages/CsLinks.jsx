import { useState } from 'react'
import { useSupabaseTable } from '../hooks/useSupabaseTable'
import { useConfirm } from '../components/ConfirmDialog'
import SaveStatusIndicator from '../components/SaveStatusIndicator'
import PageHeader from '../components/PageHeader'
import Modal from '../components/Modal'
import FormField from '../components/FormField'
import { LoadingView, ErrorView, EmptyView } from '../components/StateViews'
import { isValidUrl } from '../lib/contentPreview'
import { isDuplicate } from '../lib/validation'
import { scanInstagramComments, replyInstagramComment } from '../lib/apiClient'

const CATEGORY_OPTIONS = ['인테리어/생활용품', '푸드쇼핑']

const emptyForm = {
  trigger_keyword: '',
  target_url: 'https://link.inpock.co.kr/jena10',
  category: CATEGORY_OPTIONS[0],
  note: '',
  active: true,
}

export default function CsLinks() {
  const { rows, loading, error, saveStatus, insertRow, updateRow, deleteRow } = useSupabaseTable('cs_links')
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState(null)

  const [scanLoading, setScanLoading] = useState(false)
  const [scanMessage, setScanMessage] = useState(null)
  const [matches, setMatches] = useState([])
  const [replyingKey, setReplyingKey] = useState(null)

  const matchKey = (m) => `${m.postUrl}::${m.commenterUsername}`

  const handleScanComments = async () => {
    setScanLoading(true)
    setScanMessage(null)
    try {
      const result = await scanInstagramComments()
      setMatches(result.matches || [])
      if (result.message) setScanMessage({ type: 'info', text: result.message })
      else if ((result.matches || []).length === 0) {
        setScanMessage({ type: 'info', text: `최근 게시물 ${result.scannedPosts ?? 0}개를 확인했는데, 새로 답글 보낼 댓글은 없었어요.` })
      }
    } catch (err) {
      setScanMessage({
        type: 'error',
        text: err.loginRequired
          ? '인스타그램 로그인 창이 열렸어요! 로그인하신 뒤 다시 눌러주세요.'
          : err.message,
      })
    } finally {
      setScanLoading(false)
    }
  }

  const handleReply = async (match) => {
    setReplyingKey(matchKey(match))
    setScanMessage(null)
    try {
      const result = await replyInstagramComment(match)
      setMatches((prev) => prev.filter((m) => matchKey(m) !== matchKey(match)))
      setScanMessage({ type: 'success', text: result.message })
    } catch (err) {
      setScanMessage({ type: 'error', text: err.message })
    } finally {
      setReplyingKey(null)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm(row)
    setFormError(null)
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setFormError(null)

    if (!isValidUrl(form.target_url)) {
      setFormError('링크 형식이 올바르지 않아요 (http:// 또는 https://로 시작해야 해요).')
      return
    }

    // 이미 같은 키워드가 등록되어 있으면 경고하고 한 번 더 확인받음 (오작동 방지)
    if (isDuplicate(rows, 'trigger_keyword', form.trigger_keyword, editing?.id)) {
      const ok = await confirm(
        `이미 "${form.trigger_keyword.trim()}" 키워드가 등록되어 있어요. 그래도 계속 저장할까요?`,
        { confirmLabel: '그래도 저장', danger: false }
      )
      if (!ok) return
    }

    if (editing) await updateRow(editing.id, form)
    else await insertRow(form)
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader
        title="CS 링크 관리"
        emoji="💬"
        description='댓글에 트리거 키워드가 오면 매칭된 링크를 답글로 보낼 매핑표 (발송은 반자동 - 사람 승인 후 진행)'
        onAddClick={openAdd}
        addLabel="링크 추가"
      />

      <div className="mb-4 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
        <p className="mb-1 text-xs font-bold text-ink/70">💬 인스타그램 댓글 자동 확인</p>
        <p className="mb-2 text-[11px] text-ink/40">
          이 컴퓨터에서만 동작해요. 버튼을 누르면 최근 게시물 댓글에서 위 키워드가 들어간 댓글을 찾아줘요.
          찾은 댓글마다 "답글 보내기"를 눌러야 실제로 답글이 나가요 (한 사람에게 같은 게시물에서는 한 번만 보내요).
        </p>
        <button
          type="button"
          onClick={handleScanComments}
          disabled={scanLoading}
          className="rounded-md bg-stamp-amber px-3 py-2 text-xs font-semibold text-white hover:bg-stamp-amber/90 disabled:opacity-50"
        >
          {scanLoading ? '확인 중...' : '🔍 댓글 확인하기'}
        </button>
        {scanMessage && (
          <p className={`mt-2 text-xs ${scanMessage.type === 'error' ? 'text-stamp-reject' : 'text-ink/60'}`}>
            {scanMessage.text}
          </p>
        )}

        {matches.length > 0 && (
          <div className="mt-3 space-y-2">
            {matches.map((m) => (
              <div key={matchKey(m)} className="rounded-lg bg-white p-3 shadow-card">
                <p className="text-xs font-semibold">
                  @{m.commenterUsername}{' '}
                  <span className="font-normal text-ink/40">· "{m.matchedKeyword}" 매칭</span>
                </p>
                <p className="mt-1 text-xs text-ink/60">{m.commentText}</p>
                <button
                  type="button"
                  onClick={() => handleReply(m)}
                  disabled={replyingKey === matchKey(m)}
                  className="mt-2 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/80 disabled:opacity-50"
                >
                  {replyingKey === matchKey(m) ? '보내는 중...' : '답글 보내기'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <LoadingView />}
      {error && <ErrorView message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyView />}

      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => openEdit(row)}
            className="block w-full rounded-xl bg-paper-card p-4 text-left shadow-card transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">"{row.trigger_keyword}"</span>
              <span
                className={`stamp-badge ${
                  row.active
                    ? 'border-stamp-pass text-stamp-pass bg-stamp-pass/5'
                    : 'border-stamp-pending text-stamp-pending bg-stamp-pending/5'
                }`}
              >
                {row.active ? '사용중' : '비활성'}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-ink/50">{row.target_url}</p>
            <p className="mt-1 text-xs text-ink/40">{row.category}</p>
          </button>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'CS 링크 수정' : 'CS 링크 추가'}>
        <form onSubmit={handleSave}>
          <FormField
            label="트리거 키워드"
            required
            hint='예: "핑크" — 글마다 다르게 지정 가능'
            value={form.trigger_keyword}
            onChange={(v) => setForm({ ...form, trigger_keyword: v })}
          />
          <FormField
            label="연결할 링크 (인포크 딥링크 or 프로필)"
            required
            error={formError?.includes('링크 형식')}
            hint="http(s)://로 시작해야 해요"
            value={form.target_url}
            onChange={(v) => setForm({ ...form, target_url: v })}
          />
          <FormField
            label="카테고리"
            type="select"
            options={CATEGORY_OPTIONS}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <FormField label="메모" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
          <FormField
            type="checkbox"
            label="현재 사용중인 링크"
            value={form.active}
            onChange={(v) => setForm({ ...form, active: v })}
          />

          {formError && <p className="mb-2 text-xs text-stamp-reject">{formError}</p>}

          <div className="mt-4 flex items-center justify-between">
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm('이 CS 링크를 삭제할까요? 휴지통으로 이동해요.')
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
