<script setup lang="ts">
import { useEventListener, useThrottleFn, useToggle } from '@vueuse/core'
import type { Ref } from 'vue'

import type { Video } from '~/components/VideoCard/types'
import DownloadDialog from '~/components/VideoCard/VideoCardContextMenu/components/DownloadDialog.vue'
import type { BewlyAppProvider } from '~/composables/useAppProvider'
import { useDark } from '~/composables/useDark'
import { BEWLY_MOUNTED, DRAWER_VIDEO_ENTER_PAGE_FULL, DRAWER_VIDEO_EXIT_PAGE_FULL, IFRAME_PAGE_SWITCH_BEWLY, IFRAME_PAGE_SWITCH_BILI, IFRAME_THEME_CHANGE, OPEN_VIDEO_DOWNLOAD, OVERLAY_SCROLL_BAR_SCROLL } from '~/constants/globalEvents'
import { PAGE_SWITCHER_IFRAME_NAME } from '~/constants/iframe'
import { AppPage } from '~/enums/appEnums'
import { settings } from '~/logic'
import { type DockItem, useMainStore } from '~/stores/mainStore'
import { useSettingsStore } from '~/stores/settingsStore'
import { isHomePage, isInIframe, isNotificationPage, isVideoOrBangumiPage, openLinkToNewTab, queryDomUntilFound, scrollToTop } from '~/utils/main'
import emitter from '~/utils/mitt'

import { setupNecessarySettingsWatchers } from './necessarySettingsWatchers'

const mainStore = useMainStore()
const settingsStore = useSettingsStore()
const { isDark } = useDark()
const [showSettings, toggleSettings] = useToggle(false)

// Get the 'page' query parameter from the URL
function getPageParam(): AppPage | null {
  const urlParams = new URLSearchParams(window.location.search)
  const result = urlParams.get('page') as AppPage | null
  if (result && Object.values(AppPage).includes(result))
    return result
  return null
}

const activatedPage = ref<AppPage>(getPageParam() || (settings.value.dockItemsConfig.find(e => e.visible === true)?.page || AppPage.Home))
const pages = {
  [AppPage.Home]: defineAsyncComponent(() => import('./Home/Home.vue')),
  [AppPage.Search]: defineAsyncComponent(() => import('./Search/Search.vue')),
  [AppPage.Anime]: defineAsyncComponent(() => import('./Anime/Anime.vue')),
  [AppPage.History]: defineAsyncComponent(() => import('./History/History.vue')),
  [AppPage.WatchLater]: defineAsyncComponent(() => import('./WatchLater/WatchLater.vue')),
  [AppPage.Favorites]: defineAsyncComponent(() => import('./Favorites/Favorites.vue')),
  [AppPage.Moments]: defineAsyncComponent(() => import('./Moments/Moments.vue')),
}
const mainAppRef = ref<HTMLElement>() as Ref<HTMLElement>
const scrollbarRef = ref()
const handlePageRefresh = ref<() => void>()
const handleReachBottom = ref<() => void>()
const handleThrottledPageRefresh = useThrottleFn(() => handlePageRefresh.value?.(), 500)
const handleThrottledReachBottom = useThrottleFn(() => handleReachBottom.value?.(), 500)
const handleThrottledBackToTop = useThrottleFn(() => handleBackToTop(), 1000)
const topBarRef = ref()
const reachTop = ref<boolean>(true)

const iframeDrawerURL = ref<string>('')
const showIframeDrawer = ref<boolean>(false)

// 播放页「更多」菜单里的「下载视频」：菜单是 B 站自己的，那边只能派发事件，由这里弹出对话框
const downloadVideoTarget = ref<Video | null>(null)
const showDownloadVideoDialog = ref<boolean>(false)
useEventListener(window, OPEN_VIDEO_DOWNLOAD, (event: CustomEvent) => {
  const { bvid, title } = event.detail || {}
  if (!bvid)
    return
  downloadVideoTarget.value = { id: 0, bvid, title: title || bvid, cover: '', threePointV2: [] }
  showDownloadVideoDialog.value = true
})

