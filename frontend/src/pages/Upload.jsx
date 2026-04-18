import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload as UploadIcon, Camera, X, AlertCircle } from 'lucide-react'
import SplitText from '../components/bits/SplitText'
import Aurora from '../components/bits/Aurora'
import StarBorder from '../components/bits/StarBorder'

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

// Hand-drawn SVG symbols for the legend
const LEGEND = [
  {
    symbol: 'cube',
    label: 'Tile / Platform',
    hint: 'Shaded cube',
    color: '#a8956a',
    svg: (
      <>
        <rect x="3" y="9" width="22" height="18" rx="2" fill="#c4ab82" stroke="#a8956a" strokeWidth="2" />
        <rect x="3" y="9" width="22" height="5" rx="2" fill="#d6c090" stroke="#a8956a" strokeWidth="2" />
        <polygon points="3,9 9,4 31,4 25,9" fill="#e2cfaa" stroke="#a8956a" strokeWidth="2" strokeLinejoin="round" />
      </>
    ),
  },
  {
    symbol: 'triangle',
    label: 'Spike / Hazard',
    hint: 'Triangle',
    color: '#ef4444',
    svg: (
      <polygon points="16,4 28,28 4,28"
        stroke="#ef4444" strokeWidth="2.5" fill="#fecaca" strokeLinejoin="round" />
    ),
  },
  {
    symbol: 'circle',
    label: 'Spawn Point',
    hint: 'Circle',
    color: '#3b82f6',
    svg: (
      <>
        <circle cx="16" cy="16" r="11" stroke="#3b82f6" strokeWidth="2.5" fill="#dbeafe" />
        <text x="16" y="21" fontSize="12" textAnchor="middle" fill="#3b82f6" fontFamily="monospace" fontWeight="bold">P</text>
      </>
    ),
  },
  {
    symbol: 'star',
    label: 'Finish / Goal',
    hint: 'Star',
    color: '#22c55e',
    svg: (
      <text x="16" y="23" fontSize="22" textAnchor="middle"
        fill="#22c55e" fontFamily="sans-serif">★</text>
    ),
  },
]

function LegendCard({ label, hint, svg }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/70 backdrop-blur-sm
                 border border-stone-200 shadow-sm min-w-[80px] flex-1"
    >
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        {svg}
      </svg>
      <span className="text-xs font-bold text-stone-700 text-center leading-tight">{label}</span>
      <span className="text-[11px] text-stone-400 text-center">Draw a {hint}</span>
    </motion.div>
  )
}

