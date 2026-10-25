<script setup lang="ts">
import { useDateFormat } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

import { useBewlyApp } from '~/composables/useAppProvider'
import { SEARCH_BAR_CHARACTERS } from '~/constants/imgs'
import { gridLayout } from '~/logic'
import type { HistoryResult, List as HistoryItem } from '~/models/history/history'
import { Business } from '~/models/history/history'
import type { HistorySearchResult, List as HistorySearchItem } from '~/models/video/historySearch'
import { useMainStore } from '~/stores/mainStore'
import api from '~/utils/api'
import { calcCurrentTime } from '~/utils/dataFormatter'
import { getCSRF, removeHttpFromUrl, scrollToTop } from '~/utils/main'

const { t, locale } = useI18n()
const { setActivatedCover } = useMainStore()

const isLoading = ref<boolean>()
/** 刷新（换筛选/页签）而非翻页：新数据到达后整段替换旧列表，期间不清空以保持滚动位置 */
const isRefreshing = ref<boolean>(false)
const noMoreContent = ref<boolean>(false)
const historyList = reactive<Array<HistoryItem>>([])
const currentPageNum = ref<number>(1)
const keyword = ref<string>()
const historyStatus = ref<boolean>()
const { handlePageRefresh, handleReachBottom, haveScrollbar, scrollbarRef } = useBewlyApp()

// #region 筛选与排列（对齐 B 站原版历史页；参数取值逆向自 B 站 history-record 主包）
const historyTab = ref<'all' | 'archive' | 'live' | 'article'>('all')
const showMoreFilter = ref<boolean>(false)
const durationFilter = ref<'all' | 'max10' | 'min10max30' | 'min30max60' | 'min60'>('all')
const timeFilter = ref<'all' | 'today' | 'yesterday' | 'week' | 'range'>('all')
const customStartDate = ref<string>('')
const customEndDate = ref<string>('')
/** 0=全部 1=PC 2=手机 3=平板 4=TV（B 站枚举原值） */
const deviceFilter = ref<number>(0)
// 排列方式走 gridLayout 持久化（storage 里的 history 字段），刷新/重开页面保持，
// 和首页三个排列切换按钮的行为一致——不再用本地 ref（刷新即回单列）
const layoutMode = computed({
  get: () => gridLayout.value.history,
  set: (value: 'list' | 'grid') => {
    gridLayout.value.history = value
  },
})

// 更多筛选面板右侧装饰：复用设置里搜索栏聚焦的四个人物图，每展开一次面板换一张
const filterCharacterIndex = ref(0)
watch(showMoreFilter, (val) => {
  if (val)
    filterCharacterIndex.value = (filterCharacterIndex.value + 1) % SEARCH_BAR_CHARACTERS.length
})
// 装饰图来自 CDN：挂载时预取，避免展开动画中途发起请求/解码掉帧
onMounted(() => {
  SEARCH_BAR_CHARACTERS.forEach(({ url }) => {
    const img = new Image()
    img.src = url
  })
})

const historyTabs = computed(() => [
  { label: t('history.tab_all'), value: 'all' as const },
  { label: t('history.tab_video'), value: 'archive' as const },
  { label: t('history.tab_live'), value: 'live' as const },
  { label: t('history.tab_article'), value: 'article' as const },
])
const durationOptions = computed(() => [
  { label: t('history.duration_all'), value: 'all' as const },
  { label: t('history.duration_max10'), value: 'max10' as const },
  { label: t('history.duration_10_30'), value: 'min10max30' as const },
  { label: t('history.duration_30_60'), value: 'min30max60' as const },
  { label: t('history.duration_min60'), value: 'min60' as const },
])
const timeOptions = computed(() => [
  { label: t('history.time_all'), value: 'all' as const },
  { label: t('history.time_today'), value: 'today' as const },
  { label: t('history.time_yesterday'), value: 'yesterday' as const },
  { label: t('history.time_week'), value: 'week' as const },
])
const deviceOptions = computed(() => [
  { label: t('history.device_all'), value: 0 },
  { label: t('history.device_pc'), value: 1 },
  { label: t('history.device_mobile'), value: 2 },
  { label: t('history.device_pad'), value: 3 },
  { label: t('history.device_tv'), value: 4 },
])

const hasAdvancedFilter = computed(() =>
  durationFilter.value !== 'all' || timeFilter.value !== 'all' || deviceFilter.value !== 0)

// 直播/专栏没有时长概念，原版在这两个页签下也隐藏时长组
const showDurationFilter = computed(() =>
  historyTab.value === 'all' || historyTab.value === 'archive')

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function changeHistoryTab(tab: typeof historyTab.value) {
  if (historyTab.value === tab)
    return
  historyTab.value = tab
  refreshHistory()
}

function changeDurationFilter(value: typeof durationFilter.value) {
  durationFilter.value = value
  refreshHistory()
}

function changeTimeFilter(value: typeof timeFilter.value) {
  timeFilter.value = value
  refreshHistory()
}

function changeDeviceFilter(value: number) {
  deviceFilter.value = value
  refreshHistory()
}

function changeCustomDateRange() {
  // 两个日期都选了才算进入了自定义区间；只选了一个先不动，等用户选完
  if (customStartDate.value && customEndDate.value) {
    timeFilter.value = 'range'
    refreshHistory()
  }
  else if (timeFilter.value === 'range') {
    timeFilter.value = 'all'
    refreshHistory()
  }
}

// 自定义日期区间：自带日历面板。原生 date 控件的弹层是浏览器原生 UI，和插件风格完全不搭
const openDatePicker = ref<'start' | 'end' | null>(null)
const calendarMonth = ref<Date>(new Date())
/** 日历三视图：日期格 / 月份格 / 年份格（点表头年、月切换，同 B 站原版） */
const calendarView = ref<'days' | 'months' | 'years'>('days')
// 星期表头直接写在组件里，不走语言包：yml 数组经 tm() 取出来显示会乱码
const weekdays = computed(() =>
  locale.value === 'en'
    ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    : ['一', '二', '三', '四', '五', '六', '日'])

const displayedYear = computed(() => calendarMonth.value.getFullYear())
const displayedMonth = computed(() => calendarMonth.value.getMonth() + 1)
const yearOptions = computed(() => {
  // B 站 2009 年上线，历史不会更早；只列到当前年，列表内滚动展示
  const maxYear = new Date().getFullYear()
  return Array.from({ length: maxYear - 2008 }, (_, i) => 2009 + i)
})

// 未来时间置灰区分：今天 / 本月 / 今年不算未来
function isFutureMonth(month: number) {
  const now = new Date()
  const year = calendarMonth.value.getFullYear()
  if (year !== now.getFullYear())
    return year > now.getFullYear()
  return month > now.getMonth() + 1
}

function isFutureDay(day: number | null) {
  if (!day)
    return false
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const date = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth(), day)
  return date.getTime() > today.getTime()
}

function selectCalendarYear(year: number) {
  calendarMonth.value = new Date(year, calendarMonth.value.getMonth(), 1)
  calendarView.value = 'months'
}

function selectCalendarMonth(month: number) {
  calendarMonth.value = new Date(calendarMonth.value.getFullYear(), month - 1, 1)
  calendarView.value = 'days'
}

function toggleCalendarView(view: 'years' | 'months') {
  // 再点同一个表头切回日期视图
  calendarView.value = calendarView.value === view ? 'days' : view
}

// 年份列表限高滚动：切到年份视图时把当前年滚进可视区
const yearsGridRef = ref<HTMLElement>()
watch(calendarView, async (view) => {
  if (view !== 'years')
    return
  await nextTick()
  yearsGridRef.value
    ?.querySelector<HTMLElement>('.date-picker-day-active')
    ?.scrollIntoView({ block: 'nearest' })
})

const calendarCells = computed<Array<number | null>>(() => {
  const month = calendarMonth.value
  // 周一开头（国内习惯）
  const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: Array<number | null> = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= daysInMonth; day++)
    cells.push(day)
  while (cells.length % 7 !== 0)
    cells.push(null)
  return cells
})

