/**
 * ModalShell - Shared fullscreen/modal overlay infrastructure
 *
 * Extracts the common pattern from DiffModal, MultiFileDiffModal, FullscreenViewer:
 * - Portal rendering
 * - Backdrop blur + dark overlay with animation
 * - ESC to close
 * - useDelayedRender for mount/unmount transition
 * - requestAnimationFrame for visibility animation
 */

import { memo, useState, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDelayedRender } from '../../hooks/useDelayedRender'

// ============================================
// useModalAnimation - shared animation logic
// ============================================

export function useModalAnimation(isOpen: boolean, onClose: () => void, delayMs = 200) {
  const [isVisible, setIsVisible] = useState(false)
  const shouldRender = useDelayedRender(isOpen, delayMs)

  // Animate visibility via rAF
  useEffect(() => {
    let frameId: number | null = null

    if (shouldRender && isOpen) {
      frameId = requestAnimationFrame(() => setIsVisible(true))
    } else {
      frameId = requestAnimationFrame(() => setIsVisible(false))
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [shouldRender, isOpen])

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  return { isVisible, shouldRender }
}

// ============================================
// ModalShell - the shared overlay shell
// ============================================

interface ModalShellProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  /** "fullscreen" fills the viewport, "card" is centered with padding */
  variant?: 'fullscreen' | 'card'
  /** Allow closing by clicking the backdrop (default: false for fullscreen, true for card) */
  closeOnBackdrop?: boolean
}

export const ModalShell = memo(function ModalShell({
  isOpen,
  onClose,
  children,
  variant = 'fullscreen',
  closeOnBackdrop,
}: ModalShellProps) {
  const { isVisible, shouldRender } = useModalAnimation(isOpen, onClose)

  const allowBackdropClose = closeOnBackdrop ?? variant === 'card'

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (allowBackdropClose && e.target === e.currentTarget) onClose()
    },
    [allowBackdropClose, onClose],
  )

  if (!shouldRender) return null

  const isCard = variant === 'card'

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-200 ease-out ${isCard ? 'p-4 sm:p-6' : ''}`}
      style={{
        backgroundColor: isVisible ? 'hsl(var(--always-black) / 0.4)' : 'hsl(var(--always-black) / 0)',
        backdropFilter: isVisible ? 'blur(2px)' : 'blur(0px)',
      }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={
          isCard
            ? 'relative flex flex-col bg-bg-100 border border-border-200/60 rounded-lg shadow-2xl overflow-hidden transition-all duration-200 ease-out'
            : 'w-full h-full flex flex-col bg-bg-000 transition-all duration-200 ease-out'
        }
        style={
          isCard
            ? {
                width: 'min(96vw, 1400px)',
                maxHeight: 'min(90vh, 1000px)',
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.98) translateY(4px)',
              }
            : {
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'scale(1)' : 'scale(0.98)',
              }
        }
        onClick={isCard ? e => e.stopPropagation() : undefined}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
})
