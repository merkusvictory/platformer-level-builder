import { motion } from 'framer-motion'

const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.1,
    },
  },
}

const letter = {
  hidden: { y: 40, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring', damping: 14, stiffness: 200 },
  },
}

export default function SplitText({ text, className = '', wordClassName = '' }) {
  return (
    <motion.span
      className={`inline-flex flex-wrap gap-x-[0.15em] ${className}`}
      variants={container}
      initial="hidden"
      animate="visible"
      aria-label={text}
    >
      {text.split(' ').map((word, wi) => (
        <span key={wi} className={`inline-flex ${wordClassName}`}>
          {word.split('').map((char, ci) => (
            <motion.span
              key={ci}
              variants={letter}
              className="inline-block"
              aria-hidden="true"
            >
              {char}
            </motion.span>
          ))}
        </span>
      ))}
    </motion.span>
  )
}