function calendarDateValue(day: number) {
  return `${calendarMonth.value.getFullYear()}-${String(calendarMonth.value.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toggleDatePicker(which: 'start' | 'end') {
  if (openDatePicker.value === which) {
    openDatePicker.value = null
    return
  }
  openDatePicker.value = which
  calendarView.value = 'days'
  const base = which === 'start' && customStartDate.value
    ? new Date(customStartDate.value)
    : which === 'end' && customEndDate.value
      ? new Date(customEndDate.value)
      : new Date()
  calendarMonth.value = new Date(base.getFullYear(), base.getMonth(), 1)
}

function shiftCalendarMonth(delta: number) {
  calendarMonth.value = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth() + delta, 1)
}

function pickDate(day: number) {
  if (openDatePicker.value === 'start')
    customStartDate.value = calendarDateValue(day)
  else
    customEndDate.value = calendarDateValue(day)
  openDatePicker.value = null
  changeCustomDateRange()
}

watch(openDatePicker, (val, _old, onCleanup) => {
  if (!val)
    return
  const onDocClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.date-range'))
      openDatePicker.value = null
  }
  window.addEventListener('click', onDocClick)
  onCleanup(() => window.removeEventListener('click', onDocClick))
})
// #endregion

const HistoryBusiness = computed(() => {
  return Business
})

onMounted(() => {
  getHistoryList()
  getHistoryPauseStatus()

  initPageAction()
})

function initPageAction() {
  handleReachBottom.value = () => {
    if (isLoading.value)
      return
    if (noMoreContent.value)
      return

    if (keyword.value || hasAdvancedFilter.value)
      searchHistoryList()
    else
      getHistoryList()
  }

  handlePageRefresh.value = () => {
    refreshHistory()
  }
}

/**
 * 重置分页并按当前 筛选/关键词 决定走 cursor 还是 search 接口（和原版一致：任一高级筛选启用就走 search）。
 * 不再先清空列表：清空会让页面高度骤降、滚动位置被怼回顶部（日历选完日期收回时很突兀），
 * 改为新数据到达后整段替换，加载期间保留旧内容。
 */
function getHistoryViewport(): HTMLElement | undefined {
  return scrollbarRef.value?.osInstance?.()?.elements?.()?.viewport as HTMLElement | undefined
}

/**
 * 等平滑滚顶结束（scrollend + 轮询/超时兜底）：数据替换必须排在滚动之后，
 * 否则新列表更矮时浏览器会把滚动位置瞬间钳走，平滑滚动会被打断成跳变
 */
function waitForScrollTop(viewport: HTMLElement | undefined, timeout = 600): Promise<void> {
  if (!viewport || viewport.scrollTop <= 1)
    return Promise.resolve()
  return new Promise((resolve) => {
    let poll = 0
    let timer = 0
    const finish = () => {
      viewport.removeEventListener('scrollend', finish)
      window.clearInterval(poll)
      window.clearTimeout(timer)
      resolve()
    }
    poll = window.setInterval(() => {
      if (viewport.scrollTop <= 1)
        finish()
    }, 50)
    timer = window.setTimeout(finish, timeout)
    viewport.addEventListener('scrollend', finish)
  })
}

function refreshHistory() {
  currentPageNum.value = 1
  noMoreContent.value = false
  isRefreshing.value = true
  // 新列表通常比旧列表矮（筛选后结果变少），数据到达整段替换时浏览器会把
  // scrollTop 瞬间钳到 0（实测 600→0），观感就是「日历一收列表猛跳顶」。
  // 在请求发出时就平滑滚回顶部：此刻旧列表还在，用户看到的是一段正常滚动。
  const viewport = getHistoryViewport()
  if (viewport && viewport.scrollTop > 0)
    scrollToTop(viewport, 0)
  if (keyword.value || hasAdvancedFilter.value)
    searchHistoryList()
  else
    getHistoryList()
}

/**
 * 面板高度过渡只列 height 相关属性，不用 all：面板带 backdrop-filter，
 * all 会把动画期间任何属性变化（包括将来无意引入的）都卷进逐帧补间。
 */
const FILTER_PANEL_TRANSITION = 'height 0.3s ease, margin-bottom 0.3s ease, padding-top 0.3s ease, padding-bottom 0.3s ease'

/**
 * 面板收起：高度是 auto，CSS 无法从 auto 过渡到 0。
 * before-leave 把高度钉成当前像素值，强制回流提交后同步收到 0——
 * 不依赖 rAF（后台标签页 rAF 会停摆，之前展开动画无声失效就是这个原因）。
 */
function onFilterPanelBeforeLeave(el: Element) {
  const panel = el as HTMLElement
  panel.style.transition = FILTER_PANEL_TRANSITION
  panel.style.height = `${panel.offsetHeight}px`
  panel.style.overflow = 'hidden'
  void panel.offsetHeight // 提交起点
  panel.style.height = '0'
  panel.style.marginBottom = '0'
  panel.style.paddingTop = '0'
  panel.style.paddingBottom = '0'
}

/**
 * 面板展开。关键坑：Vue3 的 beforeEnter 在元素插入 DOM 之前调用
 * （runtime-core mountElement：transition.beforeEnter(el) → hostInsert），
 * 此刻 offsetHeight 恒为 0——在这里量自然高度会把目标钉成 0，过渡从 0 到 0
 * 什么都不发生，300ms 后 Vue 等不到 transitionend 走超时兜底、afterEnter
 * 清内联样式瞬间弹开，观感是「点了没反应、过一会儿突然弹出」（之前所谓的卡顿）。
 *
 * 所以分工：beforeEnter（插入前）只负责写好折叠态，保证插入后首帧就是收起的；
 * 自然高度等微任务补量——hostInsert 在 beforeEnter 之后同步执行，微任务跑时
 * 元素已入 DOM，且仍在同一帧内（微任务先于绘制），不会闪。
 * 守门条件：微任务执行时若这次进入已被取消（enter 类被摘掉），直接放弃，
 * 不要覆盖 leave 钉好的折叠态。
 */
function onFilterPanelBeforeEnter(el: Element) {
  const panel = el as HTMLElement
  // 收起动画中途又点开：清掉 leave 写上的折叠残留（新元素上是空操作，保险起见）
  panel.style.height = ''
  panel.style.marginBottom = ''
  panel.style.paddingTop = ''
  panel.style.paddingBottom = ''
  panel.style.overflow = ''
  panel.style.transition = ''
  // 插入前钉住折叠态：无过渡、高度 0、裁掉溢出
  panel.style.transition = 'none'
  panel.style.height = '0'
  panel.style.marginBottom = '0'
  panel.style.overflow = 'hidden'
  queueMicrotask(() => {
    if (!panel.isConnected || !panel.classList.contains('filter-panel-enter-active'))
      return
    // 量自然高度：先恢复 auto 样式（此刻已入 DOM，量到的是真实高度）
    panel.style.height = ''
    panel.style.marginBottom = ''
    panel.style.paddingTop = ''
    panel.style.paddingBottom = ''
    const target = panel.offsetHeight
    panel.style.transition = 'none' // 钉起点期间不许动
    panel.style.height = '0'
    panel.style.marginBottom = '0'
    void panel.offsetHeight // 提交 height:0 为过渡起点
    panel.style.transition = FILTER_PANEL_TRANSITION // 再开过渡，设终点
    panel.style.height = `${target}px`
    panel.style.marginBottom = '' // 回落到 mb-6 的样式值，同一条 transition 补间
  })
}

function onFilterPanelAfterEnter(el: Element) {
  const panel = el as HTMLElement
  panel.style.height = ''
  panel.style.marginBottom = ''
  panel.style.overflow = ''
  panel.style.transition = ''
}

/**
 * Get history list
 */
function getHistoryList() {
  // 刷新模式取第一页（view_at 从 0 起），翻页模式沿用列表末项游标
  const refreshing = isRefreshing.value
  isLoading.value = true
  api.history.getHistoryList({
    type: historyTab.value,
    view_at:
        !refreshing && historyList.length > 0
          ? historyList[historyList.length - 1].view_at
          : 0,
  })
    .then(async (res: HistoryResult) => {
      // Bilibili answers some requests with `code: 0` and a null payload (list 也可能是 null）；
      // 统一收成数组再用，空结果直接到底，避免对 null 读 length/forEach
      if (res.code === 0 && res.data) {
        const list = Array.isArray(res.data.list) ? res.data.list : []

        if (list.length === 0) {
          if (refreshing) {
            await waitForScrollTop(getHistoryViewport())
            historyList.splice(0)
            isRefreshing.value = false
          }
          noMoreContent.value = true
          return
        }

        if (refreshing) {
          // 整段替换旧列表；只消费一次，后续补页递归走追加逻辑。
          // 先等平滑滚顶完成再替换，否则更矮的新列表会把滚动瞬间钳回顶部
          await waitForScrollTop(getHistoryViewport())
          historyList.splice(0, historyList.length, ...list)
          isRefreshing.value = false
        }
        else {
          historyList.push(...list)
        }

        if (list.length < 20) {
          isLoading.value = false
          noMoreContent.value = true
          return
        }

        noMoreContent.value = false

        if (!await haveScrollbar() && !noMoreContent.value) {
          getHistoryList()
        }
      }
    }).finally(() => {
      isLoading.value = false
    })
}

function searchHistoryList() {
  const refreshing = isRefreshing.value
  isLoading.value = true

  const params: Record<string, any> = {
    pn: currentPageNum.value++,
    keyword: keyword.value ?? '',
    business: historyTab.value,
  }

  // 时长：秒区间，取值抄自 B 站历史页主包（arc_max_duration=599 表示「不到 10 分钟」而非 600）
  if (showDurationFilter.value) {
    if (durationFilter.value === 'max10') {
      params.arc_max_duration = 599
    }
    else if (durationFilter.value === 'min10max30') {
      params.arc_min_duration = 600
      params.arc_max_duration = 1800
    }
    else if (durationFilter.value === 'min30max60') {
      params.arc_min_duration = 1800
      params.arc_max_duration = 3600
    }
    else if (durationFilter.value === 'min60') {
      params.arc_min_duration = 3601
    }
  }

  // 时间：秒级时间戳，今天/昨天按零点切分，近一周按当前时刻减 7 天（和原版一致）
  if (timeFilter.value === 'today') {
    params.add_time_start = Math.floor(startOfDay(new Date()).getTime() / 1000)
  }
  else if (timeFilter.value === 'yesterday') {
    const todayStart = startOfDay(new Date())
    params.add_time_start = Math.floor(startOfDay(new Date(todayStart.getTime() - 86400e3)).getTime() / 1000)
    params.add_time_end = Math.floor(todayStart.getTime() / 1000) - 1
  }
  else if (timeFilter.value === 'week') {
    params.add_time_start = Math.floor((Date.now() - 7 * 86400e3) / 1000)
  }
  else if (timeFilter.value === 'range' && customStartDate.value && customEndDate.value) {
    const end = new Date(customEndDate.value)
    end.setHours(23, 59, 59, 999)
    params.add_time_start = Math.floor(startOfDay(new Date(customStartDate.value)).getTime() / 1000)
    params.add_time_end = Math.floor(end.getTime() / 1000)
  }

  if (deviceFilter.value !== 0)
    params.device_type = deviceFilter.value

  api.history.searchHistoryList(params)
    .then(async (res: HistorySearchResult) => {
      if (res.code === 0 && res.data) {
        // 筛选无结果时 data.list 是 null，直接 forEach 会炸（就是控制台那条 TypeError）
        const list = Array.isArray(res.data.list) ? res.data.list : []

        if (list.length === 0) {
          if (refreshing) {
            await waitForScrollTop(getHistoryViewport())
            historyList.splice(0)
          }
          isRefreshing.value = false
          noMoreContent.value = true
          return
        }

        if (refreshing) {
          // 整段替换旧列表（旧实现在这里先清空页面会跳顶）；
          // 先等平滑滚顶完成再替换，否则更矮的新列表会把滚动瞬间钳回顶部
          await waitForScrollTop(getHistoryViewport())
          historyList.splice(0, historyList.length, ...(list as unknown as HistoryItem[]))
          isRefreshing.value = false
        }
        else {
          list.forEach((item: HistorySearchItem) => {
            historyList.push(item as unknown as HistoryItem)
          })
        }

        noMoreContent.value = list.length < 20
      }
    }).finally(() => {
      isLoading.value = false
    })
}

function handleSearch() {
  refreshHistory()
}

function deleteHistoryItem(historyItem: HistoryItem) {
  api.history.deleteHistoryItem({
    kid: `${historyItem.history.business}_${historyItem.history.oid}`,
    csrf: getCSRF(),
  })
    .then((res) => {
      if (res.code === 0) {
        // 按对象身份找索引：宫格模式按日期分组渲染后 v-for 的 index 是组内下标，
        // 直接拿去 splice 会删错项；整段刷新过对象也会变，indexOf 找不到就不动
        const index = historyList.indexOf(historyItem)
        if (index !== -1)
          historyList.splice(index, 1)
      }
    })
}

/**
 * Return the URL of the history item
 * @param item history item
 * @return {string} url
 */
function getHistoryUrl(item: HistoryItem): string {
  if (item.uri)
    return item.uri

  // Video
  if (item.history.business === Business.ARCHIVE) {
    if (item?.videos && item.videos > 0)
      return `https://www.bilibili.com/video/${item.history.bvid}?p=${item.history.page}`
    return `https://www.bilibili.com/video/${item.history.bvid}`
  }
  // Live
  else if (item.history.business === Business.LIVE) {
    return `https://live.bilibili.com/${item.history.oid}`
  }
  // Article
  else if (item.history.business === Business.ARTICLE || item.history.business === Business.ARTICLE_LIST) {
    if (item.history.cid === 0)
      return `https://www.bilibili.com/read/cv${item.history.oid}`
    else
      return `https://www.bilibili.com/read/cv${item.history.cid}`
  }
  return ''
}

