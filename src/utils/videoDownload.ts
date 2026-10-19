import type { Video } from '~/components/VideoCard/types'
import type { VideoInfo } from '~/models/video/videoInfo'
import type { VideoPreviewResult } from '~/models/video/videoPreview'
import api from '~/utils/api'
import { muxFragmentedMp4 } from '~/utils/mp4Mux'

/**
 * 把视频标题清洗成可用的文件名。
 *
 * B 站的标题经常带 `/`、`|`、`【】`、emoji 之类，直接当文件名会在部分系统上失败或被静默截断，
 * 所以这里按各平台的规则过一遍。纯函数，方便单测。
 */
export function sanitizeFilename(title: string, fallback: string): string {
  let name = title
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  // Windows 会静默丢掉结尾的点和空格
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')

  // Windows 的保留设备名（带扩展名也算）
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))
    name = `_${name}`

  // 按码点截断，避免把 emoji / 代理对劈成两半
  if (name.length > 120)
    name = Array.from(name).slice(0, 120).join('').replace(/[.\s]+$/, '')

  return `${name || `video_${fallback}`}.mp4`
}

/**
 * 取视频的 cid。卡片上不一定带（app 推荐流的 cid 是可选的），缺了就补一次。
 * 预览功能原本内联着同一段逻辑，一并收敛到这里。
 */
export async function ensureCid(video: Pick<Video, 'bvid' | 'cid'>): Promise<number | undefined> {
  if (video.cid)
    return video.cid
  if (!video.bvid)
    return undefined

  try {
    const res: VideoInfo = await api.video.getVideoInfo({ bvid: video.bvid })
    if (res.code === 0 && res.data)
      return res.data.cid
  }
  catch {
    // 落到下面统一返回 undefined
  }
  return undefined
}

/** 并行下载的分片数。浏览器对同一主机的并发连接有限制，4 是稳妥值。 */
const CHUNK_CONCURRENCY = 4
/** 单个分片的超时。没有它，一条卡住的连接会让整个下载永远停在原地。 */
const CHUNK_TIMEOUT_MS = 30_000
/** 单个分片的重试次数，每次换一个节点。 */
const CHUNK_RETRIES = 3
/** 分片大小。 */
const CHUNK_SIZE = 4 * 1024 * 1024
/** 测速时每个节点取多少字节。 */
const PROBE_BYTES = 1024 * 1024

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
  })
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function fetchRangeWithRetry(urls: string[], start: number, end: number, attempt = 0): Promise<Uint8Array> {
  try {
    return await fetchRange(urls[attempt % urls.length], start, end)
  }
  catch (error) {
    if (attempt + 1 >= CHUNK_RETRIES)
      throw error
    return fetchRangeWithRetry(urls, start, end, attempt + 1)
  }
}

/**
 * 实测各节点速度，按从快到慢返回。
 *
 * 这是最影响体感的一步：实测同一个视频的主链与备用链速度能差好几倍（0.7MB/s 到 8.5MB/s），
 * 选错节点就是多等几分钟，而并行下载本身只有 1.5× 左右的收益。各节点并行探测，总耗时取决于
 * 最慢的那个，通常一两秒。
 */
async function rankUrlsBySpeed(urls: string[]): Promise<string[]> {
  const probed = await Promise.all(urls.map(async (url) => {
    const started = performance.now()
    try {
      const res = await fetch(url, {
        headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)
      const data = await res.arrayBuffer()
      const seconds = Math.max((performance.now() - started) / 1000, 0.001)
      return { url, speed: data.byteLength / seconds }
    }
    catch {
      return { url, speed: -1 }
    }
  }))

  return probed.sort((a, b) => b.speed - a.speed).map(item => item.url)
}

/** 服务器不支持分段时的退路：单连接顺序读取。 */
async function fetchSequential(urls: string[], onFraction?: (fraction: number) => void): Promise<Blob> {
  let lastError: unknown

  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)

      const total = Number(res.headers.get('content-length')) || 0
      const reader = res.body?.getReader()
      if (!reader)
        return await res.blob()

      const chunks: Uint8Array[] = []
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done)
          break
        chunks.push(value)
        loaded += value.length
        onFraction?.(total > 0 ? loaded / total : 0)
      }
      return new Blob(chunks as BlobPart[], { type: 'video/mp4' })
    }
    catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('no-stream')
}

