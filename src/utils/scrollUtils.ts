/**
 * 把列表项滚动到容器可视区域内，确保完全可见。
 *
 * 比 `element.scrollIntoView({ block: 'nearest' })` 更可靠：
 * 后者在有 padding 的容器上、部分可见时只滚最小距离，
 * 会导致选中项"卡在半边"。这里直接基于 getBoundingClientRect 计算，
 * 确保选中项完全在容器的 padding box（可视内容区）内。
 */
export function scrollItemIntoView(container: HTMLElement, item: HTMLElement): void {
  const cStyle = getComputedStyle(container)
  const paddingTop = parseFloat(cStyle.paddingTop) || 0
  const paddingBottom = parseFloat(cStyle.paddingBottom) || 0

  const cRect = container.getBoundingClientRect()
  // 可视内容区 = border box 内缩 padding
  const contentTop = cRect.top + paddingTop
  const contentBottom = cRect.bottom - paddingBottom

  const iRect = item.getBoundingClientRect()

  const offsetTop = iRect.top - contentTop
  const offsetBottom = iRect.bottom - contentBottom

  if (offsetTop < 0) {
    container.scrollTop += offsetTop
  } else if (offsetBottom > 0) {
    container.scrollTop += offsetBottom
  }
}
