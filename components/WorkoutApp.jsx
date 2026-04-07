'use client'
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const uid = () => Math.random().toString(36).slice(2, 11)
const mkDays = () => {
  const d1 = { id: uid(), name: 'Push Day', completed: false }
  const d2 = { id: uid(), name: 'Pull Day', completed: false }
  const d3 = { id: uid(), name: 'Leg Day', completed: false }
  return [d1, d2, d3]
}

const sampleExercises = (days, defaultWork = 60, defaultRest = 120) => {
  const s = (w, r, reps) => ({ weight: w, reps: reps || '', work: defaultWork, rest: defaultRest })
  return {
    [days[0].id]: [
      { id: uid(), name: 'Bench Press', sets: [s('60', '10'), s('80', '8'), s('80', '8')], note: '' },
      { id: uid(), name: 'Overhead Press', sets: [s('40', '10'), s('40', '10'), s('40', '10')], note: '' },
      { id: uid(), name: 'Tricep Pushdown', sets: [s('20', '12'), s('20', '12'), s('20', '12')], note: '' },
    ],
    [days[1].id]: [
      { id: uid(), name: 'Barbell Row', sets: [s('60', '10'), s('60', '10'), s('60', '10')], note: '' },
      { id: uid(), name: 'Lat Pulldown', sets: [s('50', '10'), s('50', '10'), s('50', '10')], note: '' },
      { id: uid(), name: 'Bicep Curl', sets: [s('12', '12'), s('12', '12'), s('12', '12')], note: '' },
    ],
    [days[2].id]: [
      { id: uid(), name: 'Squat', sets: [s('80', '8'), s('100', '6'), s('100', '6')], note: '' },
      { id: uid(), name: 'Romanian Deadlift', sets: [s('60', '10'), s('60', '10'), s('60', '10')], note: '' },
      { id: uid(), name: 'Calf Raises', sets: [s('40', '15'), s('40', '15'), s('40', '15')], note: '' },
    ],
  }
}
const isSS = (n) => n?.toLowerCase().includes('superset')
const pad2 = (n) => String(n).padStart(2, '0')
const fmt = (s) => `${pad2(Math.floor(Math.max(0, s) / 60))}:${pad2(Math.floor(Math.max(0, s) % 60))}`

// Fast-forwards timer state through any phases that elapsed while app was
// backgrounded or the page was reloaded. Returns null if the queue is finished.
const advanceTimerState = (t) => {
  let { phase, qi, ps, dur, q } = t
  const now = Date.now()
  while (true) {
    const rem = dur - (now - ps) / 1000
    if (rem > 0) return { ...t, phase, qi, ps, dur, rem }
    if (phase === 'WORK') {
      ps = ps + Math.round(dur * 1000)
      dur = q[qi].r
      phase = 'REST'
    } else {
      const ni = qi + 1
      if (ni >= q.length) return null
      ps = ps + Math.round(dur * 1000)
      qi = ni; dur = q[qi].w; phase = 'WORK'
    }
  }
}

let _ac
const ac = () => { if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)(); return _ac }
const beep = (f, d, t = 'sine', v = 0.3) => {
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain()
    o.connect(g); g.connect(c.destination); o.type = t; o.frequency.value = f; g.gain.value = v
    o.start(); o.stop(c.currentTime + d)
  } catch {}
}

const mono = '"SF Mono","Fira Code","Cascadia Code","Consolas","Liberation Mono",monospace'
const B = 'text-[14px]'
const gridCols = '44px 1fr 1fr 1fr 1fr 32px'
const WORK_BG = '#1a4d2e'
const REST_BG = '#3d2066'

const defaultSettings = { defaultWork: 60, defaultRest: 120, haUrl: '', haToken: '' }

