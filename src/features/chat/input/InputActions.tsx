import { memo } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PermissionListIcon, QuestionIcon } from '../../../components/Icons'
import { UndoStatus } from './UndoStatus'
import type { CollapsedDialogInfo } from '../InputBox'

// ============================================
// ScrollToBottomButton — 可复用的滚动到底部按钮
// ============================================

interface ScrollToBottomButtonProps {
  onClick?: () => void
}

export const ScrollToBottomButton = memo(function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[32px] w-[32px] min-w-[32px] rounded-full bg-accent-main-100/10 border border-accent-main-100/20 backdrop-blur-md flex items-center justify-center text-accent-main-000 hover:bg-accent-main-100/20 transition-colors shrink-0"
      aria-label="Scroll to bottom"
    >
      <ArrowDownIcon size={16} />
    </button>
  )
})

// ============================================
// FloatingActions — 输入框上方的浮动操作栏
// permission capsule / question capsule / undo status / scroll-to-bottom
// ============================================

interface FloatingActionsProps {
  showScrollToBottom?: boolean
  isCollapsed: boolean
  canRedo?: boolean
  revertSteps?: number
  onRedo?: () => void
  onRedoAll?: () => void
  onScrollToBottom?: () => void
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
}

export const FloatingActions = memo(function FloatingActions({
  showScrollToBottom,
  isCollapsed,
  canRedo,
  revertSteps,
  onRedo,
  onRedoAll,
  onScrollToBottom,
  collapsedPermission,
  collapsedQuestion,
}: FloatingActionsProps) {
  if (!showScrollToBottom && !canRedo && !collapsedPermission && !collapsedQuestion) return null

  return (
    <div className="flex items-center justify-center gap-2">
      {/* Collapsed Permission Capsule */}
      {collapsedPermission && (
        <button
          type="button"
          onClick={collapsedPermission.onExpand}
          className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 text-[11px] text-accent-main-000 hover:bg-accent-main-100/20 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <PermissionListIcon size={14} />
          <span className="whitespace-nowrap">{collapsedPermission.label}</span>
          {collapsedPermission.queueLength > 1 && (
            <span className="text-[10px] opacity-70">+{collapsedPermission.queueLength - 1}</span>
          )}
        </button>
      )}

      {/* Collapsed Question Capsule */}
      {collapsedQuestion && (
        <button
          type="button"
          onClick={collapsedQuestion.onExpand}
          className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-accent-main-100/10 backdrop-blur-md border border-accent-main-100/20 text-[11px] text-accent-main-000 hover:bg-accent-main-100/20 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <QuestionIcon size={14} />
          <span className="whitespace-nowrap">{collapsedQuestion.label}</span>
          {collapsedQuestion.queueLength > 1 && (
            <span className="text-[10px] opacity-70">+{collapsedQuestion.queueLength - 1}</span>
          )}
        </button>
      )}

      {canRedo && <UndoStatus canRedo={canRedo} revertSteps={revertSteps} onRedo={onRedo} onRedoAll={onRedoAll} />}

      {showScrollToBottom && !isCollapsed && <ScrollToBottomButton onClick={onScrollToBottom} />}
    </div>
  )
})

// ============================================
// CollapsedCapsule — 移动端收起状态的胶囊 UI
// ============================================

interface CollapsedCapsuleProps {
  onExpand: () => void
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
}

export const CollapsedCapsule = memo(function CollapsedCapsule({
  onExpand,
  showScrollToBottom,
  onScrollToBottom,
}: CollapsedCapsuleProps) {
  return (
    <div className="flex items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <button
        type="button"
        onClick={onExpand}
        className="flex items-center gap-1.5 px-3 h-[32px] rounded-full bg-bg-000/95 backdrop-blur-md border border-border-200/50 shadow-lg shadow-black/5 text-text-300 hover:text-text-200 hover:bg-bg-000 active:scale-95 transition-all"
      >
        <ArrowUpIcon size={14} />
        <span className="text-[11px]">Reply...</span>
      </button>
      {showScrollToBottom && <ScrollToBottomButton onClick={onScrollToBottom} />}
    </div>
  )
})
