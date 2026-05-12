import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, AlertTriangle, Film, CheckCircle2, XCircle,
  Plus, Eye, RotateCcw, ImagePlus, Clapperboard,
  Clock, TrendingUp, ArrowRight, GripVertical, ListPlus, Trash2,
  BarChart2, ThumbsUp, ChevronDown, ChevronRight, Award,
  IndianRupee, Wallet, Banknote, Trophy, CalendarDays, Sparkles,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { uploadToCloudinary } from '../services/cloudinary'
import {
  getCreatorMe,
  listCreatorContent,
  createCreatorContent,
  resubmitCreatorContent,
  getCreatorAnalytics,
  getCreatorRevenue,
} from '../services/api'
import styles from './CreatorStudio.module.css'
import { isValidDuration } from '../utils/duration'

// ── Smooth Catmull-Rom area chart ─────────────────────────────────────────────
function AreaChart({ data }) {
  const W = 480, H = 148, PT = 28, PB = 26, PL = 6, PR = 6
  const iW = W - PL - PR, iH = H - PT - PB
  const max = Math.max(...data.map((d) => d.amount), 1)
  const pts = data.map((d, i) => ({
    x: PL + (data.length > 1 ? i / (data.length - 1) : 0.5) * iW,
    y: PT + iH - Math.max((d.amount / max) * iH, 0),
    ...d,
  }))
  const toCurve = (ps) => {
    if (ps.length < 2) return `M ${ps[0].x} ${ps[0].y}`
    let d = `M ${ps[0].x} ${ps[0].y}`
    for (let i = 0; i < ps.length - 1; i++) {
      const p0 = ps[Math.max(0, i - 1)], p1 = ps[i]
      const p2 = ps[i + 1], p3 = ps[Math.min(ps.length - 1, i + 2)]
      const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    }
    return d
  }
  const line = toCurve(pts)
  const area = `${line} L ${pts[pts.length - 1].x} ${PT + iH} L ${pts[0].x} ${PT + iH} Z`
  const fmt  = (n) => n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : `₹${n}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={styles.areaChart}>
      <defs>
        <linearGradient id="acArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.28" />
          <stop offset="80%"  stopColor="#a78bfa" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="acLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#7c3aed" />
          <stop offset="50%"  stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={PL} y1={PT + iH * (1 - t)} x2={W - PR} y2={PT + iH * (1 - t)}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 5" />
      ))}
      <path d={area} fill="url(#acArea)" />
      <path d={line} fill="none" stroke="#a78bfa" strokeWidth="6"
        strokeOpacity="0.15" strokeLinecap="round" strokeLinejoin="round" />
      <path d={line} fill="none" stroke="url(#acLine)" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" className={styles.areaChartLine} />
      {pts.map((pt, i) => {
        const isLatest = i === pts.length - 1
        return (
          <g key={i}>
            <line x1={pt.x} y1={pt.y + 4} x2={pt.x} y2={PT + iH}
              stroke="rgba(167,139,250,0.1)" strokeWidth="1" strokeDasharray="2 4" />
            {isLatest && (
              <circle cx={pt.x} cy={pt.y} r="9" fill="none"
                stroke="#a78bfa" strokeWidth="1.2" className={styles.areaChartPulse} />
            )}
            <circle cx={pt.x} cy={pt.y} r="3.5"
              fill={isLatest ? '#c4b5fd' : '#a78bfa'} stroke="#0d0d14" strokeWidth="1.5" />
            {pt.amount > 0 && (
              <text x={pt.x} y={pt.y - 10} textAnchor="middle" fontSize="9" fontWeight="600"
                fill="rgba(196,181,253,0.9)" fontFamily="system-ui,sans-serif">{fmt(pt.amount)}</text>
            )}
            <text x={pt.x} y={H - 2} textAnchor="middle" fontSize="9" fontWeight="500"
              fill="rgba(255,255,255,0.28)" fontFamily="system-ui,sans-serif">{pt.month}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Concentric tier rings ──────────────────────────────────────────────────────
function TierRings({ totalViews }) {
  const RINGS = [
    { label: 'Newcomer',    max: 1_000,     baseViews: 0,          r: 28, color: '#6366f1' },
    { label: 'Rising Star', max: 10_000,    baseViews: 1_000,      r: 40, color: '#8b5cf6' },
    { label: 'Established', max: 100_000,   baseViews: 10_000,     r: 52, color: '#a78bfa' },
    { label: 'Featured',    max: 1_000_000, baseViews: 100_000,    r: 64, color: '#c4b5fd' },
  ]
  const cx = 76, cy = 76, S = -Math.PI / 2
  const arc = (r, prog) => {
    const sweep = Math.min(prog, 0.9999) * 2 * Math.PI
    const sx = cx + r * Math.cos(S), sy = cy + r * Math.sin(S)
    const ex = cx + r * Math.cos(S + sweep), ey = cy + r * Math.sin(S + sweep)
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
  }
  const fmtV = (v) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v/1_000).toFixed(1)}k` : String(v)
  const currentRing = RINGS.slice().reverse().find((r) => totalViews >= r.baseViews) ?? RINGS[0]
  return (
    <svg viewBox="0 0 152 152" width="152" height="152" className={styles.tierRings}>
      {RINGS.map((ring) => {
        const range = ring.max - ring.baseViews
        const prog  = Math.min(Math.max(totalViews - ring.baseViews, 0) / range, 1)
        const track = arc(ring.r, 0.9999)
        const fill  = prog > 0.005 ? arc(ring.r, prog) : null
        return (
          <g key={ring.label}>
            <path d={track} fill="none" stroke={ring.color} strokeWidth="7"
              strokeOpacity="0.1" strokeLinecap="round" />
            {fill && (
              <path d={fill} fill="none" stroke={ring.color} strokeWidth="7"
                strokeLinecap="round" className={styles.tierRingFill}
                style={{ filter: `drop-shadow(0 0 4px ${ring.color}88)` }} />
            )}
          </g>
        )
      })}
      <text x={cx} y={cy - 9}  textAnchor="middle" fontSize="17" fontWeight="700"
        fill="white" fontFamily="system-ui,sans-serif">{fmtV(totalViews)}</text>
      <text x={cx} y={cy + 6}  textAnchor="middle" fontSize="8"
        fill="rgba(255,255,255,0.38)" fontFamily="system-ui,sans-serif">views</text>
      <text x={cx} y={cy + 18} textAnchor="middle" fontSize="8" fontWeight="700"
        fill={currentRing.color} fontFamily="system-ui,sans-serif">{currentRing.label}</text>
    </svg>
  )
}

// ── Tiny sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ values }) {
  if (!values || values.length < 2) return null
  const W = 56, H = 22, max = Math.max(...values, 1)
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - Math.max((v / max) * H * 0.82, 0) - H * 0.06,
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L ${W} ${H} L 0 ${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={styles.sparkline}>
      <defs>
        <linearGradient id="slG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#slG)" />
      <path d={line} fill="none" stroke="#a78bfa" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  )
}

// ── Circular approval-rate gauge ──────────────────────────────────────────────
function ApprovalArc({ rate }) {
  const r = 36, cx = 46, cy = 46, C = 2 * Math.PI * r
  const filled  = (rate / 100) * C
  const color   = rate >= 70 ? '#4ade80' : rate >= 40 ? '#fbbf24' : '#f87171'
  return (
    <svg viewBox="0 0 92 92" width="92" height="92" className={styles.approvalArc}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${C - filled}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        className={styles.approvalArcFill}
        style={{ filter: `drop-shadow(0 0 5px ${color}70)` }}
      />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="17" fontWeight="700"
        fill="white" fontFamily="system-ui,sans-serif">{rate}%</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8"
        fill="rgba(255,255,255,0.38)" fontFamily="system-ui,sans-serif">approved</text>
    </svg>
  )
}