function getHistoryItemCover(item: HistoryItem) {
  if (item.history.business === 'article' || item.history.business === 'article-list') {
    if (item.covers)
      return removeHttpFromUrl(`${item.covers[0]}`)
  }

  return removeHttpFromUrl(item.cover)
}

function getHistoryPauseStatus() {
  api.history.getHistoryPauseStatus()
    .then((res) => {
      if (res.code === 0)
        historyStatus.value = res.data
    })
}

function setHistoryPauseStatus(isPause: boolean) {
  api.history.setHistoryPauseStatus({
    csrf: getCSRF(),
    switch: isPause,
  })
    .then((res) => {
      if (res.code === 0)
        getHistoryPauseStatus()
    })
}

function clearAllHistory() {
  api.history.clearAllHistory({
    csrf: getCSRF(),
  })
    .then((res) => {
      if (res.code === 0)
        historyList.length = 0
    })
}

// #region 批量管理（对齐 B 站原版历史页：卡片勾选/全选/计数文案/一次请求逗号拼 kid/
// 「全选且未筛选」时改走按页签清空。语义逆向自原版前端包 shanks/history-record 的
// BreadCrums 组件与 store 的 deleteHistoryRecord/clearHistoryRecord）
const isInBatchManagement = ref<boolean>(false)
/** 全选标记：只有全选复选框会点亮它；手动勾选任意一项即熄灭（同原版） */
const isAllSelected = ref<boolean>(false)
/** 选中集合，key 和单条删除同一形态：`${business}_${oid}` */
const selectedKids = ref<string[]>([])

/** 原版 isFiltering：关键词或任一高级筛选启用时，全选只作用于已加载项、删除不走清空 */
const isFiltering = computed(() => !!keyword.value || hasAdvancedFilter.value)

function kidOfHistoryItem(item: { history: { business: string, oid: number } }) {
  return `${item.history.business}_${item.history.oid}`
}

const batchTabText = computed(() => {
  const keyMap: Record<string, string> = { all: 'tab_all', archive: 'tab_video', live: 'tab_live', article: 'tab_article' }
  return t(`history.${keyMap[historyTab.value] ?? 'tab_all'}`)
})

/** 提示文案分四档（全部/按页签/筛选中全部/筛选中按页签）+ 普通计数，同原版 */
const selectedTipsText = computed(() => {
  if (!isAllSelected.value)
    return t('history.selected_count', { count: selectedKids.value.length })
  if (isFiltering.value) {
    return historyTab.value === 'all'
      ? t('history.selected_all_loaded')
      : t('history.selected_all_loaded_type', { tab: batchTabText.value })
  }
  return historyTab.value === 'all'
    ? t('history.selected_all')
    : t('history.selected_all_type', { tab: batchTabText.value })
})

const showBatchDeleteConfirm = ref<boolean>(false)
const batchDeleteConfirmMessage = ref<string>('')

function toggleBatchManagement() {
  if (isInBatchManagement.value) {
    exitBatchManagement()
    return
  }
  if (!historyList.length)
    return
  isInBatchManagement.value = true
  isAllSelected.value = false
  selectedKids.value = []
  // 原版进入编辑态会收起筛选行
  showMoreFilter.value = false
}

function exitBatchManagement() {
  isInBatchManagement.value = false
  isAllSelected.value = false
  selectedKids.value = []
}

function isHistoryItemSelected(item: { history: { business: string, oid: number } }) {
  return selectedKids.value.includes(kidOfHistoryItem(item))
}

function toggleHistoryItemSelection(item: { history: { business: string, oid: number } }) {
  const key = kidOfHistoryItem(item)
  const index = selectedKids.value.indexOf(key)
  if (index === -1)
    selectedKids.value.push(key)
  else
    selectedKids.value.splice(index, 1)
  isAllSelected.value = false
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    isAllSelected.value = false
    selectedKids.value = []
    return
  }
  isAllSelected.value = true
  selectedKids.value = historyList.map(kidOfHistoryItem)
}

/**
 * 批量模式拦截卡片跳转：批量模式下点卡片任意位置都不应该跳转/开抽屉，
 * 只放行复选框自己的点击。capture 挂在列表容器上，先于 ALink 内部的 click。
 */
function handleHistoryListClickCapture(event: MouseEvent) {
  if (!isInBatchManagement.value)
    return
  if ((event.target as HTMLElement).closest?.('.card-checkbox'))
    return
  event.preventDefault()
  event.stopPropagation()
}

function handleBatchDelete() {
  const title = isAllSelected.value && !isFiltering.value
    ? (historyTab.value === 'all'
        ? t('history.confirm_delete_all')
        : t('history.confirm_delete_all_type', { tab: batchTabText.value }))
    : (historyTab.value === 'all'
        ? t('history.confirm_delete_selected')
        : t('history.confirm_delete_selected_type', { tab: batchTabText.value }))
  batchDeleteConfirmMessage.value = `${title}\n${t('history.delete_unrecoverable')}`
  showBatchDeleteConfirm.value = true
}

/**
 * 确认后的批量删除，分支和请求形状都同原版：
 * - 全选且未筛选：不逐条删，按当前页签调 clear（综合=business 空清空全部；
 *   视频组 archive+pgc+cheese、直播 live、专栏 article+article-list）；
 * - 其余：一次请求 kid 逗号拼接全部选中项。
 * 成功后清空选择并退出批量模式；删的是全部已加载项则整页刷新，否则本地移除。
 */
