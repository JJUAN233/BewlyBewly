import { OPEN_VIDEO_DOWNLOAD } from '~/constants/globalEvents'
import { i18n } from '~/utils/i18n'
import { queryDomUntilFound } from '~/utils/main'

/** 注入项自己的标记，用来判断是否已经插过 */
const ITEM_CLASS = 'bewly-download-item'

function getBvid(): string | undefined {
  return location.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1]
}

function getVideoTitle(): string {
  const fromDom = document.querySelector('h1.video-title, .video-title')?.textContent?.trim()
  if (fromDom)
    return fromDom
  // 页面标题形如「xxx_哔哩哔哩_bilibili」，去掉后缀
  return document.title.replace(/[_-].*哔哩哔哩.*$/, '').trim()
}

/**
 * 在播放页「更多」菜单里加一项「下载视频」。
 *
 * 这个菜单是 B 站自己的（`.video-tool-more-dropdown`，里面有「用手机看」「稍后再看」），
 * 扩展没有它的组件，只能插节点。B 站用的是 scoped 样式（元素带 `data-v-*`），自己造的节点
 * 拿不到样式，所以直接克隆一个现有条目，再改文案、换图标——这样外观与原生条目一致。
 */
export function setupVideoPageDownloadItem(abort: AbortController) {
  queryDomUntilFound('.video-tool-more-dropdown', 500, abort).then((menu) => {
    if (!menu || menu.querySelector(`.${ITEM_CLASS}`))
      return

    const template = menu.querySelector('.dropdown-item')
    if (!template)
      return

    const item = template.cloneNode(true) as HTMLElement
    // 去掉被克隆条目的特有类，只保留让 B 站样式生效的通用类
    for (const cls of Array.from(item.classList)) {
      if (cls !== 'dropdown-item' && cls !== 'video-toolbar-right-item')
        item.classList.remove(cls)
    }
    // 标记要在清理之后加，否则会被上面这个循环当成「克隆来的特有类」一起删掉，
    // 开头那句防重复插入的判断就永远不成立
    item.classList.add(ITEM_CLASS)

    // 克隆来的图标是「用手机看」的，只换图形、保留原有 <svg> 元素本身，
    // 这样尺寸、颜色、类名都跟着 B 站的样式走。
    const svg = item.querySelector('svg')
    if (svg) {
      // 常见的下载图形：向下的箭头 + 底部托盘
      svg.innerHTML = '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />'
    }

    const label = i18n.global.t('video_card.operation.download_video')
    const text = item.querySelector('.video-toolbar-item-text')
    if (text)
      text.textContent = label
    else
      item.textContent = label

    item.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const bvid = getBvid()
      if (!bvid)
        return
      window.dispatchEvent(new CustomEvent(OPEN_VIDEO_DOWNLOAD, {
        detail: { bvid, title: getVideoTitle() },
      }))
    })

    menu.appendChild(item)
  })
}
