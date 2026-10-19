import md5 from 'md5'

/**
 * WBI signing for Bilibili's web APIs.
 * https://socialsisteryi.github.io/bilibili-API-collect/docs/misc/sign/wbi.html
 *
 * Some endpoints are only served when the request carries a `wts`/`w_rid` pair; without it
 * Bilibili's risk control answers 412 with an HTML page instead of JSON, which is what made the
 * homepage feed come back as `Unexpected token '<'`.
 */

// The order the image and sub keys are mixed in (see the WBI spec)
const mixinKeyEncTab = '46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52'.split(',').map(Number)

let cachedWbiKeys: { mixinKey: string, fetchedAt: number } | null = null
const WBI_KEYS_TTL = 6 * 60 * 60 * 1000

function pickKeyFromUrl(keyUrl: string): string {
  return keyUrl.split('/').pop()?.split('.')[0] ?? ''
}

async function getMixinKey(): Promise<string> {
  if (cachedWbiKeys && Date.now() - cachedWbiKeys.fetchedAt < WBI_KEYS_TTL)
    return cachedWbiKeys.mixinKey

  const res = await fetch('https://api.bilibili.com/x/web-interface/nav')
  const json = await res.json()
  const imgKey = pickKeyFromUrl(json?.data?.wbi_img?.img_url ?? '')
  const subKey = pickKeyFromUrl(json?.data?.wbi_img?.sub_url ?? '')

  const raw = imgKey + subKey
  const mixinKey = mixinKeyEncTab.map(i => raw[i] ?? '').join('').slice(0, 32)

  cachedWbiKeys = { mixinKey, fetchedAt: Date.now() }
  return mixinKey
}

/**
 * Adds `wts` and `w_rid` to a set of query parameters, as Bilibili expects them.
 */
export async function signWbiParams(params: Record<string, any>): Promise<Record<string, any>> {
  const mixinKey = await getMixinKey()
  const wts = Math.floor(Date.now() / 1000)
  const signedParams: Record<string, any> = { ...params, wts }

  const query = Object.keys(signedParams)
    .sort()
    .map((key) => {
      const value = String(signedParams[key] ?? '').replace(/[!'()*]/g, '')
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')

  return { ...signedParams, w_rid: md5(query + mixinKey) }
}