async function batchDeleteSelectedItems() {
  const keys = [...selectedKids.value]
  if (!keys.length)
    return

  if (isAllSelected.value && !isFiltering.value) {
    const businessGroups: Record<string, string[]> = {
      all: [''],
      archive: ['archive', 'pgc', 'cheese'],
      live: ['live'],
      article: ['article', 'article-list'],
    }
    const results = await Promise.all(
      (businessGroups[historyTab.value] ?? ['']).map(business =>
        api.history.clearAllHistory({ csrf: getCSRF(), business })),
    )
    // 原版语义：组内请求全部失败才算失败
    if (results.some(res => res.code === 0)) {
      exitBatchManagement()
      refreshHistory()
    }
    return
  }

  const res = await api.history.deleteHistoryItem({
    kid: keys.join(','),
    csrf: getCSRF(),
  })
  if (res.code !== 0)
    return
  exitBatchManagement()
  if (keys.length >= historyList.length) {
    refreshHistory()
    return
  }
  const removeSet = new Set(keys)
  historyList.splice(0, historyList.length, ...historyList.filter(item => !removeSet.has(kidOfHistoryItem(item))))
}
// #endregion 批量管理

/**
 * 宫格模式的时间线分组：按日历日切段，锚点标签统一显示日期（YYYY-MM-DD，
 * 和单列时间线里的日期同一种格式，不做「今天/昨天」特判——两种排列的日期要统一）。
 * 列表恒按 view_at 倒序，同日项必然相邻，顺序扫描分组即可。
 */
const gridHistorySections = computed<Array<{ label: string, items: HistoryItem[] }>>(() => {
  const sections: Array<{ label: string, items: HistoryItem[] }> = []
  for (const item of historyList) {
    const label = useDateFormat(item.view_at * 1000, 'YYYY-MM-DD').value
    const last = sections[sections.length - 1]
    if (last && last.label === label)
      last.items.push(item)
    else
      sections.push({ label, items: [item] })
  }
  return sections
})

const showClearHistoryConfirm = ref<boolean>(false)
const showPauseHistoryConfirm = ref<boolean>(false)
const showTurnOnHistoryConfirm = ref<boolean>(false)

function handleClearAllWatchHistory() {
  showClearHistoryConfirm.value = true
}

function handlePauseWatchHistory() {
  showPauseHistoryConfirm.value = true
}

function handleTurnOnWatchHistory() {
  showTurnOnHistoryConfirm.value = true
}

function jumpToLoginPage() {
  location.href = 'https://passport.bilibili.com/login'
}

function handleMouseEnter(item: HistoryItem) {
  setActivatedCover(`${getHistoryItemCover(item)}@480w_270h_1c`)
}
</script>

