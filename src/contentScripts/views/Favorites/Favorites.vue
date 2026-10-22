<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { FavoriteCategory, FavoriteResource } from '~/components/TopBar/types'
import { useBewlyApp } from '~/composables/useAppProvider'
import { TOP_BAR_VISIBILITY_CHANGE } from '~/constants/globalEvents'
import { settings } from '~/logic'
import type { FavoritesResult, Media as FavoriteItem } from '~/models/video/favorite'
import type { FavoritesCategoryResult, List as CategoryItem } from '~/models/video/favoriteCategory'
import api from '~/utils/api'
import { getCSRF, getUserID, openLinkToNewTab, removeHttpFromUrl } from '~/utils/main'
import emitter from '~/utils/mitt'

const { t } = useI18n()

const favoriteCategories = reactive<CategoryItem[]>([])
const favoriteResources = reactive<FavoriteItem[]>([])
const categoryOptions = reactive<Array<{ value: any, label: string }>>([])

const selectedCategory = ref<FavoriteCategory>()
const activatedCategoryCover = ref<string>('')

const shouldMoveCtrlBarUp = ref<boolean>(false)
const currentPageNum = ref<number>(1)
const keyword = ref<string>('')
const { handlePageRefresh, handleReachBottom, haveScrollbar } = useBewlyApp()
const isLoading = ref<boolean>(false)
const isFullPageLoading = ref<boolean>(false)
const noMoreContent = ref<boolean>(false)

// 收藏夹内视频的排序，对应 B 站原版的 最近收藏/最近投稿/最多播放
const sortBy = ref<'mtime' | 'pubtime' | 'view'>('mtime')
const sortOptions = computed(() => [
  { label: t('favorites.sort_mtime'), value: 'mtime' },
  { label: t('favorites.sort_pubtime'), value: 'pubtime' },
  { label: t('favorites.sort_view'), value: 'view' },
])

onMounted(() => {
  emitter.off(TOP_BAR_VISIBILITY_CHANGE)
  emitter.on(TOP_BAR_VISIBILITY_CHANGE, (val) => {
    shouldMoveCtrlBarUp.value = false

    // Allow moving tabs up only when the top bar is not hidden & is set to auto-hide
    // This feature is primarily designed to compatible with the Bilibili Evolved's top bar
    // Even when the BewlyBewly top bar is hidden, the Bilibili Evolved top bar still exists, so not moving up
    if (settings.value.autoHideTopBar && settings.value.showTopBar) {
      if (val)
        shouldMoveCtrlBarUp.value = false

      else
        shouldMoveCtrlBarUp.value = true
    }
  })

  initPageAction()
  initData()
})

async function initData() {
  await getFavoriteCategories()
  changeCategory(favoriteCategories[0])
}

onUnmounted(() => {
  emitter.off(TOP_BAR_VISIBILITY_CHANGE)
})

function initPageAction() {
  handleReachBottom.value = async () => {
    if (isLoading.value)
      return
    if (noMoreContent.value)
      return

    await getFavoriteResources(selectedCategory.value!.id, ++currentPageNum.value, keyword.value)
  }

  handlePageRefresh.value = () => {
    if (isLoading.value)
      return
    favoriteResources.length = 0
    currentPageNum.value = 1
    noMoreContent.value = false
    handleSearch()
  }
}

async function getFavoriteCategories() {
  await api.favorite.getFavoriteCategories({
    up_mid: getUserID(),
  })
    .then((res: FavoritesCategoryResult) => {
      if (res.code === 0) {
        // 必须整段替换而不是 Object.assign：assign 按下标覆写，新列表比旧列表短时
        // 尾部的旧项会留下来——删掉的收藏夹看起来「删不掉」，要刷新才消失
        favoriteCategories.splice(0, favoriteCategories.length, ...res.data.list)
        buildCategoryOptions()
      }
    })
}

function buildCategoryOptions() {
  categoryOptions.length = 0
  favoriteCategories.forEach((item) => {
    categoryOptions.push({
      label: item.title,
      value: item,
    })
  })
}

