<script lang="ts" setup>
import { useBewlyApp } from '~/composables/useAppProvider'
import { IFRAME_PAGE_SWITCH_BEWLY, IFRAME_PAGE_SWITCH_BILI } from '~/constants/globalEvents'
import { settings } from '~/logic'
import { useMainStore } from '~/stores/mainStore'
// import { useSettingsStore } from '~/stores/settingsStore'
import { isHomePage, isInIframe } from '~/utils/main'

const { activatedPage } = useBewlyApp()
const { getDockItemByPage } = useMainStore()
// const { getDockItemConfigByPage } = useSettingsStore()
const options = readonly([
  {
    name: 'BewlyBewly',
    shortName: 'Bewly',
    useOriginalBiliPage: false,
  },
  {
    name: 'BiliBili',
    shortName: 'Bili',
    useOriginalBiliPage: true,
  },
])

const showBewlyOrBiliPageSwitcher = computed(() => {
  if (settings.value.useOriginalBilibiliHomepage)
    return false
  if (!isInIframe() && getDockItemByPage(activatedPage.value)?.hasBewlyPage && isHomePage())
    return true
  if (isInIframe() && getDockItemByPage(activatedPage.value)?.hasBewlyPage)
    return true
  // const dockItemConfig = getDockItemConfigByPage(activatedPage.value)
  // if (dockItemConfig?.useOriginalBiliPage && isInIframe())
  //   return true
  return false
})

/**
 * 当前看到的是 B 站页面还是 BewlyBewly 页面——决定哪个选项高亮。
 *
 * iframe 里那份顶栏永远对着 B 站页面。外层则要看这一项的配置：切到 B 站页面之后外层顶栏并不会
 * 让给 iframe 里那份（那样会消失后重载，见 `~/constants/iframe.ts`），顶栏一直是外层这一份，所以
 * 这里必须按配置判断，否则高亮会一直停在 BewlyBewly 上。
 */
const isUsingOriginalBiliPage = computed(() => {
  if (isInIframe())
    return true
  return settings.value.dockItemsConfig.find(item => item.page === activatedPage.value)?.useOriginalBiliPage || false
})

function switchPage(useOriginalBiliPage: boolean) {
  if (isInIframe()) {
    // iframe 里别自己改配置：它的地址里没有 `?page=`，`activatedPage` 只能退化成「第一个可见的
    // dock 项」，写下去的是另一个页面的配置（而且会持久化到 storage）。父页面才知道当前真正
    // 是哪个页面，改配置的活交给它——它收到消息后会去改对外暴露的那个页面。
    parent.postMessage(
      useOriginalBiliPage ? IFRAME_PAGE_SWITCH_BILI : IFRAME_PAGE_SWITCH_BEWLY,
      '*',
    )
    return
  }

  const dockItem = settings.value.dockItemsConfig.find(dockItem => dockItem.page === activatedPage.value)
  if (dockItem) {
    dockItem.useOriginalBiliPage = useOriginalBiliPage
  }
}
</script>

<template>
  <div
    v-if="showBewlyOrBiliPageSwitcher"
    class="bewly-bili-switcher"
    :class="{ 'disable-frosted-glass': settings.disableFrostedGlass }"
    style="backdrop-filter: var(--bew-filter-glass-1);"
    flex="~ gap-1" bg="$bew-elevated" p-1 rounded-full
    h-34px
  >
    <button
      v-for="option in options" :key="option.name"
      class="bewly-bili-switcher-button"
      :class="{
        active: option.useOriginalBiliPage === isUsingOriginalBiliPage,
      }"
      rounded-inherit text="$bew-text-2 hover:$bew-text-1 xs" p="x-2 lg:x-4" bg="hover:$bew-fill-2"
      fw-bold duration-300
      @click="switchPage(option.useOriginalBiliPage)"
    >
      <span class="hidden lg:block">
        {{ option.name }}
      </span>
      <span class="block lg:hidden">
        {{ option.shortName }}
      </span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.force-white-icon .bewly-bili-switcher:not(.disable-frosted-glass) {
  background-color: color-mix(in oklab, var(--bew-elevated-solid), transparent 80%);
}

.force-white-icon .bewly-bili-switcher:not(.disable-frosted-glass) .bewly-bili-switcher-button {
  --uno: "text-white";

  &:hover {
    --uno: "bg-white bg-opacity-20";
  }

  &.active {
    --uno: "bg-white bg-opacity-30";
  }
}

.active {
  --uno: "bg-$bew-fill-3 text-$bew-text-1";
}
</style>
