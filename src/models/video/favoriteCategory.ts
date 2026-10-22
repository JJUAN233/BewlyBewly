export interface FavoritesCategoryResult {
  code: number
  message: string
  ttl: number
  data: Data
}

export interface Data {
  count: number
  list: List[]
  season: null
}

export interface List {
  id: number
  fid: number
  mid: number
  /** bit0: 0=公开 1=私密; bit1(值2): 0=默认收藏夹 1=其他收藏夹（实测：默认=0，其他如 22/54） */
  attr: number
  title: string
  fav_state: number
  media_count: number
  /** list-all 接口会带封面和简介，模型原先没声明，收藏夹卡片要用 */
  cover?: string
  cover_url?: string
  intro?: string
}
