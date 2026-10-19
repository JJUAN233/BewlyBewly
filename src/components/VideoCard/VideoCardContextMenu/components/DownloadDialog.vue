<script lang="ts" setup>
import { Icon } from '@iconify/vue'
import { onKeyStroke } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { TYPE, useToast } from 'vue-toastification'

import type { Video } from '~/components/VideoCard/types'
import type { DownloadQuality } from '~/utils/videoDownload'
import { enqueueVideoDownload, fetchDownloadQualities } from '~/utils/videoDownload'

const props = defineProps<{
  video: Video
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const showDownloadDialog = defineModel<boolean>()

const { t } = useI18n()
const toast = useToast()

/**
 * 编码前缀 → 给用户看的名字。带上业界别名，因为 B 站和不少工具用的是 AVC/HEVC 这套叫法。
 * ASCII，免得再往 4 个语言文件里加键。
 */
const CODEC_LABELS: Record<string, string> = {
  avc1: 'H.264 (AVC)',
  hev1: 'H.265 (HEVC)',
  hvc1: 'H.265 (HEVC)',
  av01: 'AV1',
  merged: 'MP4',
}

const isLoadingQualities = ref<boolean>(false)
const qualities = ref<DownloadQuality[]>([])
const selectedCodec = ref<string>('')
const selectedQuality = ref<number | 'merged' | undefined>()
const loadError = ref<string>('')

/** 这个视频提供了哪些编码 */
const codecs = computed(() => [...new Set(qualities.value.map(quality => quality.codec))])

/** 只列出当前所选编码下的画质 */
const qualitiesOfCodec = computed(() =>
  qualities.value.filter(quality => quality.codec === selectedCodec.value),
)

function codecLabel(codec: string): string {
  return CODEC_LABELS[codec] || codec
}

watch(showDownloadDialog, async (visible) => {
  if (!visible || qualities.value.length || isLoadingQualities.value)
    return

  isLoadingQualities.value = true
  loadError.value = ''
  try {
    qualities.value = await fetchDownloadQualities(props.video)

    // 默认 H.264：兼容性最好，H.265 在 Chrome 上很多平台解不了
    const available = [...new Set(qualities.value.map(quality => quality.codec))]
    selectedCodec.value = available.includes('avc1') ? 'avc1' : available[0] || ''
    selectedQuality.value = qualitiesOfCodec.value[0]?.qualityId
  }
  catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    isLoadingQualities.value = false
  }
}, { immediate: true })

// 换编码后，原来选中的画质可能不存在了，退到该编码下的最高画质
watch(selectedCodec, () => {
  const list = qualitiesOfCodec.value
  if (!list.some(quality => quality.qualityId === selectedQuality.value))
    selectedQuality.value = list[0]?.qualityId
})

function formatSize(bytes?: number): string {
  if (!bytes)
    return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function qualityLabel(quality: DownloadQuality): string {
  if (quality.qualityId === 'merged')
    return quality.name
  if (quality.width && quality.height)
    return `${quality.name} · ${quality.width}×${quality.height}`
  return quality.name
}

function closeDownloadDialog() {
  showDownloadDialog.value = false
  emit('close')
}

function handleConfirm() {
  if (selectedQuality.value === undefined)
    return

  const shared = { title: props.video.title }
  const toastId = toast.info(
    t('video_card.operation.download_progress_unknown', { ...shared, loaded: '0' }),
    { timeout: false },
  )

  const result = enqueueVideoDownload(props.video, {
    qualityId: selectedQuality.value,
    codec: selectedCodec.value,
    onProgress: (fraction) => {
      toast.update(toastId, {
        content: t('video_card.operation.download_progress', {
          ...shared,
          percent: Math.max(0, Math.min(100, Math.round(fraction * 100))),
        }),
      })
    },
    onFinish: () => {
      toast.update(toastId, {
        content: t('video_card.operation.download_started', shared),
        options: { type: TYPE.SUCCESS, timeout: 5000 },
      })
    },
    onError: (error) => {
      toast.update(toastId, {
        content: t('video_card.operation.download_failed', { reason: describeDownloadError(error) }),
        options: { type: TYPE.ERROR, timeout: 8000 },
      })
    },
  })

  if (result === 'duplicate') {
    toast.dismiss(toastId)
    toast.info(t('video_card.operation.download_in_progress'))
  }

  closeDownloadDialog()
}

/** 把内部错误码换成能给用户看的原因；原始 HTTP 状态码直接透出，便于排查。 */
function describeDownloadError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error)
  switch (code) {
    case 'missing-bvid':
      return t('video_card.operation.download_error_no_bvid')
    case 'no-stream':
      return t('video_card.operation.download_error_no_stream')
    case 'segmented-video':
      return t('video_card.operation.download_error_segmented')
    default:
      return code
  }
}

