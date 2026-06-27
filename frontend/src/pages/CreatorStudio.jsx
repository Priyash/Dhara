import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  X, AlertTriangle, Film, CheckCircle2, XCircle,
  Plus, Eye, RotateCcw, ImagePlus, Clapperboard,
  Clock, TrendingUp, ArrowRight, GripVertical, ListPlus, Trash2,
  BarChart2, ThumbsUp, ChevronDown, ChevronRight, Award,
  IndianRupee, Wallet, Banknote, Trophy, CalendarDays, Sparkles,
  MapPin, Clock3, Activity, Flame, Minus, TrendingDown, Zap,
  Heart, MessageCircle, Search, Upload,
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
  requestCreatorPayout,
  getCreatorPayoutDetails,
  updateCreatorPayoutDetails,
  listCreatorReels,
  deleteCreatorReel,
  resubmitCreatorReel,
  fetchReelAnalytics,
  listCreatorThumbnailVariants,
  createCreatorThumbnailVariant,
  updateCreatorThumbnailVariant,
  deleteCreatorThumbnailVariant,
} from '../services/api'
import styles from './CreatorStudio.module.css'
import { isValidDuration } from '../utils/duration'
import ReelUploadModal from '../components/ReelUploadModal'
import ThumbnailVariantModal from '../components/ThumbnailVariantModal'

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
  const color   = rate >= 70 ? '#4ade80' : rate >= 40 ? '#f472b6' : '#f87171'
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
    { label: 'In Review', value: counts.pending  || 0, color: '#f472b6' },
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
    { label: 'Has Likes', value: withLikes,            color: '#db2777', bg: 'rgba(219,39,119,0.08)'  },
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
  const GRAD   = { Film: ['#4c1d95','#a78bfa'], Series: ['#78350f','#db2777'], Documentary: ['#064e3b','#34d399'] }
  return (
    <div className={styles.rankingBars}>
      {sorted.map((item, i) => {
        const pct    = Math.max((item.viewCount / maxV) * 100, 1)
        const [f, t] = GRAD[item.type] || ['#1e1b4b','#a78bfa']
        const eng    = item.viewCount > 0 ? ((item.likeCount / item.viewCount) * 100).toFixed(1) : '0'
        const eColor = Number(eng) >= 10 ? '#4ade80' : Number(eng) >= 4 ? '#f472b6' : 'rgba(255,255,255,0.25)'
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
  const TC   = { Film: '#a78bfa', Series: '#db2777', Documentary: '#34d399' }
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

// ── Health score (derived, no server round-trip) ──────────────────────────────
function calcHealth(item, avgViews) {
  if (item.submissionStatus !== 'approved' || item.viewCount === 0) return null
  const viewRatio = Math.min(item.viewCount / Math.max(avgViews, 1), 2) / 2
  const engRatio  = Math.min((item.likeCount / item.viewCount) / 0.15, 1)
  const score     = viewRatio * 60 + engRatio * 40
  if (score >= 70) return { label: 'Hot',     color: '#db2777', Icon: Flame        }
  if (score >= 45) return { label: 'Rising',  color: '#4ade80', Icon: TrendingUp   }
  if (score >= 25) return { label: 'Steady',  color: '#a78bfa', Icon: Minus        }
  return              { label: 'Cooling', color: '#94a3b8', Icon: TrendingDown }
}

// ── Rank delta chip ───────────────────────────────────────────────────────────
function RankDelta({ delta }) {
  if (!delta) return <span className={styles.rankDeltaNeutral}><Minus size={8} /></span>
  return delta > 0
    ? <span className={styles.rankDeltaUp}>▲{Math.abs(delta)}</span>
    : <span className={styles.rankDeltaDown}>▼{Math.abs(delta)}</span>
}

// ── Auto-generated insights row ───────────────────────────────────────────────
function InsightsRow({ overview, content }) {
  const ov      = overview || {}
  const cards   = []

  if (ov.topContent && ov.avgViewsPerTitle > 0) {
    const mult = (ov.topContent.viewCount / ov.avgViewsPerTitle).toFixed(1)
    if (Number(mult) >= 1.5)
      cards.push({ color: '#db2777', text: `"${ov.topContent.title}" pulls ${mult}× more views than your average title` })
  }

  const films  = content.filter((c) => c.type === 'Film'   && c.viewCount > 0)
  const series = content.filter((c) => (c.type === 'Series' || c.type === 'Serial Drama') && c.viewCount > 0)
  if (films.length > 0 && series.length > 0) {
    const fEng = films.reduce((s, c) => s + c.likeCount / c.viewCount, 0) / films.length
    const sEng = series.reduce((s, c) => s + c.likeCount / c.viewCount, 0) / series.length
    const diff = Math.round(Math.abs(sEng - fEng) / Math.min(fEng, sEng) * 100)
    if (diff >= 10)
      cards.push({ color: '#a78bfa', text: sEng > fEng
        ? `Series get ${diff}% higher engagement than your films`
        : `Films outperform series by ${diff}% in audience engagement` })
  }

  if (ov.approvalRate >= 80)
    cards.push({ color: '#4ade80', text: `${ov.approvalRate}% approval rate — strong quality consistency` })
  else if (ov.approvalRate > 0 && ov.approvalRate < 50)
    cards.push({ color: '#f87171', text: `${ov.approvalRate}% approval — review submission guidelines to improve` })

  if (ov.engagementRate >= 10 && cards.length < 3)
    cards.push({ color: '#38bdf8', text: `${ov.engagementRate}% engagement rate — your audience is highly active` })

  if (!cards.length) return null
  return (
    <div className={styles.insightsRow}>
      {cards.slice(0, 3).map((c, i) => (
        <div key={i} className={styles.insightCard} style={{ borderColor: `${c.color}22`, background: `${c.color}08` }}>
          <Zap size={13} style={{ color: c.color, flexShrink: 0 }} />
          <p className={styles.insightText}>{c.text}</p>
        </div>
      ))}
    </div>
  )
}

// ── 7-day daily views bar chart ───────────────────────────────────────────────
// Ghost heights for the no-data state — gentle sine-wave rhythm so the chart
// looks intentional rather than broken when all values are zero.
const GHOST_HEIGHTS = [0.38, 0.55, 0.44, 0.68, 0.5, 0.35, 0.6]

function DailyViewsChart({ data }) {
  if (!data?.length) return null
  const W = 600, H = 96, PT = 18, PB = 20, PL = 4, PR = 4
  const iW = W - PL - PR, iH = H - PT - PB
  const hasAny = data.some((d) => d.views > 0)
  const maxV   = Math.max(...data.map((d) => d.views), 1)
  const gap    = iW / data.length
  const barW   = gap * 0.55
  const today  = new Date().toISOString().slice(0, 10)
  const DAY    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={styles.dailyChart}>
        {data.map((d, i) => {
          const cx    = PL + gap * i + gap / 2
          const x     = cx - barW / 2
          const isNow = d.date === today
          const lbl   = DAY[new Date(d.date + 'T12:00:00Z').getDay()]

          let barH, y, fill
          if (!hasAny) {
            barH = Math.round(GHOST_HEIGHTS[i] * iH)
            y    = PT + iH - barH
            fill = isNow ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.06)'
          } else {
            const pct = d.views / maxV
            barH = Math.max(pct * iH, d.views > 0 ? 3 : 2)
            y    = PT + iH - barH
            fill = isNow ? '#a78bfa' : 'rgba(167,139,250,0.38)'
          }

          return (
            <g key={d.date}>
              <rect x={x} y={y} width={barW} height={barH} rx="3" fill={fill}
                style={isNow && hasAny ? { filter: 'drop-shadow(0 0 7px rgba(167,139,250,0.55))' } : undefined} />
              {d.views > 0 && (
                <text x={cx} y={y - 5} textAnchor="middle" fontSize="9" fontWeight="600"
                  fill="rgba(167,139,250,0.85)" fontFamily="system-ui,sans-serif">{d.views}</text>
              )}
              <text x={cx} y={H - 3} textAnchor="middle" fontSize="9"
                fill={isNow ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.28)'}
                fontWeight={isNow ? '700' : '400'} fontFamily="system-ui,sans-serif">{lbl}</text>
            </g>
          )
        })}
      </svg>
      {!hasAny && (
        <p className={styles.chartNoData}>Views from new plays will appear here</p>
      )}
    </>
  )
}

// ── Hour-of-day histogram ─────────────────────────────────────────────────────
function HourHistogram({ data }) {
  if (!data?.length) return null
  const W = 560, H = 72, PT = 4, PB = 14, PL = 2, PR = 2
  const iW = W - PL - PR, iH = H - PT - PB
  const hasAny = data.some((d) => d.views > 0)
  const maxV   = Math.max(...data.map((d) => d.views), 1)
  const gap    = iW / 24
  const barW   = gap * 0.7
  const peak   = data.reduce((b, d) => d.views > b.views ? d : b, data[0])
  const fmtH   = (h) => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={styles.hourChart}>
        {data.map((d) => {
          const cx   = PL + gap * d.hour + gap / 2
          const x    = cx - barW / 2
          const barH = hasAny ? Math.max((d.views / maxV) * iH, d.views > 0 ? 2 : 1) : 3
          const y    = PT + iH - barH
          const isPk = hasAny && d.hour === peak.hour && peak.views > 0
          const show = d.hour % 6 === 0
          return (
            <g key={d.hour}>
              <rect x={x} y={y} width={barW} height={barH} rx="2"
                fill={isPk ? '#db2777' : hasAny && d.views > 0 ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.07)'}
                style={isPk ? { filter: 'drop-shadow(0 0 4px rgba(219,39,119,0.55))' } : undefined} />
              {show && (
                <text x={cx} y={H - 1} textAnchor="middle" fontSize="8"
                  fill={isPk ? 'rgba(219,39,119,0.9)' : 'rgba(255,255,255,0.22)'}
                  fontWeight={isPk ? '700' : '400'} fontFamily="system-ui,sans-serif">
                  {fmtH(d.hour)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {!hasAny && (
        <p className={styles.chartNoData}>Posting patterns will appear as views accumulate</p>
      )}
    </>
  )
}

// ── Geography bars ────────────────────────────────────────────────────────────
function GeographyBars({ data }) {
  if (!data?.length) return (
    <p className={styles.analyticsEmptyNote}>No location data yet — accumulates as views come in.</p>
  )
  const maxV = Math.max(...data.map((d) => d.views), 1)
  const fmtV = (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
  return (
    <div className={styles.geoList}>
      {data.slice(0, 8).map((d, i) => {
        const pct   = (d.views / maxV) * 100
        const alpha = i === 0 ? 1 : i < 3 ? 0.7 : 0.45
        return (
          <div key={d.state} className={styles.geoRow}>
            <span className={styles.geoRank}>#{i + 1}</span>
            <span className={styles.geoState}>{d.state}</span>
            <div className={styles.geoTrack}>
              <div className={styles.geoFill}
                style={{ width: `${pct}%`, background: `rgba(167,139,250,${alpha})` }} />
            </div>
            <span className={styles.geoCount}>{fmtV(d.views)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Episode retention line chart ──────────────────────────────────────────────
function EpisodeDropoff({ episodes }) {
  const sorted = [...episodes].sort((a, b) => a.number - b.number)
  if (sorted.length < 3) return null
  const W = 280, H = 72, P = 14
  const iW = W - P * 2, iH = H - P * 2
  const base = sorted[0].viewCount || 1
  const pts  = sorted.map((ep, i) => ({
    x:   P + (sorted.length > 1 ? i / (sorted.length - 1) : 0.5) * iW,
    y:   P + iH - Math.min(Math.max((ep.viewCount / base), 0), 1) * iH * 0.9,
    pct: Math.round((ep.viewCount / base) * 100),
    num: ep.number,
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L ${pts.at(-1).x} ${P + iH} L ${pts[0].x} ${P + iH} Z`
  let bigIdx = 0, bigDrop = 0
  for (let i = 1; i < pts.length; i++) {
    const drop = pts[i - 1].pct - pts[i].pct
    if (drop > bigDrop) { bigDrop = drop; bigIdx = i }
  }
  return (
    <div className={styles.episodeDropoff}>
      <p className={styles.episodeDropoffLabel}><TrendingDown size={11} /> Episode Retention</p>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={styles.dropoffChart}>
        <defs>
          <linearGradient id="dopG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0"    />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#dopG)" />
        <path d={line} fill="none" stroke="#a78bfa" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={i === bigIdx && bigDrop > 5 ? 4 : 2.5}
              fill={i === bigIdx && bigDrop > 5 ? '#f87171' : '#a78bfa'}
              stroke="#0d0d14" strokeWidth="1" />
            <text x={p.x} y={H - 1} textAnchor="middle" fontSize="8"
              fill="rgba(255,255,255,0.22)" fontFamily="system-ui,sans-serif">E{p.num}</text>
          </g>
        ))}
        {bigDrop > 5 && (
          <text x={pts[bigIdx].x} y={pts[bigIdx].y - 8} textAnchor="middle"
            fontSize="8" fill="#f87171" fontFamily="system-ui,sans-serif">▼{bigDrop}%</text>
        )}
      </svg>
    </div>
  )
}

// ── Video frame extraction helpers ───────────────────────────────────────────

function analyseVideoFrame(file) {
  return new Promise((resolve) => {
    const video  = document.createElement('video')
    const canvas = document.createElement('canvas')
    const url    = URL.createObjectURL(file)
    let   settled = false

    const finish = () => {
      if (settled) return
      settled = true
      const { videoWidth: w, videoHeight: h } = video
      let thumb = null
      try {
        const scale = w > 0 ? Math.min(1, 480 / w) : 1
        canvas.width  = Math.round(w * scale) || 480
        canvas.height = Math.round(h * scale) || 720
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        thumb = canvas.toDataURL('image/jpeg', 0.85)
      } catch {}
      URL.revokeObjectURL(url)
      resolve(thumb)
    }

    video.preload = 'auto'
    video.onloadedmetadata = () => { video.currentTime = Math.min(1e-5, video.duration) }
    video.onseeked      = finish
    video.onloadeddata  = () => setTimeout(() => { if (!settled) finish() }, 200)
    video.onerror       = () => { URL.revokeObjectURL(url); resolve(null) }
    video.src = url
  })
}

function dataUrlToFile(dataUrl, filename) {
  const [header, data] = dataUrl.split(',')
  const mime  = header.match(/:(.*?);/)[1]
  const bytes = atob(data)
  const arr   = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], filename, { type: mime })
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
  pending:  { label: 'In Review',  color: '#f472b6', bg: 'rgba(244,114,182,0.12)'  },
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
  const [artworkItem, setArtworkItem]   = useState(null)   // content whose artwork A/B modal is open
  const [filterTab, setFilterTab]       = useState('all')
  const [listLoading, setListLoading]   = useState(false)
  const [activeTab, setActiveTab]       = useState('submissions')
  const [analytics, setAnalytics]       = useState(null)
  const [analyticsLoading,   setAnalyticsLoading]   = useState(false)
  const [analyticsSubTab,    setAnalyticsSubTab]    = useState('content')  // 'content' | 'reels'
  const [revenue, setRevenue]           = useState(null)
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [payoutRequesting, setPayoutRequesting] = useState(false)
  const [payoutRequestMsg, setPayoutRequestMsg] = useState('')
  const [showPayoutDetailsModal, setShowPayoutDetailsModal] = useState(false)
  const [payoutDetails,      setPayoutDetails]      = useState(null)
  const [payoutDetailsForm,  setPayoutDetailsForm]  = useState({ method: 'bank', accountHolderName: '', accountNumber: '', ifsc: '', upiId: '' })
  const [payoutDetailsBusy,  setPayoutDetailsBusy]  = useState(false)
  const [payoutDetailsError, setPayoutDetailsError] = useState('')
  const [payoutDetailsSaved, setPayoutDetailsSaved] = useState(false)
  const [tierAdvancedDismissed, setTierAdvancedDismissed] = useState(false)
  const [expandedSeries, setExpandedSeries]     = useState(new Set())
  const [reels,           setReels]           = useState([])
  const [reelsLoading,    setReelsLoading]    = useState(false)
  const [reelAnalytics,   setReelAnalytics]   = useState(null)
  const [showReelModal,   setShowReelModal]   = useState(false)
  const [reelSearch,      setReelSearch]      = useState('')
  const [reelStatusFilter,setReelStatusFilter]= useState('all')
  const [showModal, setShowModal]       = useState(false)
  const [step, setStep]                 = useState(0)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [submitting, setSubmitting]     = useState(false)
  const [submitError, setSubmitError]   = useState('')
  const [toast, setToast]               = useState(null)
  const [imgUploading, setImgUploading] = useState({ poster: false, backdrop: false })
  const [imgProgress,  setImgProgress]  = useState({ poster: 0,     backdrop: 0     })
  const [vidThumbUploading, setVidThumbUploading] = useState(false)
  const vidThumbInputRef = useRef(null)
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
      // API returns a paginated shape { items, total, ... } — extract the array
      setSubmissions(Array.isArray(data) ? data : (data.items ?? []))
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

  const loadPayoutDetails = async () => {
    setPayoutDetailsBusy(true); setPayoutDetailsError('')
    try {
      const res = await getCreatorPayoutDetails()
      setPayoutDetails(res)
      setPayoutDetailsForm({
        method:            res.method || 'bank',
        accountHolderName: res.accountHolderName || '',
        accountNumber:     '',
        ifsc:              res.ifsc || '',
        upiId:             '',
      })
    } catch (err) {
      setPayoutDetailsError(err?.message || 'Could not load payout details.')
    } finally {
      setPayoutDetailsBusy(false)
    }
  }

  const handleSavePayoutDetails = async () => {
    setPayoutDetailsBusy(true); setPayoutDetailsError(''); setPayoutDetailsSaved(false)
    try {
      await updateCreatorPayoutDetails(payoutDetailsForm)
      setPayoutDetailsSaved(true)
      await loadPayoutDetails()
    } catch (err) {
      setPayoutDetailsError(err?.message || 'Could not save payout details.')
    } finally {
      setPayoutDetailsBusy(false)
    }
  }

  const loadReels = useCallback(async () => {
    setReelsLoading(true)
    try {
      const [reelData, analyticsData] = await Promise.all([
        listCreatorReels(),
        fetchReelAnalytics().catch(() => null),
      ])
      setReels(Array.isArray(reelData) ? reelData : (reelData.items ?? []))
      if (analyticsData) setReelAnalytics(analyticsData)
    } catch {
      setReels([])
    } finally {
      setReelsLoading(false)
    }
  }, [])

  const handleTabSwitch = (tab) => {
    setActiveTab(tab)
    if (tab === 'analytics') {
      if (!analytics)      loadAnalyticsData()
      if (!reelAnalytics)  loadReels()   // loads reels list + reel analytics together
    }
    if (tab === 'revenue' && !revenue)       loadRevenueData()
    if (tab === 'reels'   && !reels.length)  loadReels()
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

  const handleExtractPosterFromVideo = async (file) => {
    if (!file) return
    setVidThumbUploading(true)
    try {
      const thumb = await analyseVideoFrame(file)
      if (!thumb) throw new Error('Could not extract frame')
      const thumbFile = dataUrlToFile(thumb, 'poster-frame.jpg')
      const url = await uploadToCloudinary(thumbFile, { folder: 'dhara/creator' })
      setForm((prev) => ({ ...prev, posterUrl: url }))
    } catch (err) {
      showToast({ type: 'error', message: err?.message || 'Could not extract thumbnail from video.' })
    } finally {
      setVidThumbUploading(false)
      if (vidThumbInputRef.current) vidThumbInputRef.current.value = ''
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
        duration:    (form.type !== 'Series' && form.type !== 'Serial Drama') ? (form.duration?.trim() || '') : '',
        seasons:     (form.type === 'Series' || form.type === 'Serial Drama')
          ? [{
              number: 1,
              title: '',
              episodes: form.episodes
                .filter((ep) => ep.number && ep.title.trim())
                .map((ep) => ({ number: Number(ep.number), title: ep.title.trim(), duration: ep.duration.trim() })),
            }]
          : [],
      }
      delete payload.episodes
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
    const maxStep = (form.type === 'Series' || form.type === 'Serial Drama') ? STEPS_SERIES.length - 1 : STEPS_BASE.length - 1
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
          {activeTab === 'submissions' && (
            <button className={styles.newBtn} onClick={openModal}>
              <Plus size={15} /> New Submission
            </button>
          )}
          {activeTab === 'reels' && (
            <button className={styles.newBtn} onClick={() => setShowReelModal(true)}>
              <Plus size={15} /> New Reel
            </button>
          )}
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
            className={`${styles.tab} ${activeTab === 'reels' ? styles.tabActive : ''}`}
            onClick={() => handleTabSwitch('reels')}
          >
            <Zap size={13} /> Reels
            {reels.length > 0 && <span className={styles.tabCount}>{reels.length}</span>}
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
        // Fallback empty arrays for new fields — gracefully handles old backend responses
        const viewsByDay  = analytics?.viewsByDay  ?? Array.from({ length: 7 }, (_, i) => {
          const d = new Date(Date.now() - (6 - i) * 86_400_000)
          return { date: d.toISOString().slice(0, 10), views: 0 }
        })
        const viewsByHour  = analytics?.viewsByHour  ?? Array.from({ length: 24 }, (_, h) => ({ hour: h, views: 0 }))
        const viewsByState = analytics?.viewsByState ?? []
        const reelOv    = reelAnalytics?.overview    || {}
        const reelVd    = reelAnalytics?.viewsByDay  || []
        const reelVh    = reelAnalytics?.viewsByHour || []
        const reelVs    = reelAnalytics?.viewsByState || []
        const reelVdow  = reelAnalytics?.viewsByDow  || []
        const fmtReel = (n) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n ?? 0)

        return (
          <section className={styles.analytics}>

            {/* ── Sub-tab switcher ── */}
            <div className={styles.analyticsSubTabs}>
              <button
                className={`${styles.analyticsSubTab} ${analyticsSubTab === 'content' ? styles.analyticsSubTabActive : ''}`}
                onClick={() => setAnalyticsSubTab('content')}
              >
                <Film size={13} /> Content
              </button>
              <button
                className={`${styles.analyticsSubTab} ${analyticsSubTab === 'reels' ? styles.analyticsSubTabActive : ''}`}
                onClick={() => setAnalyticsSubTab('reels')}
              >
                <Zap size={13} /> Reels
              </button>
            </div>

            {/* ══════ CONTENT sub-tab ══════ */}
            {analyticsSubTab === 'content' && (analyticsLoading ? (
              <div className={styles.loadingState} style={{ padding: '48px 0' }}>
                <BarChart2 size={22} className={styles.loadingIcon} />
                <p>Loading analytics…</p>
              </div>
            ) : !analytics ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}><BarChart2 size={32} /></div>
                <h3 className={styles.emptyTitle}>No content data yet</h3>
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
                    <div className={styles.analyticsStatIcon} style={{ color: '#db2777', background: 'rgba(219,39,119,0.1)' }}>
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

                {/* ── Row 2: Insights ── */}
                <InsightsRow overview={ov} content={content} />

                {/* ── Row 3: Pipeline funnel (full width) ── */}
                {counts.total > 0 && (
                  <div className={styles.analyticsPipelineCard}>
                    <p className={styles.analyticsChartTitle}>
                      <TrendingUp size={13} /> Submission Pipeline
                    </p>
                    <p className={styles.analyticsChartSub}>From submission to audience engagement</p>
                    <PipelineFlow counts={counts} content={content} />
                  </div>
                )}

                {/* ── Row 4: 7-Day view trend ── */}
                <div className={styles.analyticsDailyCard}>
                  <p className={styles.analyticsChartTitle}>
                    <Activity size={13} /> 7-Day View Trend
                  </p>
                  <p className={styles.analyticsChartSub}>Daily views over the last 7 days · IST</p>
                  <DailyViewsChart data={viewsByDay} />
                </div>

                {content.length > 0 && (
                  <>
                    {/* ── Row 5: Ranking bars + Donut + Scatter ── */}
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

                    {/* ── Row 6: Geography + Best Time ── */}
                    <div className={styles.analyticsRow2}>
                      <div className={styles.analyticsChartCard}>
                        <p className={styles.analyticsChartTitle}>
                          <MapPin size={13} /> Audience by Region
                        </p>
                        <p className={styles.analyticsChartSub}>Top states · based on viewer location</p>
                        <GeographyBars data={viewsByState} />
                      </div>
                      <div className={styles.analyticsChartCard}>
                        <p className={styles.analyticsChartTitle}>
                          <Clock3 size={13} /> Best Time to Post
                        </p>
                        <p className={styles.analyticsChartSub}>View activity by hour · IST</p>
                        <HourHistogram data={viewsByHour} />
                        {(() => {
                          const peak = viewsByHour.reduce((b, d) => d.views > b.views ? d : b, viewsByHour[0])
                          if (!peak?.views) return null
                          const h = peak.hour
                          const lbl = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
                          return <p className={styles.peakHourNote}>Peak: {lbl} — plan posts 1–2 hrs before</p>
                        })()}
                      </div>
                    </div>

                    {/* ── Row 7: Content performance list ── */}
                    <div className={styles.analyticsContentList}>
                      {content
                        .slice()
                        .sort((a, b) => b.viewCount - a.viewCount)
                        .map((item, rank) => {
                          const isExpanded  = expandedSeries.has(item._id)
                          const viewPct     = Math.round((item.viewCount / maxViews) * 100)
                          const likePct     = item.viewCount > 0
                            ? Math.round((item.likeCount / item.viewCount) * 100) : 0
                          const hasEpisodes = (item.type === 'Series' || item.type === 'Serial Drama') && item.episodes.length > 0
                          const epMax       = hasEpisodes
                            ? Math.max(...item.episodes.map((e) => e.viewCount), 1) : 1
                          const eColor      = likePct >= 10 ? '#4ade80' : likePct >= 4 ? '#f472b6' : 'rgba(255,255,255,0.28)'
                          const health      = calcHealth(item, ov.avgViewsPerTitle)
                          const delta       = analytics?.rankingDeltas?.[String(item._id)] ?? null
                          return (
                            <div key={item._id} className={styles.analyticsContentRow}>
                              <div className={styles.analyticsRankCell}>
                                <span className={styles.analyticsContentRank}>#{rank + 1}</span>
                                <RankDelta delta={delta} />
                              </div>

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
                                    {health && (
                                      <span className={styles.healthBadge}
                                        style={{ color: health.color, borderColor: `${health.color}40` }}>
                                        <health.Icon size={9} /> {health.label}
                                      </span>
                                    )}
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
                                  <ThumbsUp size={10} style={{ color: '#db2777', flexShrink: 0, opacity: 0.7 }} />
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
                                      <>
                                      <EpisodeDropoff episodes={item.episodes} />
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
                                      </>
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

                {/* Footer guidance when creator has no approved content with views yet */}
                {analytics && ov.totalViews === 0 && (
                  <div className={styles.analyticsFooterNote}>
                    <BarChart2 size={16} />
                    <div>
                      <p className={styles.analyticsFooterTitle}>No view data yet</p>
                      <p className={styles.analyticsFooterSub}>
                        Analytics appear once your approved content gets its first views.
                        {stats.approved === 0 && ' Publish your first film or series to get started.'}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ))}

            {/* ══════ REELS sub-tab ══════ */}
            {analyticsSubTab === 'reels' && (reelsLoading ? (
              <div className={styles.loadingState} style={{ padding: '48px 0' }}>
                <Zap size={22} className={styles.loadingIcon} />
                <p>Loading reel analytics…</p>
              </div>
            ) : (
              <>
                {/* ── 4 focused stat cards — matches Content analytics layout ── */}
                <div className={styles.analyticsStatRow}>
                  {/* Total Views */}
                  <div className={styles.analyticsStatCard}>
                    <div className={styles.analyticsStatIcon} style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.1)' }}>
                      <Eye size={16} />
                    </div>
                    <p className={styles.analyticsStatValue}>{fmtReel(reelOv.totalViews)}</p>
                    <p className={styles.analyticsStatLabel}>Total Views</p>
                  </div>

                  {/* Total Likes */}
                  <div className={styles.analyticsStatCard}>
                    <div className={styles.analyticsStatIcon} style={{ color: '#db2777', background: 'rgba(219,39,119,0.1)' }}>
                      <Heart size={16} />
                    </div>
                    <p className={styles.analyticsStatValue}>{fmtReel(reelOv.totalLikes)}</p>
                    <p className={styles.analyticsStatLabel}>Total Likes</p>
                  </div>

                  {/* Approval Rate with arc */}
                  <div className={`${styles.analyticsStatCard} ${styles.analyticsStatCardArc}`}>
                    <ApprovalArc rate={reelOv.approvalRate ?? 0} />
                    <p className={styles.analyticsStatLabel}>Approval Rate</p>
                    <p className={styles.analyticsStatSub}>excl. pending</p>
                  </div>

                  {/* Engagement Rate */}
                  <div className={styles.analyticsStatCard}>
                    <div className={styles.analyticsStatIcon} style={{ color: '#4ade80', background: 'rgba(74,222,128,0.1)' }}>
                      <TrendingUp size={16} />
                    </div>
                    <p className={styles.analyticsStatValue}>
                      {reelOv.totalViews > 0
                        ? `${((reelOv.totalLikes / reelOv.totalViews) * 100).toFixed(1)}%`
                        : '0%'}
                    </p>
                    <p className={styles.analyticsStatLabel}>Engagement Rate</p>
                    <p className={styles.analyticsStatSub}>likes ÷ views</p>
                  </div>
                </div>

                {/* ── Full-width 7-day trend ── */}
                <div className={styles.reelChartFull}>
                  <div className={styles.reelChartFullHeader}>
                    <div>
                      <p className={styles.analyticsChartTitle}><Activity size={12} /> 7-DAY VIEW TREND</p>
                      <p className={styles.reelChartSubtext}>Daily views over the last 7 days · IST</p>
                    </div>
                  </div>
                  <DailyViewsChart data={reelVd} />
                </div>

                {/* ── Auto-generated reel insights ── */}
                {(() => {
                  const cards = []
                  const { totalViews, totalLikes, engagementRate, approvalRate, topReel, peakHour, peakDay } = reelOv

                  if (topReel && (totalViews || 0) > 0) {
                    const avgV = (totalViews || 0) / Math.max(reels.filter(r => r.submissionStatus === 'approved').length, 1)
                    const mult = (topReel.viewCount / avgV).toFixed(1)
                    if (Number(mult) >= 1.5)
                      cards.push({ color: '#db2777', text: `"${topReel.title || 'Your top reel'}" gets ${mult}× more views than your average reel` })
                  }
                  if (peakHour != null) {
                    const amPm = peakHour === 0 ? '12 AM' : peakHour < 12 ? `${peakHour} AM` : peakHour === 12 ? '12 PM' : `${peakHour - 12} PM`
                    cards.push({ color: '#a78bfa', text: `Peak hour is around ${amPm} IST — schedule uploads to go live before then` })
                  }
                  if (peakDay)
                    cards.push({ color: '#38bdf8', text: `${peakDay}s get the most views — your best day to release new reels` })
                  if ((engagementRate || 0) >= 10)
                    cards.push({ color: '#4ade80', text: `${engagementRate}% engagement rate — your audience is highly active on reels` })
                  if ((approvalRate || 0) > 0 && (approvalRate || 0) < 50)
                    cards.push({ color: '#f87171', text: `${approvalRate}% approval rate — review Dhara's content guidelines before re-submitting` })

                  // Hashtag insight: which hashtag has the most total views
                  const hashViews = {}
                  reels.filter(r => r.submissionStatus === 'approved' && r.viewCount > 0).forEach(r => {
                    ;(r.hashtags || []).forEach(t => { hashViews[t] = (hashViews[t] || 0) + r.viewCount })
                  })
                  const topHash = Object.entries(hashViews).sort((a, b) => b[1] - a[1])[0]
                  if (topHash)
                    cards.push({ color: '#c084fc', text: `#${topHash[0]} is your best-performing hashtag with ${fmtReel(topHash[1])} combined views` })

                  if (!cards.length) return null
                  return (
                    <div className={styles.insightsRow} style={{ marginBottom: 16 }}>
                      {cards.slice(0, 3).map((c, i) => (
                        <div key={i} className={styles.insightCard} style={{ borderColor: `${c.color}22`, background: `${c.color}08` }}>
                          <Zap size={13} style={{ color: c.color, flexShrink: 0 }} />
                          <p className={styles.insightText}>{c.text}</p>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* ── Hour histogram + Geography side by side ── */}
                {(reelVh.some(h => h.views > 0) || reelVs.length > 0) && (
                  <div className={styles.reelChartsRow} style={{ marginBottom: 12 }}>
                    {reelVh.length > 0 && (
                      <div className={styles.reelChartFull} style={{ marginBottom: 0 }}>
                        <p className={styles.analyticsChartTitle} style={{ marginBottom: 10 }}><Clock3 size={12} /> VIEWS BY HOUR</p>
                        <HourHistogram data={reelVh} />
                      </div>
                    )}
                    {reelVs.length > 0 && (
                      <div className={styles.reelChartFull} style={{ marginBottom: 0 }}>
                        <p className={styles.analyticsChartTitle} style={{ marginBottom: 10 }}><MapPin size={12} /> TOP STATES</p>
                        <GeographyBars data={reelVs} />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Reel health grid ── */}
                {(() => {
                  const approved = reels.filter(r => r.submissionStatus === 'approved' && r.viewCount > 0)
                  if (approved.length < 2) return null
                  const avgViews = approved.reduce((s, r) => s + r.viewCount, 0) / approved.length
                  return (
                    <div className={styles.reelChartFull} style={{ marginBottom: 12 }}>
                      <p className={styles.analyticsChartTitle} style={{ marginBottom: 14 }}><Flame size={12} /> REEL HEALTH</p>
                      <div className={styles.reelHealthGrid}>
                        {approved.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)).map((reel) => {
                          const eng   = reel.viewCount > 0 ? (reel.likeCount / reel.viewCount) * 100 : 0
                          const vRat  = Math.min(reel.viewCount / Math.max(avgViews, 1), 2) / 2
                          const score = vRat * 60 + Math.min(eng / 0.15, 1) * 40
                          const health = score >= 70
                            ? { label: 'Hot',     color: '#db2777', bg: 'rgba(219,39,119,0.1)',  Icon: Flame }
                            : score >= 45
                            ? { label: 'Rising',  color: '#4ade80', bg: 'rgba(74,222,128,0.1)', Icon: TrendingUp }
                            : score >= 25
                            ? { label: 'Steady',  color: '#a78bfa', bg: 'rgba(167,139,250,0.1)',Icon: Minus }
                            : { label: 'Cooling', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)',Icon: TrendingDown }
                          const HIcon = health.Icon
                          return (
                            <div key={reel._id} className={styles.reelHealthTile} style={{ borderColor: `${health.color}30`, background: health.bg }}>
                              <div className={styles.reelHealthBadge} style={{ color: health.color }}>
                                <HIcon size={11} /> {health.label}
                              </div>
                              <p className={styles.reelHealthTitle}>{reel.title || 'Untitled'}</p>
                              <div className={styles.reelHealthStats}>
                                <span><Eye size={10} /> {fmtReel(reel.viewCount)}</span>
                                <span><Heart size={10} /> {eng.toFixed(1)}%</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* ── Top reels bar chart (only when data exists) ── */}
                {(() => {
                  const top = [...reels]
                    .filter((r) => r.submissionStatus === 'approved' && (r.viewCount || 0) > 0)
                    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
                    .slice(0, 5)
                  if (!top.length) return null
                  const maxV = Math.max(...top.map((r) => r.viewCount || 0), 1)
                  const GRAD = ['#7c3aed','#a78bfa','#c4b5fd','#6366f1','#f472b6']
                  return (
                    <div className={styles.reelChartFull} style={{ marginTop: 12 }}>
                      <p className={styles.analyticsChartTitle}><TrendingUp size={12} /> TOP REELS BY VIEWS</p>
                      <div className={styles.reelBarChart} style={{ marginTop: 16 }}>
                        {top.map((r, i) => (
                          <div key={r._id} className={styles.reelBarRow}>
                            <span className={styles.reelBarLabel}>{r.title || 'Untitled'}</span>
                            <div className={styles.reelBarTrack}>
                              <div className={styles.reelBarFill}
                                style={{ width: `${Math.max(((r.viewCount||0)/maxV)*100,2)}%`, background: GRAD[i] }} />
                            </div>
                            <span className={styles.reelBarCount}>{fmtReel(r.viewCount||0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* ── Per-reel table — only shown when there are reels ── */}
                {reels.length > 0 && (
                  <div className={styles.reelAnalyticsTable}>
                    <div className={styles.reelAnalyticsHead}>
                      <span>Reel</span>
                      <span>Status</span>
                      <span className={styles.reelAnalyticsStat}><Eye size={11} /> Views</span>
                      <span className={styles.reelAnalyticsStat}><Heart size={11} /> Likes</span>
                      <span className={styles.reelAnalyticsStat}><MessageCircle size={11} /> Comments</span>
                      <span className={styles.reelAnalyticsStat}><TrendingUp size={11} /> Eng.</span>
                    </div>
                    {[...reels].sort((a, b) => (b.viewCount||0) - (a.viewCount||0)).map((reel) => {
                      const views = reel.viewCount||0, likes = reel.likeCount||0, comments = reel.commentCount||0
                      const eng = views > 0 ? `${((likes/views)*100).toFixed(1)}%` : '—'
                      return (
                        <div key={reel._id} className={styles.reelAnalyticsRow}>
                          <div className={styles.reelAnalyticsInfo}>
                            <div className={styles.reelAnalyticsThumb}
                              style={reel.thumbnailUrl
                                ? { backgroundImage: `url(${reel.thumbnailUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                                : { background: 'linear-gradient(160deg,#1e1b4b,#7c3aed)' }}
                            />
                            <div>
                              <p className={styles.reelAnalyticsTitle}>{reel.title || <em style={{ color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>No caption</em>}</p>
                              {reel.hashtags?.length > 0 && <p className={styles.reelAnalyticsTags}>#{reel.hashtags.slice(0,2).join(' #')}</p>}
                            </div>
                          </div>
                          <div><StatusChip status={reel.submissionStatus} /></div>
                          <span className={styles.reelAnalyticsStat} style={{ color: '#a78bfa' }}>{fmtReel(views)}</span>
                          <span className={styles.reelAnalyticsStat} style={{ color: '#db2777' }}>{fmtReel(likes)}</span>
                          <span className={styles.reelAnalyticsStat} style={{ color: '#c084fc' }}>{fmtReel(comments)}</span>
                          <span className={styles.reelAnalyticsStat} style={{ color: eng !== '—' ? '#4ade80' : 'rgba(255,255,255,0.2)' }}>{eng}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── Info card — always shown at the bottom ── */}
                <div className={styles.analyticsFooterNote}>
                  <BarChart2 size={16} />
                  <div>
                    <p className={styles.analyticsFooterTitle}>
                      {(reelOv.totalViews ?? 0) === 0
                        ? 'No view data yet'
                        : 'Analytics update in real-time'}
                    </p>
                    <p className={styles.analyticsFooterSub}>
                      {reels.length === 0
                        ? 'Upload your first reel and submit it for review to start seeing analytics here.'
                        : (reelOv.approved ?? 0) === 0
                        ? 'Your reels are under review. Analytics will appear once a reel is approved and gets its first views.'
                        : (reelOv.totalViews ?? 0) === 0
                        ? 'Analytics appear once your approved reels get their first views. Share your reels to drive traffic.'
                        : 'View counts, likes and comments update as viewers interact with your reels on the Reels feed.'
                      }
                    </p>
                  </div>
                </div>
              </>
            ))}

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
                {/* ── Tier advancement banner ── */}
                {revenue.tierAdvanced && !tierAdvancedDismissed && (
                  <div className={styles.tierBanner}>
                    <div className={styles.tierBannerLeft}>
                      <Trophy size={18} />
                      <div>
                        <p className={styles.tierBannerTitle}>You've reached {revenue.newTierName}!</p>
                        <p className={styles.tierBannerSub}>Your revenue share has increased. A confirmation email has been sent.</p>
                      </div>
                    </div>
                    <button className={styles.tierBannerDismiss} onClick={() => setTierAdvancedDismissed(true)} aria-label="Dismiss">
                      <X size={14} />
                    </button>
                  </div>
                )}

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
                          {thresholdMet && (
                            <>
                              <button
                                style={{
                                  marginTop: 14, width: '100%', padding: '9px 0',
                                  background: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
                                  color: '#fff', border: 'none', borderRadius: 8,
                                  fontSize: 13, fontWeight: 700, cursor: payoutRequesting ? 'not-allowed' : 'pointer',
                                  opacity: payoutRequesting ? 0.7 : 1, fontFamily: 'var(--font-body)',
                                }}
                                disabled={payoutRequesting}
                                onClick={async () => {
                                  setPayoutRequesting(true)
                                  setPayoutRequestMsg('')
                                  try {
                                    await requestCreatorPayout()
                                    setPayoutRequestMsg('✓ Payout request submitted. We\'ll process it within 2–3 business days.')
                                  } catch (err) {
                                    setPayoutRequestMsg(err?.message || 'Could not submit payout request.')
                                  } finally {
                                    setPayoutRequesting(false)
                                  }
                                }}
                              >
                                {payoutRequesting ? 'Requesting…' : 'Request Payout'}
                              </button>
                              {payoutRequestMsg && (
                                <p style={{ fontSize: 12, marginTop: 8, color: payoutRequestMsg.startsWith('✓') ? '#4ade80' : '#f87171', fontFamily: 'var(--font-body)', textAlign: 'center' }}>
                                  {payoutRequestMsg}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* ── Payout history ── */}
                <div className={styles.revenuePayoutCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <p className={styles.revenueChartTitle}><Wallet size={13} /> Payout History</p>
                    <button className={styles.ghostBtn} style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => { setPayoutDetailsError(''); setPayoutDetailsSaved(false); setShowPayoutDetailsModal(true); loadPayoutDetails() }}>
                      <Banknote size={13} /> {payoutDetails?.hasDetails ? 'Edit Payout Details' : 'Add Payout Details'}
                    </button>
                  </div>
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
                            color:       payout.status === 'paid' ? '#4ade80' : '#f472b6',
                            background:  payout.status === 'paid' ? 'rgba(74,222,128,0.1)' : 'rgba(244,114,182,0.1)',
                            borderColor: payout.status === 'paid' ? 'rgba(74,222,128,0.25)' : 'rgba(244,114,182,0.25)',
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
                    {item.revisionCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
                        background: item.revisionCount >= 4 ? 'rgba(248,113,113,0.12)' : 'rgba(244,114,182,0.10)',
                        color:      item.revisionCount >= 4 ? '#f87171' : '#f472b6',
                        border:     `1px solid ${item.revisionCount >= 4 ? 'rgba(248,113,113,0.25)' : 'rgba(244,114,182,0.2)'}`,
                        flexShrink: 0,
                      }}>
                        {item.revisionCount}/5 revisions
                      </span>
                    )}
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
                  {item.submissionStatus === 'approved' && (
                    <button className={styles.actionBtn} onClick={() => setArtworkItem(item)} title="A/B test poster artwork">
                      <ImagePlus size={12} /> Artwork
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

      {/* ── Reels tab ── */}
      {activeTab === 'reels' && (() => {
        const fmtN = (n) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n ?? 0)
        const ov   = reelAnalytics?.overview || {}
        const vd   = reelAnalytics?.viewsByDay || []

        // Client-side filter — instant, no extra API call
        const query = reelSearch.trim().toLowerCase()
        const filtered = reels.filter((r) => {
          const matchStatus = reelStatusFilter === 'all' || r.submissionStatus === reelStatusFilter
          const matchSearch = !query
            || r.title?.toLowerCase().includes(query)
            || r.description?.toLowerCase().includes(query)
            || (r.hashtags || []).some((t) => t.includes(query))
          return matchStatus && matchSearch
        })

        // Status counts for filter tabs
        const counts = {
          all:      reels.length,
          approved: reels.filter((r) => r.submissionStatus === 'approved').length,
          pending:  reels.filter((r) => r.submissionStatus === 'pending').length,
          rejected: reels.filter((r) => r.submissionStatus === 'rejected').length,
        }

        return (
          <section className={styles.reelSection}>

            {/* ── Header ── */}
            <div className={styles.reelHeader}>
              <div>
                <h2 className={styles.reelTitle}>My Reels</h2>
                <p className={styles.reelSubtitle}>{reels.length} reel{reels.length !== 1 ? 's' : ''} total</p>
              </div>
            </div>

            {/* Stats and charts moved to Analytics → Reels sub-tab */}
            {reelsLoading ? (
              <div className={styles.loadingState} style={{ padding: '40px 0' }}>
                <Zap size={20} className={styles.loadingIcon} /><p>Loading reels…</p>
              </div>
            ) : reels.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}><Zap size={28} /></div>
                <h3 className={styles.emptyTitle}>No reels yet</h3>
                <p className={styles.emptyDesc}>Upload a short clip (up to 30 s) and reach viewers in the Reels feed.</p>
                <button className={styles.newBtn} style={{ marginTop: 8 }} onClick={() => setShowReelModal(true)}>
                  <Plus size={14} /> Upload your first reel
                </button>
              </div>
            ) : (
              <>
                {/* ── Toolbar: search + status filter ── */}
                <div className={styles.reelToolbar}>
                  <div className={styles.reelSearchWrap}>
                    <Search size={14} className={styles.reelSearchIcon} />
                    <input
                      className={styles.reelSearchInput}
                      value={reelSearch}
                      onChange={(e) => setReelSearch(e.target.value)}
                      placeholder="Search by title or hashtag…"
                    />
                    {reelSearch && (
                      <button className={styles.reelSearchClear} onClick={() => setReelSearch('')} aria-label="Clear">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <div className={styles.reelStatusTabs}>
                    {[
                      { key: 'all',      label: 'All' },
                      { key: 'approved', label: 'Live' },
                      { key: 'pending',  label: 'In Review' },
                      { key: 'rejected', label: 'Rejected' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        className={`${styles.reelStatusTab} ${reelStatusFilter === key ? styles.reelStatusTabActive : ''}`}
                        onClick={() => setReelStatusFilter(key)}
                      >
                        {label}
                        {counts[key] > 0 && <span className={styles.reelStatusCount}>{counts[key]}</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <div className={styles.reelNoResults}>
                    <Search size={20} style={{ opacity: 0.3 }} />
                    <p>No reels match "{reelSearch}"</p>
                    <button onClick={() => { setReelSearch(''); setReelStatusFilter('all') }}>Clear filters</button>
                  </div>
                ) : (
                  <div className={styles.reelList}>
                    {filtered.map((reel) => (
                      <div key={reel._id} className={styles.reelCard}>

                        {/* 9:16 thumbnail */}
                        <div
                          className={styles.reelCardPoster}
                          style={reel.thumbnailUrl
                            ? { backgroundImage: `url(${reel.thumbnailUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                            : { background: 'linear-gradient(160deg,#1e1b4b 0%,#4c1d95 50%,#7c3aed 100%)' }
                          }
                        >
                          {!reel.thumbnailUrl && <Zap size={14} style={{ color: 'rgba(255,255,255,0.4)' }} />}
                          {reel.durationSecs > 0 && (
                            <span className={styles.reelCardDuration}>{reel.durationSecs}s</span>
                          )}
                        </div>

                        {/* Info */}
                        <div className={styles.reelCardBody}>
                          <div className={styles.reelCardTop}>
                            <h3 className={styles.reelCardTitle}>
                              {reel.title || <em className={styles.reelCardNoCaption}>No caption</em>}
                            </h3>
                            <StatusChip status={reel.submissionStatus} />
                          </div>

                          <div className={styles.reelCardMeta}>
                            {reel.aspectRatio && <span>{reel.aspectRatio}</span>}
                            {reel.hashtags?.length > 0 && (
                              <span className={styles.reelCardTags}>
                                #{reel.hashtags.slice(0, 3).join(' #')}
                              </span>
                            )}
                          </div>

                          {reel.submissionStatus === 'rejected' && reel.rejectionReason && (
                            <p className={styles.reelCardReject}>
                              <AlertTriangle size={11} /> {reel.rejectionReason}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className={styles.reelCardActions}>
                          {reel.submissionStatus === 'rejected' && (
                            <>
                              {/* If bunnyVideoId is cleared (video deleted on rejection),
                                  creator must upload a new video first, then can resubmit */}
                              {!reel.bunnyVideoId && (
                                <button className={styles.resubmitBtn}
                                  onClick={() => setShowReelModal(true)}
                                  title="Your video was removed on rejection. Upload a new video to resubmit.">
                                  <Upload size={13} /> Upload new video
                                </button>
                              )}
                              {reel.bunnyVideoId && (
                                <button className={styles.resubmitBtn}
                                  onClick={async () => {
                                    try { await resubmitCreatorReel(reel._id); showToast({ type: 'success', message: 'Reel resubmitted.' }); loadReels() }
                                    catch (err) { showToast({ type: 'error', message: err?.message || 'Could not resubmit.' }) }
                                  }}>
                                  <RotateCcw size={13} /> Resubmit
                                </button>
                              )}
                            </>
                          )}
                          {reel.submissionStatus !== 'approved' && (
                            <button className={styles.deleteBtn}
                              onClick={async () => {
                                try { await deleteCreatorReel(reel._id); showToast({ type: 'success', message: 'Reel deleted.' }); loadReels() }
                                catch (err) { showToast({ type: 'error', message: err?.message || 'Could not delete.' }) }
                              }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

          </section>
        )
      })()}

      {/* ── Payout Details Modal ── */}
      {showPayoutDetailsModal && createPortal(
        <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && setShowPayoutDetailsModal(false)}>
          <div className={styles.modalPanel} style={{ maxWidth: 460 }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}><Banknote size={15} /> Payout Details</h2>
              <button className={styles.modalClose} onClick={() => setShowPayoutDetailsModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                Add your bank or UPI details so payouts can be sent directly to you. Until this is filled in, your payouts are processed manually by the Dhara team.
              </p>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={payoutDetailsForm.method === 'bank' ? styles.primaryBtn : styles.ghostBtn}
                  style={{ flex: 1, padding: '8px 0', fontSize: 12 }}
                  onClick={() => setPayoutDetailsForm((p) => ({ ...p, method: 'bank' }))}
                >Bank Transfer</button>
                <button
                  className={payoutDetailsForm.method === 'upi' ? styles.primaryBtn : styles.ghostBtn}
                  style={{ flex: 1, padding: '8px 0', fontSize: 12 }}
                  onClick={() => setPayoutDetailsForm((p) => ({ ...p, method: 'upi' }))}
                >UPI</button>
              </div>

              {payoutDetailsForm.method === 'bank' ? (
                <>
                  <label className={styles.label}>
                    Account holder name
                    <input className={styles.input} value={payoutDetailsForm.accountHolderName}
                      onChange={(e) => setPayoutDetailsForm((p) => ({ ...p, accountHolderName: e.target.value }))} />
                  </label>
                  <label className={styles.label}>
                    Account number <span style={{ fontSize: 10, color: '#888', fontWeight: 400 }}>{payoutDetails?.accountNumber ? `currently on file: ${payoutDetails.accountNumber}` : ''}</span>
                    <input className={styles.input} value={payoutDetailsForm.accountNumber} placeholder="Re-enter to change"
                      onChange={(e) => setPayoutDetailsForm((p) => ({ ...p, accountNumber: e.target.value }))} />
                  </label>
                  <label className={styles.label}>
                    IFSC code
                    <input className={styles.input} value={payoutDetailsForm.ifsc} placeholder="HDFC0000053"
                      onChange={(e) => setPayoutDetailsForm((p) => ({ ...p, ifsc: e.target.value.toUpperCase() }))} />
                  </label>
                </>
              ) : (
                <label className={styles.label}>
                  UPI ID <span style={{ fontSize: 10, color: '#888', fontWeight: 400 }}>{payoutDetails?.upiId ? `currently on file: ${payoutDetails.upiId}` : ''}</span>
                  <input className={styles.input} value={payoutDetailsForm.upiId} placeholder="name@bank"
                    onChange={(e) => setPayoutDetailsForm((p) => ({ ...p, upiId: e.target.value }))} />
                </label>
              )}

              {payoutDetailsSaved && (
                <div style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#4ade80' }}>
                  ✓ Payout details saved
                </div>
              )}
              {payoutDetailsError && <p style={{ fontSize: 13, color: '#f87171' }}>{payoutDetailsError}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className={styles.ghostBtn} onClick={() => setShowPayoutDetailsModal(false)}>Close</button>
                <button className={styles.primaryBtn} onClick={handleSavePayoutDetails} disabled={payoutDetailsBusy}>
                  {payoutDetailsBusy ? 'Saving…' : 'Save Details'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Reel Upload Modal ── */}
      {showReelModal && (
        <ReelUploadModal
          onClose={() => setShowReelModal(false)}
          onCreated={() => { loadReels(); showToast({ type: 'success', message: 'Reel submitted for review!' }) }}
          onReelReady={loadReels}
        />
      )}

      {/* ── Artwork A/B Modal ── */}
      {artworkItem && (
        <ThumbnailVariantModal
          item={artworkItem}
          api={{
            list:   () => listCreatorThumbnailVariants(artworkItem._id),
            create: (p) => createCreatorThumbnailVariant(artworkItem._id, p),
            update: updateCreatorThumbnailVariant,
            remove: deleteCreatorThumbnailVariant,
          }}
          onClose={() => setArtworkItem(null)}
        />
      )}

      {/* ── New Submission Modal ── rendered via portal so CSS transforms on
           the animated routePane don't break position:fixed ── */}
      {showModal && (() => {
        const activeSteps = (form.type === 'Series' || form.type === 'Serial Drama') ? STEPS_SERIES : STEPS_BASE
        const currentStepId = activeSteps[step]?.id ?? 'basics'
        return createPortal(
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
                      <option value="Serial Drama">Serial Drama</option>
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
                      {/* Poster-only: extract a frame from a video file as fallback */}
                      {field === 'posterUrl' && (
                        <>
                          <input
                            ref={vidThumbInputRef}
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                            style={{ display: 'none' }}
                            onChange={(e) => handleExtractPosterFromVideo(e.target.files?.[0])}
                          />
                          <button
                            type="button"
                            className={styles.imageUploadBtn}
                            style={{ marginTop: 4, opacity: vidThumbUploading ? 0.6 : 1 }}
                            disabled={vidThumbUploading || imgUploading.poster}
                            onClick={() => vidThumbInputRef.current?.click()}
                          >
                            {vidThumbUploading ? '⟳ Extracting frame…' : 'Extract from video'}
                          </button>
                        </>
                      )}
                      <input className={styles.input} value={form[field]} onChange={ff(field)} placeholder="Or paste URL…" />
                    </div>
                  ))}
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
                  {form.type !== 'Series' && form.type !== 'Serial Drama' && (
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
                  {(form.type === 'Series' || form.type === 'Serial Drama') && (
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
                  if (currentStepId === 'details' && form.type !== 'Series' && form.type !== 'Serial Drama' && form.duration && !isValidDuration(form.duration)) {
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
        </div>,
        document.body
        )
      })()}
    </main>
  )
}