/** attr bit1（值 2）：0=默认收藏夹 1=其他收藏夹。默认的不能删、不能拖，其他的都可以 */
function isOtherFolder(item: CategoryItem) {
  return (item.attr & 2) !== 0
}

/**
 * Get favorite video resources
 * @param media_id
 * @param pn
 * @param keyword
 */
async function getFavoriteResources(
  media_id: number,
  pn: number,
  keyword = '' as string,
) {
  // if (pn === 1)
  //   isFullPageLoading.value = true
  isLoading.value = true
  try {
    const res: FavoritesResult = await api.favorite.getFavoriteResources({
      media_id,
      pn,
      keyword,
      order: sortBy.value,
    })

    // Bilibili answers some folder requests with `code: 0` and a null payload; reading
    // `res.data.info` then throws. Check the payload is there first.
    if (res.code === 0 && res.data) {
      activatedCategoryCover.value = res.data.info.cover

      if (Array.isArray(res.data.medias) && res.data.medias.length > 0)
        favoriteResources.push(...res.data.medias)

      if (!res.data.medias)
        noMoreContent.value = true

      if (!await haveScrollbar() && !noMoreContent.value)
        await getFavoriteResources(selectedCategory.value!.id, ++currentPageNum.value, keyword)
    }
  }
  finally {
    isLoading.value = false
    // isFullPageLoading.value = false
  }
}

async function changeCategory(categoryItem: FavoriteCategory) {
  if (isLoading.value)
    return
  currentPageNum.value = 1
  selectedCategory.value = categoryItem
  favoriteResources.length = 0
  noMoreContent.value = false

  getFavoriteResources(categoryItem.id, 1)
}

function handleSearch() {
  currentPageNum.value = 1
  favoriteResources.length = 0
  noMoreContent.value = false

  getFavoriteResources(selectedCategory.value!.id, currentPageNum.value, keyword.value)
}

function handlePlayAll() {
  openLinkToNewTab(`https://www.bilibili.com/list/ml${selectedCategory.value?.id}`)
}

function jumpToLoginPage() {
  location.href = 'https://passport.bilibili.com/login'
}

const showUnfavoriteConfirm = ref<boolean>(false)
const unfavoriteTarget = ref<FavoriteResource | null>(null)

function handleUnfavorite(favoriteResource: FavoriteResource) {
  unfavoriteTarget.value = favoriteResource
  showUnfavoriteConfirm.value = true
}

function unfavorite() {
  const favoriteResource = unfavoriteTarget.value
  if (!favoriteResource)
    return

  api.favorite.patchDelFavoriteResources({
    resources: `${favoriteResource.id}:${favoriteResource.type}`,
    media_id: selectedCategory.value?.id,
    csrf: getCSRF(),
  }).then((res) => {
    if (res.code === 0)
      favoriteResources.splice(favoriteResources.indexOf(favoriteResource as FavoriteItem), 1)
  })
}

function isMusic(item: FavoriteResource) {
  return item.link.includes('bilibili://music')
}

function handleSortChange() {
  if (isLoading.value)
    return
  handleSearch()
}

// #region 收藏夹管理（新建 / 编辑 / 删除，对齐 B 站原版功能）
const showFolderDialog = ref<boolean>(false)
const editingFolder = ref<CategoryItem | null>(null)
const folderDialogLoading = ref<boolean>(false)
const folderForm = reactive({ name: '', intro: '', privacy: 0 })
const privacyOptions = computed(() => [
  { label: t('favorites.privacy_public'), value: 0 },
  { label: t('favorites.privacy_private'), value: 1 },
])

function openCreateFolderDialog() {
  editingFolder.value = null
  folderForm.name = ''
  folderForm.intro = ''
  folderForm.privacy = 0
  showFolderDialog.value = true
}

function openEditFolderDialog(item: CategoryItem) {
  editingFolder.value = item
  folderForm.name = item.title
  folderForm.intro = item.intro ?? ''
  folderForm.privacy = (item.attr & 1) !== 0 ? 1 : 0
  showFolderDialog.value = true
}