// 数字键快速选择，与不感兴趣对话框保持一致的操作习惯
onKeyStroke((e: KeyboardEvent) => {
  if (!showDownloadDialog.value)
    return

  if (e.key >= '1' && e.key <= '9') {
    const index = Number(e.key) - 1
    if (qualitiesOfCodec.value[index])
      selectedQuality.value = qualitiesOfCodec.value[index].qualityId
  }
})
</script>

<template>
  <!--
    content-height 固定成 330px 是为了不「展开」：画质列表要等接口回来（约一两百毫秒）才出现，
    高度自适应的话，对话框一打开只有末尾那行提示（约 30px），列表到齐时内容区一下子长到三百多
    像素，而框子是居中的——看起来就像弹出来之后展开了一下。330px 正好是「编码行 + 四个画质项 +
    提示」这个常见情况的高度（窗口矮的时候下面的 content-max-height 会兜住）。
  -->
  <Dialog
    v-if="showDownloadDialog"
    :title="$t('video_card.operation.download_video')"
    width="420px"
    max-width="calc(100vw - 32px)"
    content-height="330px"
    content-max-height="50vh"
    append-to-bewly-body
    :show-close-button="false"
    :loading="isLoadingQualities"
    @close="closeDownloadDialog"
    @confirm="handleConfirm"
  >
    <!-- 编码选择 -->
    <div v-if="codecs.length > 1" flex="~ gap-2 items-center wrap" mb-3>
      <span text="$bew-text-3 sm">{{ $t('video_card.operation.download_codec') }}</span>
      <button
        v-for="codec in codecs" :key="codec"
        :class="{ 'activated-quality': selectedCodec === codec }"
        px-2 py-1 rounded="$bew-radius-half" cursor-pointer bg="$bew-fill-1 hover:$bew-fill-2"
        text="sm"
        @click="selectedCodec = codec"
      >
        {{ codecLabel(codec) }}
      </button>
    </div>

    <ul v-if="qualitiesOfCodec.length" flex="~ col gap-2">
      <li
        v-for="(quality, index) in qualitiesOfCodec"
        :key="quality.qualityId"
        :class="{ 'activated-quality': selectedQuality === quality.qualityId }"
        p="x-6 y-4" rounded="$bew-radius" cursor-pointer bg="$bew-fill-1 hover:$bew-fill-2"
        flex="~ gap-2 items-center justify-between"
        @click="selectedQuality = quality.qualityId"
      >
        <div flex="~ gap-2 items-center">
          <div
            bg="$bew-theme-color" color-white w-20px h-20px rounded-10
            flex="~ justify-center items-center"
          >
            {{ index + 1 }}
          </div>
          <span>{{ qualityLabel(quality) }}</span>
          <span v-if="formatSize(quality.sizeBytes)" text="$bew-text-3 sm">{{ formatSize(quality.sizeBytes) }}</span>
        </div>
        <Icon
          v-if="selectedQuality === quality.qualityId" icon="line-md:confirm"
          w-18px h-18px
        />
      </li>
    </ul>

    <p v-else-if="loadError" text="$bew-error-color sm">
      {{ $t('video_card.operation.download_failed', { reason: loadError }) }}
    </p>

    <p text="$bew-text-3 sm" mt-4>
      {{ $t('video_card.operation.download_quality_hint') }}
    </p>
  </Dialog>
</template>

<style lang="scss" scoped>
.activated-quality {
  --uno: "bg-$bew-theme-color-20 color-$bew-theme-color";
}
</style>