const iframePageRef = ref()
useEventListener(window, 'message', ({ data }) => {
  // The page hosting this frame is cross-origin, so it cannot reach into this document to switch
  // the theme itself. It mirrors its setting here instead and this frame's own `useDark()` takes
  // it from there. See the `IframePage` component.
  if (data?.type === IFRAME_THEME_CHANGE) {
    settings.value.theme = data.theme
    return
  }

  switch (data) {
    case IFRAME_PAGE_SWITCH_BEWLY:
      {
        const currentDockItemConfig = settingsStore.getDockItemConfigByPage(activatedPage.value)
        if (currentDockItemConfig)
          currentDockItemConfig.useOriginalBiliPage = false
      }
      break
    case IFRAME_PAGE_SWITCH_BILI:
      {
        const currentDockItemConfig = settingsStore.getDockItemConfigByPage(activatedPage.value)
        if (currentDockItemConfig)
          currentDockItemConfig.useOriginalBiliPage = true
      }
      break
  }
})
const iframePageURL = computed((): string => {
  // If the iframe is not the BiliBili homepage or in iframe, then don't show the iframe page
  if (!isHomePage(window.self.location.href) || isInIframe())
    return ''
  const currentDockItemConfig = settings.value.dockItemsConfig.find(e => e.page === activatedPage.value)
  if (currentDockItemConfig) {
    return currentDockItemConfig.useOriginalBiliPage || !mainStore.getDockItemByPage(activatedPage.value)?.hasBewlyPage ? mainStore.getBiliWebPageURLByPage(activatedPage.value) : ''
  }
  return ''
})
const showBewlyPage = computed((): boolean => {
  if (isInIframe())
    return false

  const dockItem = mainStore.getDockItemByPage(activatedPage.value)
  if (!dockItem?.hasBewlyPage)
    return false

  if (iframePageURL.value)
    return false

  return isHomePage() && !settings.value.useOriginalBilibiliHomepage
})

// 应用占满视口时（条件与下方 app 容器的 100dvh 一致），滚动完全由应用内部的
// OverlayScrollbars 负责，文档本身不许滚。否则 #bewly 里的静态内容加上（非首页
// URL 时）B 站原页面 DOM 会让 html 溢出，原生滚动条和应用里的覆盖式滚动条并排，
// 首页/历史页就出现两条竖向滑动条。切到 B 站原始页面时不加这个类，原生滚动照常。
watchEffect(() => {
  document.documentElement.classList.toggle(
    'bewly-app-fullscreen',
    showBewlyPage.value || !!iframePageURL.value,
  )
})
/**
 * 自己是不是「页面切换器」用来装 B 站页面的那个 iframe 里的那份 app。
 * 是的话顶栏由外层页面画（见 `~/constants/iframe.ts`），这份不画——否则切过去时外层顶栏会先卸载、
 * 再等这里的 B 站文档把整个 app 连同顶栏从零启动一遍，看起来就是「顶部的元素消失后重载」。
 */
const isInPageSwitcherFrame = isInIframe() && window.name === PAGE_SWITCHER_IFRAME_NAME