<template>
  <div v-if="getCSRF()" flex="~ col md:row lg:row" gap-4>
    <main w="full md:60% lg:70% xl:75%" order="2 md:1 lg:1" mb-6>
      <h3 text="3xl $bew-text-1" font-bold mb-6>
        {{ $t('history.title') }}
      </h3>

      <!-- 页签 / 更多筛选 / 排列方式（对齐 B 站原版历史页） -->
      <!-- attributify 的 flex="…" 里换行要写 wrap，写 flex-wrap 不生成规则
           （构建产物只有 [flex~=wrap]，和坑 14 的 flex-1→1 同族，实测 nowrap 溢出） -->
      <div flex="~ items-center justify-between gap-2 wrap" mb-6>
        <div flex="~ items-center gap-2 wrap">
          <!-- 页签/更多筛选：样式对齐稍后再看页的「清空稍后再看」按钮（secondary + strong），
               用 filter-btn；面板里的筛选 chips 仍是 filter-chip -->
          <button
            v-for="tab in historyTabs" :key="tab.value"
            class="filter-btn"
            :class="{ 'filter-chip-active': historyTab === tab.value }"
            @click="changeHistoryTab(tab.value)"
          >
            {{ tab.label }}
          </button>
          <button
            class="filter-btn"
            :class="{ 'filter-chip-active': showMoreFilter || hasAdvancedFilter }"
            @click="showMoreFilter = !showMoreFilter"
          >
            <div i-tabler:filter />
            {{ t('history.more_filter') }}
          </button>
        </div>
        <div flex="~ items-center gap-1">
          <!-- 批量管理控件（对齐原版）：进入批量模式时出现在排列切换按钮左边 -->
          <div v-if="isInBatchManagement" class="batch-controls" flex="~ items-center gap-3" mr-2>
            <button type="button" class="batch-select-all" @click="toggleSelectAll">
              <span class="batch-checkbox" :class="{ 'batch-checkbox-checked': isAllSelected }">
                <div v-if="isAllSelected" i-tabler:check w-14px h-14px />
              </span>
              {{ $t('history.select_all') }}
            </button>
            <span class="batch-selected-tips">{{ selectedTipsText }}</span>
            <div class="batch-split-line" />
            <Button
              type="primary"
              :disabled="!selectedKids.length"
              @click="handleBatchDelete"
            >
              <template #left>
                <div i-tabler:trash />
              </template>
              {{ $t('common.operation.delete') }}
            </Button>
          </div>
          <!-- 排列切换：容器和项样式整体克隆首页三个排列切换按钮——
               毛玻璃药丸（elevated + glass-1 + 边框 + 双层投影）+ 方形圆角图标项 + 选中整格主题色 -->
          <div
            style="backdrop-filter: var(--bew-filter-glass-1)"
            flex="~ gap-1 shrink-0" p-1 h-38px bg="$bew-elevated" transform-gpu
            rounded-full
            shadow="[var(--bew-shadow-1),var(--bew-shadow-edge-glow-1)]"
            box-border border="1 $bew-border-color"
          >
            <!-- 图标和悬浮提示与首页排列切换完全统一：
                 列表模式=首页「单列」（list-check-3），宫格模式=首页「自适应」（table-3，
                 历史页宫格本来就是 auto-fill 自适应列，语义一致），选中态同首页换 fill 图标 -->
            <Tooltip :content="t('home.layout_one_column')" placement="bottom">
              <div
                class="layout-btn"
                :class="{ 'layout-btn-active': layoutMode === 'list' }"
                @click="layoutMode = 'list'"
              >
                <div :class="layoutMode === 'list' ? 'i-mingcute:list-check-3-fill' : 'i-mingcute:list-check-3-line'" text-base />
              </div>
            </Tooltip>
            <Tooltip :content="t('home.layout_adaptive')" placement="bottom">
              <div
                class="layout-btn"
                :class="{ 'layout-btn-active': layoutMode === 'grid' }"
                @click="layoutMode = 'grid'"
              >
                <div :class="layoutMode === 'grid' ? 'i-mingcute:table-3-fill' : 'i-mingcute:table-3-line'" text-base />
              </div>
            </Tooltip>
          </div>
        </div>
      </div>

      <!-- 过渡用自定义名 filter-panel 且不配任何 CSS 类：展开/收起完全由
           before/after 钩子写内联样式驱动（auto↔0 的高度补间）。
           不要用 dropdown——它 enter-from 那套 opacity-0/scale-95/translateY/filter:blur
           会叠在 backdrop-filter 面板上逐帧重糊，且 opacity<1 让毛玻璃采样失效，
           是展开动画卡顿的来源。 -->
      <Transition
        name="filter-panel"
        @before-enter="onFilterPanelBeforeEnter"
        @after-enter="onFilterPanelAfterEnter"
        @before-leave="onFilterPanelBeforeLeave"
      >
        <div
          v-if="showMoreFilter"
          class="more-filter-panel"
          rounded="$bew-radius"
          border="1 $bew-border-color"
          p-4
          flex="~ gap-4"
          mb-6
        >
          <!-- 左：筛选项；右侧留白放人物装饰（每展开一次换一张）。
               flex-1 要走 class——写进 attributify 的 flex="..." 里不生效（实测 computed 是 0 1 auto），
               左列不撑开时人物图会挤在面板中间 -->
          <div class="flex-1 min-w-0" flex="~ col gap-4">
            <div v-if="showDurationFilter" flex="~ col gap-2">
              <p text="xs $bew-text-3">
                {{ t('history.filter_duration') }}
              </p>
              <div flex="~ gap-2 wrap">
                <button
                  v-for="opt in durationOptions" :key="opt.value"
                  class="filter-chip"
                  :class="{ 'filter-chip-active': durationFilter === opt.value }"
                  @click="changeDurationFilter(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
            <div flex="~ col gap-2">
              <p text="xs $bew-text-3">
                {{ t('history.filter_time') }}
              </p>
              <div flex="~ gap-2 items-center wrap">
                <button
                  v-for="opt in timeOptions" :key="opt.value"
                  class="filter-chip"
                  :class="{ 'filter-chip-active': timeFilter === opt.value }"
                  @click="changeTimeFilter(opt.value)"
                >
                  {{ opt.label }}
                </button>
                <!-- 自带日历面板的日期选择：原生 date 控件的弹层和插件风格不搭。
                   两个字段和弹层共用定位容器，弹层与两个字段总宽对齐 -->
                <div class="date-range">
                  <button
                    type="button"
                    class="date-picker-field"
                    :class="{ 'date-picker-field-open': openDatePicker === 'start' }"
                    @click.stop="toggleDatePicker('start')"
                  >
                    <span :class="customStartDate ? '' : 'date-picker-placeholder'">
                      {{ customStartDate || t('history.time_start_date') }}
                    </span>
                  </button>
                  <span text="xs $bew-text-3">{{ t('history.time_range_to') }}</span>
                  <button
                    type="button"
                    class="date-picker-field"
                    :class="{ 'date-picker-field-open': openDatePicker === 'end' }"
                    @click.stop="toggleDatePicker('end')"
                  >
                    <span :class="customEndDate ? '' : 'date-picker-placeholder'">
                      {{ customEndDate || t('history.time_end_date') }}
                    </span>
                  </button>
                  <Transition name="dropdown">
                    <div v-if="openDatePicker === 'start'" class="date-picker-panel" @click.stop>
                      <div class="date-picker-header">
                        <button v-if="calendarView === 'days'" type="button" class="date-picker-nav" @click="shiftCalendarMonth(-1)">
                          <div i-tabler:chevron-left />
                        </button>
                        <span v-else class="date-picker-nav-placeholder" />
                        <div flex="~ items-center gap-1">
                          <button type="button" class="date-picker-header-btn" @click="toggleCalendarView('years')">
                            {{ t('history.date_year_unit', { year: displayedYear }) }}
                          </button>
                          <button type="button" class="date-picker-header-btn" @click="toggleCalendarView('months')">
                            {{ t('history.date_month_unit', { month: displayedMonth }) }}
                          </button>
                        </div>
                        <button v-if="calendarView === 'days'" type="button" class="date-picker-nav" @click="shiftCalendarMonth(1)">
                          <div i-tabler:chevron-right />
                        </button>
                        <span v-else class="date-picker-nav-placeholder" />
                      </div>
                      <div v-if="calendarView === 'days'" class="date-picker-grid">
                        <span
                          v-for="(w, i) in weekdays" :key="`wd-${i}`"
                          class="date-picker-weekday"
                        >{{ w }}</span>
                        <button
                          v-for="(day, i) in calendarCells" :key="`d-${i}`"
                          type="button"
                          class="date-picker-day"
                          :class="{
                            'date-picker-day-empty': !day,
                            'date-picker-day-active': day && customStartDate === calendarDateValue(day),
                            'date-picker-day-muted': day && isFutureDay(day),
                          }"
                          :disabled="!day"
                          @click="day && pickDate(day)"
                        >
                          {{ day }}
                        </button>
                      </div>
                      <div v-else-if="calendarView === 'months'" class="date-picker-grid date-picker-grid-wide">
                        <button
                          v-for="m in 12" :key="`m-${m}`"
                          type="button"
                          class="date-picker-day"
                          :class="{ 'date-picker-day-active': m === displayedMonth, 'date-picker-day-muted': isFutureMonth(m) }"
                          @click="selectCalendarMonth(m)"
                        >
                          {{ m }}
                        </button>
                      </div>
                      <div v-else ref="yearsGridRef" class="date-picker-grid date-picker-grid-wide date-picker-grid-scroll">
                        <button
                          v-for="y in yearOptions" :key="`y-${y}`"
                          type="button"
                          class="date-picker-day"
                          :class="{ 'date-picker-day-active': y === displayedYear }"
                          @click="selectCalendarYear(y)"
                        >
                          {{ y }}
                        </button>
                      </div>
                    </div>
                  </Transition>
                  <Transition name="dropdown">
                    <div v-if="openDatePicker === 'end'" class="date-picker-panel" @click.stop>
                      <div class="date-picker-header">
                        <button v-if="calendarView === 'days'" type="button" class="date-picker-nav" @click="shiftCalendarMonth(-1)">
                          <div i-tabler:chevron-left />
                        </button>
                        <span v-else class="date-picker-nav-placeholder" />
                        <div flex="~ items-center gap-1">
                          <button type="button" class="date-picker-header-btn" @click="toggleCalendarView('years')">
                            {{ t('history.date_year_unit', { year: displayedYear }) }}
                          </button>
                          <button type="button" class="date-picker-header-btn" @click="toggleCalendarView('months')">
                            {{ t('history.date_month_unit', { month: displayedMonth }) }}
                          </button>
                        </div>
                        <button v-if="calendarView === 'days'" type="button" class="date-picker-nav" @click="shiftCalendarMonth(1)">
                          <div i-tabler:chevron-right />
                        </button>
                        <span v-else class="date-picker-nav-placeholder" />
                      </div>
                      <div v-if="calendarView === 'days'" class="date-picker-grid">
                        <span
                          v-for="(w, i) in weekdays" :key="`wd-${i}`"
                          class="date-picker-weekday"
                        >{{ w }}</span>
                        <button
                          v-for="(day, i) in calendarCells" :key="`d-${i}`"
                          type="button"
                          class="date-picker-day"
                          :class="{
                            'date-picker-day-empty': !day,
                            'date-picker-day-active': day && customEndDate === calendarDateValue(day),
                            'date-picker-day-muted': day && isFutureDay(day),
                          }"
                          :disabled="!day"
                          @click="day && pickDate(day)"
                        >
                          {{ day }}
                        </button>
                      </div>
                      <div v-else-if="calendarView === 'months'" class="date-picker-grid date-picker-grid-wide">
                        <button
                          v-for="m in 12" :key="`m-${m}`"
                          type="button"
                          class="date-picker-day"
                          :class="{ 'date-picker-day-active': m === displayedMonth, 'date-picker-day-muted': isFutureMonth(m) }"
                          @click="selectCalendarMonth(m)"
                        >
                          {{ m }}
                        </button>
                      </div>
                      <div v-else ref="yearsGridRef" class="date-picker-grid date-picker-grid-wide date-picker-grid-scroll">
                        <button
                          v-for="y in yearOptions" :key="`y-${y}`"
                          type="button"
                          class="date-picker-day"
                          :class="{ 'date-picker-day-active': y === displayedYear }"
                          @click="selectCalendarYear(y)"
                        >
                          {{ y }}
                        </button>
                      </div>
                    </div>
                  </Transition>
                </div>
              </div>
            </div>
            <div flex="~ col gap-2">
              <p text="xs $bew-text-3">
                {{ t('history.filter_device') }}
              </p>
              <div flex="~ gap-2 wrap">
                <button
                  v-for="opt in deviceOptions" :key="opt.value"
                  class="filter-chip"
                  :class="{ 'filter-chip-active': deviceFilter === opt.value }"
                  @click="changeDeviceFilter(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
          <div class="filter-character" shrink-0 self-end pointer-events-none select-none>
            <Transition name="fade" mode="out-in">
              <img
                :key="filterCharacterIndex"
                :src="SEARCH_BAR_CHARACTERS[filterCharacterIndex].url"
                :alt="SEARCH_BAR_CHARACTERS[filterCharacterIndex].name"
                class="filter-character-img"
                loading="lazy"
              >
            </Transition>
          </div>
        </div>
      </Transition>

      <!-- historyList -->
      <!-- Vue3 的 TransitionGroup 不传 tag 时渲染成 Fragment、没有包装元素，
           类名会落空；列表模式看不出来，宫格模式会把 grid 类全丢掉 -->
      <TransitionGroup
        v-if="layoutMode === 'list'" tag="div" name="list"
        @click.capture="handleHistoryListClickCapture"
      >
        <ALink
          v-for="historyItem in historyList"
          :key="historyItem.kid"
          type="videoCard"
          :href="getHistoryUrl(historyItem)"
          block
          class="group"
          flex
          cursor-pointer
          @mouseenter="handleMouseEnter(historyItem)"
        >
          <!-- time slot -->
          <div
            mr-8 px-4
            b-l="~ 2px dashed $bew-fill-2"
            group-hover:b-l="$bew-theme-color-40"
            shrink-0
            relative
            duration-300
            flex="important-xl:~ items-center justify-center"
            hidden
          >
            <!-- hidden lg:flex -->
            <!-- Dot -->
            <i
              pos="absolute left--1px"
              w-2
              h-2
              rounded-6
              bg="$bew-fill-3"
              group-hover:bg="$bew-theme-color"
              transform="~ translate-x--1/2"
              duration-300
            />
            <div
              text="sm $bew-text-3"
              group-hover:text="$bew-theme-color"
              bg="$bew-fill-1"
              group-hover:bg="$bew-theme-color-20"
              p="x-3 y-1"
              rounded-8
              duration-300
            >
              {{
                useDateFormat(historyItem.view_at * 1000, 'YYYY-MM-DD HH:mm:ss')
                  .value
              }}
            </div>
          </div>

          <section
            rounded="$bew-radius"
            flex="~ gap-6 col md:col lg:row items-start"
            relative
            group-hover:bg="$bew-fill-2"
            duration-300 w-full
            p-2 m-1
            content-visibility-auto
          >
            <!-- Cover -->
            <div
              pos="relative"
              bg="$bew-skeleton"
              w="full md:full lg:250px"
              flex="shrink-0"
              rounded="$bew-radius"
              overflow-hidden
              aspect-video
            >
              <img
                w="full"
                aspect-video
                :src="`${getHistoryItemCover(historyItem)}@480w_270h_1c`"
                :alt="historyItem.title"
                object-cover
              >

              <!-- 批量选择框：覆在封面左上角，勾选态主题色（同原版批量管理模式） -->
              <button
                v-if="isInBatchManagement"
                type="button"
                class="card-checkbox"
                :class="{ 'card-checkbox-checked': isHistoryItemSelected(historyItem) }"
                @click.prevent.stop="toggleHistoryItemSelection(historyItem)"
              >
                <div v-if="isHistoryItemSelected(historyItem)" i-tabler:check w-14px h-14px />
              </button>

              <span
                v-if="historyItem.history.business !== HistoryBusiness.ARCHIVE"
                pos="absolute right-0 top-0"
                bg="$bew-theme-color"
                text="xs white"
                p="x-2 y-1"
                m-1
                rounded="$bew-radius-half"
              >
                <template
                  v-if="historyItem.history.business === HistoryBusiness.LIVE"
                >
                  Livestreaming
                </template>
                <template
                  v-else-if="historyItem.history.business === HistoryBusiness.PGC"
                >
                  PGC
                </template>
              </span>

              <div
                v-if="
                  historyItem.history.business === HistoryBusiness.ARCHIVE
                    || historyItem.history.business === HistoryBusiness.PGC
                "
                pos="absolute bottom-0 right-0"
                bg="black opacity-60"
                m="2"
                p="x-2 y-1"
                text="white xs"
                rounded-8
              >
                <!--  When progress = -1 means that the user watched the full video -->
                {{
                  `${
                    historyItem.progress === -1
                      ? calcCurrentTime(historyItem.duration)
                      : calcCurrentTime(historyItem.progress)
                  } /
                      ${calcCurrentTime(historyItem.duration)}`
                }}
              </div>
              <div w-full pos="absolute bottom-0" bg="white opacity-60">
                <Progress
                  v-if="
                    historyItem.history.business === HistoryBusiness.ARCHIVE
                      || historyItem.history.business === HistoryBusiness.PGC
                  "
                  :percentage="
                    (historyItem.progress / historyItem.duration) * 100
                  "
                />
              </div>
            </div>

            <!-- Description -->
            <div flex justify-between w-full h-full>
              <div flex="~ col">
                <a
                  :href="`${getHistoryUrl(historyItem)}`" target="_blank"
                  :title="historyItem.show_title ? historyItem.show_title : historyItem.title"
                >
                  <h3
                    class="keep-two-lines"
                    overflow="hidden"
                    text="lg overflow-ellipsis"
                  >
                    {{ historyItem.show_title ? historyItem.show_title : historyItem.title }}
                  </h3>
                </a>
                <a
                  un-text="$bew-text-2 sm"
                  m="t-4 b-2"
                  flex="~ items-center"
                  cursor-pointer
                  w-fit
                  rounded="$bew-radius"
                  hover:color="$bew-theme-color"
                  hover:bg="$bew-theme-color-10"
                  duration-300
                  pr-2
                  :href="historyItem.author_mid ? `https://space.bilibili.com/${historyItem.author_mid}` : historyItem.uri" target="_blank"
                >
                  <img
                    :src="
                      removeHttpFromUrl(`${historyItem.author_face
                        ? historyItem.author_face
                        : historyItem.cover}@40w_40h_1c`)
                    "
                    w-30px
                    aspect-square
                    object-cover
                    alt=""
                    rounded="1/2"
                    mr-2
                  >
                  {{
                    historyItem.author_name
                      ? historyItem.author_name
                      : historyItem.title
                  }}
                  <span
                    v-if="historyItem.live_status === 1"
                    text="$bew-theme-color"
                    flex
                    items-center
                    gap-1
                    m="l-2"
                  ><div i-tabler:live-photo />
                    Live
                  </span>
                </a>
                <div
                  display="xl:none"
                  flex items-center
                  text="$bew-text-3 sm"
                  mt-auto
                >
                  <span text-xl mr-2 lh-0>
                    <i
                      v-if="historyItem.history.dt === 1 || historyItem.history.dt === 3 || historyItem.history.dt === 5 || historyItem.history.dt === 7"
                      i-mingcute:cellphone-line
                    />
                    <i v-if="historyItem.history.dt === 2" i-mingcute:tv-1-line />
                    <i
                      v-if="historyItem.history.dt === 4 || historyItem.history.dt === 6" i-mingcute:pad-line
                    />
                    <i v-if="historyItem.history.dt === 33" i-mingcute:tv-2-line />
                  </span>
                  <span>
                    {{
                      useDateFormat(historyItem.view_at * 1000, 'YYYY-MM-DD HH:mm:ss')
                        .value
                    }}
                  </span>
                </div>
              </div>

              <button
                v-if="!isInBatchManagement"
                text="2xl $bew-text-3"
                hover:color="$bew-theme-color"
                opacity-0 group-hover:opacity-100
                p-2
                duration-300
                @click.prevent.stop="deleteHistoryItem(historyItem)"
              >
                <div i-tabler:trash />
              </button>
            </div>
          </section>
        </ALink>
      </TransitionGroup>

      <!-- 宫格排列：时间线样式与纵向排列（单列）同款——虚线轨道 + 圆点 + 日期胶囊，
           按日分组、日期格式与单列统一（YYYY-MM-DD）。
           卡片宽度用 auto-fill 钉在 265px：减掉卡片内边距后封面约 250px，
           和纵向排列的封面（lg:250px）一样大 -->
      <div
        v-else
        class="grid-timeline"
        @click.capture="handleHistoryListClickCapture"
      >
        <div v-if="gridHistorySections.length" class="grid-timeline-track" />
        <template
          v-for="(section, sectionIndex) in gridHistorySections"
          :key="`section-${sectionIndex}`"
        >
          <div class="grid-timeline-anchor">
            <span class="grid-timeline-dot" />
            <span class="grid-timeline-label">{{ section.label }}</span>
          </div>
          <TransitionGroup tag="div" name="list" class="grid [grid-template-columns:repeat(auto-fill,minmax(265px,1fr))] gap-3">
            <ALink
              v-for="historyItem in section.items"
              :key="historyItem.kid"
              type="videoCard"
              :href="getHistoryUrl(historyItem)"
              class="group"
              rounded="$bew-radius"
              p-2
              flex="~ col gap-2"
              cursor-pointer
              duration-300
              hover:bg="$bew-fill-1"
              @mouseenter="handleMouseEnter(historyItem)"
            >
              <div
                pos="relative"
                rounded="$bew-radius"
                overflow-hidden
                aspect-video
                bg="$bew-skeleton"
              >
                <img
                  w-full h-full
                  object-cover
                  :src="`${getHistoryItemCover(historyItem)}@480w_270h_1c`"
                  :alt="historyItem.title"
                >

                <!-- 批量选择框：覆在封面左上角，勾选态主题色（同原版批量管理模式） -->
                <button
                  v-if="isInBatchManagement"
                  type="button"
                  class="card-checkbox"
                  :class="{ 'card-checkbox-checked': isHistoryItemSelected(historyItem) }"
                  @click.prevent.stop="toggleHistoryItemSelection(historyItem)"
                >
                  <div v-if="isHistoryItemSelected(historyItem)" i-tabler:check w-14px h-14px />
                </button>

                <span
                  v-if="historyItem.history.business !== HistoryBusiness.ARCHIVE"
                  pos="absolute right-0 top-0"
                  bg="$bew-theme-color"
                  text="xs white"
                  p="x-2 y-1"
                  m-1
                  rounded="$bew-radius-half"
                >
                  <template v-if="historyItem.history.business === HistoryBusiness.LIVE">
                    Livestreaming
                  </template>
                  <template v-else-if="historyItem.history.business === HistoryBusiness.PGC">
                    PGC
                  </template>
                </span>

                <div
                  v-if="historyItem.history.business === HistoryBusiness.ARCHIVE || historyItem.history.business === HistoryBusiness.PGC"
                  pos="absolute bottom-0 right-0"
                  bg="black opacity-60"
                  m="2"
                  p="x-2 y-1"
                  text="white xs"
                  rounded-8
                >
                  {{ `${historyItem.progress === -1 ? calcCurrentTime(historyItem.duration) : calcCurrentTime(historyItem.progress)} / ${calcCurrentTime(historyItem.duration)}` }}
                </div>
                <div w-full pos="absolute bottom-0" bg="white opacity-60">
                  <Progress
                    v-if="historyItem.history.business === HistoryBusiness.ARCHIVE || historyItem.history.business === HistoryBusiness.PGC"
                    :percentage="(historyItem.progress / historyItem.duration) * 100"
                  />
                </div>

                <!-- 删除：悬停封面右上角出现（批量模式下隐藏，同原版） -->
                <button
                  v-if="!isInBatchManagement"
                  pos="absolute top-0 right-0"
                  m-1
                  p="x-2 y-1"
                  rounded="$bew-radius"
                  text="!white xl"
                  bg="black opacity-60 hover:$bew-error-color-80"
                  opacity-0 group-hover:opacity-100
                  duration-300
                  @click.prevent.stop="deleteHistoryItem(historyItem)"
                >
                  <div i-tabler:trash />
                </button>
              </div>

              <h3
                class="keep-two-lines"
                overflow="hidden"
                text="sm $bew-text-1"
              >
                {{ historyItem.show_title ? historyItem.show_title : historyItem.title }}
              </h3>
              <!-- 信息区：元素与单列对齐（作者头像、作者链接、直播标、设备图标、
                   完整日期时间），排版按宫格自排成两行——不照搬单列的横向布局，但元素不能少 -->
              <div flex="~ col gap-1" text="xs $bew-text-3" mt-1>
                <a
                  flex="~ items-center gap-2"
                  w-fit
                  max-w-full
                  rounded="$bew-radius"
                  hover:color="$bew-theme-color"
                  hover:bg="$bew-theme-color-10"
                  duration-300
                  :href="historyItem.author_mid ? `https://space.bilibili.com/${historyItem.author_mid}` : historyItem.uri"
                  target="_blank"
                >
                  <img
                    :src="removeHttpFromUrl(`${historyItem.author_face ? historyItem.author_face : historyItem.cover}@40w_40h_1c`)"
                    w-24px
                    aspect-square
                    object-cover
                    rounded="1/2"
                    shrink-0
                    alt=""
                  >
                  <span truncate>{{ historyItem.author_name ? historyItem.author_name : historyItem.title }}</span>
                  <span
                    v-if="historyItem.live_status === 1"
                    text="$bew-theme-color"
                    flex
                    items-center
                    gap-1
                    shrink-0
                  ><div i-tabler:live-photo />
                    Live
                  </span>
                </a>
                <div flex="~ items-center gap-1" text="$bew-text-3">
                  <span text-base mr-1 lh-0 shrink-0>
                    <i v-if="historyItem.history.dt === 1 || historyItem.history.dt === 3 || historyItem.history.dt === 5 || historyItem.history.dt === 7" i-mingcute:cellphone-line />
                    <i v-if="historyItem.history.dt === 2" i-mingcute:tv-1-line />
                    <i v-if="historyItem.history.dt === 4 || historyItem.history.dt === 6" i-mingcute:pad-line />
                    <i v-if="historyItem.history.dt === 33" i-mingcute:tv-2-line />
                  </span>
                  <span>{{ useDateFormat(historyItem.view_at * 1000, 'YYYY-MM-DD HH:mm:ss').value }}</span>
                </div>
              </div>
            </ALink>
          </TransitionGroup>
        </template>
      </div>

      <!-- no more content -->
      <Empty v-if="noMoreContent" class="py-4" :description="$t('common.no_more_content')" />

      <!-- loading -->
      <Transition name="fade">
        <loading
          v-if="isLoading && historyList.length !== 0 && !noMoreContent"
          m="-t-4"
        />
      </Transition>
    </main>

    <aside relative w="full md:40% lg:30% xl:25%" order="1 md:2 lg:2">
      <!-- 吸附位置取面板静止时的位置：页面顶部内边距 + 自己的 my-10（2.5em）。写死 120px 比静止位置
           低 9px，主内容列一旦高过面板就会让面板下滑 9px 再弹回，见 Favorites.vue 同处注释。 -->
      <div pos="sticky top-[calc(var(--bew-top-bar-height)+10px+2.5em)]" flex="~ col gap-4" justify-start my-10 w-full>
        <!-- 搜索框与全站统一：静止胶囊形，聚焦时过渡成圆角矩形并亮主题色光环，右端放大镜
             与 SearchBar 同款（悬停/聚焦转主题色 + 光晕）。胶囊+边框+按钮的组合也让它
             和下方两个圆角矩形操作按钮一眼可分 -->
        <div class="group" pos="relative" w-full>
          <input
            v-model.lazy.trim="keyword"
            class="search-input"
            type="text"
            :placeholder="t('history.search_watch_history')"
            p="l-14px r-42px"
            lh-35px h-35px
            rounded="60px focus:$bew-radius"
            transition="all duration-300"
            un-border="1 solid $bew-border-color focus:$bew-theme-color"
            bg="$bew-content-solid"
            shadow="$bew-shadow-1"
            outline-none
            w-full
            @keyup.enter="handleSearch"
          >
          <button
            class="absolute top-1/2 right-6px -translate-y-1/2"
            p-2
            rounded-full
            text="lg leading-0 $bew-text-1 group-hover:$bew-theme-color group-focus-within:$bew-theme-color"
            bg="hover:$bew-fill-2"
            transition="all duration-300"
            border-none
            outline-none
            filter="group-focus-within:~"
            style="--un-drop-shadow: drop-shadow(0 0 6px var(--bew-theme-color))"
            @click="handleSearch"
          >
            <div i-tabler:search block align-middle />
          </button>
        </div>
        <!-- 侧栏按钮统一用稍后再看页「清空稍后再看」的样式：type=secondary + strong（不带投影）。
             清除所有观看历史 + 批量管理并排（原版两者也是左右相邻）；批量管理列表为空时禁用
             （同原版），批量模式下按钮文案变「退出管理」。
             flex-1 / min-w 要走 class——写进 attributify 的 flex="..." 里不生效（坑 14）。
             行带 wrap：窗口/缩放把两列挤窄时先整列换行堆叠；min-w-170px 保证并排时文字放得下；
             内联 height:auto 兜底——Button 是固定 35px 高 + lh-35px，文字真折成两行时
             第二行会溢出按钮盒子（实测「不是完整比例时文字溢出」的机制），让按钮长高而不是溢出。 -->
        <div flex="~ gap-4 wrap" w-full>
          <Button
            type="secondary"
            strong
            block
            class="flex-1 min-w-170px"
            style="height: auto; min-height: 35px; line-height: 1.4;"
            @click="handleClearAllWatchHistory"
          >
            <template #left>
              <div i-tabler:trash />
            </template>
            {{ $t('history.clear_all_watch_history') }}
          </Button>
          <Button
            type="secondary"
            strong
            block
            class="flex-1 min-w-170px"
            :disabled="!historyList.length"
            style="height: auto; min-height: 35px; line-height: 1.4;"
            @click="toggleBatchManagement"
          >
            <template #left>
              <div i-tabler:list-check />
            </template>
            {{ isInBatchManagement ? $t('history.exit_manage') : $t('history.batch_manage') }}
          </Button>
        </div>
        <Button
          v-if="!historyStatus"
          type="secondary"
          strong
          block
          @click="handlePauseWatchHistory"
        >
          <template #left>
            <div i-ph:pause-circle-bold />
          </template>
          {{ $t('history.pause_watch_history') }}
        </Button>
        <Button
          v-else
          type="secondary"
          strong
          block
          @click="handleTurnOnWatchHistory"
        >
          <template #left>
            <div i-ph:play-circle-bold />
          </template>
          {{ $t('history.turn_on_watch_history') }}
        </Button>
      </div>
    </aside>

    <!-- 确认框统一用扩展自己的 ConfirmDialog，不用浏览器原生的 confirm -->
    <ConfirmDialog
      v-model="showClearHistoryConfirm"
      :message="t('history.clear_all_watch_history_confirm')"
      @confirm="clearAllHistory"
    />
    <ConfirmDialog
      v-model="showPauseHistoryConfirm"
      :message="t('history.pause_watch_history_confirm')"
      @confirm="setHistoryPauseStatus(true)"
    />
    <ConfirmDialog
      v-model="showTurnOnHistoryConfirm"
      :message="t('history.turn_on_watch_history_confirm')"
      @confirm="setHistoryPauseStatus(false)"
    />
    <!-- 批量删除确认：标题按选中状态/页签拼（同原版文案），正文统一「记录删除后将不可恢复」 -->
    <ConfirmDialog
      v-model="showBatchDeleteConfirm"
      :message="batchDeleteConfirmMessage"
      @confirm="batchDeleteSelectedItems"
    />
  </div>
  <Empty v-else mt-6 :description="t('common.please_log_in_first')">
    <Button type="primary" @click="jumpToLoginPage()">
      {{ $t('common.login') }}
    </Button>
  </Empty>
