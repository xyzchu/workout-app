'use client'
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings, Search, Plus, Trash2, ChevronUp, ChevronDown,
  Copy, Clipboard, Play, Pause, SkipBack, SkipForward,
  Square, Download, Upload, X, ChevronLeft, ChevronRight,
  Minimize2, Maximize2, Edit3, Clock, LogOut, Check, Loader2
} from 'lucide-react'

const uid = () => Math.random().toString(36).slice(2, 11)
const mkDays = () =>
  Array.from({ length: 10 }, (_, i) => ({
    id: uid(),
    name: `Day ${i + 1}`,
    completed: false,
  }))
const mkEx = () => ({
  id: uid(),
  name: 'New Exercise',
  sets: [{ weight: '', reps: '', work: 30, rest: 60 }],
  note: '',
})
const mkSet = () => ({ weight: '', reps: '', work: 30, rest: 60 })
const isSS = (n) => n?.toLowerCase().includes('superset')
const fmt = (s) =>
  `${Math.floor(Math.max(0, s) / 60)}:${Math.floor(Math.max(0, s) % 60)
    .toString()
    .padStart(2, '0')}`

let _ac
const ac = () => {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)()
  return _ac
}
const beep = (f, d, t = 'sine', v = 0.3) => {
  try {
    const c = ac()
    const o = c.createOscillator()
    const g = c.createGain()
    o.connect(g)
    g.connect(c.destination)
    o.type = t
    o.frequency.value = f
    g.gain.value = v
    o.start()
    o.stop(c.currentTime + d)
  } catch (e) {
    /* silent */
  }
}