const showTopBar = computed((): boolean => {
  // 页面切换器的 iframe：顶栏交给外层页面
  if (isInPageSwitcherFrame)
    return false

  // When using the open in drawer feature, the iframe inside the page will hide the top bar
  if (isVideoOrBangumiPage() && isInIframe())
    return false

  // when user open the notifications page as a drawer, don't show the top bar
  if (isNotificationPage() && settings.value.openNotificationsPageAsDrawer && isInIframe())
    return false

  // When the user switches to the original Bilibili page, the top bar used to be handed over to the one
  // inside the iframe. That is what made the top bar disappear and reload — the iframe's copy boots the
  // whole app from scratch. Now the outside top bar keeps drawing it the whole time while the iframe's
  // copy renders nothing (see the early return above), so nothing reloads.
  // reference: https://github.com/BewlyBewly/BewlyBewly/issues/1235

  // when using original bilibili homepage, show top bar
  return settings.value.useOriginalBilibiliHomepage
  // when on home page and not using original bilibili page, show top bar
    || (isHomePage() && !settingsStore.getDockItemIsUseOriginalBiliPage(activatedPage.value) && !isInIframe())
  // when a dock item is switched to the original bilibili page, the (outside) top bar stays as well
    || (isHomePage() && !!iframePageURL.value)
  // when in iframe and using original bilibili page, show top bar
    || (settingsStore.getDockItemIsUseOriginalBiliPage(activatedPage.value) && isInIframe())
  // when not on home page, show top bar
    || !isHomePage()
})

const isFirstTimeActivatedPageChange = ref<boolean>(true)
watch(
  () => activatedPage.value,
  () => {
    mainStore.setActivatedCover('')

    if (!isFirstTimeActivatedPageChange.value) {
      // Update the URL query parameter when activatedPage changes
      const url = new URL(window.location.href)
      url.searchParams.set('page', activatedPage.value)
      window.history.replaceState({}, '', url.toString())
    }

    // `osInstance()` is undefined while the scrollbar component has not mounted yet — which
    // happens on the first run and whenever the BewlyBewly page is swapped out and back.
    const osInstance = scrollbarRef.value?.osInstance()
    if (osInstance)
      osInstance.elements().viewport.scrollTop = 0

    isFirstTimeActivatedPageChange.value = false
  },
  { immediate: true },
)

watch([() => showTopBar.value, () => activatedPage.value], () => {
  // Remove the original Bilibili top bar when using original bilibili page to avoid two top bars showing
  const biliHeader = document.querySelector('.bili-header') as HTMLElement | null
  if (biliHeader && isHomePage()) {
    if (settingsStore.getDockItemIsUseOriginalBiliPage(activatedPage.value) && !isInIframe()) {
      biliHeader.style.visibility = 'hidden'
    }
    else {
      biliHeader.style.visibility = 'visible'
    }
  }
}, { immediate: true })

// Setup necessary settings watchers
setupNecessarySettingsWatchers()

onMounted(() => {
  window.dispatchEvent(new CustomEvent(BEWLY_MOUNTED))

  if (isHomePage()) {
    // Force overwrite Bilibili Evolved body tag & html tag background color
    document.body.style.setProperty('background-color', 'unset', 'important')
  }
  // document.documentElement.style.setProperty('font-size', '14px')

  document.addEventListener('scroll', () => {
    if (window.scrollY > 0)
      reachTop.value = false
    else
      reachTop.value = true
  })
})

function handleDockItemClick(dockItem: DockItem) {
  // Opening in a new tab while still on the current tab doesn't require changing the `activatedPage`
  if (dockItem.openInNewTab) {
    openLinkToNewTab(`https://www.bilibili.com/?page=${dockItem.page}`)
  }
  else {
    if (dockItem.useOriginalBiliPage) {
      // It seem like the `activatedPage` watcher above will handle this, so no need to set iframePageURL.value here
      // iframePageURL.value = dockItem.url
      if (!isHomePage()) {
        location.href = `https://www.bilibili.com/?page=${dockItem.page}`
      }
    }
    else {
      if (isHomePage()) {
        nextTick(() => {
          changeActivatePage(dockItem.page)
        })
      }
      else {
        location.href = `https://www.bilibili.com/?page=${dockItem.page}`
      }
    }

    // When not opened in a new tab, change the `activatedPage`
    activatedPage.value = dockItem.page
  }
}