</template>

<style lang="scss" scoped>
// 聚焦光环与顶栏 SearchBar 一致（模板上的 transition/border/圆角变化负责形态，
// 这里只补 SearchBar 放在 SCSS 里的那套 box-shadow 光环）
.search-input:focus {
  box-shadow:
    0 0 0 2px var(--bew-theme-color),
    0 6px 16px var(--bew-theme-color-40),
    inset 0 0 6px var(--bew-theme-color-30);
}

// 页签（综合/视频/直播/专栏）与更多筛选按钮：视觉克隆稍后再看页「清空稍后再看」的
// Button（type=secondary + strong）——fill-1 底 hover 升 fill-2、text-1、fw-800、
// 圆角 --bew-radius、高 35px、左右 14px、gap 8px、按下 scale-95，无投影。
// 必须排在 .filter-chip-active 之前，激活态才盖得住底色。
.filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 35px;
  padding: 0 14px;
  border: none;
  border-radius: var(--bew-radius);
  background: var(--bew-fill-1);
  color: var(--bew-text-1);
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  transition: all 0.3s;
  transform: translateZ(0);
  // 窄窗口下交给外层 flex-wrap 排下去
  flex-shrink: 0;
  white-space: nowrap;

  &:hover {
    background: var(--bew-fill-2);
  }

  &:active {
    transform: scale(0.95);
  }
}

