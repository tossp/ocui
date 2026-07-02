/**
 * 把列表项滚动到容器可视区域内，确保完全可见。
 *
 * 比 `element.scrollIntoView({ block: 'nearest' })` 更可靠：
 * 后者在有 padding 的容器上、部分可见时只滚最小距离，
 * 会导致选中项"卡在半边"。这里直接基于 getBoundingClientRect 计算，
 * 确保选中项完全在容器的 content box 内。
 */
export function scrollItemIntoView(container: HTMLElement, item: HTMLElement): void {
  const cRect = container.getBoundingClientRect()
  const iRect = item.getBoundingClientRect()

  const offsetTop = iRect.top - cRect.top
  const offsetBottom = iRect.bottom - cRect.bottom

  if (offsetTop < 0) {
    // 元素顶部在容器上方（含部分遮挡），向上滚到完全可见
    container.scrollTop += offsetTop
  } else if (offsetBottom > 0) {
    // 元素底部在容器下方（含部分遮挡），向下滚到完全可见
    container.scrollTop += offsetBottom
  }
}
