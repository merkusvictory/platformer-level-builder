import { motion } from 'framer-motion'

export default function StarBorder({
  children,
  onClick,
  disabled = false,
  className = '',
  type = 'button',
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? {} : { scale: 1.03 }}
      whileTap={disabled ? {} : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className={`
        relative inline-flex items-center justify-center gap-2
        px-8 py-4 rounded-2xl font-bold text-lg
        bg-orange-500 text-white shadow-lg shadow-orange-200
        hover:bg-orange-600 hover:shadow-orange-300
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors focus-visible:outline focus-visible:outline-2
        focus-visible:outline-offset-2 focus-visible:outline-orange-500
        ${className}
      `}
    >
      {children}
    </motion.button>
  )
}