// ── Status donut ──────────────────────────────────────────────────────────────
function StatusDonut({ counts }) {
  const segs = [
    { label: 'Live',      value: counts.approved || 0, color: '#4ade80' },
    { label: 'In Review', value: counts.pending  || 0, color: '#fbbf24' },
    { label: 'Rejected',  value: counts.rejected || 0, color: '#f87171' },
  ].filter((s) => s.value > 0)
  const total = segs.reduce((s, x) => s + x.value, 0) || 1
  const r = 32, cx = 42, cy = 42, C = 2 * Math.PI * r
  let cumulative = 0
  const segments = segs.map((seg) => {
    const dashLen = (seg.value / total) * C
    const off = -cumulative
    cumulative += dashLen
    return { ...seg, dashLen, off }
  })
  return (
    <div className={styles.donutWrap}>
      <svg viewBox="0 0 84 84" width="84" height="84" style={{ overflow: 'visible' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="11" />
        {segments.map((seg, i) => (
          <circle key={seg.label} cx={cx} cy={cy} r={r} fill="none"
            stroke={seg.color} strokeWidth="10" strokeLinecap="butt"
            strokeDasharray={`${seg.dashLen - 1.5} ${C - seg.dashLen + 1.5}`}
            strokeDashoffset={seg.off}
            transform={`rotate(-90 ${cx} ${cy})`}
            className={styles.donutSegment}
            style={{ animationDelay: `${i * 0.1}s`, filter: `drop-shadow(0 0 3px ${seg.color}60)` }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="700"
          fill="white" fontFamily="system-ui,sans-serif">{total}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fontSize="7.5"
          fill="rgba(255,255,255,0.38)" fontFamily="system-ui,sans-serif">titles</text>
      </svg>
      <div className={styles.donutLegend}>
        {segments.map((seg) => (
          <div key={seg.label} className={styles.donutLegendRow}>
            <span className={styles.donutLegendDot} style={{ background: seg.color }} />
            <span className={styles.donutLegendLabel}>{seg.label}</span>
            <span className={styles.donutLegendCount} style={{ color: seg.color }}>{seg.count ?? seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Submission pipeline funnel ────────────────────────────────────────────────
function PipelineFlow({ counts, content }) {
  const withViews = content.filter((i) => i.viewCount > 0).length
  const withLikes = content.filter((i) => i.likeCount > 0).length
  const stages = [
    { label: 'Submitted', value: counts.total    || 0, color: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
    { label: 'Approved',  value: counts.approved || 0, color: '#4ade80', bg: 'rgba(74,222,128,0.08)'  },
    { label: 'Has Views', value: withViews,            color: '#38bdf8', bg: 'rgba(56,189,248,0.08)'  },
    { label: 'Has Likes', value: withLikes,            color: '#f59e0b', bg: 'rgba(245,158,11,0.08)'  },
  ]
  return (
    <div className={styles.pipelineFlow}>
      {stages.map((stage, i) => {
        const prev = i > 0 ? stages[i - 1].value : null
        const pct  = prev && prev > 0 ? Math.round((stage.value / prev) * 100) : null
        return (
          <div key={stage.label} className={styles.pipelineFlowItem}>
            <div className={styles.pipelineFlowStage}
              style={{ borderColor: `${stage.color}35`, background: stage.bg }}>
              <p className={styles.pipelineFlowValue} style={{ color: stage.color }}>{stage.value}</p>
              <p className={styles.pipelineFlowLabel}>{stage.label}</p>
              {pct !== null && (
                <span className={styles.pipelineFlowPct} style={{ color: stage.color }}>{pct}% of prev</span>
              )}
            </div>
            {i < stages.length - 1 && (
              <div className={styles.pipelineFlowArrow}>
                <svg width="22" height="14" viewBox="0 0 22 14">
                  <path d="M0 7 H16 M12 2 L18 7 L12 12"
                    stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"
                    fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Gradient ranking bars ─────────────────────────────────────────────────────
function RankingBars({ items }) {
  if (!items.length) return null
  const sorted = [...items].sort((a, b) => b.viewCount - a.viewCount)
  const maxV   = Math.max(...sorted.map((i) => i.viewCount), 1)
  const fmtV   = (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
  const GRAD   = { Film: ['#4c1d95','#a78bfa'], Series: ['#78350f','#f59e0b'], Documentary: ['#064e3b','#34d399'] }
  return (
    <div className={styles.rankingBars}>
      {sorted.map((item, i) => {
        const pct    = Math.max((item.viewCount / maxV) * 100, 1)
        const [f, t] = GRAD[item.type] || ['#1e1b4b','#a78bfa']
        const eng    = item.viewCount > 0 ? ((item.likeCount / item.viewCount) * 100).toFixed(1) : '0'
        const eColor = Number(eng) >= 10 ? '#4ade80' : Number(eng) >= 4 ? '#fbbf24' : 'rgba(255,255,255,0.25)'
        return (
          <div key={item._id} className={styles.rankingBarRow}>
            <div className={styles.rankingBarLeft}>
              <span className={styles.rankingBarRank}>#{i + 1}</span>
              <div className={styles.rankingBarInfo}>
                <span className={styles.rankingBarTitle}>
                  {item.title.length > 26 ? item.title.slice(0, 25) + '…' : item.title}
                </span>
                <span className={styles.rankingBarType}>{item.type}</span>
              </div>
            </div>
            <div className={styles.rankingBarTrack}>
              <div className={styles.rankingBarFill}
                style={{ width: `${pct}%`, background: `linear-gradient(90deg,${f},${t})` }} />
              <span className={styles.rankingBarCount}>{fmtV(item.viewCount)}</span>
            </div>
            <span className={styles.rankingBarEng} style={{ color: eColor }}>{eng}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Views vs Likes scatter ────────────────────────────────────────────────────
function EngagementScatter({ items }) {
  const pts = items.filter((i) => i.submissionStatus === 'approved' && (i.viewCount > 0 || i.likeCount > 0))
  const W = 260, H = 180, P = 28
  const iW = W - P * 2, iH = H - P * 2
  const maxV = Math.max(...pts.map((i) => i.viewCount), 1)
  const maxL = Math.max(...pts.map((i) => i.likeCount), 1)
  const TC   = { Film: '#a78bfa', Series: '#f59e0b', Documentary: '#34d399' }
  if (!pts.length) return (
    <div className={styles.scatterEmpty}><p>No approved content with activity yet.</p></div>
  )
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={styles.scatterChart}>
      {[0.5].map((t) => (
        <g key={t}>
          <line x1={P + iW * t} y1={P} x2={P + iW * t} y2={P + iH}
            stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 5" />
          <line x1={P} y1={P + iH * (1 - t)} x2={P + iW} y2={P + iH * (1 - t)}
            stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 5" />
        </g>
      ))}
      <text x={P + iW * 0.76} y={P + 9} textAnchor="middle" fontSize="7"
        fill="rgba(74,222,128,0.4)" fontFamily="system-ui,sans-serif">High engagement</text>
      <text x={P + iW * 0.2} y={P + iH - 4} textAnchor="middle" fontSize="7"
        fill="rgba(255,255,255,0.18)" fontFamily="system-ui,sans-serif">Low reach</text>
      {pts.map((item) => {
        const x = P + (item.viewCount / maxV) * iW
        const y = P + iH - (item.likeCount / maxL) * iH
        const c = TC[item.type] || '#888'
        return (
          <g key={item._id}>
            <circle cx={x} cy={y} r="8" fill={c} fillOpacity="0.12" />
            <circle cx={x} cy={y} r="5" fill={c} fillOpacity="0.88"
              stroke="#0d0d14" strokeWidth="1.5" className={styles.scatterDot}
              style={{ filter: `drop-shadow(0 0 3px ${c}80)` }} />
            <text x={x} y={y - 9} textAnchor="middle" fontSize="7.5"
              fill="rgba(255,255,255,0.48)" fontFamily="system-ui,sans-serif">
              {item.title.split(' ')[0].slice(0, 8)}
            </text>
          </g>
        )
      })}
      <text x={P + iW / 2} y={H - 3} textAnchor="middle" fontSize="8"
        fill="rgba(255,255,255,0.2)" fontFamily="system-ui,sans-serif">Views →</text>
      <text x={7} y={P + iH / 2} textAnchor="middle" fontSize="8"
        fill="rgba(255,255,255,0.2)" fontFamily="system-ui,sans-serif"
        transform={`rotate(-90 7 ${P + iH / 2})`}>Likes →</text>
    </svg>
  )
}

const STEPS_BASE = [
  { id: 'basics',   label: 'Basics'   },
  { id: 'media',    label: 'Media'    },
  { id: 'details',  label: 'Details'  },
  { id: 'review',   label: 'Review'   },
]

const STEPS_SERIES = [
  { id: 'basics',   label: 'Basics'   },
  { id: 'media',    label: 'Media'    },
  { id: 'details',  label: 'Details'  },
  { id: 'episodes', label: 'Episodes' },
  { id: 'review',   label: 'Review'   },
]

const EMPTY_FORM = {
  title: '', subtitle: '', type: 'Film', genre: '', releaseYear: '',
  contentLanguage: 'Bengali', certification: '', duration: '',
  posterUrl: '', backdropUrl: '', bunnyVideoId: '',
  desc: '', director: '', cast: '', moodTags: '', contentWarnings: '',
  episodes: [],
}

const STATUS_META = {
  pending:  { label: 'In Review',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  approved: { label: 'Live',       color: '#4ade80', bg: 'rgba(74,222,128,0.12)'  },
  rejected: { label: 'Rejected',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status, color: '#888', bg: 'rgba(255,255,255,0.06)' }
  return (
    <span className={styles.statusChip} style={{ color: meta.color, background: meta.bg }}>
      {status === 'pending'  && <Clock size={10} />}
      {status === 'approved' && <CheckCircle2 size={10} />}
      {status === 'rejected' && <XCircle size={10} />}
      {meta.label}
    </span>
  )
}

export default function CreatorStudio() {
  const navigate = useNavigate()
  const { isLoggedIn, authLoading, isCreator, creatorStatus } = useStore()

  const [loading, setLoading]           = useState(true)
  const [dashData, setDashData]         = useState(null)
  const [submissions, setSubmissions]   = useState([])
  const [filterTab, setFilterTab]       = useState('all')
  const [listLoading, setListLoading]   = useState(false)
  const [activeTab, setActiveTab]       = useState('submissions')
  const [analytics, setAnalytics]       = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [revenue, setRevenue]           = useState(null)
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [expandedSeries, setExpandedSeries]     = useState(new Set())
  const [showModal, setShowModal]       = useState(false)
  const [step, setStep]                 = useState(0)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [submitting, setSubmitting]     = useState(false)
  const [submitError, setSubmitError]   = useState('')
  const [toast, setToast]               = useState(null)
  const [imgUploading, setImgUploading] = useState({ poster: false, backdrop: false })
  const [imgProgress,  setImgProgress]  = useState({ poster: 0,     backdrop: 0     })
  const [dragEpIdx,    setDragEpIdx]    = useState(null)

  const showToast = useCallback((t) => {
    setToast(t)
    setTimeout(() => setToast(null), 5000)
  }, [])

  const loadDash = useCallback(async () => {
    try {
      const data = await getCreatorMe()
      setDashData(data)
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not load dashboard.' })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const loadSubmissions = useCallback(async (status = 'all') => {
    setListLoading(true)
    try {
      const params = status !== 'all' ? { status } : {}
      const data = await listCreatorContent(params)
      setSubmissions(data)
    } catch {
      setSubmissions([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!isLoggedIn) { navigate('/'); return }
    if (!isCreator || creatorStatus !== 'approved') { navigate('/profile'); return }
    loadDash()
    loadSubmissions('all')
  }, [authLoading, isLoggedIn, isCreator, creatorStatus, navigate, loadDash, loadSubmissions])

  const loadAnalyticsData = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const data = await getCreatorAnalytics()
      setAnalytics(data)
    } catch {
      setAnalytics(null)
    } finally {
      setAnalyticsLoading(false)
    }
  }, [])

  const loadRevenueData = useCallback(async () => {
    setRevenueLoading(true)
    try {
      const data = await getCreatorRevenue()
      setRevenue(data)
    } catch {
      setRevenue(null)
    } finally {
      setRevenueLoading(false)
    }
  }, [])

  const handleTabSwitch = (tab) => {
    setActiveTab(tab)
    if (tab === 'analytics' && !analytics) loadAnalyticsData()
    if (tab === 'revenue'   && !revenue)   loadRevenueData()
  }

  const toggleSeriesExpand = (id) => {
    setExpandedSeries((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleFilterTab = (tab) => {
    setFilterTab(tab)
    loadSubmissions(tab)
  }

  const openModal = () => {
    setForm(EMPTY_FORM); setStep(0); setSubmitError(''); setShowModal(true)
  }

  const closeModal = () => { setShowModal(false); setSubmitError('') }

  const ff = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleImageUpload = async (field, file) => {
    if (!file) return
    const key = field === 'posterUrl' ? 'poster' : 'backdrop'
    setImgUploading((p) => ({ ...p, [key]: true }))
    setImgProgress((p)  => ({ ...p, [key]: 0 }))
    try {
      const url = await uploadToCloudinary(file, {
        folder: 'dhara/creator',
        onProgress: (pct) => setImgProgress((p) => ({ ...p, [key]: pct })),
      })
      setForm((prev) => ({ ...prev, [field]: url }))
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Image upload failed.' })
    } finally {
      setImgUploading((p) => ({ ...p, [key]: false }))
    }
  }

  const handleSubmit = async () => {
    if (!form.title.trim()) { setSubmitError('Title is required.'); return }
    setSubmitting(true); setSubmitError('')
    try {
      const payload = {
        ...form,
        genre:       form.genre.split(',').map((s) => s.trim()).filter(Boolean),
        cast:        form.cast.split(',').map((s) => s.trim()).filter(Boolean),
        moodTags:    form.moodTags.split(',').map((s) => s.trim()).filter(Boolean),
        releaseYear: form.releaseYear ? Number(form.releaseYear) : null,
        certification: form.certification || null,
        duration:    form.type !== 'Series' ? (form.duration?.trim() || '') : '',
        episodes:    form.type === 'Series'
          ? form.episodes
              .filter((ep) => ep.number && ep.title.trim())
              .map((ep) => ({ number: Number(ep.number), title: ep.title.trim(), duration: ep.duration.trim() }))
          : [],
      }
      await createCreatorContent(payload)
      showToast({ type: 'success', message: 'Submitted for review — we\'ll notify you once approved.' })
      closeModal()
      await Promise.all([loadDash(), loadSubmissions(filterTab)])
    } catch (err) {
      setSubmitError(err?.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResubmit = async (id) => {
    try {
      await resubmitCreatorContent(id)
      showToast({ type: 'success', message: 'Resubmitted for review.' })
      await Promise.all([loadDash(), loadSubmissions(filterTab)])
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not resubmit.' })
    }
  }

  // Clamp step index when type changes between Series / non-Series
  useEffect(() => {
    const maxStep = form.type === 'Series' ? STEPS_SERIES.length - 1 : STEPS_BASE.length - 1
    if (step > maxStep) setStep(maxStep)
  }, [form.type]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loadingState}>
          <Clapperboard size={28} className={styles.loadingIcon} />
          <p>Loading your studio…</p>
        </div>
      </main>
    )
  }

  const stats = dashData?.stats || { total: 0, approved: 0, pending: 0, rejected: 0 }
  const studioName = dashData?.creatorProfile?.studioName || 'My Studio'
  const bio        = dashData?.creatorProfile?.bio || ''

  return (
    <main className={styles.page}>

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.type === 'success' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          <span>{toast.message}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* ── Hero — identity only ── */}
      <header className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <div className={styles.heroLeft}>
            <p className={styles.heroEyebrow}>
              <Clapperboard size={12} /> Creator Studio
            </p>
            <h1 className={styles.heroName}>{studioName}</h1>
            {bio && <p className={styles.heroBio}>{bio}</p>}
            <div className={styles.heroStats}>
              <span className={styles.heroStat}>
                <strong>{stats.total}</strong> Total
              </span>
              <span className={styles.heroStatDivider} />
              <span className={`${styles.heroStat} ${styles.heroStatApproved}`}>
                <strong>{stats.approved}</strong> Live
              </span>
              <span className={styles.heroStatDivider} />
              <span className={`${styles.heroStat} ${styles.heroStatPending}`}>
                <strong>{stats.pending}</strong> In Review
              </span>
              {stats.rejected > 0 && (
                <>
                  <span className={styles.heroStatDivider} />
                  <span className={`${styles.heroStat} ${styles.heroStatRejected}`}>
                    <strong>{stats.rejected}</strong> Rejected
                  </span>
                </>
              )}
            </div>
          </div>
          <button className={styles.newBtn} onClick={openModal}>
            <Plus size={15} /> New Submission
          </button>
        </div>
      </header>

      {/* ── Pipeline strip — submission journey ── */}
      <div className={styles.pipelineStrip}>
        <div className={styles.pipeline}>
          {[
            { label: 'Draft & Submit', desc: 'Fill in details and upload media', done: stats.total > 0 },
            { label: 'Admin Review',   desc: 'We check quality and guidelines',  done: stats.approved > 0 || stats.rejected > 0 },
            { label: 'Goes Live',      desc: 'Visible to all Dhara subscribers', done: stats.approved > 0 },
          ].map((stage, i) => (
            <div key={stage.label} className={styles.pipelineStage}>
              <div className={`${styles.pipelineDot} ${stage.done ? styles.pipelineDotDone : ''}`}>
                {stage.done ? '✓' : i + 1}
              </div>
              <div className={styles.pipelineInfo}>
                <p className={styles.pipelineLabel}>{stage.label}</p>
                <p className={styles.pipelineDesc}>{stage.desc}</p>
              </div>
              {i < 2 && <ArrowRight size={14} className={styles.pipelineArrow} />}
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className={styles.tabBar}>
        <div className={styles.tabBarInner}>
          <button
            className={`${styles.tab} ${activeTab === 'submissions' ? styles.tabActive : ''}`}
            onClick={() => handleTabSwitch('submissions')}
          >
            <Film size={13} /> My Submissions
            {stats.total > 0 && <span className={styles.tabCount}>{stats.total}</span>}
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'analytics' ? styles.tabActive : ''}`}
            onClick={() => handleTabSwitch('analytics')}
          >
            <BarChart2 size={13} /> Analytics
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'revenue' ? styles.tabActive : ''}`}
            onClick={() => handleTabSwitch('revenue')}
          >
            <IndianRupee size={13} /> Revenue
          </button>
        </div>
      </div>

      {/* ── Submissions ── */}
      {activeTab === 'analytics' && (() => {
        const ov      = analytics?.overview || {}
        const content = analytics?.content  || []
        const counts  = ov.submissionCounts || {}
        const maxViews = Math.max(...content.map((i) => i.viewCount), 1)
        const fmtN = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0)
        return (
          <section className={styles.analytics}>
            {analyticsLoading ? (
              <div className={styles.loadingState} style={{ padding: '48px 0' }}>
                <BarChart2 size={22} className={styles.loadingIcon} />
                <p>Loading analytics…</p>
              </div>
            ) : !analytics ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}><BarChart2 size={32} /></div>
                <h3 className={styles.emptyTitle}>No data yet</h3>
                <p className={styles.emptyDesc}>Analytics will appear once you have approved content with views.</p>
              </div>
            ) : (
              <>
                {/* ── Row 1: Stat cards ── */}
                <div className={styles.analyticsStatRow}>
                  <div className={styles.analyticsStatCard}>
                    <div className={styles.analyticsStatIcon} style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.1)' }}>
                      <Eye size={16} />
                    </div>
                    <p className={styles.analyticsStatValue}>{fmtN(ov.totalViews)}</p>
                    <p className={styles.analyticsStatLabel}>Total Views</p>
                    {ov.avgViewsPerTitle > 0 && (
                      <p className={styles.analyticsStatSub}>~{fmtN(ov.avgViewsPerTitle)} avg per title</p>
                    )}
                  </div>
                  <div className={styles.analyticsStatCard}>
                    <div className={styles.analyticsStatIcon} style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}>
                      <ThumbsUp size={16} />
                    </div>
                    <p className={styles.analyticsStatValue}>{fmtN(ov.totalLikes)}</p>
                    <p className={styles.analyticsStatLabel}>Total Likes</p>
                    {ov.totalEpisodes > 0 && (
                      <p className={styles.analyticsStatSub}>{ov.totalEpisodes} episodes total</p>
                    )}
                  </div>
                  <div className={`${styles.analyticsStatCard} ${styles.analyticsStatCardArc}`}>
                    <ApprovalArc rate={ov.approvalRate ?? 0} />
                    <p className={styles.analyticsStatLabel}>Approval Rate</p>
                    <p className={styles.analyticsStatSub}>excl. pending</p>
                  </div>
                  <div className={styles.analyticsStatCard}>
                    <div className={styles.analyticsStatIcon} style={{ color: '#34d399', background: 'rgba(52,211,153,0.1)' }}>
                      <TrendingUp size={16} />
                    </div>
                    <p className={styles.analyticsStatValue}>{ov.engagementRate ?? 0}%</p>
                    <p className={styles.analyticsStatLabel}>Engagement Rate</p>
                    <p className={styles.analyticsStatSub}>likes ÷ views</p>
                  </div>
                </div>

                {/* ── Row 2: Pipeline funnel (full width) ── */}
                {counts.total > 0 && (
                  <div className={styles.analyticsPipelineCard}>
                    <p className={styles.analyticsChartTitle}>
                      <TrendingUp size={13} /> Submission Pipeline
                    </p>
                    <p className={styles.analyticsChartSub}>From submission to audience engagement</p>
                    <PipelineFlow counts={counts} content={content} />
                  </div>
                )}

                {content.length > 0 && (
                  <>
                    {/* ── Row 3: Ranking bars + Donut + Scatter ── */}
                    <div className={styles.analyticsChartRow}>
                      <div className={styles.analyticsChartCard}>
                        <p className={styles.analyticsChartTitle}>
                          <BarChart2 size={13} /> Views Ranking
                        </p>
                        <p className={styles.analyticsChartSub}>Sorted by views · right column = engagement rate</p>
                        <RankingBars items={content} />
                      </div>

                      <div className={styles.analyticsDonutCard}>
                        <p className={styles.analyticsChartTitle}>
                          <Award size={13} /> Status Mix
                        </p>
                        <StatusDonut counts={counts} />

                        {ov.topContent && (
                          <div className={styles.analyticsTopContent}>
                            <p className={styles.analyticsTopLabel}>Top Performer</p>
                            <p className={styles.analyticsTopTitle}>{ov.topContent.title}</p>
                            <p className={styles.analyticsTopViews}>
                              <Eye size={10} /> {ov.topContent.viewCount.toLocaleString()} views
                            </p>
                          </div>
                        )}

                        <div className={styles.analyticsScatterWrap}>
                          <p className={styles.analyticsChartTitle} style={{ marginBottom: 6 }}>
                            <ThumbsUp size={12} /> Views vs Likes
                          </p>
                          <EngagementScatter items={content} />
                        </div>
                      </div>
                    </div>

                    {/* ── Row 4: Content performance list ── */}
                    <div className={styles.analyticsContentList}>
                      {content
                        .slice()
                        .sort((a, b) => b.viewCount - a.viewCount)
                        .map((item, rank) => {
                          const isExpanded  = expandedSeries.has(item._id)
                          const viewPct     = Math.round((item.viewCount / maxViews) * 100)
                          const likePct     = item.viewCount > 0
                            ? Math.round((item.likeCount / item.viewCount) * 100) : 0
                          const hasEpisodes = item.type === 'Series' && item.episodes.length > 0
                          const epMax       = hasEpisodes
                            ? Math.max(...item.episodes.map((e) => e.viewCount), 1) : 1
                          const eColor      = likePct >= 10 ? '#4ade80' : likePct >= 4 ? '#fbbf24' : 'rgba(255,255,255,0.28)'
                          return (
                            <div key={item._id} className={styles.analyticsContentRow}>
                              <span className={styles.analyticsContentRank}>#{rank + 1}</span>

                              <div className={styles.analyticsContentPoster}>
                                {item.posterUrl
                                  ? <img src={item.posterUrl} alt={item.title} className={styles.analyticsContentPosterImg} />
                                  : <div className={styles.analyticsContentPosterFallback}><Film size={18} opacity={0.3} /></div>
                                }
                              </div>

                              <div className={styles.analyticsContentBody}>
                                <div className={styles.analyticsContentHead2}>
                                  <p className={styles.analyticsContentTitle2}>{item.title}</p>
                                  <div className={styles.analyticsContentChips}>
                                    <StatusChip status={item.submissionStatus} />
                                    <span className={styles.rowType}>{item.type}</span>
                                    <span className={styles.analyticsEngBadge}
                                      style={{ color: eColor, borderColor: `${eColor}40` }}>
                                      {likePct}% eng
                                    </span>
                                  </div>
                                </div>

                                <div className={styles.analyticsDualBarRow}>
                                  <Eye size={10} style={{ color: '#a78bfa', flexShrink: 0, opacity: 0.7 }} />
                                  <div className={styles.analyticsDualBarTrack}>
                                    <div className={styles.analyticsDualBarFillViews} style={{ width: `${viewPct}%` }} />
                                  </div>
                                  <span className={styles.analyticsDualBarVal}>{fmtN(item.viewCount)}</span>
                                </div>

                                <div className={styles.analyticsDualBarRow}>
                                  <ThumbsUp size={10} style={{ color: '#f59e0b', flexShrink: 0, opacity: 0.7 }} />
                                  <div className={styles.analyticsDualBarTrack}>
                                    <div className={styles.analyticsDualBarFillLikes}
                                      style={{ width: `${item.viewCount > 0 ? Math.round((item.likeCount / maxViews) * 100) : 0}%` }} />
                                  </div>
                                  <span className={styles.analyticsDualBarVal}>{fmtN(item.likeCount)}</span>
                                </div>

                                {hasEpisodes && (
                                  <div className={styles.analyticsEpSection}>
                                    <button className={styles.analyticsEpToggle}
                                      onClick={() => toggleSeriesExpand(item._id)}>
                                      {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                      {isExpanded ? 'Hide episodes' : `${item.episodes.length} episodes`}
                                    </button>
                                    {isExpanded && (
                                      <div className={styles.analyticsEpWaterfall}>
                                        {item.episodes
                                          .slice()
                                          .sort((a, b) => a.number - b.number)
                                          .map((ep) => {
                                            const epPct = Math.round((ep.viewCount / epMax) * 100)
                                            return (
                                              <div key={ep.number} className={styles.analyticsEpBar}>
                                                <span className={styles.analyticsEpNum}>E{ep.number}</span>
                                                <div className={styles.analyticsEpTrack}>
                                                  <div className={styles.analyticsEpFill} style={{ width: `${epPct}%` }} />
                                                </div>
                                                <span className={styles.analyticsEpCount}>{fmtN(ep.viewCount)}</span>
                                              </div>
                                            )
                                          })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )
      })()}

      {/* ── Revenue Tab ── */}
      {activeTab === 'revenue' && (
        <section className={styles.revenueSection}>
          {revenueLoading ? (
            <div className={styles.loadingState} style={{ padding: '64px 0' }}>
              <IndianRupee size={26} className={styles.loadingIcon} />
              <p>Loading revenue data…</p>
            </div>
          ) : !revenue ? (
            <div className={styles.revenueComingSoon}>
              <div className={styles.revenueComingSoonGlow} />
              <div className={styles.revenueComingSoonIcon}><Sparkles size={36} /></div>
              <h3 className={styles.revenueComingSoonTitle}>Revenue Dashboard</h3>
              <p className={styles.revenueComingSoonDesc}>
                Once your content goes live and accumulates views, your earnings and payout history will appear here.
                Revenue is calculated monthly based on premium subscription share.
              </p>
              <div className={styles.revenueComingSoonCards}>
                {[
                  { icon: IndianRupee,  label: 'Revenue Share', value: '70%',     sub: 'of subscription pool'    },
                  { icon: CalendarDays, label: 'Payout Cycle',  value: 'Monthly', sub: 'on the 15th each month'  },
                  { icon: Trophy,       label: 'Creator Tier',  value: 'Newcomer',sub: 'grows with your audience' },
                ].map(({ icon: Icon, label, value, sub }) => (
                  <div key={label} className={styles.revenueInfoCard}>
                    <Icon size={18} className={styles.revenueInfoIcon} />
                    <p className={styles.revenueInfoValue}>{value}</p>
                    <p className={styles.revenueInfoLabel}>{label}</p>
                    <p className={styles.revenueInfoSub}>{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (() => {
            const ov      = revenue.overview || {}
            const monthly = revenue.monthly  || []
            const tier    = revenue.tier     || {}
            const payouts = revenue.payouts  || []
            const content = revenue.content  || []
            const sparkVals = monthly.map((m) => m.amount)

            const fmt = (n) =>
              n >= 1000
                ? `₹${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
                : `₹${Number(n).toLocaleString('en-IN')}`

            const maxEarned = Math.max(...content.map((c) => c.earned ?? 0), 1)

            return (
              <>
                {/* ── Overview stat cards with inline sparklines ── */}
                <div className={styles.revenueOverview}>
                  {[
                    { icon: IndianRupee, label: 'Total Earned',   value: fmt(ov.totalEarned   ?? 0), accent: true,  spark: true },
                    { icon: TrendingUp,  label: 'This Month',     value: fmt(ov.thisMonth     ?? 0), accent: false, spark: true },
                    { icon: Wallet,      label: 'Pending Payout', value: fmt(ov.pendingPayout ?? 0), accent: false, spark: false },
                    { icon: Banknote,    label: 'Paid Out',       value: fmt(ov.paidOut       ?? 0), accent: false, spark: false },
                  ].map(({ icon: Icon, label, value, accent, spark }) => (
                    <div key={label} className={`${styles.revenueCard} ${accent ? styles.revenueCardAccent : ''}`}>
                      <div className={styles.revenueCardTop}>
                        <div className={styles.revenueCardIconWrap}><Icon size={15} /></div>
                        {spark && sparkVals.length >= 2 && <Sparkline values={sparkVals} />}
                      </div>
                      <p className={styles.revenueCardValue}>{value}</p>
                      <p className={styles.revenueCardLabel}>{label}</p>
                    </div>
                  ))}
                </div>

                {/* ── Area chart — full width ── */}
                <div className={styles.revenueChartCard}>
                  <div className={styles.revenueChartHeader}>
                    <p className={styles.revenueChartTitle}>
                      <CalendarDays size={13} /> Monthly Earnings
                    </p>
                    <span className={styles.revenueChartSub}>Last {monthly.length} months · ₹ INR</span>
                  </div>
                  {monthly.length === 0
                    ? <p className={styles.revenueEmpty}>No monthly data yet — first calculation after content goes live.</p>
                    : <AreaChart data={monthly} />
                  }
                </div>

                {/* ── Earnings by title (full width) ── */}
                {content.length > 0 && (
                  <div className={styles.revenueContentCard}>
                    <p className={styles.revenueChartTitle}><Film size={13} /> Earnings by Title</p>
                    <div className={styles.revenueContentTable}>
                      <div className={styles.revenueContentHead}>
                        <span>Title</span><span>Views</span><span>Earned</span>
                      </div>
                      {content.map((item) => {
                        const pct = Math.round(((item.earned ?? 0) / maxEarned) * 100)
                        return (
                          <div key={item._id} className={styles.revenueContentRow}>
                            <div className={styles.revenueContentInfo}>
                              <span className={styles.rowType}>{item.type}</span>
                              <p className={styles.revenueContentTitle}>{item.title}</p>
                              <div className={styles.revenueContentBar}>
                                <div className={styles.revenueContentBarFill} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <span className={styles.revenueContentStat}>{(item.viewCount || 0).toLocaleString()}</span>
                            <span className={styles.revenueEarnedBadge}>{fmt(item.earned ?? 0)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ── Tier + Next Payout — full-width 3-col horizontal card ── */}
                {(() => {
                  const now           = new Date()
                  const payoutDay     = 15
                  const nextPayout    = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= payoutDay ? 1 : 0), payoutDay)
                  const daysUntil     = Math.ceil((nextPayout - now) / (1000 * 60 * 60 * 24))
                  const THRESHOLD     = 1000   // ₹1,000 minimum payout
                  const pending       = ov.pendingPayout ?? 0
                  const thresholdPct  = Math.min(Math.round((pending / THRESHOLD) * 100), 100)
                  const thresholdMet  = pending >= THRESHOLD
                  return (
                    <div className={styles.revenueTierFullCard}>
                      {/* Col 1: Rings */}
                      <div className={styles.revenueTierCol}>
                        <p className={styles.revenueChartTitle} style={{ marginBottom: 14 }}>
                          <Trophy size={13} /> Creator Tier
                        </p>
                        <div className={styles.revenueTierRingWrap}>
                          <TierRings totalViews={tier.totalViews ?? 0} />
                          <div className={styles.revenueTierRingLegend}>
                            {[
                              { label: 'Newcomer',    color: '#6366f1', max: '< 1k'   },
                              { label: 'Rising Star', color: '#8b5cf6', max: '< 10k'  },
                              { label: 'Established', color: '#a78bfa', max: '< 100k' },
                              { label: 'Featured',    color: '#c4b5fd', max: '100k+'  },
                            ].map((t) => (
                              <div key={t.label} className={styles.revenueTierLegendRow}>
                                <span className={styles.revenueTierLegendDot} style={{ background: t.color }} />
                                <span className={styles.revenueTierLegendLabel}>{t.label}</span>
                                <span className={styles.revenueTierLegendMax}>{t.max}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Divider */}
                      <div className={styles.revenueTierDivider} />

                      {/* Col 2: Perks */}
                      <div className={styles.revenueTierCol}>
                        <p className={styles.revenueChartTitle} style={{ marginBottom: 14 }}>
                          <Sparkles size={13} /> {tier.name || 'Newcomer'} Benefits
                        </p>
                        <div className={styles.revenueTierPerks}>
                          {[
                            { text: `${tier.revenueShare ?? 60}% revenue share`,                    done: true  },
                            { text: 'Monthly payouts on the 15th',                                  done: true  },
                            { text: 'Priority admin review',     done: (tier.level ?? 1) >= 2 },
                            { text: 'Featured shelf placement',  done: (tier.level ?? 1) >= 3 },
                            { text: 'Dedicated creator support', done: (tier.level ?? 1) >= 4 },
                          ].map(({ text, done }) => (
                            <p key={text} className={`${styles.revenueTierPerk} ${!done ? styles.revenueTierPerkLocked : ''}`}>
                              {done ? <CheckCircle2 size={11} /> : <Clock size={11} />} {text}
                            </p>
                          ))}
                        </div>
                        {tier.nextTier && (
                          <div className={styles.revenueTierUpgrade}>
                            <p className={styles.revenueTierUpgradeLabel}>
                              {(tier.totalViews || 0).toLocaleString()} / {(tier.nextMinViews || 0).toLocaleString()} views → {tier.nextTier}
                            </p>
                            <div className={styles.revenueTierBar}>
                              <div className={styles.revenueTierBarFill} style={{ width: `${Math.min(tier.progress ?? 0, 100)}%` }} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Divider */}
                      <div className={styles.revenueTierDivider} />

                      {/* Col 3: Next payout */}
                      <div className={styles.revenueTierCol}>
                        <p className={styles.revenueChartTitle} style={{ marginBottom: 14 }}>
                          <CalendarDays size={13} /> Next Payout
                        </p>
                        <div className={styles.revenuePayoutCountdown}>
                          <p className={styles.revenuePayoutDays}>
                            {thresholdMet ? '✓' : daysUntil}
                          </p>
                          <p className={styles.revenuePayoutDaysLabel}>
                            {thresholdMet ? 'Ready to pay out' : `day${daysUntil !== 1 ? 's' : ''} until the 15th`}
                          </p>
                        </div>
                        <div className={styles.revenueThresholdWrap}>
                          <div className={styles.revenueThresholdLabels}>
                            <span>{fmt(pending)} pending</span>
                            <span className={styles.revenueThresholdTarget}>₹1,000 threshold</span>
                          </div>
                          <div className={styles.revenueThresholdBar}>
                            <div
                              className={`${styles.revenueThresholdFill} ${thresholdMet ? styles.revenueThresholdFillMet : ''}`}
                              style={{ width: `${thresholdPct}%` }}
                            />
                          </div>
                          <p className={styles.revenueThresholdNote}>
                            {thresholdMet
                              ? 'Your balance will be transferred on the 15th.'
                              : `${fmt(THRESHOLD - pending)} more needed to unlock payout.`}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* ── Payout history ── */}
                <div className={styles.revenuePayoutCard}>
                  <p className={styles.revenueChartTitle}><Wallet size={13} /> Payout History</p>
                  {payouts.length === 0 ? (
                    <p className={styles.revenueEmpty}>No payouts yet — your first payout is issued once your balance reaches ₹1,000.</p>
                  ) : (
                    <div className={styles.revenuePayoutList}>
                      {payouts.map((payout) => (
                        <div key={payout._id} className={styles.revenuePayoutItem}>
                          <div className={styles.revenuePayoutLeft}>
                            <p className={styles.revenuePayoutAmount}>{fmt(payout.amount)}</p>
                            <p className={styles.revenuePayoutMeta}>
                              {new Date(payout.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              {payout.method ? ` · ${payout.method}` : ''}
                            </p>
                          </div>
                          <span className={styles.revenuePayoutStatus} style={{
                            color:       payout.status === 'paid' ? '#4ade80' : '#fbbf24',
                            background:  payout.status === 'paid' ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.1)',
                            borderColor: payout.status === 'paid' ? 'rgba(74,222,128,0.25)' : 'rgba(251,191,36,0.25)',
                          }}>
                            {payout.status === 'paid' ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                            {payout.status === 'paid' ? 'Paid' : 'Processing'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )
          })()}
        </section>
      )}

      {activeTab === 'submissions' && <section className={styles.submissions}>
        <div className={styles.submissionsHead}>
          <div className={styles.filterTabs}>
            {[
              { id: 'all',      label: 'All' },
              { id: 'pending',  label: 'In Review' },
              { id: 'approved', label: 'Live' },
              { id: 'rejected', label: 'Rejected' },
            ].map(({ id, label }) => (
              <button
                key={id}
                className={`${styles.filterTab} ${filterTab === id ? styles.filterTabActive : ''}`}
                onClick={() => handleFilterTab(id)}
              >
                {label}
                {id !== 'all' && stats[id] > 0 && (
                  <span className={styles.filterCount}>{stats[id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {listLoading ? (
          <div className={styles.loadingState} style={{ padding: '48px 0' }}>
            <p>Loading submissions…</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <Film size={32} />
            </div>
            <h3 className={styles.emptyTitle}>
              {filterTab === 'all'
                ? 'Your studio is empty'
                : `No ${filterTab === 'approved' ? 'live' : filterTab === 'pending' ? 'in-review' : 'rejected'} submissions`
              }
            </h3>
            <p className={styles.emptyDesc}>
              {filterTab === 'all'
                ? 'Submit your first film, documentary, or series and share Bengali stories with the world.'
                : 'Switch to "All" to see your full submission history.'
              }
            </p>
            {filterTab === 'all' && (
              <button className={styles.newBtn} onClick={openModal}>
                <Plus size={14} /> Submit Your First Work
              </button>
            )}
          </div>
        ) : (
          <div className={styles.submissionList}>
            {submissions.map((item) => (
              <div key={item._id} className={styles.submissionRow}>
                {/* Poster */}
                <div className={styles.rowPoster}>
                  {item.posterUrl
                    ? <img src={item.posterUrl} alt={item.title} className={styles.posterImg} />
                    : <div className={styles.posterFallback}><Film size={18} opacity={0.4} /></div>
                  }
                </div>

                {/* Info */}
                <div className={styles.rowInfo}>
                  <div className={styles.rowTop}>
                    <span className={styles.rowType}>{item.type}</span>
                    <StatusChip status={item.submissionStatus} />
                  </div>
                  <p className={styles.rowTitle}>{item.title}</p>
                  {item.genre?.length > 0 && (
                    <p className={styles.rowGenre}>{item.genre.slice(0, 3).join(' · ')}</p>
                  )}
                  {item.submissionStatus === 'rejected' && item.rejectionReason && (
                    <p className={styles.rowRejection}>
                      <AlertTriangle size={11} /> {item.rejectionReason}
                    </p>
                  )}
                </div>

                {/* Date */}
                <p className={styles.rowDate}>
                  {new Date(item.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </p>

                {/* Actions */}
                <div className={styles.rowActions}>
                  {item.submissionStatus === 'approved' && (
                    <button className={styles.actionBtn} onClick={() => navigate(`/watch/${item._id}`)}>
                      <Eye size={12} /> View Live
                    </button>
                  )}
                  {item.submissionStatus === 'rejected' && (
                    <button className={styles.actionBtnPrimary} onClick={() => handleResubmit(item._id)}>
                      <RotateCcw size={12} /> Resubmit
                    </button>
                  )}
                  {item.submissionStatus === 'pending' && (
                    <span className={styles.pendingNote}>
                      <Clock size={11} /> Awaiting review
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>}

      {/* ── New Submission Modal ── */}
      {showModal && (() => {
        const activeSteps = form.type === 'Series' ? STEPS_SERIES : STEPS_BASE
        const currentStepId = activeSteps[step]?.id ?? 'basics'
        return (
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className={styles.modalPanel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>

            <div className={styles.modalHeader}>
              <div>
                <p className={styles.modalEyebrow}>Step {step + 1} of {activeSteps.length}</p>
                <h2 className={styles.modalTitle}>{activeSteps[step]?.label}</h2>
              </div>
              <button className={styles.modalClose} onClick={closeModal} aria-label="Close"><X size={16} /></button>
            </div>

            {/* Step indicator */}
            <div className={styles.stepIndicator}>
              {activeSteps.map((s, i) => (
                <div key={s.id} className={styles.stepItem}>
                  <div className={`${styles.stepDot} ${i < step ? styles.stepDotDone : i === step ? styles.stepDotActive : ''}`}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span className={`${styles.stepLabel} ${i === step ? styles.stepLabelActive : ''}`}>{s.label}</span>
                  {i < activeSteps.length - 1 && <div className={`${styles.stepLine} ${i < step ? styles.stepLineDone : ''}`} />}
                </div>
              ))}
            </div>

            <div className={styles.modalBody}>

              {/* Step — Basics */}
              {currentStepId === 'basics' && (
                <div className={styles.formGrid}>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Title *
                    <input className={styles.input} value={form.title} onChange={ff('title')} placeholder="e.g. আলোর পথে" autoFocus />
                  </label>
                  <label className={styles.label}>
                    Subtitle / Tagline
                    <input className={styles.input} value={form.subtitle} onChange={ff('subtitle')} placeholder="Optional" />
                  </label>
                  <label className={styles.label}>
                    Type
                    <select className={styles.select} value={form.type} onChange={ff('type')}>
                      <option value="Film">Film</option>
                      <option value="Series">Series</option>
                      <option value="Documentary">Documentary</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    <span>Genre <span className={styles.labelHint}>(comma-separated)</span></span>
                    <input className={styles.input} value={form.genre} onChange={ff('genre')} placeholder="Drama, Thriller" />
                  </label>
                  <label className={styles.label}>
                    Release Year
                    <input className={styles.input} type="number" min="1900" max="2099" value={form.releaseYear} onChange={ff('releaseYear')} placeholder="2024" />
                  </label>
                  <label className={styles.label}>
                    Language
                    <select className={styles.select} value={form.contentLanguage} onChange={ff('contentLanguage')}>
                      <option value="Bengali">Bengali (বাংলা)</option>
                      <option value="Hindi">Hindi</option>
                      <option value="English">English</option>
                      <option value="Odia">Odia</option>
                      <option value="Tamil">Tamil</option>
                      <option value="Telugu">Telugu</option>
                    </select>
                  </label>
                  <label className={styles.label}>
                    Certification
                    <select className={styles.select} value={form.certification} onChange={ff('certification')}>
                      <option value="">— Select —</option>
                      <option value="U">U — Universal</option>
                      <option value="UA">UA — Parental Guidance</option>
                      <option value="A">A — Adults Only</option>
                    </select>
                  </label>
                </div>
              )}

              {/* Step — Media */}
              {currentStepId === 'media' && (
                <div className={styles.formGrid}>
                  {[
                    { field: 'posterUrl',   label: 'Poster',   hint: '2:3 portrait',    key: 'poster' },
                    { field: 'backdropUrl', label: 'Backdrop', hint: '16:9 landscape',  key: 'backdrop' },
                  ].map(({ field, label, hint, key }) => (
                    <div key={field} className={styles.imageSlot}>
                      <p className={styles.imageSlotLabel}>{label} <span className={styles.labelHint}>{hint}</span></p>
                      <div className={styles.imagePreviewWrap}>
                        {form[field]
                          ? <img src={form[field]} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
                          : <div className={styles.imageEmpty}><ImagePlus size={22} opacity={0.3} /><span>No image</span></div>
                        }
                      </div>
                      <label className={styles.imageUploadBtn}>
                        {imgUploading[key] ? `Uploading… ${imgProgress[key]}%` : `Upload ${label}`}
                        <input type="file" accept="image/*" style={{ display: 'none' }} disabled={imgUploading[key]}
                          onChange={(e) => handleImageUpload(field, e.target.files?.[0])} />
                      </label>
                      <input className={styles.input} value={form[field]} onChange={ff(field)} placeholder="Or paste URL…" />
                    </div>
                  ))}
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Bunny Video ID <span className={styles.labelHint}>(optional — admin can link it via Upload tab)</span>
                    <input className={styles.input} value={form.bunnyVideoId} onChange={ff('bunnyVideoId')} placeholder="Paste GUID from Bunny Stream" />
                  </label>
                </div>
              )}

              {/* Step — Details */}
              {currentStepId === 'details' && (
                <div className={styles.formGrid}>
                  <label className={`${styles.label} ${styles.spanFull}`}>
                    Synopsis / Description
                    <textarea className={styles.textarea} rows={4} value={form.desc} onChange={ff('desc')} placeholder="গল্পের সারসংক্ষেপ লিখুন…" />
                  </label>
                  <label className={styles.label}>
                    Director
                    <input className={styles.input} value={form.director} onChange={ff('director')} placeholder="পরিচালকের নাম" />
                  </label>
                  {form.type !== 'Series' && (
                    <label className={styles.label}>
                      Duration <span className={styles.labelHint}>(e.g. 2h, 1h 45m, 105m)</span>
                      <input
                        className={`${styles.input} ${form.duration && !isValidDuration(form.duration) ? styles.inputError : ''}`}
                        value={form.duration}
                        onChange={ff('duration')}
                        placeholder="1h 45m"
                      />
                      {form.duration && !isValidDuration(form.duration) && (
                        <span className={styles.fieldHintError}>Use: 42m · 2h · 1h 20m · 1:20</span>
                      )}
                    </label>
                  )}
                  <label className={styles.label}>
                    Cast <span className={styles.labelHint}>(comma-separated)</span>
                    <input className={styles.input} value={form.cast} onChange={ff('cast')} placeholder="Actor 1, Actor 2" />
                  </label>
                  <label className={styles.label}>
                    Mood Tags <span className={styles.labelHint}>(comma-separated)</span>
                    <input className={styles.input} value={form.moodTags} onChange={ff('moodTags')} placeholder="Emotional, Suspenseful" />
                  </label>
                  <label className={styles.label}>
                    Content Warnings
                    <input className={styles.input} value={form.contentWarnings} onChange={ff('contentWarnings')} placeholder="violence, language" />
                  </label>
                </div>
              )}

              {/* Step — Episodes (Series only) */}
              {currentStepId === 'episodes' && (
                <div>
                  <div className={styles.episodeStepHeader}>
                    <p className={styles.episodeStepTitle}><ListPlus size={14} /> Define Episodes</p>
                    <button
                      type="button"
                      className={styles.addEpBtn}
                      onClick={() => {
                        const nextNum = form.episodes.length > 0
                          ? Math.max(...form.episodes.map((e) => e.number)) + 1
                          : 1
                        setForm((prev) => ({
                          ...prev,
                          episodes: [...prev.episodes, { number: nextNum, title: '', duration: '' }],
                        }))
                      }}
                    >
                      <Plus size={12} /> Add Episode
                    </button>
                  </div>

                  {form.episodes.length === 0 && (
                    <p className={styles.episodeEmpty}>
                      No episodes yet. Click "Add Episode" to define your series structure.
                    </p>
                  )}

                  <div className={styles.episodeList}>
                    {form.episodes.map((ep, idx) => (
                      <div
                        key={idx}
                        className={`${styles.episodeRow} ${dragEpIdx === idx ? styles.episodeRowDragging : ''}`}
                        draggable
                        onDragStart={() => setDragEpIdx(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragEpIdx === null || dragEpIdx === idx) { setDragEpIdx(null); return }
                          setForm((prev) => {
                            const eps = [...prev.episodes]
                            const [moved] = eps.splice(dragEpIdx, 1)
                            eps.splice(idx, 0, moved)
                            return { ...prev, episodes: eps }
                          })
                          setDragEpIdx(null)
                        }}
                        onDragEnd={() => setDragEpIdx(null)}
                      >
                        <GripVertical size={14} className={styles.epDragHandle} />
                        <input
                          className={`${styles.input} ${styles.epInputNum}`}
                          type="number"
                          min="1"
                          value={ep.number}
                          onChange={(e) => setForm((prev) => ({
                            ...prev,
                            episodes: prev.episodes.map((x, i) => i === idx ? { ...x, number: Number(e.target.value) } : x),
                          }))}
                          placeholder="1"
                        />
                        <input
                          className={`${styles.input} ${styles.epInputTitle}`}
                          value={ep.title}
                          onChange={(e) => setForm((prev) => ({
                            ...prev,
                            episodes: prev.episodes.map((x, i) => i === idx ? { ...x, title: e.target.value } : x),
                          }))}
                          placeholder={`Episode ${ep.number} title`}
                        />
                        <div className={styles.epDurationWrap}>
                          <input
                            className={`${styles.input} ${styles.epInputDuration} ${ep.duration && !isValidDuration(ep.duration) ? styles.epInputError : ''}`}
                            value={ep.duration}
                            onChange={(e) => setForm((prev) => ({
                              ...prev,
                              episodes: prev.episodes.map((x, i) => i === idx ? { ...x, duration: e.target.value } : x),
                            }))}
                            placeholder="42m"
                            title="Format: 42m · 1h · 1h 20m · 1:20"
                          />
                          {ep.duration && !isValidDuration(ep.duration) && (
                            <span className={styles.epDurationHint}>e.g. 42m</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={styles.epDeleteBtn}
                          onClick={() => setForm((prev) => ({
                            ...prev,
                            episodes: prev.episodes.filter((_, i) => i !== idx),
                          }))}
                          aria-label="Remove episode"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className={styles.episodeHint}>
                    Drag rows to reorder. Admin will upload video files for each episode after approval.
                  </p>
                </div>
              )}

              {/* Step — Review */}
              {currentStepId === 'review' && (
                <div className={styles.reviewGrid}>
                  <div className={styles.reviewSection}>
                    <p className={styles.reviewHead}>Basics</p>
                    <dl className={styles.reviewDl}>
                      <dt>Title</dt>     <dd>{form.title || '—'}</dd>
                      <dt>Type</dt>      <dd>{form.type}</dd>
                      <dt>Genre</dt>     <dd>{form.genre || '—'}</dd>
                      <dt>Year</dt>      <dd>{form.releaseYear || '—'}</dd>
                      <dt>Language</dt>  <dd>{form.contentLanguage}</dd>
                      <dt>Cert.</dt>     <dd>{form.certification || '—'}</dd>
                    </dl>
                  </div>
                  <div className={styles.reviewSection}>
                    <p className={styles.reviewHead}>Media</p>
                    <dl className={styles.reviewDl}>
                      <dt>Poster</dt>    <dd style={{ color: form.posterUrl   ? '#4ade80' : '#888' }}>{form.posterUrl   ? '✓ Set' : 'Not set'}</dd>
                      <dt>Backdrop</dt>  <dd style={{ color: form.backdropUrl ? '#4ade80' : '#888' }}>{form.backdropUrl ? '✓ Set' : 'Not set'}</dd>
                      <dt>Video ID</dt>  <dd style={{ color: form.bunnyVideoId ? '#4ade80' : '#888' }}>{form.bunnyVideoId || 'Not set'}</dd>
                    </dl>
                  </div>
                  <div className={styles.reviewSection}>
                    <p className={styles.reviewHead}>Details</p>
                    <dl className={styles.reviewDl}>
                      <dt>Director</dt>  <dd>{form.director || '—'}</dd>
                      <dt>Cast</dt>      <dd>{form.cast || '—'}</dd>
                      <dt>Mood</dt>      <dd>{form.moodTags || '—'}</dd>
                    </dl>
                  </div>
                  {form.type === 'Series' && (
                    <div className={styles.reviewSection}>
                      <p className={styles.reviewHead}>Episodes</p>
                      <dl className={styles.reviewDl}>
                        <dt>Defined</dt>
                        <dd style={{ color: form.episodes.filter(e => e.title).length > 0 ? '#4ade80' : '#888' }}>
                          {form.episodes.filter(e => e.title).length > 0
                            ? `${form.episodes.filter(e => e.title).length} episode${form.episodes.filter(e => e.title).length !== 1 ? 's' : ''}`
                            : 'None — admin will add after approval'}
                        </dd>
                      </dl>
                    </div>
                  )}
                  <p className={styles.reviewNote}>
                    Once submitted, your content will be reviewed by the Dhara team. You'll be able to see the status in your studio.
                  </p>
                  {submitError && (
                    <p className={styles.submitError}><AlertTriangle size={13} /> {submitError}</p>
                  )}
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.ghostBtn} onClick={() => step > 0 ? setStep(step - 1) : closeModal()}>
                {step === 0 ? 'Cancel' : '← Back'}
              </button>
              {step < activeSteps.length - 1 ? (
                <button className={styles.primaryBtn} onClick={() => {
                  if (currentStepId === 'basics' && !form.title.trim()) { setSubmitError('Title is required.'); return }
                  if (currentStepId === 'details' && form.type !== 'Series' && form.duration && !isValidDuration(form.duration)) {
                    setSubmitError(`Invalid duration "${form.duration}". Use "1h 45m", "105m", or "1:45".`); return
                  }
                  if (currentStepId === 'episodes') {
                    const badEp = form.episodes.find((ep) => ep.duration && !isValidDuration(ep.duration))
                    if (badEp) {
                      setSubmitError(`Episode ${badEp.number}: invalid duration "${badEp.duration}". Use "42m", "1h 20m", or "1:20".`)
                      return
                    }
                  }
                  setSubmitError(''); setStep(step + 1)
                }}>
                  Next →
                </button>
              ) : (
                <button className={styles.primaryBtn} onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit for Review'}
                </button>
              )}
            </div>
          </div>
        </div>
        )
      })()}
    </main>
  )
}
