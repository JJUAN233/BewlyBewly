<script lang="ts" setup>
type Size = 'small' | 'medium' | 'large'
interface Props {
  size?: Size
  type?: 'text' | 'password' | 'email' | 'number'
  min?: number
  max?: number
  placeholder?: string
  /** 搜索框样式：静止胶囊形，聚焦时过渡成圆角矩形并亮起主题色光环，与顶栏 SearchBar 一致 */
  pill?: boolean
}
const props = withDefaults(defineProps<Props>(), { size: 'medium' })

defineEmits(['enter'])

const modelValue = defineModel<string | number>()

const inputRef = ref<HTMLInputElement | null>(null)

const height = computed(() => {
  if (props.size === 'small')
    return '30px'
  if (props.size === 'medium')
    return '35px'
  if (props.size === 'large')
    return '40px'
  return '35px'
})

const padding = computed(() => {
  if (props.size === 'small')
    return '0 calc(var(--bew-base-font-size) * 0.5)'
  return '0 var(--bew-base-font-size)'
})

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div
    :style="{ height, padding }"
    class="group"
    :class="{ 'b-input--pill': pill }"
    focus-within:ring="2px $bew-theme-color"
    p="x-4"
    rounded="$bew-radius" transition-all duration-300
    bg="$bew-fill-1" flex="~ gap-2"
  >
    <div v-if="$slots.prefix" class="prefix">
      <div>
        <slot name="prefix" />
      </div>
    </div>

    <input
      ref="inputRef"
      v-model="modelValue"
      :style="{ lineHeight: height }"
      :type="type"
      :min="min"
      :max="max"
      :placeholder="placeholder"
      w-inherit h-inherit
      outline-none flex-1 bg-transparent
      @keydown.enter="$emit('enter')"
    >

    <div v-if="$slots.suffix" class="suffix">
      <div>
        <slot name="suffix" />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.prefix,
.suffix {
  --uno: "flex items-center";
}

// 搜索框形态（与 SearchBar 的聚焦表现一致）：静止胶囊形 + 细边框，
// 聚焦时 300ms 过渡成圆角矩形、边框转主题色，并亮起同一套主题色光环。
// 带 data-v 的 scoped 规则能压过模板上的 focus-within:ring attributify
.b-input--pill {
  --uno: "rounded-60px border-1 border-$bew-border-color";

  &:focus-within {
    --uno: "rounded-$bew-radius border-$bew-theme-color";
    box-shadow:
      0 0 0 2px var(--bew-theme-color),
      0 6px 16px var(--bew-theme-color-40),
      inset 0 0 6px var(--bew-theme-color-30);
  }
}
</style>
