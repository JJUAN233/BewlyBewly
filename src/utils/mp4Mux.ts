/**
 * 把 B 站 DASH 的视频轨与音频轨合成一个可播放的 mp4。
 *
 * 为什么不引第三方合流库：B 站的两条 DASH 流都是**分片 mp4**，顶层结构是
 * `ftyp + moov + sidx + (moof + mdat) × N`，而且分片里的数据偏移是相对于各自 `moof` 的。
 * 所以不需要把样本重新封装一遍，只要：
 *
 *   1. 用视频的 `ftyp`；
 *   2. 拼一个新 `moov`：视频的 `mvhd` + 视频 `trak` + 音频 `trak` + 合并后的 `mvex`；
 *   3. 丢掉 `sidx`（那是给 DASH 在线播放做索引用的，本地文件不需要，留着反而与内容不符）；
 *   4. 直接顺序拼接两边的 `moof` / `mdat`。
 *
 * 唯一的坑是两条轨的 track_ID 都是 1，撞车了——所以把音频轨整体重新编号为 2：
 * `tkhd.track_ID`、`mvex` 里的 `trex.track_ID`，以及**每一个音频分片内部 `traf` 的
 * `tfhd.track_ID`**。漏掉分片里的那处，播放器就会把音频分片当成视频轨的数据。
 */

interface RawBox {
  type: string
  /** 相对传入的 Uint8Array 起点的偏移 */
  start: number
  size: number
  /** box 头长度，8 或 16 */
  hdr: number
}

function walkBoxes(buf: Uint8Array, from: number, to: number): RawBox[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: RawBox[] = []
  let offset = from

  while (offset + 8 <= to) {
    let size = view.getUint32(offset)
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7])
    let hdr = 8

    if (size === 1) {
      size = Number(view.getBigUint64(offset + 8))
      hdr = 16
    }
    else if (size === 0) {
      size = to - offset
    }

    // 结构不对就停下，避免把垃圾数据当成 box
    if (size < 8 || offset + size > to)
      break

    out.push({ type, start: offset, size, hdr })
    offset += size
  }

  return out
}

function sliceOf(buf: Uint8Array, box: RawBox): Uint8Array {
  return buf.subarray(box.start, box.start + box.size)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/** 组装一个只含 length + type 的容器 box。 */
function makeBox(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength)
  new DataView(out.buffer).setUint32(0, out.byteLength)
  for (let i = 0; i < 4; i++)
    out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  return out
}

function writeUint32At(buf: Uint8Array, offset: number, value: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(offset, value)
}

/** `tkhd` 里 track_ID 的位置：8 字节头 + 4 字节 version/flags + 时间戳（v1 是 16 字节，v0 是 8 字节） */
function tkhdTrackIdOffset(tkhd: Uint8Array): number {
  const version = tkhd[8]
  return 8 + 4 + (version === 1 ? 16 : 8)
}

export function muxFragmentedMp4(video: Uint8Array, audio: Uint8Array): Blob {
  const AUDIO_TRACK_ID = 2

  const videoTop = walkBoxes(video, 0, video.byteLength)
  const audioTop = walkBoxes(audio, 0, audio.byteLength)

  const ftyp = videoTop.find(b => b.type === 'ftyp')
  const videoMoov = videoTop.find(b => b.type === 'moov')
  const audioMoov = audioTop.find(b => b.type === 'moov')

  if (!ftyp || !videoMoov || !audioMoov)
    throw new Error('mux-unsupported-stream')

  const videoMoovKids = walkBoxes(video, videoMoov.start + videoMoov.hdr, videoMoov.start + videoMoov.size)
  const audioMoovKids = walkBoxes(audio, audioMoov.start + audioMoov.hdr, audioMoov.start + audioMoov.size)

  const mvhd = videoMoovKids.find(b => b.type === 'mvhd')
  const videoTrak = videoMoovKids.find(b => b.type === 'trak')
  const videoMvex = videoMoovKids.find(b => b.type === 'mvex')
  const audioTrak = audioMoovKids.find(b => b.type === 'trak')
  const audioMvex = audioMoovKids.find(b => b.type === 'mvex')

  if (!mvhd || !videoTrak || !videoMvex || !audioTrak || !audioMvex)
    throw new Error('mux-unsupported-stream')

  // 视频轨沿用 id 1，音频轨改成 2。tkhd 是 moov 直属子 box，可以直接定位。
  const audioTrakBox = walkBoxes(audio, audioTrak.start + audioTrak.hdr, audioTrak.start + audioTrak.size)
  const audioTkhd = audioTrakBox.find(b => b.type === 'tkhd')
  if (!audioTkhd)
    throw new Error('mux-unsupported-stream')

  const audioTrakBytes = sliceOf(audio, audioTrak)
  const tkhdInTrakOffset = audioTkhd.start - audioTrak.start
  const tkhdBytes = audioTrakBytes.subarray(tkhdInTrakOffset)
  writeUint32At(audioTrakBytes, tkhdInTrakOffset + tkhdTrackIdOffset(tkhdBytes), AUDIO_TRACK_ID)

  // mvex：保留视频的 mehd 与 trex，再加上改过号的音频 trex
  const trexOf = (buf: Uint8Array, mvex: RawBox) =>
    walkBoxes(buf, mvex.start + mvex.hdr, mvex.start + mvex.size).filter(b => b.type === 'trex')

  const videoTrex = trexOf(video, videoMvex)
  const audioTrex = trexOf(audio, audioMvex).map((box) => {
    const copy = sliceOf(audio, box)
    writeUint32At(copy, 12, AUDIO_TRACK_ID)
    return copy
  })
  if (!videoTrex.length || !audioTrex.length)
    throw new Error('mux-unsupported-stream')

  const videoMvexBytes = sliceOf(video, videoMvex)
  const mvexPayload = concat([
    // 视频 mvex 的 payload 里含 mehd + trex，直接复用
    videoMvexBytes.subarray(videoMvex.hdr),
    ...audioTrex,
  ])

  const moov = makeBox('moov', concat([
    sliceOf(video, mvhd),
    sliceOf(video, videoTrak),
    audioTrakBytes,
    makeBox('mvex', mvexPayload),
  ]))

  // 音频分片：每个 moof → traf → tfhd 的 track_ID 都要跟着改
  const fragments: Uint8Array[] = []
  for (const box of videoTop) {
    if (box.type === 'moof' || box.type === 'mdat')
      fragments.push(sliceOf(video, box))
  }
  for (const box of audioTop) {
    if (box.type !== 'moof' && box.type !== 'mdat')
      continue

    const bytes = sliceOf(audio, box)
    if (box.type === 'moof') {
      const traf = walkBoxes(audio, box.start + box.hdr, box.start + box.size).find(b => b.type === 'traf')
      const tfhd = traf
        ? walkBoxes(audio, traf.start + traf.hdr, traf.start + traf.size).find(b => b.type === 'tfhd')
        : undefined
      if (tfhd)
        writeUint32At(bytes, tfhd.start - box.start + 12, AUDIO_TRACK_ID)
    }
    fragments.push(bytes)
  }

  return new Blob([
    sliceOf(video, ftyp) as BlobPart,
    moov as BlobPart,
    ...fragments as BlobPart[],
  ], { type: 'video/mp4' })
}