async function submitFolderDialog() {
  if (!folderForm.name.trim())
    return

  // 同步置位：Dialog 在 emit confirm 后会看 loading 决定要不要立刻关，置位晚了就会先关掉
  folderDialogLoading.value = true
  try {
    // 接口的标题字段是 title；编辑的收藏夹 id 字段是 media_id（不是 name/fid，见 favorite.ts 注释）
    const params = {
      title: folderForm.name.trim(),
      intro: folderForm.intro.trim(),
      privacy: folderForm.privacy,
      csrf: getCSRF(),
    }
    const res = editingFolder.value
      ? await api.favorite.patchFavoriteFolder({ media_id: editingFolder.value.id, ...params })
      : await api.favorite.addFavoriteFolder(params)

    if (res.code === 0) {
      const editedId = editingFolder.value?.id
      await getFavoriteCategories()
      // 刷新后列表里的对象全是新的，把选中项指到同 id 的新对象上，下拉框的选中态才不会丢
      if (editedId) {
        const fresh = favoriteCategories.find(folder => folder.id === editedId)
        if (fresh)
          selectedCategory.value = fresh
      }
      showFolderDialog.value = false
    }
    else {
      window.alert(res.message)
    }
  }
  finally {
    folderDialogLoading.value = false
  }
}

const showDeleteFolderConfirm = ref<boolean>(false)
const deleteFolderTarget = ref<CategoryItem | null>(null)

function openDeleteFolderDialog(item: CategoryItem) {
  deleteFolderTarget.value = item
  showDeleteFolderConfirm.value = true
}

async function deleteFolder() {
  if (!deleteFolderTarget.value)
    return

  const res = await api.favorite.delFavoriteFolder({
    // 删除接口要的是 media_ids：逗号分隔的收藏夹 id 列表（见 favorite.ts 注释）
    media_ids: `${deleteFolderTarget.value.id}`,
    csrf: getCSRF(),
  })
  if (res.code === 0) {
    const wasSelected = selectedCategory.value?.id === deleteFolderTarget.value.id
    await getFavoriteCategories()
    // 删的是当前选中的收藏夹就切回第一个，别让列表悬空
    if (wasSelected && favoriteCategories.length > 0)
      changeCategory(favoriteCategories[0])
  }
  else {
    window.alert(res.message)
  }
}

// #region 收藏夹拖拽排序（对齐 B 站原版：悬停封面出排序图标，拖到目标位置）
const draggingFolderId = ref<number | null>(null)
const dragOverFolderId = ref<number | null>(null)

function onFolderDragStart(item: CategoryItem, e: DragEvent) {
  if (!isOtherFolder(item)) {
    e.preventDefault()
    return
  }
  draggingFolderId.value = item.id
  dragOverFolderId.value = null
  // Firefox 要求 dragstart 里写入数据才会真正启动拖拽
  e.dataTransfer?.setData('text/plain', `${item.id}`)
  if (e.dataTransfer)
    e.dataTransfer.effectAllowed = 'move'
}

function onFolderDragOver(item: CategoryItem, e: DragEvent) {
  // 默认收藏夹不参与排序，拖到它上面直接忽略
  if (draggingFolderId.value === null || draggingFolderId.value === item.id || !isOtherFolder(item))
    return
  e.preventDefault()
  if (e.dataTransfer)
    e.dataTransfer.dropEffect = 'move'
  dragOverFolderId.value = item.id
}

async function onFolderDrop(item: CategoryItem, e: DragEvent) {
  e.preventDefault()
  const fromId = draggingFolderId.value
  draggingFolderId.value = null
  dragOverFolderId.value = null
  if (!fromId || fromId === item.id || !isOtherFolder(item))
    return

  // 按落点在目标卡片的上/下半插入，手感比整卡交换好
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const placeAfter = e.clientY > rect.top + rect.height / 2

  const fromIdx = favoriteCategories.findIndex(folder => folder.id === fromId)
  if (fromIdx === -1)
    return
  const moved = favoriteCategories.splice(fromIdx, 1)[0]
  let toIdx = favoriteCategories.findIndex(folder => folder.id === item.id)
  if (toIdx === -1) {
    favoriteCategories.splice(fromIdx, 0, moved)
    return
  }
  if (placeAfter)
    toIdx++
  favoriteCategories.splice(toIdx, 0, moved)

  await persistFolderOrder()
}

