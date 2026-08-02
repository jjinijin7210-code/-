import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { createLocalStore } from '../lib/localStore'

let localStoreSingleton = null
function getLocalStore() {
  if (!localStoreSingleton && typeof window !== 'undefined') {
    localStoreSingleton = createLocalStore(window.localStorage)
  }
  return localStoreSingleton
}

export function useSupabaseTable(tableName, options = {}) {
  const { orderBy = 'created_at', ascending = false, select = '*' } = options
  const [useLocalFallback, setUseLocalFallback] = useState(!isSupabaseConfigured)

  const [rows, setRows] = useState([])
  const [trash, setTrash] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saveStatus, setSaveStatus] = useState('idle') // idle | saving | saved | error

  const sortRows = useCallback(
    (list) => {
      return [...list].sort((a, b) => {
        const av = a[orderBy]
        const bv = b[orderBy]
        if (av === bv) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return ascending ? (av > bv ? 1 : -1) : av < bv ? 1 : -1
      })
    },
    [orderBy, ascending]
  )

  const flashSaved = () => {
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 1500)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    if (useLocalFallback || !isSupabaseConfigured) {
      const store = getLocalStore()
      setRows(sortRows(store.getAll(tableName)))
      setTrash(store.getTrash(tableName))
      setLoading(false)
      return
    }

    try {
      const { data, error: err } = await supabase
        .from(tableName)
        .select(select)
        .order(orderBy, { ascending })

      if (err) {
        if (
          err.message?.includes('exceed_egress_quota') ||
          err.message?.includes('restricted') ||
          err.code === 'PGRST301'
        ) {
          console.warn(`[useSupabaseTable] ${tableName} Supabase 용량 차단 감지. 로컬 저장소로 자동 전환합니다.`)
          setUseLocalFallback(true)
          const store = getLocalStore()
          setRows(sortRows(store.getAll(tableName)))
          setTrash(store.getTrash(tableName))
        } else {
          setError(err.message)
          setRows([])
        }
      } else {
        setRows(data ?? [])
      }
    } catch (e) {
      setUseLocalFallback(true)
      const store = getLocalStore()
      setRows(sortRows(store.getAll(tableName)))
      setTrash(store.getTrash(tableName))
    }
    setLoading(false)
  }, [tableName, orderBy, ascending, useLocalFallback, sortRows, select])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const fetchOne = useCallback(
    async (id) => {
      if (useLocalFallback || !isSupabaseConfigured) {
        const store = getLocalStore()
        return store.getAll(tableName).find((r) => r.id === id) || null
      }
      try {
        const { data, error: err } = await supabase.from(tableName).select('*').eq('id', id).single()
        if (err) throw err
        return data
      } catch (e) {
        const store = getLocalStore()
        return store.getAll(tableName).find((r) => r.id === id) || null
      }
    },
    [tableName, useLocalFallback]
  )

  const insertRow = useCallback(
    async (values) => {
      setSaveStatus('saving')
      try {
        if (useLocalFallback || !isSupabaseConfigured) {
          const store = getLocalStore()
          const res = store.insert(tableName, values)
          if (!res.ok) throw new Error(res.error)
          setRows((prev) => sortRows([res.record, ...prev]))
          flashSaved()
          return res.record
        }
        const { data, error: err } = await supabase.from(tableName).insert(values).select()
        if (err) {
          if (err.message?.includes('exceed_egress_quota') || err.message?.includes('restricted')) {
            setUseLocalFallback(true)
            const store = getLocalStore()
            const res = store.insert(tableName, values)
            setRows((prev) => sortRows([res.record, ...prev]))
            flashSaved()
            return res.record
          }
          throw err
        }
        setRows((prev) => [...(data ?? []), ...prev])
        flashSaved()
        return data?.[0]
      } catch (e) {
        // Fallback to local
        const store = getLocalStore()
        const res = store.insert(tableName, values)
        setRows((prev) => sortRows([res.record, ...prev]))
        flashSaved()
        return res.record
      }
    },
    [tableName, useLocalFallback, sortRows]
  )

  const updateRow = useCallback(
    async (id, values) => {
      setSaveStatus('saving')
      try {
        if (useLocalFallback || !isSupabaseConfigured) {
          const store = getLocalStore()
          const res = store.update(tableName, id, values)
          if (!res.ok) throw new Error(res.error)
          setRows((prev) => sortRows(prev.map((r) => (r.id === id ? res.record : r))))
          flashSaved()
          return res.record
        }
        const { data, error: err } = await supabase.from(tableName).update(values).eq('id', id).select()
        if (err) {
          setUseLocalFallback(true)
          const store = getLocalStore()
          const res = store.update(tableName, id, values)
          setRows((prev) => sortRows(prev.map((r) => (r.id === id ? res.record : r))))
          flashSaved()
          return res.record
        }
        setRows((prev) => prev.map((r) => (r.id === id ? data?.[0] ?? r : r)))
        flashSaved()
        return data?.[0]
      } catch (e) {
        const store = getLocalStore()
        const res = store.update(tableName, id, values)
        setRows((prev) => sortRows(prev.map((r) => (r.id === id ? res.record : r))))
        flashSaved()
        return res.record
      }
    },
    [tableName, useLocalFallback, sortRows]
  )

  const deleteRow = useCallback(
    async (id) => {
      setSaveStatus('saving')
      try {
        if (useLocalFallback || !isSupabaseConfigured) {
          const store = getLocalStore()
          const res = store.softDelete(tableName, id)
          if (!res.ok) throw new Error(res.error)
          setRows((prev) => prev.filter((r) => r.id !== id))
          setTrash(store.getTrash(tableName))
          flashSaved()
          return
        }
        const { error: err } = await supabase.from(tableName).delete().eq('id', id)
        if (err) {
          setUseLocalFallback(true)
          const store = getLocalStore()
          store.softDelete(tableName, id)
          setRows((prev) => prev.filter((r) => r.id !== id))
          flashSaved()
          return
        }
        setRows((prev) => prev.filter((r) => r.id !== id))
        flashSaved()
      } catch (e) {
        const store = getLocalStore()
        store.softDelete(tableName, id)
        setRows((prev) => prev.filter((r) => r.id !== id))
        flashSaved()
      }
    },
    [tableName, useLocalFallback]
  )

  const restoreRow = useCallback(
    async (id) => {
      const store = getLocalStore()
      const res = store.restore(tableName, id)
      if (!res.ok) throw new Error(res.error)
      setRows(sortRows(store.getAll(tableName)))
      setTrash(store.getTrash(tableName))
    },
    [tableName, sortRows]
  )

  const permanentlyDeleteRow = useCallback(
    async (id) => {
      const store = getLocalStore()
      const res = store.permanentDelete(tableName, id)
      if (!res.ok) throw new Error(res.error)
      setTrash(store.getTrash(tableName))
    },
    [tableName]
  )

  return {
    rows,
    trash,
    loading,
    error,
    saveStatus,
    backend: useLocalFallback ? 'local' : 'supabase',
    refetch: fetchAll,
    fetchOne,
    insertRow,
    updateRow,
    deleteRow,
    restoreRow,
    permanentlyDeleteRow,
  }
}
