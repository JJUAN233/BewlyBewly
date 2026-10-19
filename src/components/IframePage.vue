<script setup lang="ts">
import { useDark } from '~/composables/useDark'
import { IFRAME_THEME_CHANGE } from '~/constants/globalEvents'
import { PAGE_SWITCHER_IFRAME_NAME } from '~/constants/iframe'
import { settings } from '~/logic'

const props = defineProps<{
  url: string
}>()
const { isDark } = useDark()
const headerShow = ref(false)
const iframeRef = ref<HTMLIFrameElement | null>(null)
const currentUrl = ref<string>(props.url)
const showIframe = ref<boolean>(false)
const showLoading = ref<boolean>(false)

/**
 * Pass the theme on to the iframe.
 *
 * The page is opened over `www.bilibili.com` while the iframe itself points at `t.bilibili.com`,
 * so it is cross-origin and `contentDocument` is null — reaching into its DOM silently does
 * nothing. The extension also runs inside that iframe, but it reads the settings from
 * `browser.storage`, which VueUse only re-reads on the `window` `storage` event; that event never
 * fires for extension storage, so the iframe keeps whatever theme it loaded with.
 *
 * `postMessage` is what works across origins. The iframe mirrors the setting and its own
 * `useDark()` does the rest, so `auto` keeps following the system there too.
 */
function syncThemeToIframe() {
  iframeRef.value?.contentWindow?.postMessage(
    { type: IFRAME_THEME_CHANGE, theme: settings.value.theme },
    '*',
  )
}

watch(() => isDark.value, () => {
  syncThemeToIframe()
})

watch(() => props.url, () => {
  showIframe.value = false
})

// Only show loading animation after 1.5 seconds to prevent annoying flash when content loads quickly
const showLoadingTimeout = ref()
watch(() => showIframe.value, async (newValue) => {
  clearTimeout(showLoadingTimeout.value)
  if (!newValue) {
    showLoadingTimeout.value = setTimeout(() => {
      showLoading.value = true
    }, 1500)
  }
  else {
    showLoading.value = false
  }
}, { immediate: true })

onMounted(() => {
  nextTick(() => {
    iframeRef.value?.focus()
  })
})

onBeforeUnmount(() => {
  releaseIframeResources()
})

async function releaseIframeResources() {
  // Clear iframe content
  currentUrl.value = 'about:blank'
  /**
   * eg: When use 'iframeRef.value?.contentWindow?.document' of t.bilibili.com iframe on bilibili.com, there may be cross domain issues
   * set the src to 'about:blank' to avoid this issue, it also can release the memory
   */
  if (iframeRef.value) {
    iframeRef.value.src = 'about:blank'
  }
  await nextTick()
  iframeRef.value?.contentWindow?.close()

  // Remove iframe from the DOM
  iframeRef.value?.parentNode?.removeChild(iframeRef.value)
  await nextTick()

  // Nullify the reference
  iframeRef.value = null
}

function handleIframeLoad() {
  showIframe.value = true
  // The frame has just read the settings itself, but re-send in case the theme was switched
  // while it was still loading and the message arrived before its app was mounted.
  syncThemeToIframe()
}

function handleBackToTop() {
  if (iframeRef.value) {
    iframeRef.value.contentWindow?.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function handleRefresh() {
  if (iframeRef.value) {
    iframeRef.value.contentWindow?.location.reload()
  }
}

defineExpose({
  handleBackToTop,
  handleRefresh,
})
</script>

<template>
  <div
    pos="relative top-0 left-0" of-hidden w-full h-full
  >
    <Transition name="fade">
      <Loading v-if="showLoading" w-full h-full pos="absolute top-0 left-0" />
    </Transition>
    <Transition name="fade">
      <!-- Iframe -->
      <iframe
        v-show="showIframe"
        ref="iframeRef"
        :name="PAGE_SWITCHER_IFRAME_NAME"
        :src="props.url"
        :style="{
          bottom: headerShow ? `var(--bew-top-bar-height)` : '0',
        }"
        frameborder="0"
        pointer-events-auto
        pos="absolute left-0"
        w-inherit h-inherit
        @load="handleIframeLoad"
      />
    </Transition>
  </div>
</template>

<style lang="scss" scoped>

</style>
