import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface TypewriterProps {
  phrases: string[]
  typingSpeed?: number
  deletingSpeed?: number
  pauseDuration?: number
  className?: string
}

export function Typewriter({
  phrases,
  typingSpeed = 80,
  deletingSpeed = 50,
  pauseDuration = 2000,
  className,
}: TypewriterProps) {
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0)
  const [currentText, setCurrentText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  const currentPhrase = phrases[currentPhraseIndex]

  const tick = useCallback(() => {
    if (isPaused) return

    if (!isDeleting) {
      // Typing
      if (currentText.length < currentPhrase.length) {
        setCurrentText(currentPhrase.slice(0, currentText.length + 1))
      } else {
        // Finished typing, pause before deleting
        setIsPaused(true)
        setTimeout(() => {
          setIsPaused(false)
          setIsDeleting(true)
        }, pauseDuration)
      }
    } else {
      // Deleting
      if (currentText.length > 0) {
        setCurrentText(currentText.slice(0, -1))
      } else {
        // Finished deleting, move to next phrase
        setIsDeleting(false)
        setCurrentPhraseIndex((prev) => (prev + 1) % phrases.length)
      }
    }
  }, [currentText, currentPhrase, isDeleting, isPaused, pauseDuration, phrases.length])

  useEffect(() => {
    const speed = isDeleting ? deletingSpeed : typingSpeed
    const timer = setTimeout(tick, speed)
    return () => clearTimeout(timer)
  }, [tick, isDeleting, typingSpeed, deletingSpeed])

  return (
    <span className={cn('inline-block', className)}>
      {currentText}
      <span className="animate-blink ml-0.5 inline-block w-[3px] h-[1em] bg-current align-middle" />
    </span>
  )
}
