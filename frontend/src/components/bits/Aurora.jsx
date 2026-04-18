// Aurora-style animated gradient background
// Warm palette: orange, amber, rose, sky
export default function Aurora({ className = '' }) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      aria-hidden="true"
    >
      {/* Base warm cream */}
      <div className="absolute inset-0 bg-amber-50" />

      {/* Blobs */}
      <div
        className="aurora-blob absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full opacity-40"
        style={{
          background: 'radial-gradient(circle, #fed7aa 0%, #fb923c 40%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
      <div
        className="aurora-blob-2 absolute -bottom-32 -right-16 w-[500px] h-[500px] rounded-full opacity-35"
        style={{
          background: 'radial-gradient(circle, #fde68a 0%, #fbbf24 40%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        className="aurora-blob-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full opacity-25"
        style={{
          background: 'radial-gradient(ellipse, #fdba74 0%, #f97316 30%, transparent 65%)',
          filter: 'blur(90px)',
        }}
      />
      {/* Subtle grid paper texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(#78716c 1px, transparent 1px), linear-gradient(90deg, #78716c 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
    </div>
  )
}