// 面板内的筛选 chips（时长/时间/设备）：胶囊小章，选中主题色
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.25em 0.9em;
  border-radius: 999px;
  font-size: 0.875em;
  color: var(--bew-text-2);
  background: var(--bew-fill-1);
  cursor: pointer;
  transition: all 0.3s;
  // 窄窗口下 flex 子项会被压窄导致文字换行变形；不缩小、不换行，交给外层 flex-wrap 排下去
  flex-shrink: 0;
  white-space: nowrap;

  &:hover {
    background: var(--bew-fill-2);
    color: var(--bew-text-1);
  }
}

// 选中态（页签/更多筛选/筛选 chips 共用）：放在所有底色规则之后，同权重才盖得住
.filter-chip-active {
  background: var(--bew-theme-color-20);
  color: var(--bew-theme-color);
}

// 批量管理控件（全选 + 已选提示 + 删除）：内联在工具栏排列切换按钮左侧，无独立面板
.batch-controls {
  // 删除按钮高度（35px）比布局图标按钮高，垂直居中即可，不撑破工具栏行
  align-items: center;
}

.batch-select-all {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  font-size: 0.875em;
  color: var(--bew-text-2);
  cursor: pointer;
  user-select: none;

  &:hover {
    color: var(--bew-text-1);
  }
}

