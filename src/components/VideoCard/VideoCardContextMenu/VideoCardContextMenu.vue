<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'

import { useBewlyApp } from '~/composables/useAppProvider'
import { Type as ThreePointV2Type } from '~/models/video/appForYou'
import { openLinkToNewTab } from '~/utils/main'
import { openLinkInBackground } from '~/utils/tabs'
import { downloadVideoCover } from '~/utils/videoDownload'

import type { Video } from '../types'
import DislikeDialog from './components/DislikeDialog.vue'
import DownloadDialog from './components/DownloadDialog.vue'

const props = defineProps<{
  video: Video
  /** 由卡片给的锚点（视口坐标）：x 是鼠标点在哪，top/bottom 是「更多」按钮的上下边 */
  anchor: { x: number, top: number, bottom: number }
}>()
const emit = defineEmits<{
  (event: 'removed', selectedOpt?: { dislikeReasonId: number }): void
  (event: 'close'): void
  (event: 'reopen'): void
}>()

const getVideoType = inject<() => string>('getVideoType')!

const videoOptions = reactive<{ id: number, name: string }[]>([
  { id: 1, name: '不感兴趣' },
  { id: 2, name: '不想看此UP主' },
])

const { t } = useI18n()
const toast = useToast()
const showContextMenu = ref<boolean>(false)
const showDislikeDialog = ref<boolean>(false)
const showDownloadDialog = ref<boolean>(false)
const showPipWindow = ref<boolean>(false)
const { openIframeDrawer } = useBewlyApp()

enum VideoOption {
  OpenInNewTab,
  OpenInBackground,
  OpenInCurrentTab,
  OpenInNewWindow,
  OpenInDrawer,

  ViewTheOriginalCover,
  ViewThisUserChannel,

  CopyVideoLink,
  CopyBVNumber,
  CopyAVNumber,

  DownloadVideo,
  DownloadCover,
}

interface MenuItem {
  command: VideoOption
  name: string
  icon: string
}
interface MenuGroup {
  name: string
  icon: string
  items: MenuItem[]
}
type MenuEntry = MenuItem | MenuGroup

function isGroup(entry: MenuEntry): entry is MenuGroup {
  return 'items' in entry
}

const commonOptions = computed((): MenuEntry[] => {
  let result: MenuEntry[] = [
    {
      name: t('video_card.operation.open_with'),
      icon: 'i-solar:square-top-down-bold-duotone',
      items: [
        { command: VideoOption.OpenInNewTab, name: t('video_card.operation.open_in_new_tab'), icon: 'i-solar:square-top-down-bold-duotone' },
        { command: VideoOption.OpenInBackground, name: t('video_card.operation.open_in_background'), icon: 'i-solar:square-top-down-bold-duotone' },
        { command: VideoOption.OpenInNewWindow, name: t('video_card.operation.open_in_new_window'), icon: 'i-solar:maximize-square-3-bold-duotone' },
        { command: VideoOption.OpenInCurrentTab, name: t('video_card.operation.open_in_current_tab'), icon: 'i-solar:square-top-down-bold-duotone' },
        { command: VideoOption.OpenInDrawer, name: t('video_card.operation.open_in_drawer'), icon: 'i-solar:archive-up-minimlistic-bold-duotone' },
      ],
    },

    {
      name: t('video_card.operation.copy'),
      icon: 'i-solar:copy-bold-duotone',
      items: [
        { command: VideoOption.CopyVideoLink, name: t('video_card.operation.copy_video_link'), icon: 'i-solar:copy-bold-duotone' },
        { command: VideoOption.CopyBVNumber, name: t('video_card.operation.copy_bv_number'), icon: 'i-solar:copy-bold-duotone' },
        { command: VideoOption.CopyAVNumber, name: t('video_card.operation.copy_av_number'), icon: 'i-solar:copy-bold-duotone' },
      ],
    },

    {
      name: t('video_card.operation.cover'),
      icon: 'i-solar:gallery-minimalistic-bold-duotone',
      items: [
        { command: VideoOption.ViewTheOriginalCover, name: t('video_card.operation.view_the_original_cover'), icon: 'i-solar:gallery-minimalistic-bold-duotone' },
        { command: VideoOption.DownloadCover, name: t('video_card.operation.download_cover'), icon: 'i-solar:download-bold-duotone' },
      ],
    },

    { command: VideoOption.DownloadVideo, name: t('video_card.operation.download_video'), icon: 'i-solar:download-bold-duotone' },
  ]

  // 番剧/直播卡片没有 bvid/cid，也没有对应的下载接口，下载项直接不显示
  const canDownload = Boolean(props.video.bvid) && getVideoType() !== 'bangumi' && getVideoType() !== 'live'

  if (!canDownload)
    result = result.filter(entry => !isGroup(entry) && entry.command !== VideoOption.DownloadVideo)

  if (getVideoType() === 'bangumi' || getVideoType() === 'live') {
    result = result.map((entry) => {
      if (!isGroup(entry))
        return entry

      return {
        ...entry,
        items: entry.items.filter(opt =>
          opt.command !== VideoOption.CopyBVNumber && opt.command !== VideoOption.CopyAVNumber,
        ),
      }
    })
  }

  // 分组里的项被过滤光后，整组也不再显示
  return result.filter(entry => !isGroup(entry) || entry.items.length > 0)
})

