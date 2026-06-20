import { useId } from 'react'

// 6-petal rosette badge — gradient fill, white checkmark, soft glow.
// Each petal is a smooth cubic bezier bowing outward from centre (R=7),
// with valleys at r=5.5. useId() keeps gradient IDs unique per instance.
export default function VerifiedBadge({ size = 16, style }) {
  const id     = useId()
  const gradId = `vb-g-${id.replace(/[:\s]/g, '')}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        display: 'inline-block',
        flexShrink: 0,
        filter: 'drop-shadow(0 0 3px rgba(167,139,250,0.7))',
        ...style,
      }}
      aria-label="Verified Creator"
      title="Verified Creator"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>

      {/* 6-petal rosette: outer tips at R=7 (0°,60°,…), valleys at r=5.5 (30°,90°,…) */}
      <path
        d="
          M 8 1
          C 10.45 1,    9.083 2.275, 10.75 3.237
          C 12.417 4.2, 12.837 2.379, 14.062 4.5
          C 15.287 6.621, 13.5 6.075, 13.5 8
          C 13.5 9.925, 15.287 9.379, 14.062 11.5
          C 12.837 13.621, 12.417 11.8, 10.75 12.763
          C 9.083 13.725, 10.45 15, 8 15
          C 5.55 15,    6.917 13.725, 5.25 12.763
          C 3.583 11.8, 3.163 13.621, 1.938 11.5
          C 0.713 9.379, 2.5 9.925, 2.5 8
          C 2.5 6.075,  0.713 6.621, 1.938 4.5
          C 3.163 2.379, 3.583 4.2, 5.25 3.237
          C 6.917 2.275, 5.55 1, 8 1
          Z
        "
        fill={`url(#${gradId})`}
      />

      {/* Checkmark */}
      <path
        d="M 5.2 8.3 L 7.1 10.2 L 11 6.2"
        stroke="#fff"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