/**
 * 取回一条流。先测速选最快的节点，再按 Range 切片并行下载；任一环节不支持就退回单连接。
 */
async function fetchStream(urls: string[], onFraction?: (fraction: number) => void): Promise<Uint8Array> {
  const rankedUrls = await rankUrlsBySpeed(urls)

  let probe: Response | undefined
  for (const url of rankedUrls) {
    try {
      const res = await fetch(url, {
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      })
      if (res.ok) {
        probe = res
        break
      }
    }
    catch {
      // 换下一个节点探
    }
  }

  if (!probe) {
    const blobOnly = await fetchSequential(rankedUrls, onFraction)
    return new Uint8Array(await blobOnly.arrayBuffer())
  }

  // Content-Range 形如 `bytes 0-0/12345678`，斜杠后面是总大小
  const total = Number((probe.headers.get('content-range') || '').split('/')[1]) || 0

  if (probe.status !== 206 || !total) {
    const blobOnly = await fetchSequential(rankedUrls, onFraction)
    return new Uint8Array(await blobOnly.arrayBuffer())
  }

  const ranges: [number, number][] = []
  for (let start = 0; start < total; start += CHUNK_SIZE)
    ranges.push([start, Math.min(start + CHUNK_SIZE - 1, total - 1)])

  const parts: Uint8Array[] = Array.from({ length: ranges.length })
  let loaded = 0
  let next = 0
  onFraction?.(0)

  const worker = async () => {
    for (;;) {
      const index = next++
      if (index >= ranges.length)
        return
      const [start, end] = ranges[index]
      const data = await fetchRangeWithRetry(rankedUrls, start, end)
      parts[index] = data
      loaded += data.byteLength
      onFraction?.(loaded / total)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, ranges.length) }, () => worker()))

  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/** 一次下载要拉哪些流。 */
type DownloadPlan =
  | { kind: 'dash', video: string[], audio: string[] }
  | { kind: 'merged', urls: string[] }

/** 画质编号对应的名字。用 ASCII，避免再往 4 个语言文件里加 11 个键。 */
const QUALITY_NAMES: Record<number, string> = {
  127: '8K',
  126: 'Dolby Vision',
  125: 'HDR',
  120: '4K',
  116: '1080P60',
  112: '1080P+',
  80: '1080P',
  74: '720P60',
  64: '720P',
  32: '480P',
  16: '360P',
}

export interface DownloadQuality {
  /** DASH 里的 video id，也就是 B 站的画质编号；`'merged'` 表示已合流的单文件 mp4 */
  qualityId: number | 'merged'
  /** 编码，取 codecs 的前缀：avc1 / hev1 / av01；已合流的单文件是 `'merged'` */
  codec: string
  name: string
  width?: number
  height?: number
  sizeBytes?: number
}

/**
 * 把地址规整成 https。
 *
 * B 站部分接口返回的封面/流地址是 `http://` 开头的。这类资源在 HTTPS 页面上用 `<img>` 能正常
 * 显示（浏览器会把混合内容请求自动升级到 HTTPS），但 `fetch()` **不会**自动升级，会被直接拦下，
 * 报 "Mixed Content ... has been blocked"。所以下载前统一补上 https。
 * 协议相对地址（`//host/...`）也一并处理。
 */