export default function WorkoutApp({ session }) {
  const [days, setDays] = useState(mkDays)
  const [sel, setSel] = useState(0)
  const [exMap, setExMap] = useState({})
  const [clip, setClip] = useState(null)
  const [sOpen, setSOpen] = useState(false)
  const [srchOpen, setSrchOpen] = useState(false)
  const [srchQ, setSrchQ] = useState('')
  const [editDay, setEditDay] = useState(null)
  const [editName, setEditName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tmr, setTmr] = useState({
    on: false, vis: false, phase: 'WORK', q: [], qi: 0,
    ps: 0, dur: 0, rem: 0, mini: false,
  })

  const tR = useRef(tmr)
  const iR = useRef(null)
  const ltR = useRef(-1)
  const fR = useRef(null)
  const loadedRef = useRef(false)
  const saveTimerRef = useRef(null)

  useEffect(() => { tR.current = tmr }, [tmr])
  useEffect(() => () => { if (iR.current) clearInterval(iR.current) }, [])

  // Load data from Supabase on mount
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('workout_data')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (data) {
        if (data.days && data.days.length > 0) setDays(data.days)
        if (data.exercises) setExMap(data.exercises)
        if (typeof data.selected_day === 'number') setSel(data.selected_day)
      }
      loadedRef.current = true
      setIsLoading(false)
    }
    load()
  }, [session.user.id])

  // Save data to Supabase on changes (debounced)
  useEffect(() => {
    if (!loadedRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      const { error } = await supabase.from('workout_data').upsert(
        {
          user_id: session.user.id,
          days,
          exercises: exMap,
          selected_day: sel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      setSaving(false)
      if (!error) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    }, 1500)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [days, exMap, sel, session.user.id])

  const logout = async () => {
    await supabase.auth.signOut()
  }

  const safeIdx = Math.min(sel, days.length - 1)
  const day = days[safeIdx]
  const did = day?.id
  const exs = exMap[did] || []
  const setExs = (fn) =>
    setExMap((m) => ({
      ...m,
      [did]: typeof fn === 'function' ? fn(m[did] || []) : fn,
    }))

  // Day operations
  const shiftD = (i, d) => {
    const j = i + d
    if (j < 0 || j >= days.length) return
    setDays((ds) => {
      const a = [...ds]
      ;[a[i], a[j]] = [a[j], a[i]]
      return a
    })
    setSel(j)
  }

  const dupD = (i) => {
    const s = days[i]
    const nd = { ...s, id: uid(), name: s.name + ' copy' }
    setDays((d) => [...d.slice(0, i + 1), nd, ...d.slice(i + 1)])
    setExMap((m) => ({
      ...m,
      [nd.id]: (m[s.id] || []).map((x) => ({
        ...x,
        id: uid(),
        sets: x.sets.map((st) => ({ ...st })),
      })),
    }))
    setSel(i + 1)
  }

  const delD = (i) => {
    if (days.length <= 1) return
    const id = days[i].id
    setDays((d) => d.filter((_, idx) => idx !== i))
    setExMap((m) => {
      const n = { ...m }
      delete n[id]
      return n
    })
    if (sel >= i && sel > 0) setSel((s) => s - 1)
  }

  const confirmRename = () => {
    if (editDay && editName.trim())
      setDays((d) =>
        d.map((x) => (x.id === editDay ? { ...x, name: editName.trim() } : x))
      )
    setEditDay(null)
  }

  // Exercise operations
  const addEx = () => setExs((a) => [...a, mkEx()])
  const delEx = (id) => setExs((a) => a.filter((e) => e.id !== id))
  const moveEx = (i, d) =>
    setExs((a) => {
      const j = i + d
      if (j < 0 || j >= a.length) return a
      const b = [...a]
      ;[b[i], b[j]] = [b[j], b[i]]
      return b
    })
  const cpEx = (ex) =>
    setClip({ ...ex, id: uid(), sets: ex.sets.map((s) => ({ ...s })) })
  const pasteEx = (ai) => {
    if (!clip) return
    setExs((a) => {
      const b = [...a]
      b.splice(ai + 1, 0, {
        ...clip,
        id: uid(),
        sets: clip.sets.map((s) => ({ ...s })),
      })
      return b
    })
  }
  const updName = (id, v) =>
    setExs((a) => a.map((e) => (e.id === id ? { ...e, name: v } : e)))
  const updNote = (id, v) =>
    setExs((a) => a.map((e) => (e.id === id ? { ...e, note: v } : e)))
  const addS = (id) =>
    setExs((a) =>
      a.map((e) => (e.id === id ? { ...e, sets: [...e.sets, mkSet()] } : e))
    )
  const rmS = (id, si) =>
    setExs((a) =>
      a.map((e) =>
        e.id === id
          ? { ...e, sets: e.sets.filter((_, i) => i !== si) }
          : e
      )
    )
  const updS = (id, si, f, v) =>
    setExs((a) =>
      a.map((e) =>
        e.id === id
          ? { ...e, sets: e.sets.map((s, i) => (i === si ? { ...s, [f]: v } : s)) }
          : e
      )
    )

  // Search
  const sRes = srchQ.trim()
    ? days.flatMap((d, di) =>
        (exMap[d.id] || [])
          .filter((e) =>
            e.name.toLowerCase().includes(srchQ.toLowerCase())
          )
          .map((e) => ({ ...e, dn: d.name, di }))
      )
    : []

  // Import / Export
  const doExp = () => {
    const blob = new Blob(
      [JSON.stringify({ days, selectedDayIndex: sel, exercises: exMap }, null, 2)],
      { type: 'application/json' }
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'workout.json'
    a.click()
  }

  const doImp = (ev) => {
    const f = ev.target.files[0]
    if (!f) return
    const r = new FileReader()
    r.onload = (e) => {
      try {
        const d = JSON.parse(e.target.result)
        if (d.days) setDays(d.days)
        if (d.exercises) setExMap(d.exercises)
        if (typeof d.selectedDayIndex === 'number') setSel(d.selectedDayIndex)
      } catch (err) {
        /* silent */
      }
    }
    r.readAsText(f)
    ev.target.value = ''
  }

  // Timer
  const buildQ = () => {
    const ex = exMap[did] || []
    const q = []
    let i = 0
    while (i < ex.length) {
      if (isSS(ex[i].name)) {
        const g = []
        while (i < ex.length && isSS(ex[i].name)) {
          g.push(ex[i])
          i++
        }
        const mx = Math.max(...g.map((e) => e.sets.length))
        for (let s = 0; s < mx; s++)
          for (const e of g)
            if (s < e.sets.length)
              q.push({
                nm: e.name,
                sn: s + 1,
                ts: e.sets.length,
                w: Number(e.sets[s].work) || 30,
                r: Number(e.sets[s].rest) || 60,
              })
      } else {
        const e = ex[i]
        e.sets.forEach((s, si) =>
          q.push({
            nm: e.name,
            sn: si + 1,
            ts: e.sets.length,
            w: Number(s.work) || 30,
            r: Number(s.rest) || 60,
          })
        )
        i++
      }
    }
    return q
  }

  const tick = () => {
    const t = tR.current
    if (!t.on) return
    const el = (Date.now() - t.ps) / 1000
    const rem = t.dur - el
    const rs = Math.ceil(rem)
    if (rs <= 3 && rs > 0 && rs !== ltR.current) {
      ltR.current = rs
      beep(800, 0.08)
    }
    if (rem <= 0) {
      if (t.phase === 'WORK') {
        beep(1200, 0.3)
        const rd = t.q[t.qi].r
        const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }
        setTmr(n)
        tR.current = n
        ltR.current = -1
      } else {
        beep(600, 0.5, 'square')
        const ni = t.qi + 1
        if (ni >= t.q.length) {
          stopT()
        } else {
          const wd = t.q[ni].w
          const n = {
            ...t,
            phase: 'WORK',
            qi: ni,
            ps: Date.now(),
            dur: wd,
            rem: wd,
          }
          setTmr(n)
          tR.current = n
          ltR.current = -1
        }
      }
    } else {
      setTmr((p) => ({ ...p, rem: Math.max(0, rem) }))
    }
  }

  const startT = () => {
    const q = buildQ()
    if (!q.length) return
    if (iR.current) clearInterval(iR.current)
    const n = {
      on: true, vis: true, phase: 'WORK', q, qi: 0,
      ps: Date.now(), dur: q[0].w, rem: q[0].w, mini: false,
    }
    setTmr(n)
    tR.current = n
    ltR.current = -1
    iR.current = setInterval(tick, 100)
  }

  const toggleP = () =>
    setTmr((p) => {
      let n
      if (p.on) {
        const rem = p.dur - (Date.now() - p.ps) / 1000
        n = { ...p, on: false, rem: Math.max(0, rem) }
      } else {
        n = { ...p, on: true, ps: Date.now() - (p.dur - p.rem) * 1000 }
      }
      tR.current = n
      return n
    })

  const nextPh = () => {
    const t = tR.current
    if (t.phase === 'WORK') {
      const rd = t.q[t.qi].r
      const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }
      setTmr(n)
      tR.current = n
    } else {
      const ni = t.qi + 1
      if (ni >= t.q.length) stopT()
      else {
        const wd = t.q[ni].w
        const n = {
          ...t,
          phase: 'WORK',
          qi: ni,
          ps: Date.now(),
          dur: wd,
          rem: wd,
        }
        setTmr(n)
        tR.current = n
      }
    }
    ltR.current = -1
  }

  const prevPh = () => {
    const t = tR.current
    if (t.phase === 'REST') {
      const wd = t.q[t.qi].w
      const n = { ...t, phase: 'WORK', ps: Date.now(), dur: wd, rem: wd }
      setTmr(n)
      tR.current = n
    } else {
      const pi = t.qi - 1
      if (pi < 0) {
        const wd = t.q[0].w
        const n = { ...t, ps: Date.now(), dur: wd, rem: wd }
        setTmr(n)
        tR.current = n
      } else {
        const rd = t.q[pi].r
        const n = {
          ...t,
          phase: 'REST',
          qi: pi,
          ps: Date.now(),
          dur: rd,
          rem: rd,
        }
        setTmr(n)
        tR.current = n
      }
    }
    ltR.current = -1
  }

  const stopT = () => {
    if (iR.current) {
      clearInterval(iR.current)
      iR.current = null
    }
    const n = {
      on: false, vis: false, phase: 'WORK', q: [], qi: 0,
      ps: 0, dur: 0, rem: 0, mini: false,
    }
    setTmr(n)
    tR.current = n
  }

  const curQ = tmr.q[tmr.qi]
  const pct = tmr.dur > 0 ? ((tmr.dur - tmr.rem) / tmr.dur) * 100 : 0

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Loading your workouts...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSOpen((s) => !s)}
            className={`p-2 rounded-lg transition-colors ${
              sOpen
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            <Settings size={20} />
          </button>
          <h1 className="text-lg font-bold tracking-tight">Workout</h1>
          {clip && (
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
              Copied
            </span>
          )}
          {saving && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Saving
            </span>
          )}
          {saved && !saving && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setSrchOpen(true)
              setSrchQ('')
            }}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700"
          >
            <Search size={18} />
          </button>
          <button
            onClick={doExp}
            title="Export"
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700"
          >
            <Download size={18} />
          </button>
          <button
            onClick={() => fR.current?.click()}
            title="Import"
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700"
          >
            <Upload size={18} />
          </button>
          <input
            ref={fR}
            type="file"
            accept=".json"
            className="hidden"
            onChange={doImp}
          />
          <button
            onClick={logout}
            title="Sign out"
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:bg-red-500/20 hover:text-red-400"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Day Tabs */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="flex gap-1.5 overflow-x-auto px-3 py-2">
          {days.map((d, i) => (
            <div key={d.id} className="flex-shrink-0">
              {editDay === d.id ? (
                <input
                  autoFocus
                  className="px-3 py-1.5 rounded-lg bg-gray-700 text-white text-sm w-28 outline-none ring-2 ring-blue-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmRename()
                    if (e.key === 'Escape') setEditDay(null)
                  }}
                  onBlur={confirmRename}
                />
              ) : (
                <button
                  onClick={() => setSel(i)}
                  onDoubleClick={() =>
                    setDays((ds) =>
                      ds.map((x) =>
                        x.id === d.id
                          ? { ...x, completed: !x.completed }
                          : x
                      )
                    )
                  }
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                    i === safeIdx
                      ? d.completed
                        ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                        : 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                      : d.completed
                      ? 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {d.name}
                </button>
              )}
            </div>
          ))}
          {sOpen && (
            <button
              onClick={() => {
                setDays((d) => [
                  ...d,
                  {
                    id: uid(),
                    name: `Day ${days.length + 1}`,
                    completed: false,
                  },
                ])
                setSel(days.length)
              }}
              className="flex-shrink-0 p-1.5 rounded-lg bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-white"
            >
              <Plus size={16} />
            </button>
          )}
        </div>

        {/* Day Action Bar */}
        {sOpen && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-800/50 overflow-x-auto">
            <span className="text-xs text-gray-500 mr-1 whitespace-nowrap">
              {day?.name}:
            </span>
            <button
              onClick={() => {
                setEditDay(did)
                setEditName(day.name)
              }}
              className="px-2 py-1 text-xs bg-gray-800 rounded-md hover:bg-gray-700 whitespace-nowrap flex items-center gap-1 text-gray-300"
            >
              <Edit3 size={11} /> Rename
            </button>
            <button
              onClick={() => shiftD(safeIdx, -1)}
              disabled={safeIdx === 0}
              className="px-2 py-1 text-xs bg-gray-800 rounded-md hover:bg-gray-700 disabled:opacity-25 whitespace-nowrap flex items-center gap-1 text-gray-300"
            >
              <ChevronLeft size={11} /> Move
            </button>
            <button
              onClick={() => shiftD(safeIdx, 1)}
              disabled={safeIdx === days.length - 1}
              className="px-2 py-1 text-xs bg-gray-800 rounded-md hover:bg-gray-700 disabled:opacity-25 whitespace-nowrap flex items-center gap-1 text-gray-300"
            >
              Move <ChevronRight size={11} />
            </button>
            <button
              onClick={() => dupD(safeIdx)}
              className="px-2 py-1 text-xs bg-gray-800 rounded-md hover:bg-gray-700 whitespace-nowrap flex items-center gap-1 text-gray-300"
            >
              <Copy size={11} /> Duplicate
            </button>
            <button
              onClick={() => delD(safeIdx)}
              disabled={days.length <= 1}
              className="px-2 py-1 text-xs bg-red-500/15 text-red-400 rounded-md hover:bg-red-500/25 disabled:opacity-25 whitespace-nowrap flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Exercise List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 pb-36">
        {exs.length === 0 ? (
          <div className="text-center text-gray-600 py-20">
            <Clock size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium text-gray-500">
              No exercises yet
            </p>
            {sOpen && (
              <p className="text-sm mt-1 text-gray-600">
                Tap the button below to add one
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {exs.map((ex, xi) => (
              <div
                key={ex.id}
                className={`bg-gray-900 rounded-xl border border-gray-800 overflow-hidden transition-all ${
                  isSS(ex.name)
                    ? 'ml-5 border-l-4 border-l-purple-500'
                    : ''
                }`}
              >
                {/* Exercise Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  {sOpen ? (
                    <input
                      className="bg-transparent text-white font-semibold outline-none flex-1 mr-2 placeholder-gray-600"
                      value={ex.name}
                      onChange={(e) => updName(ex.id, e.target.value)}
                      placeholder="Exercise name"
                    />
                  ) : (
                    <h3 className="font-semibold flex-1 text-white">
                      {ex.name}
                    </h3>
                  )}
                  {sOpen && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => moveEx(xi, -1)}
                        disabled={xi === 0}
                        className="p-1.5 text-gray-500 hover:text-white disabled:opacity-20 rounded-md hover:bg-gray-800"
                      >
                        <ChevronUp size={15} />
                      </button>
                      <button
                        onClick={() => moveEx(xi, 1)}
                        disabled={xi === exs.length - 1}
                        className="p-1.5 text-gray-500 hover:text-white disabled:opacity-20 rounded-md hover:bg-gray-800"
                      >
                        <ChevronDown size={15} />
                      </button>
                      <button
                        onClick={() => cpEx(ex)}
                        className="p-1.5 text-gray-500 hover:text-blue-400 rounded-md hover:bg-gray-800"
                      >
                        <Copy size={13} />
                      </button>
                      {clip && (
                        <button
                          onClick={() => pasteEx(xi)}
                          className="p-1.5 text-gray-500 hover:text-green-400 rounded-md hover:bg-gray-800"
                        >
                          <Clipboard size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => delEx(ex.id)}
                        className="p-1.5 text-gray-500 hover:text-red-400 rounded-md hover:bg-gray-800"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Sets Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs border-t border-gray-800">
                        <th className="px-3 py-2 text-left w-8">#</th>
                        <th className="px-2 py-2 text-left">Weight</th>
                        <th className="px-2 py-2 text-left">Reps</th>
                        <th className="px-2 py-2 text-left">Work(s)</th>
                        <th className="px-2 py-2 text-left">Rest(s)</th>
                        {sOpen && <th className="w-8"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {ex.sets.map((s, si) => (
                        <tr key={si} className="border-t border-gray-800/50">
                          <td className="px-3 py-1.5 text-gray-600 text-xs font-medium">
                            {si + 1}
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-gray-800 rounded px-2 py-1 w-16 text-white outline-none text-sm focus:ring-1 focus:ring-blue-500"
                              value={s.weight}
                              onChange={(e) =>
                                updS(ex.id, si, 'weight', e.target.value)
                              }
                              placeholder="—"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-gray-800 rounded px-2 py-1 w-16 text-white outline-none text-sm focus:ring-1 focus:ring-blue-500"
                              value={s.reps}
                              onChange={(e) =>
                                updS(ex.id, si, 'reps', e.target.value)
                              }
                              placeholder="—"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-gray-800 rounded px-2 py-1 w-14 text-white outline-none text-sm focus:ring-1 focus:ring-blue-500"
                              value={s.work}
                              onChange={(e) =>
                                updS(ex.id, si, 'work', e.target.value)
                              }
                              placeholder="30"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-gray-800 rounded px-2 py-1 w-14 text-white outline-none text-sm focus:ring-1 focus:ring-blue-500"
                              value={s.rest}
                              onChange={(e) =>
                                updS(ex.id, si, 'rest', e.target.value)
                              }
                              placeholder="60"
                            />
                          </td>
                          {sOpen && (
                            <td className="px-1">
                              <button
                                onClick={() => rmS(ex.id, si)}
                                disabled={ex.sets.length <= 1}
                                className="p-1 text-gray-600 hover:text-red-400 disabled:opacity-20"
                              >
                                <X size={13} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {sOpen && (
                  <button
                    onClick={() => addS(ex.id)}
                    className="w-full py-2 text-xs text-gray-500 hover:text-blue-400 hover:bg-gray-800/50 border-t border-gray-800 transition-colors"
                  >
                    + Add Set
                  </button>
                )}

                {(sOpen || ex.note) && (
                  <div className="px-4 py-2 border-t border-gray-800">
                    {sOpen ? (
                      <textarea
                        className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 outline-none resize-none focus:ring-1 focus:ring-blue-500"
                        rows={2}
                        placeholder="Add a note..."
                        value={ex.note}
                        onChange={(e) => updNote(ex.id, e.target.value)}
                      />
                    ) : (
                      ex.note && (
                        <p className="text-sm text-gray-500 italic">
                          {ex.note}
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {sOpen && (
          <button
            onClick={addEx}
            className="mt-4 w-full py-3.5 rounded-xl border-2 border-dashed border-gray-800 text-gray-500 hover:border-blue-500/40 hover:text-blue-400 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
          >
            <Plus size={18} /> Add Exercise
          </button>
        )}
      </div>

      {/* Timer FAB */}
      {!tmr.vis && (
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={startT}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center hover:bg-blue-500 z-20"
        >
          <Play size={22} className="ml-0.5" />
        </motion.button>
      )}

      {/* Timer Panel */}
      <AnimatePresence>
        {tmr.vis && (
          <motion.div
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-40"
          >
            {tmr.mini ? (
              <div
                onClick={() => {
                  setTmr((p) => {
                    const n = { ...p, mini: false }
                    tR.current = n
                    return n
                  })
                }}
                className={`mx-3 mb-3 rounded-2xl px-4 py-3 flex items-center justify-between cursor-pointer shadow-2xl ${
                  tmr.phase === 'WORK' ? 'bg-green-600' : 'bg-amber-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold uppercase opacity-75">
                    {tmr.phase}
                  </span>
                  <span className="font-mono font-bold text-xl">
                    {fmt(tmr.rem)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm opacity-80">
                  <span className="truncate max-w-28">{curQ?.nm}</span>
                  <Maximize2 size={16} />
                </div>
              </div>
            ) : (
              <div
                className={`mx-2 mb-2 rounded-2xl shadow-2xl border border-white/10 overflow-hidden ${
                  tmr.phase === 'WORK' ? 'bg-green-900' : 'bg-amber-900'
                }`}
              >
                <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/10">
                  <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                    {tmr.phase === 'WORK' ? '💪 WORK' : '😮‍💨 REST'}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setTmr((p) => {
                          const n = { ...p, mini: true }
                          tR.current = n
                          return n
                        })
                      }}
                      className="p-1.5 rounded-lg opacity-60 hover:opacity-100 hover:bg-white/10"
                    >
                      <Minimize2 size={16} />
                    </button>
                    <button
                      onClick={stopT}
                      className="p-1.5 rounded-lg opacity-60 hover:opacity-100 hover:bg-white/10"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <div className="px-4 pt-5 pb-3 text-center">
                  <p className="text-sm opacity-60 mb-2">
                    {curQ?.nm} — Set {curQ?.sn} of {curQ?.ts}
                  </p>
                  <p className="text-6xl font-mono font-bold tracking-wider">
                    {fmt(tmr.rem)}
                  </p>
                  <p className="text-xs opacity-40 mt-2">
                    {tmr.qi + 1} of {tmr.q.length} total
                  </p>
                </div>
                <div className="px-6 pb-3">
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/40 rounded-full transition-all duration-150"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3 pb-5 pt-1">
                  <button
                    onClick={prevPh}
                    className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    <SkipBack size={20} />
                  </button>
                  <button
                    onClick={toggleP}
                    className="p-4 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                  >
                    {tmr.on ? <Pause size={28} /> : <Play size={28} />}
                  </button>
                  <button
                    onClick={nextPh}
                    className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    <SkipForward size={20} />
                  </button>
                  <button
                    onClick={stopT}
                    className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    <Square size={18} />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search Modal */}
      <AnimatePresence>
        {srchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex flex-col"
          >
            <div className="bg-gray-900 border-b border-gray-800 p-4 flex items-center gap-3">
              <Search size={20} className="text-gray-500 flex-shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-white outline-none text-lg placeholder-gray-600"
                placeholder="Search exercises..."
                value={srchQ}
                onChange={(e) => setSrchQ(e.target.value)}
              />
              <button
                onClick={() => setSrchOpen(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {!srchQ.trim() && (
                <p className="text-gray-600 text-center py-16">
                  Type to search across all days
                </p>
              )}
              {srchQ.trim() && sRes.length === 0 && (
                <p className="text-gray-600 text-center py-16">
                  No matching exercises
                </p>
              )}
              <div className="space-y-1">
                {sRes.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSel(r.di)
                      setSrchOpen(false)
                    }}
                    className="w-full text-left p-3 rounded-xl hover:bg-gray-800/80 transition-colors"
                  >
                    <p className="text-white font-medium">{r.name}</p>
                    <p className="text-gray-500 text-sm mt-0.5">{r.dn}</p>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}