function changeActivatePage(pageName: AppPage) {
  // `osInstance()` is undefined until the scrollbar component has mounted. Landing here with no
  // instance (returning to the home page re-creates it) used to throw on `.elements()`.
  const scrollTop: number = scrollbarRef.value?.osInstance()?.elements().viewport.scrollTop ?? 0

  if (activatedPage.value === pageName) {
    if (activatedPage.value !== AppPage.Search) {
      if (scrollTop === 0)
        handleThrottledPageRefresh()
      else
        handleThrottledBackToTop()
    }
    return
  }
  activatedPage.value = pageName
}

function handleBackToTop(targetScrollTop = 0 as number) {
  const osInstance = scrollbarRef.value?.osInstance()
  if (osInstance) {
    scrollToTop(osInstance.elements().viewport, targetScrollTop)
    topBarRef.value?.toggleTopBarVisible(true)
  }

  iframePageRef.value?.handleBackToTop()
}

function handleOsScroll() {
  emitter.emit(OVERLAY_SCROLL_BAR_SCROLL)

  const osInstance = scrollbarRef.value?.osInstance()
  if (!osInstance)
    return

  const { viewport } = osInstance.elements()
  const { scrollTop, scrollHeight, clientHeight } = viewport // get scroll offset

  if (scrollTop === 0) {
    reachTop.value = true
  }
  else {
    reachTop.value = false
  }

  if (clientHeight + scrollTop >= scrollHeight - 300)
    handleThrottledReachBottom()

  if (isHomePage())
    topBarRef.value?.handleScroll()
}

function openIframeDrawer(url: string) {
  const isSameOrigin = (origin: URL, destination: URL) =>
    origin.protocol === destination.protocol && origin.host === destination.host && origin.port === destination.port

  const currentUrl = new URL(location.href)
  const destination = new URL(url)

  try {
    if (!isSameOrigin(currentUrl, destination)) {
      openLinkToNewTab(url)
      return
    }
  }
  catch {
    openLinkToNewTab(url)
    return
  }

  iframeDrawerURL.value = url
  showIframeDrawer.value = true
}

/**
 * Checks if the current viewport has a scrollbar.
 * @returns {boolean} Returns true if the viewport has a scrollbar, false otherwise.
 */
async function haveScrollbar() {
  await nextTick()
  const osInstance = scrollbarRef.value?.osInstance()
  // If the scrollbarRef is not ready, return false
  if (osInstance) {
    const { viewport } = osInstance.elements()
    const { scrollHeight } = viewport // get scroll offset
    return scrollHeight > window.innerHeight
  }
  else {
    return false
  }
}

// In drawer video, watch btn className changed and post message to parent
watchEffect(async (onCleanUp) => {
  if (!isInIframe())
    return null

  const observer = new MutationObserver(([{ target: el }]) => {
    if (!(el instanceof HTMLElement))
      return null
    if (el.classList.contains('bpx-state-entered')) {
      parent.postMessage(DRAWER_VIDEO_ENTER_PAGE_FULL)
    }
    else {
      parent.postMessage(DRAWER_VIDEO_EXIT_PAGE_FULL)
    }
  })

  const abort = new AbortController()
  queryDomUntilFound('.bpx-player-ctrl-btn.bpx-player-ctrl-web', 500, abort).then((openVideo2WebFullBtn) => {
    if (!openVideo2WebFullBtn)
      return
    observer.observe(openVideo2WebFullBtn, { attributes: true })
  })

  onCleanUp(() => {
    observer.disconnect()
    abort.abort()
  })
})

provide<BewlyAppProvider>('BEWLY_APP', {
  activatedPage,
  mainAppRef,
  scrollbarRef,
  reachTop,
  handleBackToTop,
  handlePageRefresh,
  handleReachBottom,
  openIframeDrawer,
  haveScrollbar,
})
</script>