// 通用小方框选择器：操作条的全选与卡片角上的选择框同款，勾选态主题色
.batch-checkbox,
.card-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bew-text-2);
  background: rgb(0 0 0 / 0.35);
  color: white;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--bew-text-1);
  }
}

.batch-checkbox {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  flex-shrink: 0;
}

.batch-selected-tips {
  font-size: 0.8125em;
  color: var(--bew-text-3);
}

.batch-split-line {
  width: 1px;
  height: 1.25em;
  background: var(--bew-fill-3);
}

// 卡片封面左上角的选择框：批量模式才出现，浮在封面内容之上
.card-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 22px;
  height: 22px;
  border-radius: 8px;
  border-color: white;
  z-index: 1;
}

// 勾选态必须放在 card-checkbox 的白边规则之后：同为单类选择器，靠后生效
.batch-checkbox-checked,
.card-checkbox-checked {
  background: var(--bew-theme-color);
  border-color: var(--bew-theme-color);
}

// 底色与确认框（暂停记录观看历史那类弹窗）同构。确认框显实的秘诀是它背后垫着
// 全页 40% 黑遮罩，68% 半透的 elevated 叠在压暗的背景上才不透底；内联面板没有遮罩，
// 就把这层 40% 黑直接垫进自己的背景里（linear-gradient 是为了满足 background 多层语法，
// 纯色层不能放在非末位），合成效果和确认框一致——之前"太透明"就是因为缺了这层压暗。
// elevated 仍随「禁用毛玻璃效果」变实色盖住黑层，联动方式和确认框一模一样；
// 模糊取确认框默认档 glass-2 的字面值 blur(30px)，不读 --bew-filter-glass-*，
// 模糊强度滑条拖到哪都不影响（构建产物已 grep 核实）。
.more-filter-panel {
  background: linear-gradient(var(--bew-elevated), var(--bew-elevated)), rgb(0 0 0 / 0.4);
  backdrop-filter: blur(30px) saturate(180%);
  // 必须提 z-index：backdrop-filter 会让它成为 z-index:auto 的层叠上下文，
  // 内部日历下拉画不出来、被后 DOM 的列表卡片盖住（更早版本"被遮挡"的根因）。
  position: relative;
  z-index: 20;
}

// 日历面板不共享面板底色：它有一大截（实测 173px）悬在筛选面板外、直接盖在历史列表上。
// 父面板的 backdrop-filter 是 backdrop root，悬出父盒的区域采不到任何背景——面板那层
// 40% 黑压暗在悬出段不存在，下面的记录会清晰透上来（实测截图确认）。所以日历自带
// 近不透明黑层（85%，与 elevated 合成约 95% 不透明），悬在面板内外都不透底；
// elevated 仍走「禁用毛玻璃变实色」的联动。不给它 backdrop-filter：底已近不透明，
// 模糊没有可见贡献，还省掉一层嵌套采样。
.date-picker-panel {
  background: linear-gradient(var(--bew-elevated), var(--bew-elevated)), rgb(0 0 0 / 0.85);
}

// 面板右侧人物装饰（搜索栏聚焦同款图），高度和面板内容区协调。
// 视口太窄（小窗口或高缩放比）时左列自己都吃紧，装饰纯属挤占——不显示。
.filter-character {
  @media (max-width: 1000px) {
    display: none;
  }
}

.filter-character-img {
  height: 110px;
  object-fit: contain;
  object-position: bottom right;
}

// 排列方式切换按钮项：克隆首页三个排列切换按钮的项样式——方形（h-full + aspect-square）、
// 全圆角、hover 升 fill-2、选中整格主题色底（同首页 .grid-layout-item-activated）。
// 项挂在 Tooltip 的锚点 span 里，span 会被药丸容器 stretch 到内容高，h-full 正好取满。
.layout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  aspect-ratio: 1;
  border-radius: 999px;
  color: var(--bew-text-2);
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    background: var(--bew-fill-2);
    color: var(--bew-text-1);
  }
}

// 必须排在 .layout-btn 之后，同权重才盖得住底色
.layout-btn-active {
  background: var(--bew-theme-color-auto);
  color: var(--bew-text-auto);
}

// 宫格模式的时间线：样式与纵向排列（单列）的时间线同款——2px 虚线轨道（fill-2）、
// 8px 实心圆点（fill-3）、日期装在 fill-1 底的小胶囊里（同单列时间戳 chip 的画法）。
// flow-root 挡住锚点外边距塌陷，否则首个锚点的 margin-top 塌出容器、线和点错位。
.grid-timeline {
  position: relative;
  display: flow-root;
  padding-left: 24px; // 轨道+圆点区，日期胶囊从这里起排
}

.grid-timeline-track {
  position: absolute;
  left: 7px; // 线占 7~9px，中心 8px（同单列 b-l 虚线的 2px 规格）
  top: -4px;
  bottom: -4px;
  border-left: 2px dashed var(--bew-fill-2);
}

.grid-timeline-anchor {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0 10px;
}

.grid-timeline-dot {
  position: absolute;
  // 圆心正压轨道线：锚点从 padding 24px 起，点心要在 x=8 → left = 8 - 24 - 4
  left: -20px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 6px;
  background: var(--bew-fill-3);
}

// 日期胶囊：字号/底色/圆角/内边距都取单列时间戳 chip 的同款值
.grid-timeline-label {
  font-size: 0.875em;
  color: var(--bew-text-3);
  background: var(--bew-fill-1);
  padding: 0.25em 0.75em;
  border-radius: 8px;
  white-space: nowrap;
}

// 自定义日期选择：字段长得和插件输入框一样，日历面板用插件的表面色/dropdown 过渡
// 两个日期字段 + 中间「至」共用定位容器：弹层宽度 = 两个字段总宽，视觉更协调
.date-range {
  position: relative;
  display: flex;
  gap: 0.5em;
  align-items: center;
  // 极窄窗口下两个字段加「至」放不下时换行，而不是互相挤压溢出
  flex-wrap: wrap;
}

.date-picker-field {
  width: 160px;
  height: 35px;
  padding: 0 1em;
  border-radius: var(--bew-radius);
  background: var(--bew-fill-1);
  border: 1px solid transparent;
  color: var(--bew-text-1);
  font-size: 0.875em;
  display: flex;
  align-items: center;
  cursor: pointer;
  transition: all 0.3s;
  text-align: left;

  &:hover {
    background: var(--bew-fill-2);
  }
}

.date-picker-field-open {
  border-color: var(--bew-theme-color);
}

.date-picker-placeholder {
  color: var(--bew-text-3);
}

.date-picker-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 10;
  padding: 12px;
  border: 1px solid var(--bew-border-color);
  border-radius: var(--bew-radius);
  box-shadow: var(--bew-shadow-2);
}

.date-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 0.875em;
  color: var(--bew-text-1);
}

.date-picker-nav {
  display: flex;
  padding: 4px;
  border-radius: 8px;
  color: var(--bew-text-2);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bew-fill-2);
    color: var(--bew-text-1);
  }
}

// 表头的年/月文字按钮：点击切到年份/月份视图（同 B 站原版）
.date-picker-header-btn {
  padding: 2px 6px;
  border-radius: 8px;
  color: var(--bew-text-1);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bew-fill-2);
    color: var(--bew-theme-color);
  }
}

// 非日期视图时表头左右没有箭头，用等宽占位保持标题居中
.date-picker-nav-placeholder {
  width: 26px;
}

.date-picker-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

// 年份/月份视图：4 列宽格，格子不再是正方形（年份四位数要放得下）
.date-picker-grid-wide {
  grid-template-columns: repeat(4, 1fr);

  .date-picker-day {
    height: auto;
    padding: 6px 0;
  }
}

// 年份列表只显示约 4 行，其余滚动查看
.date-picker-grid-scroll {
  max-height: 11em;
  overflow-y: auto;
}

.date-picker-weekday {
  text-align: center;
  font-size: 0.75em;
  color: var(--bew-text-3);
  padding: 4px 0;
}

.date-picker-day {
  // 面板加宽后不再用 aspect-ratio:1（格子会随宽度变成大正方形），固定高度保持紧凑
  height: 2.25em;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 0.8125em;
  color: var(--bew-text-1);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bew-fill-2);
  }
}

.date-picker-day-empty {
  visibility: hidden;
  cursor: default;

  &:hover {
    background: transparent;
  }
}

// 未来日期：只压暗文字与可点的过去日期区分，仍可选（同原版）
.date-picker-day-muted {
  color: var(--bew-text-3);
  opacity: 0.5;

  &:hover {
    background: var(--bew-fill-2);
  }
}

.date-picker-day-active {
  background: var(--bew-theme-color-20) !important;
  color: var(--bew-theme-color);
  font-weight: 600;
}
</style>
