export default function VerifiedBadge({ size = 16, style }) {
  return (
    <span
      aria-label="Verified Creator"
      title="Verified Creator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
        boxShadow: '0 0 0 1.5px rgba(167,139,250,0.35), 0 0 7px rgba(167,139,250,0.55)',
        flexShrink: 0,
        ...style,
      }}
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 5.2L4.1 7.5L8.2 2.8"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