function toHttps(url: string): string {
  if (url.startsWith('//'))
    return `https:${url}`
  return url.replace(/^http:\/\//i, 'https://')
}

function dashUrls(entry: any): string[] {
  return [entry?.baseUrl || entry?.base_url, ...(entry?.backupUrl || entry?.backup_url || [])]
    .filter(Boolean)
    .map((url: string) => toHttps(url))
}

/**
 * 从同一画质的多个编码里挑一个能播的。
 *
 * B 站同一个画质会给 avc1(H.264) / hev1(H.265) / av01(AV1) 几种，优先取 avc1——
 * H.265 在 Chrome 上很多平台解不了，选错编码下载下来的文件会播不动。
 */
function pickPlayable(entries: any[]): any | undefined {
  if (!entries?.length)
    return undefined
  return entries.find(entry => String(entry.codecs || '').startsWith('avc1')) || entries[0]
}

/**
 * 查这个视频有哪些画质可选。
 *
 * 只有 DASH 才有 1080p 及以上（已合流的单文件 mp4 被 B 站限制在 720p），所以这里列的是 DASH
 * 里的视频轨；DASH 拿不到时退而提供已合流的那一档，保证任何视频都有的下。
 */
export async function fetchDownloadQualities(video: Video): Promise<DownloadQuality[]> {
  if (!video.bvid)
    throw new Error('missing-bvid')

  const cid = await ensureCid(video)

  try {
    const res: any = await api.video.getVideoPreview({ bvid: video.bvid, cid, qn: 120, fnver: 0, fnval: 4048 })
    const dash = res?.data?.dash
    if (res?.code === 0 && dash?.video?.length) {
      // 同一个画质 B 站会给出多种编码（avc1 / hev1 / av01），数组里因此有重复项。
      // 按画质去重，并优先保留 avc1——hev1 是 H.265，Chrome 在不少平台上解不了，
      // 选到它下载下来的文件会播不动。
      // 同一画质的不同编码都保留——交由界面让用户挑
      const options: DownloadQuality[] = dash.video
        .map((entry: any) => ({
          qualityId: entry.id,
          codec: String(entry.codecs || '').split('.')[0] || 'unknown',
          name: QUALITY_NAMES[entry.id] || `Q${entry.id}`,
          width: entry.width,
          height: entry.height,
          sizeBytes: entry.size,
        }))
        .sort((a: DownloadQuality, b: DownloadQuality) => (b.qualityId as number) - (a.qualityId as number))
      if (options.length)
        return options
    }
  }
  catch {
    // 落到已合流
  }

  return [{ qualityId: 'merged', codec: 'merged', name: '720P (MP4)' }]
}

/**
 * 决定下载哪条流。
 *
 * 首选 DASH：B 站对「已合流的单文件 mp4」（`fnval=1`）只提供到 720p，1080p 及以上只存在于
 * DASH 里（音视频分离，需要本地合流，见 `mp4Mux.ts`）。所以先请求 DASH，挑最高画质；拿不到
 * 或者合流失败时再退回已合流的 720p。
 */
async function planDownload(video: Video, qualityId?: number | 'merged', codec?: string): Promise<DownloadPlan> {
  if (!video.bvid)
    throw new Error('missing-bvid')

  const cid = await ensureCid(video)

  // 用户明确选了「已合流」就直接走那条路，不必再请求 DASH
  if (qualityId !== 'merged') {
    try {
      const res: any = await api.video.getVideoPreview({
        bvid: video.bvid,
        cid,
        qn: 120,
        fnver: 0,
        fnval: 4048,
      })
      const dash = res?.data?.dash
      if (res?.code === 0 && dash?.video?.length && dash?.audio?.length) {
        // 指定了画质就用它；没指定、或该画质已不可用时退回最高的
        const highestId = Math.max(...dash.video.map((entry: any) => entry.id || 0))
        const targetId = qualityId !== undefined ? qualityId : highestId
        const sameQuality = dash.video.filter((entry: any) => entry.id === targetId)
        // 用户指定了编码就按它找，找不到再退回该画质下能播的那条
        const wanted = codec
          ? sameQuality.find((entry: any) => String(entry.codecs || '').startsWith(codec))
          : undefined
        const chosenVideo = wanted
          || pickPlayable(sameQuality)
          || pickPlayable(dash.video.filter((entry: any) => entry.id === highestId))
        const bestAudio = [...dash.audio].sort((a: any, b: any) => (b.bandwidth || 0) - (a.bandwidth || 0))[0]
        const videoUrls = dashUrls(chosenVideo)
        const audioUrls = dashUrls(bestAudio)
        if (videoUrls.length && audioUrls.length)
          return { kind: 'dash', video: videoUrls, audio: audioUrls }
      }
    }
    catch {
      // 落到已合流
    }
  }

  const res: VideoPreviewResult = await api.video.getVideoPreview({ bvid: video.bvid, cid, qn: 80 })
  if (res.code !== 0 || !res.data)
    throw new Error(res.message || 'playurl-failed')

  const durl = res.data.durl
  if (!durl?.length)
    throw new Error('no-stream')

  if (durl.length > 1)
    throw new Error('segmented-video')

  return {
    kind: 'merged',
    urls: [durl[0].url, ...(durl[0].backup_url ?? [])].filter(Boolean).map(toHttps),
  }
}

/**
 * 在页面里取回整个视频并交给浏览器保存。
 *
 * 必须由内容脚本发起：B 站 CDN 会校验 Referer，而只有页面上下文发出的请求才天然带着站点
 * Referer（`downloads.download` 补不上，`Referer` 是禁止修改的请求头，DNR 也管不到下载）。
 * 配上 manifest 里的 `host_permissions`，这些 fetch 也不受 CORS 限制。
 */
async function fetchAndSave(
  plan: DownloadPlan,
  filename: string,
  onFraction?: (fraction: number) => void,
): Promise<void> {
  let blob: Blob

  if (plan.kind === 'merged') {
    const buffer = await fetchStream(plan.urls, onFraction)
    blob = new Blob([buffer as BlobPart], { type: 'video/mp4' })
  }
  else {
    // 视频占绝大部分体积，进度按 85% / 15% 分摊到两条流上
    const video = await fetchStream(plan.video, f => onFraction?.(f * 0.85))
    const audio = await fetchStream(plan.audio, f => onFraction?.(0.85 + f * 0.15))
    blob = muxFragmentedMp4(video, audio)
  }

  saveBlob(blob, filename)
}

/** 把 Blob 交给浏览器下载。 */
function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 交给浏览器之后再释放
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

/**
 * 下载视频封面。
 *
 * 卡片上的 `cover` 是缩略图，地址形如 `.../xxx.jpg@672w_378h_1c.webp`——**去掉 `@` 之后的部分
 * 就是原图**（实测与 `web-interface/view` 返回的 `pic` 一致）。封面在 `*.hdslb.com` 上，该域
 * 已在 host_permissions 里，所以这里的 fetch 不受 CORS 限制。
 */
export async function downloadVideoCover(video: Pick<Video, 'cover' | 'title' | 'bvid' | 'id'>): Promise<void> {
  if (!video.cover)
    throw new Error('no-cover')

  const url = toHttps(video.cover.replace(/@.*$/, ''))
  const res = await fetch(url)
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)

  const blob = await res.blob()
  const ext = url.match(/\.(jpe?g|png|webp|gif)(?:[?#]|$)/i)?.[1]?.toLowerCase() || 'jpg'
  const base = sanitizeFilename(video.title, String(video.bvid || video.id)).replace(/\.mp4$/i, '')
  saveBlob(blob, `${base}_cover.${ext}`)
}

/** 队列里等待中的任务 */
const pendingTasks: (() => Promise<void>)[] = []
/** 正在下载的 bvid，用来防止同一个视频被重复点 */
const activeIds = new Set<string>()
let draining = false

async function drainQueue() {
  if (draining)
    return
  draining = true
  try {
    while (pendingTasks.length) {
      const task = pendingTasks.shift()!
      try {
        await task()
      }
      catch {
        // 单个任务失败不影响后面的任务，错误由各自的回调处理
      }
    }
  }
  finally {
    draining = false
  }
}

/**
 * 排队下载一个视频。
 *
 * 串行执行是刻意为之：同时下多个视频时，任意时刻内存里只会驻留一份视频的数据，不会因为任务数
 * 变多而线性吃掉内存。同一个视频重复点击会被忽略。
 *
 * @returns `'started'` 表示已入队，`'duplicate'` 表示同一个视频正在下载
 */
export function enqueueVideoDownload(
  video: Video,
  callbacks: {
    /** 画质编号（DASH 的 video id），或 `'merged'` 表示已合流的单文件；不传则取最高画质 */
    qualityId?: number | 'merged'
    /** 编码前缀（avc1 / hev1 / av01）；不传则优先挑 avc1 */
    codec?: string
    onProgress?: (fraction: number) => void
    onFinish?: () => void
    onError?: (error: unknown) => void
  } = {},
): 'started' | 'duplicate' {
  const id = video.bvid || String(video.id)
  if (activeIds.has(id))
    return 'duplicate'

  activeIds.add(id)
  pendingTasks.push(async () => {
    try {
      const plan = await planDownload(video, callbacks.qualityId, callbacks.codec)
      await fetchAndSave(
        plan,
        sanitizeFilename(video.title, String(video.bvid || video.id)),
        callbacks.onProgress,
      )
      callbacks.onFinish?.()
    }
    catch (error) {
      callbacks.onError?.(error)
    }
    finally {
      activeIds.delete(id)
    }
  })
  void drainQueue()

  return 'started'
}