<template>
  <div
    id="bewly-wrapper"
    ref="mainAppRef"
    class="bewly-wrapper"
    :class="{ dark: isDark }"
    text="$bew-text-1 size-$bew-base-font-size"
  >
    <!-- Background -->
    <template v-if="showBewlyPage">
      <AppBackground :activated-page="activatedPage" />
    </template>

    <!-- Settings -->
    <KeepAlive>
      <Settings v-if="showSettings" z-10002 @close="showSettings = false" />
    </KeepAlive>

    <!-- Dock & RightSideButtons -->
    <div
      v-if="!isInIframe()"
      pos="absolute top-0 left-0" w-full h-full overflow-hidden
      pointer-events-none
    >
      <Dock
        v-if="!settings.useOriginalBilibiliHomepage && (settings.alwaysUseDock || (showBewlyPage || iframePageURL))"
        pointer-events-auto
        :activated-page="activatedPage"
        @settings-visibility-change="toggleSettings"
        @refresh="handleThrottledPageRefresh"
        @back-to-top="handleThrottledBackToTop"
        @dock-item-click="handleDockItemClick"
      />
      <SideBar
        v-else
        pointer-events-auto
        @settings-visibility-change="toggleSettings"
      />
    </div>

    <!-- TopBar -->
    <div
      v-if="showTopBar"
      m-auto max-w="$bew-page-max-width"
    >
      <BewlyOrBiliTopBarSwitcher v-if="settings.showBewlyOrBiliTopBarSwitcher" />

      <OldTopBar
        v-if="settings.useOldTopBar"
        pos="top-0 left-0" z="99 hover:1001" w-full
      />
      <TopBar
        v-else
        pos="top-0 left-0" z="99 hover:1001" w-full
      />
    </div>

    <div
      v-if="!settings.useOriginalBilibiliHomepage"
      pos="absolute top-0 left-0" w-full h-full
      :style="{
        height: showBewlyPage || iframePageURL ? '100dvh' : '0',
      }"
    >
      <Transition name="fade">
        <template v-if="showBewlyPage">
          <OverlayScrollbarsComponent ref="scrollbarRef" element="div" h-inherit @os-scroll="handleOsScroll">
            <main m-auto max-w="$bew-page-max-width">
              <div
                p="t-[calc(var(--bew-top-bar-height)+10px)]" m-auto
                w="lg:[calc(100%-200px)] [calc(100%-150px)]"
              >
                <Transition name="page-fade">
                  <Component :is="pages[activatedPage]" />
                </Transition>
              </div>
            </main>
          </OverlayScrollbarsComponent>
        </template>
      </Transition>

      <Transition v-if="!showBewlyPage && iframePageURL && !isInIframe()" name="fade">
        <IframePage ref="iframePageRef" :url="iframePageURL" />
      </Transition>
    </div>

    <IframeDrawer
      v-if="showIframeDrawer"
      :url="iframeDrawerURL"
      @close="showIframeDrawer = false"
    />

    <!-- 播放页「更多」菜单里点「下载视频」时弹出 -->
    <!--
      外面这层容器不能省。Dialog 的根节点是 Teleport，而它传送的目标正是 #bewly-wrapper 本身，
      于是占位节点和传送进来的对话框在同一个容器里紧挨着排列。对话框关闭时，DownloadDialog 的根
      从 Dialog 组件变成注释节点，Vue 会用 getNextHostNode() 取「占位节点后面的兄弟节点」当插入
      锚点——取到的恰是被传送进来的对话框元素，而它在上一步卸载里已经被移走，insertBefore 于是抛
      NotFoundError（DOMException）；这之后整棵树的 DOM 记账失准，下一次渲染又报
      「Cannot read properties of null (reading 'insertBefore')」。
      套一层容器后，占位节点位于容器内部且是最后一个子节点，锚点退化成 null，卸载不再出错。
      传送目标不变，所以对话框的定位和主题都不受影响。
    -->
    <div>
      <DownloadDialog
        v-if="downloadVideoTarget"
        v-model="showDownloadVideoDialog"
        :video="downloadVideoTarget"
        @close="showDownloadVideoDialog = false"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.bewly-wrapper {
  // To fix the filter used in `.bewly-wrapper` that cause the positions of elements become discorded.
  > * > * {
    filter: var(--bew-filter-force-dark);
  }
}
</style>