onMounted(async () => {
  showContextMenu.value = true
  // 菜单挂载后先量一次真实尺寸再摆位置——`nextTick` 在浏览器绘制之前就返回，所以不会看到它跳一下
  await nextTick()
  placeMenu()
})

// ---------- 主菜单的位置 ----------
const menuEl = ref<HTMLElement | null>(null)
const menuOffset = ref({ x: 0, y: 0 })

const menuStyles = computed<CSSProperties>(() => ({
  position: 'absolute',
  top: 0,
  left: 0,
  transform: `translate(${props.anchor.x + menuOffset.value.x}px, ${props.anchor.bottom + menuOffset.value.y}px)`,
}))

/**
 * 菜单的位置 = 锚点（`translate`）加上类里的 margin（`mt-4` 让出一点空隙、`ml-[calc(-200px+1rem)]`
 * 让菜单右对齐到鼠标），这里只补一个修正量，把它夹进视口。
 *
 * 之前是卡片那边按「菜单高 406px」硬推的（源码注释也写了这只是个临时值），菜单改版后实际只有
 * 一百多像素，窗口一小就被推到视口外面——上半截跑到顶栏后面（顶栏 z-index 99、菜单 z-index 10，
 * 于是被顶栏盖住），看起来就是「显示被遮挡」。
 */
function placeMenu() {
  const el = menuEl.value
  if (!el)
    return

  const edge = 8
  const gap = 4
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 顶栏压在菜单上层（顶栏 z-index 99，菜单 10），所以上边界从顶栏下面开始算，别把菜单摆进顶栏那一条
  const topBarHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bew-top-bar-height')) || 0
  const minTop = topBarHeight + edge

  // 窗口很窄时先按视口限制宽度（菜单项会自己折行），否则光夹位置也还是会被切掉
  if (el.getBoundingClientRect().width > vw - edge * 2)
    el.style.maxWidth = `${vw - edge * 2}px`

  const rect = el.getBoundingClientRect()
  const left = Math.min(Math.max(rect.left, edge), Math.max(vw - rect.width - edge, edge))
  const below = props.anchor.bottom + gap
  const above = props.anchor.top - gap - rect.height
  const top = below + rect.height <= vh - edge
    ? below
    : Math.max(Math.min(above, vh - rect.height - edge), minTop)

  menuOffset.value = { x: left - rect.left, y: top - rect.top }
}

// ---------- 二级菜单 ----------
const activeSubmenu = ref<number | null>(null)
const submenuStyles = ref<CSSProperties>({})
let activeGroupEl: HTMLElement | null = null
let submenuCloseTimer: ReturnType<typeof setTimeout> | undefined

function cancelSubmenuClose() {
  if (submenuCloseTimer)
    clearTimeout(submenuCloseTimer)
  submenuCloseTimer = undefined
}

function closeSubmenu() {
  cancelSubmenuClose()
  activeSubmenu.value = null
  activeGroupEl = null
  submenuStyles.value = {}
}

/** 一级项和二级菜单之间隔着几像素空隙，给一点宽限时间，别让菜单在鼠标穿过去的中途消失 */
function scheduleSubmenuClose() {
  cancelSubmenuClose()
  submenuCloseTimer = setTimeout(closeSubmenu, 120)
}

onUnmounted(cancelSubmenuClose)

async function handleGroupEnter(index: number, event: MouseEvent) {
  cancelSubmenuClose()
  if (activeSubmenu.value === index)
    return

  activeSubmenu.value = index
  activeGroupEl = event.currentTarget as HTMLElement
  submenuStyles.value = {}
  await nextTick()
  updateSubmenuPosition()
}