function onFolderDragEnd() {
  draggingFolderId.value = null
  dragOverFolderId.value = null
}

async function persistFolderOrder() {
  // 接口要的是完整新顺序（含默认收藏夹）逗号拼接，见 favorite.ts 注释
  const res = await api.favorite.sortFavoriteFolders({
    sort: favoriteCategories.map(folder => folder.id).join(','),
    csrf: getCSRF(),
  })
  if (res.code !== 0) {
    window.alert(res.message)
    // 失败就回滚：重新拉一遍服务端顺序
    await getFavoriteCategories()
  }
  else {
    buildCategoryOptions()
  }
}
// #endregion
</script>

<template>
  <div v-if="getCSRF()" flex="~ col md:row lg:row" gap-6>
    <main w="full md:60% lg:70% xl:75%" order="2 md:1 lg:1" relative>
      <!-- <h3 text="3xl $bew-text-1" font-bold mb-6>
        {{ selectedCategory?.title }}
      </h3> -->
      <div
        fixed z-10 absolute p-2 flex="~ gap-2"
        items-center
        bg="$bew-elevated-solid" rounded="$bew-radius" shadow="$bew-shadow-2" mt--2 transition="all 300 ease-in-out"
        :class="{ hide: shouldMoveCtrlBarUp }"
      >
        <Select v-model="selectedCategory" w-150px :options="categoryOptions" @change="(val: FavoriteCategory) => changeCategory(val)" />
        <!-- 排序对齐 B 站原版：最近收藏 / 最近投稿 / 最多播放 -->
        <Select v-model="sortBy" class="hidden md:block" w-120px :options="sortOptions" @change="handleSortChange" />
        <!-- 搜索按钮放进输入框右端，样式与顶栏 SearchBar 内的放大镜一致（悬停/聚焦转主题色 + 光晕），
             不再用单独的 primary 按钮 -->
        <Input v-model="keyword" pill w-250px @enter="handleSearch">
          <template #suffix>
            <button
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
          </template>
        </Input>
        <!-- <h3
          text="2xl $bew-text-1" font-bold w-150px
        >
          {{ selectedCategory?.title }}
        </h3> -->
      </div>
      <Empty v-if="favoriteResources.length === 0 && !isLoading" m="t-55px b-6" />
      <template v-else>
        <Transition name="fade">
          <Loading v-if="isFullPageLoading" w-full h-full pos="absolute top-0 left-0" mt--50px />
        </Transition>
        <!-- favorite list -->
        <div grid="~ 2xl:cols-4 xl:cols-3 lg:cols-2 md:cols-1 sm:cols-1 cols-1 gap-5" m="t-55px b-6">
          <TransitionGroup name="list">
            <VideoCard
              v-for="item in favoriteResources"
              :key="item.id"
              :video="{
                id: item.id,
                duration: item.duration,
                title: item.title,
                cover: item.cover,
                author: {
                  name: item.upper.name,
                  authorFace: item.upper.face,
                  mid: item.upper.mid,
                },
                view: item.cnt_info.play,
                danmaku: item.cnt_info.danmaku,
                publishedTimestamp: item.pubtime,
                bvid: isMusic(item) ? undefined : item.bvid,
                url: isMusic(item) ? `https://www.bilibili.com/audio/au${item.id}` : undefined,
              }"
              group
            >
              <template #coverTopLeft>
                <button
                  p="x-2 y-1" m="1"
                  rounded="$bew-radius"
                  text="!white xl"
                  bg="black opacity-60 hover:$bew-error-color-80"
                  @click.prevent.stop="handleUnfavorite(item)"
                >
                  <Tooltip :content="$t('favorites.unfavorite')" placement="bottom" type="dark">
                    <div i-ic-baseline-clear />
                  </Tooltip>
                </button>
              </template>
            </VideoCard>
          </TransitionGroup>
        </div>

        <!-- no more content -->
        <Empty v-if="noMoreContent" class="py-4" :description="$t('common.no_more_content')" />

        <!-- loading -->
        <Transition name="fade">
          <Loading
            v-if="isLoading && favoriteResources.length !== 0 && !noMoreContent"
            m="-t-4"
          />
        </Transition>
      </template>
    </main>

    <aside relative w="full md:40% lg:30% xl:25%" class="hidden md:block" order="1 md:2 lg:2">
      <!--
        吸附位置取「面板静止时的位置」＝页面顶部内边距（App.vue 的 p-t-[calc(var(--bew-top-bar-height)+10px)]）
        加上面板自己的 my-10（2.5em，本项目的 uno 间距是 em 基准）。
        原先写死 top-120px，比静止位置低 9px：面板容器被 flex 行拉高、平时刚好没有余量所以动不了，
        一旦主内容列高过面板就多出余量（收藏页进入时列表会短暂越过这个高度），面板立刻下滑 9px，
        缩回时再弹回来——就是那下「向下跳动后复原」。
      -->
      <div
        pos="sticky top-[calc(var(--bew-top-bar-height)+10px+2.5em)]"
        w-full h="auto md:[calc(100vh-160px)]"
        my-10
        rounded="$bew-radius"
        overflow-hidden
      >
        <!-- Frosted Glass Cover -->
        <!-- 底色用扩展自己的表面色（不是固定的灰色），这样亮暗模式和主题设置都能带上；
             模糊封面压在下面，开了毛玻璃时透出来当作底纹 -->
        <div
          pos="absolute top-0 left-0" w-full h-full
          z--1
        >
          <div
            absolute w-full h-full
            bg="$bew-elevated"
          />
          <img
            v-if="activatedCategoryCover"
            :src="removeHttpFromUrl(`${activatedCategoryCover}@480w_270h_1c`)"
            w-full h-full object="cover center" blur-40px
            relative z--1
          >
        </div>

        <!-- Content -->
        <main
          pos="absolute top-0 left-0"
          w-full h-full
          overflow-overlay
          flex="~ col gap-4 justify-start"
          p-6
        >
          <picture
            rounded="$bew-radius" shadow="$bew-shadow-2"
            aspect-video mb-4 bg="$bew-skeleton"
          >
            <img
              v-if="activatedCategoryCover" :src="removeHttpFromUrl(`${activatedCategoryCover}@480w_270h_1c`)"
              rounded="$bew-radius" aspect-video w-full object-cover
            >
            <div v-else aspect-video w-full>
              <!-- <Empty /> -->
            </div>
          </picture>

          <h3 text="3xl $bew-text-1" fw-600>
            {{ selectedCategory?.title }}
          </h3>
          <p flex="~ col" gap-4>
            <Button
              type="primary" block strong flex-1
              @click="handlePlayAll"
            >
              <template #left>
                <div i-tabler:player-play />
              </template>
              {{ t('common.play_all') }}
            </Button>
            <!-- 虚线卡片式新建按钮，和下方收藏夹卡片同一套视觉语言 -->
            <button
              class="create-folder-btn"
              w-full box-border
              rounded="$bew-radius"
              border="1 dashed $bew-border-color"
              p="x-3 y-2"
              flex="~ items-center justify-center gap-2"
              text="sm"
              cursor-pointer duration-300
              @click="openCreateFolderDialog"
            >
              <div i-tabler:plus />
              <span>{{ t('favorites.create_folder') }}</span>
            </button>
          </p>
          <!-- 只纵向滚动：横向滚动条是 overflow-overlay 把两个轴都开出来了 -->
          <ul
            class="category-list" h-full min-h-200px
            overflow-y-auto overflow-x-hidden
            flex="~ col gap-2"
          >
            <li
              v-for="item in favoriteCategories" :key="item.id"
              class="category-item"
              :class="{
                'category-active': item.id === selectedCategory?.id,
                'category-dragging': draggingFolderId === item.id,
                'category-drag-over': dragOverFolderId === item.id && draggingFolderId !== item.id,
              }"
              :draggable="isOtherFolder(item)"
              rounded="$bew-radius"
              p="x-3 y-2"
              cursor-pointer
              duration-300
              group
              flex="~ items-center gap-3"
              :style="{ pointerEvents: isFullPageLoading ? 'none' : 'auto' }"
              @click="changeCategory(item)"
              @dragstart="onFolderDragStart(item, $event)"
              @dragover="onFolderDragOver(item, $event)"
              @dragenter="onFolderDragOver(item, $event)"
              @drop="onFolderDrop(item, $event)"
              @dragend="onFolderDragEnd"
            >
              <div
                class="category-cover"
                relative shrink-0
                w-40px h-40px
                rounded="$bew-radius-half" overflow-hidden
                bg="$bew-skeleton"
              >
                <img
                  v-if="item.cover || item.cover_url"
                  class="category-cover-media"
                  :src="removeHttpFromUrl(`${item.cover_url || item.cover}@64w_64h_1c`)"
                  w-full h-full
                  object-cover
                >
                <div
                  v-else
                  class="category-cover-media"
                  w-full h-full
                  bg="$bew-fill-2"
                  flex="~ items-center justify-center"
                >
                  <div i-tabler:folder text-xl op-60 />
                </div>
                <!-- 悬停时整个封面切换成图标（原封面淡出，不是叠在上面）：
                     其他收藏夹=排序手柄；默认收藏夹=禁止图标（不可拖） -->
                <div
                  class="category-cover-overlay"
                  bg="$bew-fill-3"
                  flex="~ items-center justify-center"
                  text="$bew-text-1"
                >
                  <div
                    :class="isOtherFolder(item) ? 'i-tabler:arrows-sort' : 'i-tabler:ban'"
                    text-lg
                  />
                </div>
              </div>
              <div flex="~ col gap-1" min-w-0 flex-1>
                <span truncate text="sm $bew-text-1" fw-500>{{ item.title }}</span>
                <span text="xs $bew-text-2" flex="~ items-center gap-2">
                  {{ item.media_count }}
                  <span
                    v-if="(item.attr & 1) !== 0"
                    px="x-1.5" py="y-0.5"
                    rounded-4px
                    bg="$bew-fill-2"
                    leading-14px
                  >{{ t('favorites.privacy_private') }}</span>
                </span>
              </div>
              <!-- 收藏夹操作：悬停出现，避免和点击切换收藏夹冲突 -->
              <div
                class="category-actions"
                flex="~ gap-1" shrink-0
                duration-300
                @click.stop
              >
                <button
                  p-1 rounded-full
                  text="base $bew-text-2 hover:$bew-theme-color"
                  bg="hover:$bew-fill-2"
                  duration-300
                  cursor-pointer
                  @click="openEditFolderDialog(item)"
                >
                  <Tooltip :content="t('favorites.edit_folder')" placement="top">
                    <div i-tabler:pencil block />
                  </Tooltip>
                </button>
                <!-- 默认收藏夹（attr bit1=0）不能删，不给入口 -->
                <button
                  v-if="isOtherFolder(item)"
                  p-1 rounded-full
                  text="base $bew-text-2 hover:$bew-error-color"
                  bg="hover:$bew-fill-2"
                  duration-300
                  cursor-pointer
                  @click="openDeleteFolderDialog(item)"
                >
                  <Tooltip :content="t('favorites.delete_folder')" placement="top">
                    <div i-tabler:trash block />
                  </Tooltip>
                </button>
              </div>
            </li>
          </ul>
        </main>
      </div>
    </aside>

    <!-- 确认框统一用扩展自己的 ConfirmDialog，不用浏览器原生的 confirm -->
    <ConfirmDialog
      v-model="showUnfavoriteConfirm"
      :message="t('favorites.unfavorite_confirm')"
      @confirm="unfavorite"
    />

    <!-- 新建 / 编辑收藏夹 -->
    <Dialog
      v-if="showFolderDialog"
      :title="editingFolder ? t('favorites.edit_folder') : t('favorites.create_folder')"
      width="440px"
      :loading="folderDialogLoading"
      :show-close-button="false"
      @close="showFolderDialog = false"
      @confirm="submitFolderDialog"
    >
      <div flex="~ col gap-4">
        <div>
          <p text="sm $bew-text-2" mb-2>
            {{ t('favorites.folder_name') }}
          </p>
          <Input v-model="folderForm.name" w-full :placeholder="t('favorites.folder_name')" />
        </div>
        <div>
          <p text="sm $bew-text-2" mb-2>
            {{ t('favorites.folder_intro') }}
          </p>
          <textarea
            v-model="folderForm.intro"
            rows="3"
            w-full rounded="$bew-radius"
            bg="$bew-fill-1"
            p="x-4 y-2"
            text="$bew-text-1"
            resize-none outline-none
            border="1 transparent focus:$bew-theme-color"
            transition="all duration-300"
            :placeholder="t('favorites.folder_intro')"
            @keydown.enter.stop="() => {}"
          />
        </div>
        <div>
          <p text="sm $bew-text-2" mb-2>
            {{ t('favorites.folder_privacy') }}
          </p>
          <!-- 两选一用内联分段按钮，不弹面板：下拉不管向上还是向下都会挡到别的东西 -->
          <div flex="~ gap-2">
            <button
              v-for="opt in privacyOptions"
              :key="opt.value"
              type="button"
              flex-1
              rounded="$bew-radius"
              p="y-2"
              border="1"
              text-sm
              cursor-pointer duration-300
              :class="folderForm.privacy === opt.value ? 'privacy-option-active' : 'privacy-option-idle'"
              @click="folderForm.privacy = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>
    </Dialog>

    <ConfirmDialog
      v-model="showDeleteFolderConfirm"
      :message="t('favorites.delete_folder_confirm')"
      @confirm="deleteFolder"
    />
  </div>
  <Empty v-else mt-6 :description="t('common.please_log_in_first')">
    <Button type="primary" @click="jumpToLoginPage()">
      {{ $t('common.login') }}
    </Button>
  </Empty>