export default function WorkoutApp({ session }) {
  const [days, setDays] = useState(mkDays)
  const [sel, setSel] = useState(0)
  const [exMap, setExMap] = useState({})
  const [showTools, setShowTools] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [editDay, setEditDay] = useState(null)
  const [editName, setEditName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [settings, setSettings] = useState(defaultSettings)
  const [clipDay, setClipDay] = useState(null)
  const [clipEx, setClipEx] = useState(null)
  const [tmr, setTmr] = useState({ on: false, vis: false, phase: 'WORK', q: [], qi: 0, ps: 0, dur: 0, rem: 0 })
  const [tmrDayId, setTmrDayId] = useState(null)
  const [confirmDlg, setConfirmDlg] = useState(null)
  const [haStatus, setHaStatus] = useState('')
  const [toast, setToast] = useState('')

  const mkSet = () => ({ weight: '', reps: '', work: settings.defaultWork, rest: settings.defaultRest })
  const mkEx = () => ({ id: uid(), name: 'New Exercise', sets: [mkSet()], note: '' })

  const tR = useRef(tmr)
  const iR = useRef(null)
  const ltR = useRef(-1)
  const loadedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const fileRef = useRef(null)
  const dayScrollRef = useRef(null)
  const dayBtnRefs = useRef([])
  const prevEiRef = useRef(-1)
  const settingsRef = useRef(settings)
  const dayNameRef = useRef('')

  const scrollDays = (dir) => {
    dayScrollRef.current?.scrollBy({ left: dir * 150, behavior: 'smooth' })
  }

  useEffect(() => { tR.current = tmr }, [tmr])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => () => { if (iR.current) clearInterval(iR.current) }, [])

  // Scroll selected day tab into view
  useEffect(() => {
    if (isLoading) return
    const container = dayScrollRef.current
    const btn = dayBtnRefs.current[safeIdx]
    if (!container || !btn) return
    const cr = container.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    container.scrollTo({ left: container.scrollLeft + br.left - cr.left - cr.width / 2 + br.width / 2, behavior: 'smooth' })
  }, [safeIdx, isLoading])

  // Persist timer state across reloads
  useEffect(() => {
    if (!loadedRef.current) return // don't touch localStorage before data is loaded
    if (!tmr.vis) { localStorage.removeItem('workout_timer'); return }
    localStorage.setItem('workout_timer', JSON.stringify({ tmr, tmrDayId }))
  }, [tmr, tmrDayId])

  // Restore timer after user data has loaded
  useEffect(() => {
    if (isLoading) return
    try {
      const saved = localStorage.getItem('workout_timer')
      if (!saved) return
      const { tmr: st, tmrDayId: sdid } = JSON.parse(saved)
      if (!st?.vis || !st?.q?.length) return
      const restored = st.on ? advanceTimerState(st) : st
      if (!restored) { localStorage.removeItem('workout_timer'); return }
      setTmr(restored); tR.current = restored
      setTmrDayId(sdid)
      if (restored.on) {
        if (iR.current) clearInterval(iR.current)
        iR.current = setInterval(tick, 100)
      }
    } catch { localStorage.removeItem('workout_timer') }
  }, [isLoading]) // eslint-disable-line

  useEffect(() => {
    const handler = (e) => {
      if (!tR.current.vis) return
      if (e.key === 'ArrowDown') { e.preventDefault(); nextT() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // eslint-disable-line

  // When returning from background: fast-forward timer and re-sync HA
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== 'visible' || !tR.current.on) return
      const advanced = advanceTimerState(tR.current)
      if (!advanced) { stopTInner(); return }
      setTmr(advanced); tR.current = advanced
      pushHA(advanced.phase, advanced.rem, advanced.q[advanced.qi])
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, []) // eslint-disable-line

  const safeIdx = Math.min(sel, days.length - 1)
  const day = days[safeIdx]
  const did = day?.id

  useEffect(() => { dayNameRef.current = day?.name || '' }, [day?.name])

  /* ── Home Assistant Push ── */
  const pushHA = (phase, duration, qItem, extra = {}) => {
    const s = settingsRef.current
    if (!s.haUrl || !s.haToken) return

    const entities = [
      {
          entity_id: 'sensor.workout_exercise',
          state: qItem?.nm || 'idle',
          attributes: {
            friendly_name: 'Current Exercise',
            exercise_number: qItem?.ei != null ? qItem.ei + 1 : 0,
            total_exercises: qItem?.te || 0,
            set_number: qItem?.sn || 0,
            total_sets: qItem?.ts || 0,
            day: dayNameRef.current,
            icon: 'mdi:dumbbell',
          },
      },
      {
        entity_id: 'sensor.workout_phase',
        state: phase,
        attributes: {
          friendly_name: 'Workout Phase',
          duration: Math.ceil(duration),
          work_time: qItem?.w || 0,
          rest_time: qItem?.r || 0,
          started_at: new Date().toISOString(),
          ...extra,
          icon: phase === 'WORK' ? 'mdi:run' : phase === 'REST' ? 'mdi:seat' : phase === 'PAUSED' ? 'mdi:pause' : 'mdi:stop',
        },
      },
    ]

    fetch('/api/ha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: s.haUrl, token: s.haToken, entities }),
    }).catch(() => {})
  }

  const testHA = async () => {
    if (!settings.haUrl || !settings.haToken) return
    setHaStatus('testing')
    try {
      const res = await fetch('/api/ha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: settings.haUrl,
          token: settings.haToken,
          entities: [{
            entity_id: 'sensor.workout_phase',
            state: 'TEST',
            attributes: {
              friendly_name: 'Workout Phase',
              duration: 0,
              work_time: 0,
              rest_time: 0,
              started_at: new Date().toISOString(),
              icon: 'mdi:check',
            },
          }],
        }),
      })
      const data = await res.json()
      setHaStatus(data.ok ? 'ok' : 'fail')
    } catch {
      setHaStatus('fail')
    }
    setTimeout(() => setHaStatus(''), 3000)
  }

  /* Auto-scroll to current exercise card */
  useEffect(() => {
    if (tmr.vis && tmr.q[tmr.qi]) {
      const newEi = tmr.q[tmr.qi].ei
      if (newEi !== prevEiRef.current) {
        prevEiRef.current = newEi
        setTimeout(() => {
          const el = document.getElementById(`ex-card-${newEi}`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 150)
      }
    } else {
      prevEiRef.current = -1
    }
  }, [tmr.qi, tmr.vis])

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('workout_data').select('*').eq('user_id', session.user.id).maybeSingle()
      if (data) {
        if (data.days?.length > 0) {
          setDays(data.days)
          if (data.exercises) setExMap(data.exercises)
        } else {
          // New user — load sample data
          const sampleDays = mkDays()
          setDays(sampleDays)
          setExMap(sampleExercises(sampleDays, settings.defaultWork, settings.defaultRest))
        }
        if (typeof data.selected_day === 'number') setSel(data.selected_day)
        if (data.settings) setSettings((prev) => ({ ...prev, ...data.settings }))
      }
      loadedRef.current = true
      setIsLoading(false)
    }
    load()
  }, [session.user.id])

  useEffect(() => {
    if (!loadedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true)
      const { error } = await supabase.from('workout_data').upsert(
        { user_id: session.user.id, days, exercises: exMap, selected_day: sel, settings, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      setSaving(false)
      if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    }, 1500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [days, exMap, sel, settings, session.user.id])

  const ask = (msg, fn) => setConfirmDlg({ msg, fn })
  const doConfirm = () => { confirmDlg?.fn(); setConfirmDlg(null) }

  const exs = exMap[did] || []
  const setExs = (fn) => setExMap((m) => ({ ...m, [did]: typeof fn === 'function' ? fn(m[did] || []) : fn }))

  const addDay = () => { setDays((d) => [...d, { id: uid(), name: `Day ${d.length + 1}`, completed: false }]); setSel(days.length) }
  const toggleDone = () => setDays((d) => {
  const updated = d.map((x, i) => (i === safeIdx ? { ...x, completed: !x.completed } : x))
    if (updated.every((x) => x.completed)) {
      setToast('All Days Completed! Mark Done will be Reset')
      setTimeout(() => setToast(''), 3000)
      return updated.map((x) => ({ ...x, completed: false }))
    }
    return updated
  })
  const delDay = () => {
    if (days.length <= 1) return
    const id = days[safeIdx].id
    setDays((d) => d.filter((_, i) => i !== safeIdx))
    setExMap((m) => { const n = { ...m }; delete n[id]; return n })
    if (sel >= safeIdx && sel > 0) setSel((s) => s - 1)
    if (tmrDayId === id) stopTInner()
  }
  const delDayConfirm = () => { if (days.length <= 1) return; ask('Delete this day and all its exercises?', delDay) }
  const resetDay = () => { if (!did) return; setExMap((m) => ({ ...m, [did]: [] })); setDays((d) => d.map((x, i) => (i === safeIdx ? { ...x, completed: false } : x))) }
  const resetDayConfirm = () => ask('Reset all exercises for this day?', resetDay)
  const copyDay = () => setClipDay(JSON.parse(JSON.stringify(exs)))
  const pasteDay = () => { if (!clipDay || !did) return; setExs((a) => [...a, ...clipDay.map((e) => ({ ...e, id: uid() }))]) }
  const saveRename = () => {
    if (editDay !== null && editName.trim()) setDays((d) => d.map((x) => (x.id === editDay ? { ...x, name: editName.trim() } : x)))
    setEditDay(null)
  }

  const addEx = () => setExs((a) => [...a, mkEx()])
  const delEx = (idx) => setExs((a) => a.filter((_, i) => i !== idx))
  const delExConfirm = (idx) => ask('Delete this exercise?', () => delEx(idx))
  const moveEx = (i, d) => setExs((a) => { const j = i + d; if (j < 0 || j >= a.length) return a; const b = [...a]; [b[i], b[j]] = [b[j], b[i]]; return b })
  const updEx = (idx, f, v) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, [f]: v } : e)))
  const copyEx = (idx) => setClipEx(JSON.parse(JSON.stringify(exs[idx])))
  const pasteExAt = (idx) => { if (!clipEx) return; setExs((a) => { const b = [...a]; b.splice(idx, 0, { ...JSON.parse(JSON.stringify(clipEx)), id: uid() }); return b }) }
  const pasteExEnd = () => { if (!clipEx) return; setExs((a) => [...a, { ...JSON.parse(JSON.stringify(clipEx)), id: uid() }]) }

  const addSet = (idx) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: [...e.sets, mkSet()] } : e)))
  const delSet = (idx, si) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)))
  const delSetConfirm = (idx, si) => ask('Delete this set?', () => delSet(idx, si))
  const updSet = (idx, si, f, v) => setExs((a) => a.map((e, i) => (i === idx ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, [f]: v } : s)) } : e)))

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ days, exercises: exMap, settings }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `workout-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }
  const importData = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = (ev) => { try { const d = JSON.parse(ev.target.result); if (d.days) setDays(d.days); if (d.exercises) setExMap(d.exercises); if (d.settings) setSettings((p) => ({ ...p, ...d.settings })); setSel(0) } catch {} }
    r.readAsText(file); e.target.value = ''
  }

  const searchResults = searchQ.trim()
    ? days.flatMap((d, di) => (exMap[d.id] || []).filter((e) => e.name.toLowerCase().includes(searchQ.toLowerCase())).map((e) => ({ exName: e.name, dayName: d.name, dayIdx: di })))
    : []

  /* ── Timer ── */
  const buildQ = () => {
    const ex = exMap[did] || []; const q = []
    for (let i = 0; i < ex.length; i++) {
      if (isSS(ex[i].name)) continue
      const e = ex[i]
      e.sets.forEach((s, si) => q.push({ nm: e.name, ei: i, sn: si + 1, ts: e.sets.length, te: ex.length, w: Number(s.work) || 30, r: Number(s.rest) || 60 }))
    }
    return q
  }

  const tick = () => {
    const t = tR.current; if (!t.on) return
    const el = (Date.now() - t.ps) / 1000, rem = t.dur - el, rs = Math.ceil(rem)
    if (rs <= 3 && rs > 0 && rs !== ltR.current) { ltR.current = rs; beep(800, 0.08) }
    if (rem <= 0) {
      if (t.phase === 'WORK') {
        beep(1200, 0.3)
        const rd = t.q[t.qi].r
        const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }
        setTmr(n); tR.current = n; ltR.current = -1
        pushHA('REST', rd, t.q[t.qi])
      } else {
        beep(600, 0.5, 'square')
        const ni = t.qi + 1
        if (ni >= t.q.length) stopTInner()
        else {
          const wd = t.q[ni].w
          const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }
          setTmr(n); tR.current = n; ltR.current = -1
          pushHA('WORK', wd, t.q[ni])
        }
      }
    } else setTmr((p) => ({ ...p, rem: Math.max(0, rem) }))
  }

  const startT = () => {
    const q = buildQ(); if (!q.length) return
    if (iR.current) clearInterval(iR.current)
    const n = { on: true, vis: true, phase: 'WORK', q, qi: 0, ps: Date.now(), dur: q[0].w, rem: q[0].w }
    setTmr(n); tR.current = n; ltR.current = -1; prevEiRef.current = -1
    iR.current = setInterval(tick, 100)
    setTmrDayId(did)
    pushHA('WORK', q[0].w, q[0])
  }

  const pauseT = () => {
    const p = tR.current
    let n
    if (p.on) {
      const rem = Math.max(0, p.dur - (Date.now() - p.ps) / 1000)
      n = { ...p, on: false, rem }
      pushHA('PAUSED', 0, p.q[p.qi], { remaining: Math.ceil(rem) })
    } else {
      n = { ...p, on: true, ps: Date.now() - (p.dur - p.rem) * 1000 }
      if (!iR.current) iR.current = setInterval(tick, 100)
      pushHA(p.phase, p.rem, p.q[p.qi])
    }
    tR.current = n
    setTmr(n)
  }

  const skipT = () => {
    const t = tR.current
    if (t.phase === 'WORK') {
      const rd = t.q[t.qi].r
      const n = { ...t, phase: 'REST', ps: Date.now(), dur: rd, rem: rd }
      setTmr(n); tR.current = n
      pushHA('REST', rd, t.q[t.qi])
    } else {
      const ni = t.qi + 1
      if (ni >= t.q.length) stopTInner()
      else {
        const wd = t.q[ni].w
        const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }
        setTmr(n); tR.current = n
        pushHA('WORK', wd, t.q[ni])
      }
    }
    ltR.current = -1
  }

  const prevT = () => {
    const t = tR.current
    if (t.phase === 'REST') {
      const wd = t.q[t.qi].w
      const n = { ...t, phase: 'WORK', ps: Date.now(), dur: wd, rem: wd }
      setTmr(n); tR.current = n
      pushHA('WORK', wd, t.q[t.qi])
    } else if (t.qi > 0) {
      const pi = t.qi - 1
      const wd = t.q[pi].w
      const n = { ...t, phase: 'WORK', qi: pi, ps: Date.now(), dur: wd, rem: wd }
      setTmr(n); tR.current = n
      pushHA('WORK', wd, t.q[pi])
    } else {
      const wd = t.q[0].w
      const n = { ...t, ps: Date.now(), dur: wd, rem: wd }
      setTmr(n); tR.current = n
      pushHA('WORK', wd, t.q[0])
    }
    ltR.current = -1
  }

  const nextT = () => {
    const t = tR.current
    const ni = t.qi + 1
    if (ni >= t.q.length) stopTInner()
    else {
      const wd = t.q[ni].w
      const n = { ...t, phase: 'WORK', qi: ni, ps: Date.now(), dur: wd, rem: wd }
      setTmr(n); tR.current = n; ltR.current = -1
      pushHA('WORK', wd, t.q[ni])
    }
  }

  const stopTInner = () => {
    if (iR.current) { clearInterval(iR.current); iR.current = null }
    const n = { on: false, vis: false, phase: 'WORK', q: [], qi: 0, ps: 0, dur: 0, rem: 0 }
    setTmr(n); tR.current = n; setTmrDayId(null); prevEiRef.current = -1
    localStorage.removeItem('workout_timer')
    pushHA('OFF', 0, null)
  }

  const stopTConfirm = () => ask('Stop the timer?', stopTInner)

  const curQ = tmr.q[tmr.qi]
  const pct = tmr.dur > 0 ? ((tmr.dur - tmr.rem) / tmr.dur) * 100 : 0
  const curExIdx = tmr.vis ? (curQ?.ei ?? -1) : -1
  const timerOnThisDay = tmr.vis && tmrDayId === did
  const tmrDayName = days.find((d) => d.id === tmrDayId)?.name || ''
  const phaseBg = tmr.phase === 'WORK' ? WORK_BG : REST_BG

  const renderTimerWidget = () => (
    <div style={{ background: phaseBg, color: '#f5f5ee', transition: 'background 0.4s ease' }}>
      <div className="px-5 py-5">
        <div className="flex items-center gap-5 flex-wrap">
          <span className="text-[52px] font-bold tabular-nums tracking-tight leading-none select-none"
            style={{ fontFamily: mono }}>
            {fmt(tmr.rem)}
          </span>
          <div className="flex items-center gap-2">
            <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full transition-all ${
              tmr.phase === 'WORK' ? 'bg-[#f5f5ee] text-[#222] font-bold' : 'border-2 border-[#f5f5ee]/20 opacity-30'
            }`}>Work</span>
            <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full transition-all ${
              tmr.phase === 'REST' ? 'bg-[#f5f5ee] text-[#222] font-bold' : 'border-2 border-[#f5f5ee]/20 opacity-30'
            }`}>Rest</span>
          </div>
        </div>
        <div className="mt-3 h-1 w-full rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }}>
          <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: '#f5f5ee' }} />
        </div>
        <div className="flex items-center gap-2 mt-5 flex-wrap">
          {[
            { label: 'Prev', fn: prevT },
            { label: tmr.on ? '❚❚ Pause' : '▶ Play', fn: pauseT, primary: true },
            { label: 'Next', fn: nextT },
            { label: 'Skip', fn: skipT },
            { label: 'Stop', fn: stopTConfirm },
          ].map((b) => (
            <button key={b.label} onClick={b.fn}
              className={`${B} tracking-[0.1em] uppercase px-4 py-3 rounded-xl transition-all ${
                b.primary
                  ? 'border-2 border-[#f5f5ee] hover:bg-[#f5f5ee] hover:text-[#222] font-bold'
                  : 'border-2 border-[#f5f5ee]/25 hover:border-[#f5f5ee]/60 active:bg-[#f5f5ee]/10'
              }`}>{b.label}</button>
          ))}
        </div>
        {(() => {
          if (tmr.phase !== 'REST' || !curQ || curQ.sn < curQ.ts) return null
          const nextExItem = tmr.qi + 1 < tmr.q.length ? tmr.q[tmr.qi + 1] : null
          if (!nextExItem || nextExItem.ei === curQ.ei) return null
          const nextNote = exs[nextExItem.ei]?.note
          return (
            <div className="flex justify-end mt-4">
              <button onClick={nextT}
                className={`${B} tracking-[0.08em] uppercase px-4 py-2.5 rounded-xl border-2 border-[#f5f5ee]/30 hover:border-[#f5f5ee]/70 text-[#f5f5ee] opacity-60 hover:opacity-100 transition-all text-right`}>
                <div>↓ Next: {nextExItem.nm}</div>
                {nextNote && <div className="mt-0.5 opacity-60 normal-case tracking-normal" style={{ fontSize: '11px' }}>{nextNote}</div>}
              </button>
            </div>
          )
        })()}
      </div>
    </div>
  )

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAF5', fontFamily: mono }}>
      <p className={`${B} tracking-[0.15em] uppercase opacity-40 animate-pulse`}>Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#FAFAF5', fontFamily: mono, color: '#1a1a1a' }}>
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <input ref={fileRef} type="file" accept=".json" onChange={importData} className="hidden" />
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-4 rounded-2xl bg-[#222] text-[#f5f5ee] shadow-lg animate-pulse">
          <p className={`${B} tracking-[0.08em] uppercase font-bold text-center`}>{toast}</p>
        </div>
      )}
      {confirmDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="mx-4 max-w-sm w-full p-6 rounded-2xl" style={{ background: '#FAFAF5', fontFamily: mono }}>
            <p className={`${B} tracking-[0.08em] uppercase font-bold mb-2`}>Confirm</p>
            <p className={`${B} tracking-[0.04em] mb-6 opacity-60 leading-relaxed`}>{confirmDlg.msg}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDlg(null)}
                className={`flex-1 ${B} tracking-[0.1em] uppercase px-5 py-3 rounded-xl border-2 border-[#ccc] hover:border-[#222] transition-colors`}>Cancel</button>
              <button onClick={doConfirm}
                className={`flex-1 ${B} tracking-[0.1em] uppercase px-5 py-3 rounded-xl bg-[#222] text-[#f5f5ee] font-bold hover:bg-[#444] transition-colors`}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <header>
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-end justify-between gap-4">
          <h1 className="text-[48px] font-bold tracking-tight uppercase leading-none">Workout Tracker X</h1>
          <span className={`${B} tracking-[0.1em] uppercase opacity-30 pb-1 flex-shrink-0`}>
            {saving ? 'Saving...' : saved ? '✓ Saved' : ''}
          </span>
        </div>
      </header>

      <div>
        <div className="max-w-2xl mx-auto px-4">
          <button onClick={() => setShowTools(!showTools)}
            className={`w-full py-4 text-left ${B} tracking-[0.12em] uppercase font-bold opacity-40 hover:opacity-100 transition-opacity`}>
            {showTools ? '− Hide Tools' : '+ Show Tools'}
          </button>

          {showTools && (
            <div className="pb-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Export', fn: exportData },
                  { label: 'Import', fn: () => fileRef.current?.click() },
                  { label: 'Search', fn: () => { setShowSearch(!showSearch); if (showSearch) setSearchQ('') } },
                  { label: 'Copy Day', fn: copyDay },
                  { label: clipDay ? 'Paste Day ✓' : 'Paste Day', fn: pasteDay, off: !clipDay },
                  { label: 'Sign Out', fn: () => supabase.auth.signOut() },
                ].map((b) => (
                  <button key={b.label} onClick={b.fn} disabled={b.off}
                    className={`${B} tracking-[0.1em] uppercase px-4 py-3 rounded-xl border transition-colors ${
                      b.off ? 'border-[#eee] opacity-20 cursor-default' : 'border-[#bbb] hover:border-[#222] active:bg-[#222] active:text-white'
                    }`}>{b.label}</button>
                ))}
              </div>

              {showSearch && (
                <div>
                  <input autoFocus className={`w-full bg-transparent ${B} outline-none border-b-2 border-[#222] pb-2 tracking-wide uppercase`}
                    placeholder="Search exercises..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
                  {searchQ && (
                    <div className="mt-2 max-h-52 overflow-y-auto">
                      {searchResults.length === 0 && <p className={`${B} uppercase opacity-25 py-4`}>No results</p>}
                      {searchResults.map((r, i) => (
                        <button key={i} onClick={() => { setSel(r.dayIdx); setShowSearch(false); setSearchQ('') }}
                          className={`block w-full text-left py-3 border-b border-[#eee] hover:bg-[#f0f0e8] px-2 rounded-lg`}>
                          <span className={`${B} font-bold uppercase`}>{r.exName}</span>
                          <span className={`${B} opacity-30 ml-3`}>{r.dayName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <button onClick={() => setShowSync(!showSync)}
                  className={`${B} tracking-[0.12em] uppercase font-bold opacity-40 hover:opacity-100 transition-opacity`}>
                  {showSync ? '− Home Assistant' : '+ Home Assistant'}
                </button>
                {showSync && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className={`${B} tracking-[0.12em] uppercase opacity-35 block mb-1`}>HA URL</label>
                      <input className={`w-full bg-transparent border border-[#ddd] focus:border-[#222] px-4 py-3 rounded-xl ${B} outline-none`}
                        placeholder="http://homeassistant.local:8123" value={settings.haUrl}
                        onChange={(e) => setSettings((s) => ({ ...s, haUrl: e.target.value }))} />
                    </div>
                    <div>
                      <label className={`${B} tracking-[0.12em] uppercase opacity-35 block mb-1`}>Long-Lived Access Token</label>
                      <input className={`w-full bg-transparent border border-[#ddd] focus:border-[#222] px-4 py-3 rounded-xl ${B} outline-none`}
                        placeholder="eyJ0..." type="password" value={settings.haToken}
                        onChange={(e) => setSettings((s) => ({ ...s, haToken: e.target.value }))} />
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={testHA} disabled={!settings.haUrl || !settings.haToken || haStatus === 'testing'}
                        className={`${B} tracking-[0.1em] uppercase px-4 py-3 rounded-xl border transition-colors ${
                          !settings.haUrl || !settings.haToken
                            ? 'border-[#eee] opacity-20 cursor-default'
                            : 'border-[#222] hover:bg-[#222] hover:text-[#f5f5ee]'
                        }`}>
                        {haStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                      </button>
                      {haStatus === 'ok' && <span className={`${B} text-green-600 font-bold`}>✓ Connected</span>}
                      {haStatus === 'fail' && <span className={`${B} text-red-600 font-bold`}>✗ Failed</span>}
                    </div>
                    <p className={`${B} opacity-25 leading-relaxed`}>
                      Sends sensor.workout_exercise and sensor.workout_phase on every phase change. Auto-saves.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2 pb-3">
            <button onClick={() => scrollDays(-1)}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-[#f0f0ea] hover:bg-[#e0e0d5] transition-colors">
              <span className="text-[16px] text-[#666] font-bold leading-none">‹</span>
            </button>
            <div ref={dayScrollRef} className="flex items-center gap-2 overflow-x-auto flex-1 no-scrollbar">
              {days.map((d, i) => (
                <button key={d.id} ref={(el) => (dayBtnRefs.current[i] = el)} onClick={() => setSel(i)}
                  className={`${B} tracking-[0.06em] uppercase px-4 py-2.5 rounded-full flex-shrink-0 transition-all whitespace-nowrap ${
                    i === safeIdx
                      ? 'bg-[#222] text-[#f5f5ee] font-bold'
                      : d.completed
                      ? 'bg-[#e8e8e0] opacity-50 hover:opacity-80'
                      : 'bg-[#f0f0ea] opacity-60 hover:opacity-100'
                  }`}>
                  {d.completed ? '✓ ' : ''}{d.name}
                </button>
              ))}
            </div>
            <button onClick={() => scrollDays(1)}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-[#f0f0ea] hover:bg-[#e0e0d5] transition-colors">
              <span className="text-[16px] text-[#666] font-bold leading-none">›</span>
            </button>
          </div>

          {editDay !== null && (
            <div className="pb-3">
              <input autoFocus className={`w-full bg-transparent border-b-2 border-[#222] ${B} font-bold uppercase outline-none py-2`}
                value={editName} onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditDay(null) }} onBlur={saveRename} />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={toggleDone}
              className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl transition-colors ${
                day?.completed ? 'bg-[#222] text-[#f5f5ee] font-bold' : 'bg-[#f0f0ea] hover:bg-[#e0e0d5]'
              }`}>{day?.completed ? '✓ Done' : 'Mark Done'}</button>
            {showTools && (
              <>
                {[
                  { label: '+ Add', fn: addDay },
                  { label: 'Rename', fn: () => { setEditDay(did); setEditName(day.name) } },
                  { label: 'Reset', fn: resetDayConfirm },
                  { label: 'Delete', fn: delDayConfirm, off: days.length <= 1 },
                ].map((b) => (
                  <button key={b.label} onClick={b.fn} disabled={b.off}
                    className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl transition-colors ${
                      b.off ? 'bg-[#f5f5f0] opacity-15 cursor-default' : 'bg-[#f0f0ea] hover:bg-[#e0e0d5]'
                    }`}>{b.label}</button>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {!tmr.vis && (
        <div>
          <div className="max-w-2xl mx-auto px-4 py-5">
            <div className="flex items-center gap-5 flex-wrap">
              <span className="text-[52px] font-bold tabular-nums tracking-tight leading-none select-none opacity-20"
                style={{ fontFamily: mono }}>00:00</span>
              <div className="flex items-center gap-2">
                <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full border-2 border-[#ddd] opacity-30`}>Work</span>
                <span className={`${B} tracking-[0.12em] uppercase px-4 py-2.5 rounded-full border-2 border-[#ddd] opacity-30`}>Rest</span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-5 flex-wrap">
              <button onClick={startT}
                className={`${B} tracking-[0.12em] uppercase px-5 py-3 rounded-xl border-2 border-[#222] hover:bg-[#222] hover:text-[#f5f5ee] transition-all font-bold`}>
                ▶ Start
              </button>
              {showTools && (
                <div className="flex items-center gap-4 ml-2">
                  <label className="flex items-center gap-2">
                    <span className={`${B} uppercase opacity-40`}>Default Work</span>
                    <input inputMode="numeric" className={`w-16 bg-[#f0f0ea] rounded-xl ${B} text-center outline-none py-2.5 tabular-nums`}
                      value={settings.defaultWork} onChange={(e) => setSettings((s) => ({ ...s, defaultWork: e.target.value }))} />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className={`${B} uppercase opacity-40`}>Default Rest</span>
                    <input inputMode="numeric" className={`w-16 bg-[#f0f0ea] rounded-xl ${B} text-center outline-none py-2.5 tabular-nums`}
                      value={settings.defaultRest} onChange={(e) => setSettings((s) => ({ ...s, defaultRest: e.target.value }))} />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tmr.vis && tmrDayId !== did && (
        <div style={{ background: phaseBg, color: '#f5f5ee', transition: 'background 0.4s ease' }}>
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <span className="text-[32px] font-bold tabular-nums tracking-tight" style={{ fontFamily: mono }}>{fmt(tmr.rem)}</span>
              <div>
                <span className={`${B} tracking-[0.08em] uppercase opacity-50`}>
                  {curQ?.nm} — {tmr.phase} — Set {curQ?.sn}/{curQ?.ts}
                </span>
                <p className={`${B} tracking-[0.06em] uppercase opacity-30 mt-1`}>on {tmrDayName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={pauseT}
                className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl border-2 border-[#f5f5ee] hover:bg-[#f5f5ee] hover:text-[#222] font-bold transition-all`}>
                {tmr.on ? '❚❚ Pause' : '▶ Play'}
              </button>
              <button onClick={stopTConfirm}
                className={`${B} tracking-[0.1em] uppercase px-4 py-2.5 rounded-xl border-2 border-[#f5f5ee]/25 hover:border-[#f5f5ee]/60 transition-all`}>Stop</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {exs.length === 0 && (
          <div className="py-20 text-center">
            <p className={`${B} tracking-[0.12em] uppercase opacity-20`}>No exercises yet</p>
            <p className={`${B} tracking-[0.1em] uppercase opacity-15 mt-2`}>Tap + Add Exercise below</p>
          </div>
        )}

        {exs.map((ex, idx) => {
          const isTimerHere = timerOnThisDay && curExIdx === idx
          const isSuperset = isSS(ex.name)
          return (
            <div key={ex.id}>
              {isSuperset && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '22px', marginTop: '-12px', marginBottom: '-8px', position: 'relative', zIndex: 2 }}>
                  <div style={{ width: 2, height: 20, background: '#c8c8c0', borderRadius: 1 }} />
                  <span style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa', fontFamily: mono }}>superset</span>
                </div>
              )}
              <div id={`ex-card-${idx}`}>
              <div style={{
                borderRadius: '20px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
                overflow: 'hidden',
                borderLeft: isSuperset ? '3px solid #d0d0c8' : undefined,
              }}>
                <div style={{ background: '#FFFFFF' }}>
                  <div className="px-5 py-4 flex items-center gap-3">
                    <span className={`${B} font-bold text-[#111] opacity-30 tabular-nums flex-shrink-0`}>{pad2(idx + 1)}</span>
                    <input
                      className={`flex-1 ${B} font-bold tracking-[0.04em] uppercase bg-transparent outline-none text-[#111] border-b-2 border-transparent focus:border-[#222] transition-colors py-1`}
                      value={ex.name} onChange={(e) => updEx(idx, 'name', e.target.value)} placeholder="Exercise Name"
                    />
                  </div>

                  <div className="px-3">
                    <div className="py-2"
                      style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center' }}>
                      {['Set', 'Weight', 'Reps', 'Work', 'Rest', ''].map((h, i) => (
                        <span key={i} className="text-center text-[10px] tracking-[0.12em] uppercase text-[#111] opacity-40 font-bold">{h}</span>
                      ))}
                    </div>
                    {ex.sets.map((set, si) => {
                      const isCurrentSet = isTimerHere && curQ && (si + 1) === curQ.sn
                      return (
                        <div key={si} className="py-1.5"
                          style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center' }}>
                          <div className="flex items-center justify-center">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${B} font-bold tabular-nums transition-all ${
                              isCurrentSet ? 'bg-[#1a1a1a] text-white' : 'text-[#111] opacity-25'
                            }`}>{pad2(si + 1)}</span>
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] font-bold text-[#111] outline-none tabular-nums transition-all focus:bg-[#e8e8df]"
                              value={set.weight} onChange={(e) => updSet(idx, si, 'weight', e.target.value)} placeholder="—" inputMode="decimal" />
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] font-bold text-[#111] outline-none tabular-nums transition-all focus:bg-[#e8e8df]"
                              value={set.reps} onChange={(e) => updSet(idx, si, 'reps', e.target.value)} placeholder="—" inputMode="numeric" />
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] text-[#111] outline-none tabular-nums transition-all opacity-35 focus:opacity-100 focus:bg-[#e8e8df]"
                              inputMode="numeric" value={set.work} onChange={(e) => updSet(idx, si, 'work', e.target.value)} />
                          </div>
                          <div className="px-1">
                            <input className="w-full bg-[#F0F0EA] border-0 rounded-xl py-2.5 text-center text-[14px] text-[#111] outline-none tabular-nums transition-all opacity-35 focus:opacity-100 focus:bg-[#e8e8df]"
                              inputMode="numeric" value={set.rest} onChange={(e) => updSet(idx, si, 'rest', e.target.value)} />
                          </div>
                          <div className="flex items-center justify-center">
                            {showTools && (
                              <button onClick={() => delSetConfirm(idx, si)}
                                className={`${B} text-[#111] opacity-25 hover:opacity-100 hover:text-red-600 transition-all w-8 h-8 inline-flex items-center justify-center`}>×</button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {showTools && <div className="px-5 py-3 flex items-center justify-between">
                    <button onClick={() => addSet(idx)}
                      className={`${B} tracking-[0.12em] uppercase text-[#111] opacity-30 hover:opacity-100 transition-opacity font-bold py-1`}>+ Add Set</button>
                    {showTools && (
                      <div className="flex items-center">
                        <button onClick={() => copyEx(idx)} title="Copy"
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] opacity-35 hover:opacity-100 transition-opacity`}>⧉</button>
                        {clipEx && (
                          <button onClick={() => pasteExAt(idx)} title="Paste here"
                            className={`${B} w-10 h-10 flex items-center justify-center text-[#111] opacity-35 hover:opacity-100 transition-opacity`}>⊞</button>
                        )}
                        <button onClick={() => moveEx(idx, -1)} disabled={idx === 0}
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] transition-opacity ${idx === 0 ? 'opacity-10' : 'opacity-35 hover:opacity-100'}`}>↑</button>
                        <button onClick={() => moveEx(idx, 1)} disabled={idx === exs.length - 1}
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] transition-opacity ${idx === exs.length - 1 ? 'opacity-10' : 'opacity-35 hover:opacity-100'}`}>↓</button>
                        <button onClick={() => delExConfirm(idx)} title="Delete"
                          className={`${B} w-10 h-10 flex items-center justify-center text-[#111] opacity-35 hover:opacity-100 hover:text-red-600 transition-all`}>×</button>
                      </div>
                    )}
                  </div>}

                  <div className="px-5 pb-4">
                    <textarea
                      className={`w-full bg-[#F0F0EA] rounded-xl outline-none ${B} text-[#111] opacity-35 focus:opacity-100 resize-none transition-all p-3 leading-relaxed focus:bg-[#e8e8df]`}
                      rows={1} placeholder="Notes..." value={ex.note} onChange={(e) => updEx(idx, 'note', e.target.value)}
                    />
                  </div>
                </div>

                {isTimerHere && renderTimerWidget()}
              </div>
              </div>
            </div>
          )
        })}

        <div className="space-y-3 pt-2">
          <button onClick={addEx}
            className={`w-full py-5 ${B} tracking-[0.15em] uppercase font-bold border-2 border-dashed rounded-2xl border-[#bbb] hover:border-[#222] active:bg-[#f0f0e5] transition-all`}>
            + Add Exercise
          </button>
          {showTools && clipEx && (
            <button onClick={pasteExEnd}
              className={`w-full py-5 ${B} tracking-[0.15em] uppercase font-bold border-2 border-dashed rounded-2xl border-[#aaa] hover:border-[#222] active:bg-[#f0f0e5] transition-all opacity-50 hover:opacity-100`}>
              ⧉ Paste: {clipEx.name}
            </button>
          )}
        </div>
      </div>
      <footer className="max-w-2xl mx-auto px-4 py-8 text-center">
        <p className="text-[11px] tracking-[0.15em] uppercase opacity-40"
           style={{ fontFamily: mono }}>
          © {new Date().getFullYear()} Roland Chu. All rights reserved.
        </p>
        <p className="text-[10px] tracking-[0.12em] uppercase opacity-30 mt-1"
           style={{ fontFamily: mono }}>
          Last updated {process.env.NEXT_PUBLIC_BUILD_DATE || 'unknown'}
        </p>
      </footer>
    </div>
  )
}