export default function Upload() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)

  const validateAndSet = useCallback((f) => {
    setError(null)
    if (!f.type.startsWith('image/')) {
      setError('Please upload an image file (JPG, PNG, HEIC, etc.)')
      return
    }
    if (f.size > MAX_SIZE) {
      setError('Image is too large. Max size is 10 MB.')
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }, [preview])

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) validateAndSet(f)
  }

  const onFileChange = (e) => {
    const f = e.target.files[0]
    if (f) validateAndSet(f)
    e.target.value = ''
  }

  const clearFile = (e) => {
    e.stopPropagation()
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview(null)
    setError(null)
  }

  const handleGenerate = () => {
    if (!file) return
    // Store file in sessionStorage-friendly way via object URL key + navigate
    // Processing page will pick it up from the navigate state
    navigate('/processing', { state: { file, fileName: file.name } })
  }

  const handleDemo = () => {
    const E = '', T = 'T', S = 'S', P = 'P', G = 'G', C = 'C'
    const demoLevel = {
      data: [
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,T,T,G,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,T,T,T,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,C,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,T,T,T,E,E,E,E,T,T,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,C,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,T,T,T,T,E,E,E,E,E,T,T,T,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,C,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,T,T,T,T,T,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [P,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [T,T,T,T,S,T,T,T,S,T,T,S,S,T,T,T,S,T,T,T,T,S,T,T,T,T,T,T,T,T],
        [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
      ]
    }
    localStorage.setItem('level_demo', JSON.stringify(demoLevel))
    navigate('/play/demo')
  }

  return (
    <div className="relative min-h-dvh flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      <Aurora />

      {/* Hero */}
      <div className="relative z-10 text-center max-w-2xl w-full">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full
                     bg-orange-100 border border-orange-200 text-orange-700 text-sm font-semibold"
        >
          <span>✏️</span> HackPrinceton 2025
        </motion.div>

        <h1 className="text-5xl sm:text-6xl font-black text-stone-800 leading-tight mb-4 tracking-tight">
          <SplitText text="Sketch a Level." className="block" />
          <span className="block text-orange-500">
            <SplitText text="Play It." />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-stone-600 text-lg sm:text-xl mb-10"
        >
          Draw a platformer on grid paper. Take a photo. Watch it come alive.
        </motion.p>

        {/* Legend */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mb-8"
        >
          <p className="text-sm font-semibold text-stone-500 uppercase tracking-widest mb-1">
            What to draw on your grid paper
          </p>
          <p className="text-xs text-stone-400 mb-3">Use these symbols so the AI knows what each cell means</p>
          <div className="flex flex-wrap justify-center gap-3">
            {LEGEND.map((item, i) => (
              <motion.div
                key={item.symbol}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.8 + i * 0.07 }}
              >
                <LegendCard {...item} />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Two input options */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="relative"
        >
          <AnimatePresence mode="wait">
            {!preview ? (
              <motion.div
                key="options"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-2 gap-4"
              >
                {/* Upload option */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload an image from your device"
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`
                    flex flex-col items-center justify-center gap-3 p-8 rounded-3xl
                    border-2 border-dashed cursor-pointer transition-all duration-200
                    backdrop-blur-sm shadow-lg
                    ${dragOver
                      ? 'border-orange-400 bg-orange-50 scale-[1.02]'
                      : 'border-stone-300 bg-white/60 hover:border-orange-300 hover:bg-white/80 hover:scale-[1.02]'
                    }
                  `}
                >
                  <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                    <UploadIcon size={26} className="text-orange-500" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-stone-700 text-base">Upload</p>
                    <p className="text-xs text-stone-400 mt-1">Browse or drag a photo</p>
                  </div>
                </div>

                {/* Camera option */}
                <label
                  role="button"
                  tabIndex={0}
                  aria-label="Take a photo with your camera"
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
                  className="flex flex-col items-center justify-center gap-3 p-8 rounded-3xl
                             border-2 border-dashed border-stone-300 bg-white/60
                             hover:border-sky-300 hover:bg-sky-50/60 hover:scale-[1.02]
                             cursor-pointer transition-all duration-200 backdrop-blur-sm shadow-lg"
                >
                  <div className="w-14 h-14 rounded-2xl bg-sky-100 flex items-center justify-center">
                    <Camera size={26} className="text-sky-500" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-stone-700 text-base">Camera</p>
                    <p className="text-xs text-stone-400 mt-1">Take a photo now</p>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={onFileChange}
                  />
                </label>
              </motion.div>
            ) : (
              /* Preview */
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="relative rounded-3xl border-2 border-orange-300 bg-white/80
                           backdrop-blur-sm shadow-xl overflow-hidden"
              >
                <img
                  src={preview}
                  alt="Your sketch preview"
                  className="w-full max-h-72 object-contain p-4"
                />
                <button
                  onClick={clearFile}
                  aria-label="Remove image and choose again"
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-stone-800/70 text-white
                             hover:bg-stone-800 transition-colors"
                >
                  <X size={16} />
                </button>
                <p className="text-sm text-stone-500 pb-3 px-4 truncate">{file?.name}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Hidden file input for upload option */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-hidden="true"
            onChange={onFileChange}
          />

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                role="alert"
                className="mt-3 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200
                           text-red-700 text-sm"
              >
                <AlertCircle size={16} className="flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generate button */}
          <AnimatePresence>
            {file && !error && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="mt-6"
              >
                <StarBorder onClick={handleGenerate} className="w-full text-xl py-5">
                  ✨ Generate Level
                </StarBorder>
              </motion.div>
            )}
          </AnimatePresence>
        {/* Demo button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="mt-6 text-center"
        >
          <button
            onClick={handleDemo}
            className="text-sm text-stone-400 hover:text-orange-500 underline underline-offset-4 transition-colors"
          >
            🎮 Try a demo level instead
          </button>
        </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
