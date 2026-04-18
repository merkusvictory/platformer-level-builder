import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-amber-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <div className="text-8xl mb-6">🗺️</div>
        <h1 className="text-4xl font-black text-stone-800 mb-3">Page Not Found</h1>
        <p className="text-stone-500 mb-8 max-w-xs">
          This level or page does not exist. Head back and sketch something new.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl
                     transition-colors text-lg shadow-lg shadow-orange-200"
        >
          Back to Upload
        </button>
      </motion.div>
    </div>
  )
}