// 触屏没有 hover，只能靠点击展开；鼠标场景下 hover 已经展开了，点击不折叠
function handleGroupClick(index: number, event: MouseEvent) {
  if (activeSubmenu.value !== index)
    handleGroupEnter(index, event)
}

/**
 * 二级菜单优先贴在一级菜单右侧，右边放不下就翻到左侧，两侧都放不下就尽量贴边（会压在一级菜单上）。
 * 一级菜单本身靠右（更多按钮通常在卡片右侧），所以翻转是常态而非例外。
 */
function updateSubmenuPosition() {
  const groupEl = activeGroupEl
  const submenuEl = groupEl?.querySelector<HTMLElement>('.context-submenu')
  if (!groupEl || !submenuEl)
    return

  const groupRect = groupEl.getBoundingClientRect()
  const { width, height } = submenuEl.getBoundingClientRect()
  const gap = 4
  const edge = 8

  const fitsRight = groupRect.right + gap + width + edge <= window.innerWidth
  const preferredLeft = fitsRight ? groupRect.right + gap : groupRect.left - gap - width
  const left = Math.min(Math.max(preferredLeft, edge), Math.max(window.innerWidth - width - edge, edge))
  const top = Math.min(Math.max(groupRect.top - gap, edge), Math.max(window.innerHeight - height - edge, edge))

  submenuStyles.value = {
    left: `${left - groupRect.left}px`,
    right: 'auto',
    top: `${top - groupRect.top}px`,
  }
}

function handleMoreCommand(_command: number) {
  handleRemoved()
}

function handleAppMoreCommand(command: ThreePointV2Type) {
  switch (command) {
    case ThreePointV2Type.Feedback:
      break
    case ThreePointV2Type.Dislike:
      openAppDislikeDialog()
      break
  }
}

function handleCommonCommand(command: VideoOption) {
  switch (command) {
    case VideoOption.OpenInNewTab:
      openLinkToNewTab(props.video.url!)
      handleClose()
      break
    case VideoOption.OpenInBackground:
      openLinkInBackground(props.video.url!)
      handleClose()
      break
    case VideoOption.OpenInNewWindow:
      showPipWindow.value = true
      break
    case VideoOption.OpenInCurrentTab:
      window.open(props.video.url, '_self')
      handleClose()
      break
    case VideoOption.OpenInDrawer:
      openIframeDrawer(props.video.url || '')
      handleClose()
      break

    case VideoOption.CopyVideoLink:
      navigator.clipboard.writeText(props.video.url!)
      handleClose()
      break
    case VideoOption.CopyBVNumber:
      navigator.clipboard.writeText(props.video.bvid!)
      handleClose()
      break
    case VideoOption.CopyAVNumber:
      navigator.clipboard.writeText(`av${props.video.id.toString()}`)
      handleClose()
      break

    case VideoOption.ViewTheOriginalCover:
      window.open(props.video.cover, '_blank')
      handleClose()
      break

    case VideoOption.DownloadVideo:
      showDownloadDialog.value = true
      showContextMenu.value = false
      break

    case VideoOption.DownloadCover:
      handleDownloadCover()
      break
  }
}

/** 封面是原图，体积很小，直接下载，不走画质对话框和队列。 */
function handleDownloadCover() {
  downloadVideoCover(props.video)
    .then(() => toast.success(t('video_card.operation.download_cover_done')))
    .catch(error => toast.error(t('video_card.operation.download_failed', {
      reason: error instanceof Error ? error.message : String(error),
    })))
  handleClose()
}

function openAppDislikeDialog() {
  showDislikeDialog.value = true
  showContextMenu.value = false
}

function handleClose() {
  showContextMenu.value = false
  showPipWindow.value = false
  closeSubmenu()
  emit('close')
}

function handleReopen() {
  // showContextMenu.value = false
  // showPipWindow.value = false
  // console.log('reopen')
  // emit('reopen')
  handleClose()
}

function handleRemoved(selectedOpt?: { dislikeReasonId: number }) {
  emit('removed', selectedOpt)
  handleClose()
}
</script>