</template>

<style lang="scss" scoped>
.hide {
  transform: translateY(-70px);
}

.category-item {
  // 卡片式列表项：hover 中性填充、选中主题色 + 内描边，都由变量驱动所以跟主题走
  &:not(.category-active):hover {
    --uno: "bg-$bew-fill-2";
  }
}

.category-active {
  --uno: "bg-$bew-theme-color-20 color-$bew-theme-color";
  box-shadow: inset 0 0 0 1px var(--bew-theme-color-40);
}

// 操作按钮悬停才出现（纯 scoped CSS，不依赖 op-* 工具类）
.category-actions {
  opacity: 0;
}

.category-item:hover .category-actions {
  opacity: 1;
}

// 封面悬停时原图淡出、整块切换成图标（排序手柄 / 禁止），不是叠一层半透明蒙版
.category-cover-media {
  transition: opacity 0.3s;
}

.category-cover-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.category-cover:hover .category-cover-media {
  opacity: 0;
}

.category-cover:hover .category-cover-overlay {
  opacity: 1;
}

// 可拖的收藏夹封面是抓手光标；默认收藏夹不可拖，给禁止光标
li[draggable="true"] .category-cover {
  cursor: grab;
}

li[draggable="true"]:active .category-cover {
  cursor: grabbing;
}

li[draggable="false"] .category-cover {
  cursor: not-allowed;
}

.category-dragging {
  opacity: 0.4;
}

.category-drag-over {
  box-shadow: inset 0 0 0 2px var(--bew-theme-color);
}

// 新建收藏夹：虚线卡片按钮，hover 转主题色
.create-folder-btn {
  color: var(--bew-text-2);

  &:hover {
    border-color: var(--bew-theme-color);
    color: var(--bew-theme-color);
    background: var(--bew-theme-color-10);
  }
}

// 弹窗里的公开性分段按钮
.privacy-option-idle {
  border-color: var(--bew-border-color);
  color: var(--bew-text-2);
  background: var(--bew-fill-1);

  &:hover {
    color: var(--bew-text-1);
  }
}

.privacy-option-active {
  border-color: var(--bew-theme-color);
  color: var(--bew-theme-color);
  background: var(--bew-theme-color-20);
}

.category-list {
  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    // 与全局滚动条保持一致
    background-color: rgba(120, 120, 140, 0.44);
    border-radius: 20px;
  }

  &::-webkit-scrollbar-corner {
    background: transparent;
  }
}
</style>