<template>
  <div>
    <!-- more popup -->
    <div v-if="showContextMenu">
      <div
        ref="menuEl"
        style="backdrop-filter: var(--bew-filter-glass-1); box-shadow: var(--bew-shadow-edge-glow-1), var(--bew-shadow-1);"
        :style="menuStyles"
        p-1 bg="$bew-elevated" rounded="$bew-radius"
        min-w-200px m="t-4 l-[calc(-200px+1rem)]"
        border="1 $bew-border-color"
        z-10
      >
        <ul flex="~ col gap-1" @mouseleave="scheduleSubmenuClose">
          <template v-if="getVideoType() === 'appRcmd'">
            <template v-for="option in video.threePointV2" :key="option.type">
              <li
                v-if="option.type !== ThreePointV2Type.WatchLater && option.type !== ThreePointV2Type.Feedback"
                class="context-menu-item"
                @mouseenter="closeSubmenu"
                @click="handleAppMoreCommand(option.type)"
              >
                <i class="item-icon" i-solar:confounded-circle-bold-duotone />
                <span v-if="option.type === ThreePointV2Type.Dislike">{{ $t('video_card.operation.not_interested') }}</span>
                <span v-else>{{ option.title }}</span>
              </li>
            </template>
          </template>
          <template v-else-if="getVideoType() === 'rcmd'">
            <li
              v-for="option in videoOptions" :key="option.id"
              class="context-menu-item"
              @mouseenter="closeSubmenu"
              @click="handleMoreCommand(option.id)"
            >
              <i class="item-icon" i-solar:confounded-circle-bold-duotone />
              {{ option.name }}
            </li>
          </template>

          <div v-if="getVideoType() === 'rcmd'" class="divider" />

          <template v-for="(entry, index) in commonOptions" :key="index">
            <li
              v-if="isGroup(entry)"
              class="context-menu-item context-menu-group"
              :class="{ 'is-submenu-open': activeSubmenu === index }"
              @mouseenter="handleGroupEnter(index, $event)"
              @click="handleGroupClick(index, $event)"
            >
              <i class="item-icon" :class="entry.icon" />
              <span flex-1>{{ entry.name }}</span>
              <i class="submenu-arrow" i-solar:alt-arrow-right-bold-duotone />

              <!-- submenu -->
              <ul
                v-show="activeSubmenu === index"
                class="context-submenu"
                :style="submenuStyles"
                p-1 min-w-160px
                bg="$bew-elevated" rounded="$bew-radius"
                border="1 $bew-border-color"
                @mouseenter="cancelSubmenuClose"
                @click.stop
              >
                <li
                  v-for="item in entry.items"
                  :key="item.command"
                  class="context-menu-item"
                  @click="handleCommonCommand(item.command)"
                >
                  <i class="item-icon" :class="item.icon" />
                  {{ item.name }}
                </li>
              </ul>
            </li>

            <li
              v-else
              class="context-menu-item"
              @mouseenter="closeSubmenu"
              @click="handleCommonCommand(entry.command)"
            >
              <i class="item-icon" :class="entry.icon" />
              {{ entry.name }}
            </li>

            <div v-if="index !== commonOptions.length - 1" class="divider" />
          </template>
        </ul>
      </div>
    </div>

    <!-- mask -->
    <div
      v-if="showContextMenu"
      pos="fixed top-0 left-0" w-full h-full
      @click="handleClose"
      @click.right.prevent.stop="handleReopen"
    />

    <DislikeDialog
      v-model="showDislikeDialog"
      :video="video"
      @close="handleClose"
      @removed="handleRemoved"
    />

    <DownloadDialog
      v-model="showDownloadDialog"
      :video="video"
      @close="handleClose"
    />

    <PipWindow
      v-if="showPipWindow"
      :url="video.url"
      @close="handleClose"
    />
  </div>
</template>

<style lang="scss" scoped>
.context-menu-item {
  --uno: "hover:bg-$bew-fill-2 text-sm px-2.5 py-1.75 rounded-$bew-radius-half cursor-pointer";
  --uno: "flex items-center";
}

.context-menu-group {
  --uno: "relative";

  /* 子菜单打开时保持高亮，避免鼠标移入子菜单后一级项失去选中态 */
  &.is-submenu-open {
    --uno: "bg-$bew-fill-2";
  }
}

.item-icon {
  --uno: "mr-2 inline-block color-$bew-text-color-2";
}

.submenu-arrow {
  --uno: "ml-auto pl-2 opacity-60 shrink-0";
}

.context-submenu {
  /* 默认贴在右侧，实际位置由 updateSubmenuPosition 计算后以内联样式覆盖 */
  position: absolute;
  top: 0;
  left: 100%;
  margin-left: 4px;
  z-index: 1;
  white-space: nowrap;
  backdrop-filter: var(--bew-filter-glass-1);
  box-shadow: var(--bew-shadow-edge-glow-1), var(--bew-shadow-1);
}

.divider {
  --uno: "w-full h-1px px-2px bg-$bew-border-color";
}
</style>
