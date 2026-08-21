/**
 * 网络工具箱（一体化）
 *
 * 版本：v1.4.0
 *
 * 合并三个插件的能力，一个面板搞定：
 *   1. 「🚀 体检」—— 来自 plugin-network-info：四类出口（国内/国外/Cloudflare/X.com）+ 8 个网站延迟
 *   2. 「📶 测速」—— 来自 plugin-batch-download-speed：延迟预检 + 真实下载测速排序 + 国外出口 + 历史 + 一键使用
 *   3. 「🇺🇸 美国出口」—— 来自 plugin-openai-us-egress：ProxyIP 改写美国节点 + 一键生成/清除 AI/测速分流配置 + 出口验证
 *
 * 数据统一存放在 data/plugin-data/network-toolbox/ 下。
 */

/* ============================================================
 * 常量
 * ============================================================ */

const DATA_DIR = 'data/plugin-data/network-toolbox'
const SETTINGS_PATH = `${DATA_DIR}/settings.json`
const SPEED_RESULTS_PATH = `${DATA_DIR}/speed-results.json`
const EGRESS_HISTORY_PATH = `${DATA_DIR}/egress-history.json`

const PROFILES_PATH = 'data/profiles.yaml'
const PROFILES_BAK_SUFFIX = '.bak-plugin'
const CLASH_API_SINGBOX_PORT = '20123'
const CLASH_API_CLASH_PORT = '20113'
const PROXYIP_PATH_FORMAT = (host) => `/proxyip=${host}?globalproxy`

const NETWORK_SOURCES = [
  { key: 'domestic', title: '国内出口', source: 'speedtest.cn' },
  { key: 'overseas', title: '国外出口', source: 'cmliussss API' },
  { key: 'cloudflare', title: 'Cloudflare', source: '090227 API' },
  { key: 'twitter', title: 'X.com', source: 'Cloudflare trace' }
]

const SITES = [
  ['字节跳动', '国内', 'https://lf3-zlink-tos.ugurl.cn/obj/zebra-public/resource_lmmizj_1632398893.png'],
  ['Bilibili', '国内', 'https://i0.hdslb.com/bfs/face/member/noface.jpg@24w_24h_1c'],
  ['微信', '国内', 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico'],
  ['淘宝', '国内', 'https://img.alicdn.com/imgextra/i2/O1CN01qnQCrN1VkzAWiU4Hs_!!6000000002692-2-tps-33-33.png'],
  ['GitHub', '国际', 'https://github.github.io/janky/images/bg_hr.png'],
  ['jsDelivr', '国际', 'https://cdn.jsdelivr.net/npm/latency-test@1.0.1/smallest-possible-white.gif'],
  ['Cloudflare', '国际', 'https://www.cloudflare.com/favicon.ico'],
  ['YouTube', '国际', 'https://www.youtube.com/favicon.ico']
].map(([name, region, url]) => ({ name, region, url }))

const OVERSEAS_SOURCES = [
  [
    'cmliussss API',
    'https://api.cmliussss.net/api/ipinfo',
    (body) => {
      if (!body?.ip) throw new Error('返回格式异常')
      return { ip: body.ip, place: `${body.country_code || ''} AS${body.asn || ''} ${body.as_name || ''}`, country: body.country_code || '' }
    }
  ],
  [
    'ipinfo.io',
    'https://ipinfo.io/json',
    (body) => {
      if (!body?.ip) throw new Error('返回格式异常')
      return { ip: body.ip, place: `${body.country || ''} ${body.org || ''}`, country: body.country || '' }
    }
  ],
  [
    'ipapi.co',
    'https://ipapi.co/json/',
    (body) => {
      if (!body?.ip) throw new Error('返回格式异常')
      return {
        ip: body.ip,
        place: `${body.country_code || body.country_name || ''} ${body.org || (body.asn ? `AS${body.asn}` : '')}`,
        country: body.country_code || body.country_name || ''
      }
    }
  ]
]

const PRESET_URLS = [
  { label: '🇭🇰 香港', value: 'http://hkg.download.datapacket.com/100mb.bin' },
  { label: '🇸🇬 新加坡', value: 'http://sgp.download.datapacket.com/100mb.bin' },
  { label: '🇯🇵 日本', value: 'http://tyo.download.datapacket.com/100mb.bin' },
  { label: '🇺🇸 美西', value: 'http://lax.download.datapacket.com/100mb.bin' },
  { label: '🇺🇸 美东', value: 'http://ash.download.datapacket.com/100mb.bin' }
]

const PROXYIP_OPTIONS = [
  { label: 'SG', value: 'ProxyIP.SG.CMLiussss.net' },
  { label: 'JP', value: 'ProxyIP.JP.CMLiussss.net' },
  { label: 'TW', value: 'tw.william.us.ci' },
  { label: 'US', value: 'ProxyIP.US.CMLiussss.net' },
  { label: 'CA', value: 'ProxyIP.CA.CMLiussss.net' }
]
const DEFAULT_PROXYIP_HOST = 'ProxyIP.US.CMLiussss.net'
const GROUP_TAG = '🇺🇸 AI出口'
const SPEED_GROUP_TAG = '⚡ 测速专用'
const OPENCODE_GROUP_TAG = '🤖 OpenCode'
const SPEED_RULESET_NAME = '下载测速分流'
const SPEED_DOMAINS = ['datapacket.com', 'ipinfo.io', 'ipapi.co', 'cmliussss.net', 'api.ip.sb']
const OPENCODE_DOMAINS = ['opencode.ai']
const OPENAI_GEOSITE_URL = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/openai.json'
const ANTHROPIC_GEOSITE_URL = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/anthropic.json'
const META_GEOSITE_URL = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/meta.json'

const genId = () => 'ID_' + Math.random().toString(36).slice(2, 10)

/* ============================================================
 * 纯工具函数
 * ============================================================ */

const createProxyUrl = (endpoint) => {
  if (!endpoint?.host || !endpoint?.port) throw new Error('没有可用的本地代理入站')
  const host = String(endpoint.host).includes(':') && !String(endpoint.host).startsWith('[') ? `[${endpoint.host}]` : endpoint.host
  const auth = endpoint.username ? `${encodeURIComponent(endpoint.username)}:${encodeURIComponent(endpoint.password || '')}@` : ''
  return `${endpoint.schema || endpoint.proxyType || 'http'}://${auth}${host}:${endpoint.port}`
}

const errorText = (error) =>
  String(error?.message || error || '未知错误')
    .replace(/^Error:\s*/, '')
    .slice(0, 240)

const parseTrace = (body) =>
  Object.fromEntries(
    String(body || '')
      .split(/\r?\n/)
      .map((line) => line.split('=').map((part) => part.trim()))
      .filter(([key, value]) => key && value)
  )

const cacheBust = (url) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`

const latencyClass = (value) => {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms < 0) return 'text-red-500'
  if (ms < 200) return 'text-green-500'
  if (ms < 500) return 'text-orange-500'
  return 'text-red-500'
}

const formatDelay = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? `${Math.round(Number(value))} ms` : '—')

/** 读取 data/profiles.yaml 并定位当前 activeProfile，返回原始文本、解析后的文档与 profile 对象。 */
const getActiveProfile = async () => {
  const raw = await Plugins.ReadFile(PROFILES_PATH)
  if (!raw) throw new Error('未找到 profiles.yaml，请先创建 profile')
  const doc = Plugins.YAML.parse(raw)
  const activeProfileId = Plugins.useAppSettingsStore?.()?.app?.kernel?.profile
  const profile = Array.isArray(doc) ? doc.find((item) => item?.id === activeProfileId) : doc
  if (!profile || !Array.isArray(profile.outbounds)) throw new Error('未找到当前 profile 或 profiles.yaml 结构异常')
  return { raw, doc, profile }
}

/** 统一构造测速结果行：必填 name/groupName/testUrl/status/delay，可选 speed 与展示字段。 */
const buildResultRow = ({ name, groupName, testUrl, status, delay, speed, mb = '—', mbps = '—', bytesText = '—', time = '—', error = '', ...extra }) => ({
  key: resultKeyOf({ name, groupName }),
  name,
  groupName,
  testUrl,
  testedAt: new Date().toISOString(),
  status,
  delay,
  speed: speed === undefined ? null : speed,
  mb,
  mbps,
  bytesText,
  time,
  error,
  ...extra
})

/* ============================================================
 * 网络体检（网络信息）
 * ============================================================ */

const createRun = (proxy) => ({ proxy, generation: Date.now() + Math.random(), cancelled: false, ids: new Set() })

const cancelRun = (run) => {
  if (!run) return
  run.cancelled = true
  let failed = 0
  run.ids.forEach((id) => {
    try {
      Plugins.HttpCancel(id)
    } catch {
      failed += 1
    }
  })
  run.ids.clear()
  if (failed) Plugins.message.warn(`取消网络请求时有 ${failed} 个请求取消失败（请求可能已完成）`)
}

const networkRequest = async (run, url, autoTransformBody = true) => {
  if (run.cancelled) throw new Error('检测已取消')
  const id = `toolbox-check-${Plugins.sampleID()}`
  run.ids.add(id)
  const started = performance.now()
  try {
    const response = await Plugins.Requests({ method: 'GET', url: cacheBust(url), autoTransformBody, options: { Proxy: run.proxy, Timeout: 10, CancelId: id } })
    if (response.status < 200 || response.status >= 400) throw new Error(`HTTP ${response.status}`)
    return { ...response, elapsed: performance.now() - started }
  } finally {
    run.ids.delete(id)
  }
}

const networkDomesticInfo = async (run) => {
  const sources = [
    [
      'speedtest.cn',
      'https://api-v3.speedtest.cn/ip',
      (body) => {
        if (body?.code !== 0 || !body.data) throw new Error('返回格式异常')
        return { ip: body.data.ip, place: `${body.data.country || ''} ${body.data.city || ''}` }
      }
    ],
    ['ipipv.com', 'https://myip.ipipv.com/', (body) => ({ ip: body.Ip, place: `${body.Country || ''} ${body.City || ''}` })],
    [
      'ipip.net',
      'https://myip.ipip.net/json',
      (body) => {
        if (body?.ret !== 'ok' || !body.data) throw new Error('返回格式异常')
        return { ip: body.data.ip, place: `${body.data.location?.[0] || ''} ${body.data.location?.[2] || ''}` }
      }
    ]
  ]
  let last
  for (const [source, url, parse] of sources) {
    if (run.cancelled) throw new Error('检测已取消')
    try {
      const response = await networkRequest(run, url)
      const result = parse(response.body)
      return { ...result, source, elapsed: response.elapsed }
    } catch (error) {
      last = error
    }
  }
  throw last || new Error('国内出口检测失败')
}

const networkOverseasInfo = async (run) => {
  let last
  for (const [source, url, parse] of OVERSEAS_SOURCES) {
    if (run.cancelled) throw new Error('检测已取消')
    try {
      const response = await networkRequest(run, url)
      const result = parse(response.body)
      return { ...result, source, elapsed: response.elapsed }
    } catch (error) {
      last = error
    }
  }
  throw last || new Error('国外出口检测失败')
}

const networkCloudflareInfo = async (run) => {
  const response = await networkRequest(run, 'https://cf.090227.xyz/ip.json')
  return { ip: response.body.ip, place: `${response.body.country || ''} ${response.body.org || ''}`, source: 'cf.090227.xyz', elapsed: response.elapsed }
}

const networkXTraceInfo = async (run) => {
  const response = await networkRequest(run, 'https://help.x.com/cdn-cgi/trace', false)
  const data = parseTrace(response.body)
  return { ip: data.ip, place: `${data.loc || ''} ${data.colo || ''}`, source: 'X.com trace', elapsed: response.elapsed }
}

const networkInfo = async (run) => Promise.allSettled([networkDomesticInfo(run), networkOverseasInfo(run), networkCloudflareInfo(run), networkXTraceInfo(run)])

const siteLatency = async (run, site) => {
  const response = await networkRequest(run, site.url)
  return { ...site, latency: Math.round(response.elapsed), status: '成功', error: '' }
}

/* ============================================================
 * 测速（批量下载测速排序）
 * ============================================================ */

let batchRunPromise = null
let egressStop = null
let historySaveTask = Promise.resolve()

const saveSpeedResults = (payload) => {
  historySaveTask = historySaveTask.then(async () => {
    try {
      await Plugins.MakeDir(DATA_DIR)
      await Plugins.WriteFile(SPEED_RESULTS_PATH, JSON.stringify(payload, null, 2))
    } catch (error) {
      Plugins.message.warn(`保存测速历史失败：${errorText(error)}`)
    }
  })
  return historySaveTask
}

const loadSpeedResults = async () => {
  try {
    const raw = await Plugins.ReadFile(SPEED_RESULTS_PATH)
    if (!raw) return null
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!data || !Array.isArray(data.results)) return null
    data.results = data.results.map((row) => ({
      ...row,
      delay: Number.isFinite(Number(row.delay)) && Number(row.delay) > 0 ? Number(row.delay) : null,
      groupName: row.groupName || data.groupName || '',
      testUrl: row.testUrl || data.testUrl || '',
      testedAt: row.testedAt || data.savedAt || ''
    }))
    return data
  } catch {
    return null
  }
}

const getClashApiConfig = () => {
  const profilesStore = Plugins.useProfilesStore?.()
  const appSettingsStore = Plugins.useAppSettingsStore?.()
  const profileId = appSettingsStore?.app?.kernel?.profile
  const profile = profileId && profilesStore?.getProfileById ? profilesStore.getProfileById(profileId) : null
  if (!profile) throw new Error('未找到当前 profile，无法读取 Clash API 配置')
  let controller = ''
  let secret = ''
  if (String(Plugins.APP_TITLE || '').includes('SingBox')) {
    controller = profile?.experimental?.clash_api?.external_controller || `127.0.0.1:${CLASH_API_SINGBOX_PORT}`
    secret = profile?.experimental?.clash_api?.secret || ''
  } else {
    controller = profile?.advancedConfig?.['external-controller'] || `127.0.0.1:${CLASH_API_CLASH_PORT}`
    secret = profile?.advancedConfig?.secret || ''
  }
  const hostPort = String(controller || `127.0.0.1:${CLASH_API_SINGBOX_PORT}`)
    .trim()
    .replace(/^https?:\/\//i, '')
  const bracket = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/)
  let host
  let port
  if (bracket) {
    host = bracket[1]
    port = bracket[2] || CLASH_API_SINGBOX_PORT
  } else {
    const sep = hostPort.lastIndexOf(':')
    if (sep === -1) {
      host = hostPort
      port = CLASH_API_SINGBOX_PORT
    } else {
      host = hostPort.slice(0, sep)
      port = hostPort.slice(sep + 1)
    }
  }
  if (!host || !/^\d{1,5}$/.test(port)) throw new Error(`Clash API 监听地址无效：${controller}`)
  const hostPart = String(host).includes(':') ? `[${host}]` : host
  return { baseUrl: `http://${hostPart}:${port}`, secret }
}

const collectTestNodes = (api, group, limit, filter = '') => {
  const GROUP_TYPES = ['SELECTOR', 'URLTEST', 'FALLBACK', 'LOADBALANCE', 'DIRECT', 'REJECT']
  const keywords = String(filter || '')
    .trim()
    .toLowerCase()
    .split(/[\s,，]+/)
    .filter(Boolean)
  const seen = new Set()
  const nodes = []
  for (const name of group.all || []) {
    if (seen.has(name)) continue
    seen.add(name)
    const upper = String(name).toUpperCase()
    if (upper === 'DIRECT' || upper === 'REJECT') continue
    const proxy = (api.proxies || {})[name]
    if (!proxy) continue
    if (Array.isArray(proxy.all) && proxy.all.length) continue
    if (GROUP_TYPES.includes(String(proxy.type || '').toUpperCase())) continue
    if (keywords.length && !keywords.some((k) => String(name).toLowerCase().includes(k))) continue
    nodes.push(name)
  }
  return limit > 0 ? nodes.slice(0, limit) : nodes
}

const checkClashApi = async ({ baseUrl, secret, cancelIds }) => {
  const cancelId = `clash-version-${Plugins.sampleID()}`
  cancelIds.add(cancelId)
  try {
    const response = await Plugins.Requests({
      method: 'GET',
      url: `${baseUrl}/version`,
      autoTransformBody: true,
      headers: { Authorization: `Bearer ${secret}` },
      options: { Proxy: '', Timeout: 3, CancelId: cancelId }
    })
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
  } finally {
    cancelIds.delete(cancelId)
  }
}

const testProxyDelay = async ({ baseUrl, secret, node, url, maxDelay, cancelIds }) => {
  const cancelId = `precheck-${Plugins.sampleID()}`
  cancelIds.add(cancelId)
  try {
    const target = `${baseUrl}/proxies/${encodeURIComponent(node)}/delay?url=${encodeURIComponent(url)}&timeout=${maxDelay}`
    const response = await Plugins.Requests({
      method: 'GET',
      url: target,
      autoTransformBody: true,
      headers: { Authorization: `Bearer ${secret}` },
      options: { Proxy: '', Timeout: Math.ceil(maxDelay / 1000) + 2, CancelId: cancelId }
    })
    if (response.status < 200 || response.status >= 300) return { delay: 0, error: `HTTP ${response.status}` }
    const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body || {}
    const delay = Number(body.delay)
    return { delay: Number.isFinite(delay) && delay > 0 ? delay : 0, error: Number.isFinite(delay) ? '' : '响应缺少有效 delay 字段' }
  } catch (error) {
    return { delay: 0, error: errorText(error) }
  } finally {
    cancelIds.delete(cancelId)
  }
}

const runConcurrent = async ({ items, concurrency, isStopped, task }) => {
  let index = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1))
  const workers = []
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (!isStopped()) {
          const i = index
          index += 1
          if (i >= items.length) return
          await task(items[i], i)
        }
      })()
    )
  }
  await Promise.all(workers)
}

const downloadForDuration = async ({ url, path, proxy, seconds, cancelId, onProgress }) => {
  let bytes = 0
  let cancelled = false
  const started = Date.now()
  const timer = setTimeout(() => {
    cancelled = true
    try {
      Plugins.HttpCancel(cancelId)
    } catch {
      /* 取消失败可忽略：下载可能已结束 */
    }
  }, seconds * 1000)
  try {
    await Plugins.Download(
      url,
      path,
      {},
      (progress) => {
        if (Number.isFinite(Number(progress))) {
          bytes = Math.max(bytes, Number(progress))
          if (onProgress) {
            const elapsed = (Date.now() - started) / 1000
            if (elapsed > 0.05) onProgress(bytes / 1000000 / elapsed)
          }
        }
      },
      { Proxy: proxy, CancelId: cancelId, Timeout: seconds + 5 }
    )
  } catch (error) {
    if (!(cancelled && bytes > 0)) throw error
  } finally {
    clearTimeout(timer)
  }
  return { bytes, elapsed: Math.max(0.001, (Date.now() - started) / 1000) }
}

const overseasInfo = async ({ proxy, cancelIds, isStopped }) => {
  let last
  for (const [source, url, parse] of OVERSEAS_SOURCES) {
    if (isStopped()) throw new Error('检测已停止')
    const cancelId = `overseas-${Plugins.sampleID()}`
    cancelIds.add(cancelId)
    try {
      const response = await Plugins.Requests({
        method: 'GET',
        url: `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`,
        autoTransformBody: true,
        options: { Proxy: proxy, Timeout: 5, CancelId: cancelId }
      })
      if (response.status < 200 || response.status >= 400) throw new Error(`HTTP ${response.status}`)
      const result = parse(response.body)
      return { ...result, source }
    } catch (error) {
      last = error
    } finally {
      cancelIds.delete(cancelId)
    }
  }
  throw last || new Error('国外出口检测失败')
}

const resultKeyOf = (row) => (row.groupName ? `${row.groupName}::${row.name}` : row.name)

const compareResultRows = (a, b) => {
  const aOk = a.status === '成功' ? 1 : 0
  const bOk = b.status === '成功' ? 1 : 0
  if (aOk !== bOk) return bOk - aOk
  const aSpeed = Number.isFinite(Number(a.speed)) ? Number(a.speed) : -1
  const bSpeed = Number.isFinite(Number(b.speed)) ? Number(b.speed) : -1
  if (aSpeed !== bSpeed) return bSpeed - aSpeed
  const aDelay = Number.isFinite(Number(a.delay)) && Number(a.delay) > 0 ? Number(a.delay) : Number.MAX_SAFE_INTEGER
  const bDelay = Number.isFinite(Number(b.delay)) && Number(b.delay) > 0 ? Number(b.delay) : Number.MAX_SAFE_INTEGER
  if (aDelay !== bDelay) return aDelay - bDelay
  return String(a.name).localeCompare(String(b.name))
}

const runBatchTest = async ({
  api,
  groupName,
  url,
  pingUrl,
  maxDelay,
  seconds,
  concurrency,
  limit,
  downloadLimit,
  filter,
  onTotal,
  onPrecheck,
  onNode,
  onDownload,
  onResult,
  onNodeSpeed
}) => {
  if (!api.running) throw new Error('内核未运行，请先启动内核')
  const clashApi = getClashApiConfig()
  const endpoint = createProxyUrl(api.getProxyEndpoint())
  const group = (api.proxies || {})[groupName]
  if (!group || group.type !== 'Selector' || !Array.isArray(group.all)) throw new Error('策略组不存在或不是 Selector')
  const speedGroup = Object.values(api.proxies || {}).find(
    (g) => g && g.type === 'Selector' && Array.isArray(g.all) && /测速/.test(String(g.name || g.tag || '')) && (g.name || g.tag) !== groupName
  )
  const speedOriginal = speedGroup ? speedGroup.now : null
  const nodes = collectTestNodes(api, group, limit, filter)
  if (!nodes.length) throw new Error('策略组中没有有效可测速节点')
  onTotal(nodes.length)
  const original = group.now
  let stopped = false
  let downloaded = 0
  const cancelIds = new Set()
  let currentCancelId = null
  const isStopped = () => stopped
  const cancelAll = () => {
    for (const id of cancelIds) {
      try {
        Plugins.HttpCancel(id)
      } catch {
        /* 取消失败可忽略：请求可能已结束 */
      }
    }
    cancelIds.clear()
    if (currentCancelId) {
      try {
        Plugins.HttpCancel(currentCancelId)
      } catch {
        /* 取消失败可忽略：请求可能已结束 */
      }
    }
  }
  runBatchTest.stop = () => {
    stopped = true
    cancelAll()
  }
  const qualified = []
  let successCount = 0
  let failCount = 0
  try {
    await checkClashApi({ baseUrl: clashApi.baseUrl, secret: clashApi.secret, cancelIds })
    if (stopped) return { stopped, qualifiedCount: 0, downloadedCount: 0, successCount: 0, failCount: 0 }
    let done = 0
    const precheckStarted = Date.now()
    await runConcurrent({
      items: nodes,
      concurrency,
      isStopped,
      task: async (node) => {
        const result = await testProxyDelay({ baseUrl: clashApi.baseUrl, secret: clashApi.secret, node, url: pingUrl, maxDelay, cancelIds })
        if (stopped) return
        done += 1
        const perTask = Math.max(0.05, (Date.now() - precheckStarted) / 1000 / done)
        const etaSec = Math.ceil((nodes.length - done) * perTask * 1.2)
        onPrecheck(done, nodes.length, etaSec)
        if (result.delay <= 0) {
          onResult(buildResultRow({ name: node, groupName, testUrl: url, status: '延迟失败', delay: null, speed: null, error: result.error || '延迟测试失败' }))
          return
        }
        if (result.delay > maxDelay) {
          onResult(
            buildResultRow({ name: node, groupName, testUrl: url, status: '延迟过高', delay: result.delay, speed: null, error: `超过阈值 ${maxDelay}ms` })
          )
          return
        }
        onResult(buildResultRow({ name: node, groupName, testUrl: url, status: '预检通过', delay: result.delay, speed: null }))
        qualified.push({ name: node, delay: result.delay })
      }
    })
    if (stopped) return { stopped, qualifiedCount: qualified.length, downloadedCount: 0, successCount: 0, failCount: 0 }

    qualified.sort((a, b) => a.delay - b.delay)
    const selected = downloadLimit > 0 ? qualified.slice(0, downloadLimit) : qualified
    for (const item of qualified.slice(selected.length)) {
      onResult(buildResultRow({ name: item.name, groupName, testUrl: url, status: '未下载（数量限制）', delay: item.delay, speed: null }))
    }
    const downloadTarget = selected.length
    let downloadIndex = 0
    for (; downloadIndex < downloadTarget; downloadIndex++) {
      if (stopped) break
      const { name, delay } = selected[downloadIndex]
      onNode(name)
      const path = `data/.cache/toolbox-download-${Plugins.sampleID()}.bin`
      const cancelId = `batch-speed-${Plugins.sampleID()}`
      currentCancelId = cancelId
      let row
      let nodeMb = null
      try {
        const proxy = (api.proxies || {})[name]
        if (!proxy) throw new Error('找不到节点代理对象')
        await Plugins.handleUseProxy((api.proxies || {})[groupName] || group, proxy)
        if (speedGroup && speedGroup.all.includes(name)) {
          try {
            await Plugins.handleUseProxy(speedGroup, proxy)
          } catch {
            /* 测速组切换失败不影响主流程，节点仍按主组测速 */
          }
        }
        const downloadPromise = downloadForDuration({
          url,
          path,
          proxy: endpoint,
          seconds,
          cancelId,
          onProgress: (mb) => onNodeSpeed?.(name, mb, downloadIndex + 1, downloadTarget)
        })
        const overseasPromise = overseasInfo({ proxy: endpoint, cancelIds, isStopped }).catch((error) => ({ error: errorText(error) }))
        const [data, overseas] = await Promise.all([downloadPromise, overseasPromise])
        const success = !stopped
        const mb = data.bytes / 1000000 / data.elapsed
        nodeMb = mb
        row = success
          ? buildResultRow({
              name,
              groupName,
              testUrl: url,
              status: '成功',
              delay,
              speed: mb,
              mb: mb.toFixed(2),
              mbps: (mb * 8).toFixed(2),
              bytesText: `${(data.bytes / 1000000).toFixed(2)} MB`,
              time: `${data.elapsed.toFixed(2)} s`,
              overseasIp: overseas?.ip || '',
              overseasPlace: overseas?.place || '',
              overseasSource: overseas?.source || '',
              overseasError: overseas?.error || '',
              overseasCountry: overseas?.country || ''
            })
          : buildResultRow({ name, groupName, testUrl: url, status: '已停止', delay, speed: null })
      } catch (error) {
        row = buildResultRow({
          name,
          groupName,
          testUrl: url,
          status: stopped ? '已停止' : '下载失败',
          delay,
          speed: null,
          error: stopped ? '' : errorText(error)
        })
      } finally {
        try {
          Plugins.RemoveFile(path)
        } catch {
          /* 清理临时文件失败可忽略 */
        }
      }
      currentCancelId = null
      downloaded += 1
      onResult(row)
      if (row.status === '成功') successCount += 1
      else if (row.status === '下载失败') failCount += 1
      const perNodeSec = seconds + 1
      const remaining = Math.max(0, downloadTarget - downloadIndex - 1)
      onDownload(downloaded, downloadTarget, Math.ceil(remaining * perNodeSec), name, row.status === '成功' ? nodeMb : null)
    }
    if (stopped) {
      for (let j = downloadIndex; j < downloadTarget; j++) {
        const rest = selected[j]
        onResult(buildResultRow({ name: rest.name, groupName, testUrl: url, status: '已停止', delay: rest.delay, speed: null }))
      }
    }
    return { stopped, qualifiedCount: qualified.length, downloadedCount: downloaded, successCount, failCount }
  } finally {
    runBatchTest.stop = null
    try {
      const freshGroup = (api.proxies || {})[groupName] || group
      const fresh = original && (api.proxies || {})[original]
      if (fresh) await Plugins.handleUseProxy(freshGroup, fresh)
      if (speedGroup && speedOriginal) {
        const speedFresh = (api.proxies || {})[speedOriginal]
        if (speedFresh) await Plugins.handleUseProxy(speedGroup, speedFresh)
      }
    } catch (error) {
      Plugins.message.warn(`测速结束后恢复原分组节点失败：${errorText(error)}`)
    }
  }
}

/* ============================================================
 * 美国出口配置
 * ============================================================ */

const loadProxyIpSettings = async () => {
  try {
    const raw = await Plugins.ReadFile(SETTINGS_PATH)
    const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
    const proxyipHost = PROXYIP_OPTIONS.some((item) => item.value === data.proxyipHost) ? data.proxyipHost : DEFAULT_PROXYIP_HOST
    return { proxyipHost, customHost: String(data.customHost || ''), opencodeThirdId: String(data.opencodeThirdId || '') }
  } catch {
    return { proxyipHost: DEFAULT_PROXYIP_HOST, customHost: '', opencodeThirdId: '' }
  }
}

const saveProxyIpSettings = async (settings) => {
  const proxyipHost = PROXYIP_OPTIONS.some((item) => item.value === settings.proxyipHost) ? settings.proxyipHost : DEFAULT_PROXYIP_HOST
  const normalized = {
    proxyipHost,
    customHost: String(settings.customHost || '').trim(),
    opencodeThirdId: String(settings.opencodeThirdId || '').trim()
  }
  await Plugins.MakeDir(DATA_DIR)
  await Plugins.WriteFile(SETTINGS_PATH, JSON.stringify(normalized, null, 2))
  return normalized
}

const getProxyIpHost = (settings) => String(settings.customHost || '').trim() || settings.proxyipHost || DEFAULT_PROXYIP_HOST

const getProxyIpPath = (settings) => PROXYIP_PATH_FORMAT(getProxyIpHost(settings))

const ensureFullConfig = async () => {
  const created = []
  const skipped = []
  const proxyIpSettings = await loadProxyIpSettings()
  const proxyIpHost = getProxyIpHost(proxyIpSettings)
  const proxyIpPath = getProxyIpPath(proxyIpSettings)
  const { raw, doc, profile } = await getActiveProfile()

  const subscribesStore = Plugins.useSubscribesStore()
  let rewrittenUsNodes = 0
  let rewriteFailures = 0
  for (const sub of subscribesStore.subscribes || []) {
    const subPath = sub.path || sub.file
    if (!subPath) continue
    try {
      const subRaw = await Plugins.ReadFile(subPath)
      if (!subRaw) continue
      const subDoc = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw
      const proxies = Array.isArray(subDoc) ? subDoc : subDoc && Array.isArray(subDoc.outbounds) ? subDoc.outbounds : []
      let fileChanged = false
      for (const proxy of proxies) {
        if (proxy && typeof proxy.tag === 'string' && proxy.tag.includes('🇺🇸') && proxy.transport && proxy.transport.path !== proxyIpPath) {
          proxy.transport.path = proxyIpPath
          rewrittenUsNodes++
          fileChanged = true
        }
      }
      if (fileChanged) await Plugins.WriteFile(subPath, JSON.stringify(subDoc, null, 2))
    } catch {
      rewriteFailures++
    }
  }
  created.push(`美国节点改写：${rewrittenUsNodes} 个（${proxyIpHost}）`)
  if (rewriteFailures) created.push(`订阅改写失败：${rewriteFailures} 个`)

  const subRef =
    profile.outbounds.find((o) => o && o.type === 'Subscription') ||
    profile.outbounds.find((o) => o && Array.isArray(o.outbounds) && o.outbounds.some((x) => x && x.type === 'Subscription'))
  const subEntry = subRef && Array.isArray(subRef.outbounds) ? subRef.outbounds.find((x) => x && x.type === 'Subscription') : subRef
  if (!subEntry) throw new Error('没有找到订阅条目，请先添加订阅')

  let aiGroup = profile.outbounds.find((o) => o && o.tag === GROUP_TAG)
  if (!aiGroup) {
    aiGroup = {
      id: genId(),
      tag: GROUP_TAG,
      type: 'selector',
      outbounds: [{ id: subEntry.id, tag: subEntry.tag, type: 'Subscription' }],
      interrupt_exist_connections: true,
      url: 'https://www.gstatic.com/generate_204',
      interval: '3m',
      tolerance: 150,
      include: '🇺🇸|US|美',
      exclude: '',
      icon: '',
      hidden: false
    }
    profile.outbounds.push(aiGroup)
    created.push('🇺🇸 AI出口 分组')
  } else skipped.push('🇺🇸 AI出口 分组')

  let speedGroup = profile.outbounds.find((o) => o && o.tag === SPEED_GROUP_TAG)
  if (!speedGroup) {
    speedGroup = {
      id: genId(),
      tag: SPEED_GROUP_TAG,
      type: 'selector',
      outbounds: [{ id: subEntry.id, tag: subEntry.tag, type: 'Subscription' }],
      interrupt_exist_connections: true,
      url: 'https://www.gstatic.com/generate_204',
      interval: '3m',
      tolerance: 150,
      include: '',
      exclude: '',
      icon: '',
      hidden: false
    }
    profile.outbounds.push(speedGroup)
    created.push('测速专用 分组')
  } else skipped.push('测速专用 分组')

  let opencodeGroup = profile.outbounds.find((o) => o && o.tag === OPENCODE_GROUP_TAG)
  const GROUP_LIKE_TYPES = ['selector', 'urltest', 'fallback', 'loadbalance']
  const opencodeOutbounds = [
    { id: 'direct', type: 'Built-in', tag: 'direct' },
    { id: aiGroup.id, type: 'Built-in', tag: GROUP_TAG }
  ]
  const findGroupLike = (pred) =>
    profile.outbounds.find((o) => o && o.tag !== OPENCODE_GROUP_TAG && GROUP_LIKE_TYPES.includes(String(o.type || '').toLowerCase()) && pred(o))
  const thirdTarget = (() => {
    const thirdId = String(proxyIpSettings.opencodeThirdId || '').trim()
    if (thirdId) {
      const found = findGroupLike((o) => o.id === thirdId)
      if (found) return { id: found.id, type: 'Built-in', tag: found.tag }
    }
    const nodeSelector = findGroupLike((o) => String(o.tag || '').includes('节点选择'))
    if (nodeSelector) return { id: nodeSelector.id, type: 'Built-in', tag: nodeSelector.tag }
    return null
  })()
  if (thirdTarget) opencodeOutbounds.push(thirdTarget)
  const targetIdSeq = opencodeOutbounds.map((o) => o.id).join('|')
  const sameStructure = !!opencodeGroup && (opencodeGroup.outbounds || []).map((o) => o.id).join('|') === targetIdSeq
  if (!opencodeGroup) {
    if (!thirdTarget) created.push('未设置第三出口且未找到「节点选择」组，OpenCode 组仅含 直连/AI出口')
    opencodeGroup = {
      id: genId(),
      tag: OPENCODE_GROUP_TAG,
      type: 'selector',
      outbounds: opencodeOutbounds,
      interrupt_exist_connections: true,
      url: 'https://www.gstatic.com/generate_204',
      interval: '3m',
      tolerance: 150,
      include: '',
      exclude: '',
      icon: '',
      hidden: false
    }
    profile.outbounds.push(opencodeGroup)
    created.push('🤖 OpenCode 分组')
  } else if (sameStructure) skipped.push('🤖 OpenCode 分组')
  else {
    opencodeGroup.outbounds = opencodeOutbounds
    created.push('opencode 分组已修正')
  }

  const rs = Array.isArray(profile.route?.rule_set) ? profile.route.rule_set : (profile.route.rule_set = [])
  let openaiRs = rs.find((r) => r && (r.url || '').includes('openai'))
  if (!openaiRs) {
    openaiRs = {
      id: genId(),
      type: 'remote',
      tag: 'openai-geosite.json',
      format: 'source',
      url: OPENAI_GEOSITE_URL,
      download_detour: '',
      update_interval: '',
      rules: '',
      path: ''
    }
    rs.push(openaiRs)
    created.push('openai 规则集')
  } else skipped.push('openai 规则集')
  let anthropicRs = rs.find((r) => r && (r.url || '').includes('anthropic'))
  if (!anthropicRs) {
    anthropicRs = {
      id: genId(),
      type: 'remote',
      tag: 'anthropic-geosite.json',
      format: 'source',
      url: ANTHROPIC_GEOSITE_URL,
      download_detour: '',
      update_interval: '',
      rules: '',
      path: ''
    }
    rs.push(anthropicRs)
    created.push('anthropic 规则集')
  } else skipped.push('anthropic 规则集')
  let metaRs = rs.find((r) => r && (r.tag === 'meta-geosite.json' || (r.url || '').includes('geosite/meta')))
  if (!metaRs) {
    metaRs = {
      id: genId(),
      type: 'remote',
      tag: 'meta-geosite.json',
      format: 'source',
      url: META_GEOSITE_URL,
      download_detour: '',
      update_interval: '',
      rules: '',
      path: ''
    }
    rs.push(metaRs)
    created.push('meta 规则集')
  } else skipped.push('meta 规则集')

  const rulesPre = Array.isArray(profile.route?.rules) ? profile.route.rules : (profile.route.rules = [])
  for (let i = rulesPre.length - 1; i >= 0; i--) {
    const r = rulesPre[i]
    if (r && r.type !== 'inline' && String(r.payload || '').includes('datapacket')) {
      rulesPre.splice(i, 1)
      created.push('清理旧测速分流规则')
    }
  }
  for (const g of (profile.outbounds || []).slice()) {
    if (g && g.type === 'selector' && g.tag === '测速专用') {
      const referenced = rulesPre.some((r) => r && r.outbound === g.id)
      if (!referenced) {
        profile.outbounds.splice(profile.outbounds.indexOf(g), 1)
        created.push('清理旧分组: 测速专用')
      } else {
        skipped.push('旧分组「测速专用」仍被引用，保留')
      }
    }
  }
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i]
    if (r && r.type === 'local' && r.tag === SPEED_RULESET_NAME) {
      rs.splice(i, 1)
      created.push('清理旧规则集: 下载测速分流')
    }
  }

  const rules = rulesPre
  const mkRule = (id, payload, outbound) => ({
    id,
    type: 'rule_set',
    enable: true,
    payload,
    invert: false,
    action: 'route',
    outbound,
    sniffer: [],
    strategy: 'default',
    server: ''
  })
  const isSpeedRule = (r) => r && r.type === 'inline' && String(r.payload || '').includes('datapacket')
  const isOpenaiRule = (r) => r && r.type === 'rule_set' && r.payload === openaiRs.id
  const isAnthropicRule = (r) => r && r.type === 'rule_set' && r.payload === anthropicRs.id
  const isMetaRule = (r) => r && r.type === 'rule_set' && r.payload === metaRs.id
  const isOpencodeRule = (r) => r && r.type === 'inline' && String(r.payload || '').includes('opencode.ai')
  const pickFirst = (pred) => {
    const idx = rules.findIndex(pred)
    if (idx === -1) return null
    for (let i = rules.length - 1; i > idx; i--) {
      if (pred(rules[i])) {
        rules.splice(i, 1)
        created.push('清理重复分流规则')
      }
    }
    return rules[idx]
  }
  let speedRule = pickFirst(isSpeedRule)
  let openaiRule = pickFirst(isOpenaiRule)
  let anthropicRule = pickFirst(isAnthropicRule)
  let metaRule = pickFirst(isMetaRule)
  let opencodeRule = pickFirst(isOpencodeRule)
  if (!speedRule) {
    speedRule = {
      id: genId(),
      type: 'inline',
      enable: true,
      payload: JSON.stringify({ domain_suffix: SPEED_DOMAINS }, null, 2),
      invert: false,
      action: 'route',
      outbound: speedGroup.id,
      sniffer: [],
      strategy: 'default',
      server: ''
    }
    created.push('测速分流规则（置顶 inline）')
  } else {
    const speedPayload = JSON.stringify({ domain_suffix: SPEED_DOMAINS }, null, 2)
    let speedChanged = false
    if (speedRule.payload !== speedPayload) {
      speedRule.payload = speedPayload
      speedChanged = true
    }
    if (speedRule.outbound !== speedGroup.id) {
      speedRule.outbound = speedGroup.id
      speedChanged = true
    }
    if (speedChanged) created.push('测速分流规则已修正')
    else skipped.push('测速分流规则（置顶 inline）')
  }
  if (!openaiRule) {
    openaiRule = mkRule(genId(), openaiRs.id, aiGroup.id)
    created.push('openai 分流规则')
  } else if (openaiRule.outbound !== aiGroup.id) {
    openaiRule.outbound = aiGroup.id
    created.push('openai 分流规则出口已修正')
  } else skipped.push('openai 分流规则')
  if (!anthropicRule) {
    anthropicRule = mkRule(genId(), anthropicRs.id, aiGroup.id)
    created.push('anthropic 分流规则')
  } else if (anthropicRule.outbound !== aiGroup.id) {
    anthropicRule.outbound = aiGroup.id
    created.push('anthropic 分流规则出口已修正')
  } else skipped.push('anthropic 分流规则')
  if (!metaRule) {
    metaRule = mkRule(genId(), metaRs.id, aiGroup.id)
    created.push('meta 分流规则')
  } else if (metaRule.outbound !== aiGroup.id) {
    metaRule.outbound = aiGroup.id
    created.push('meta 分流规则出口已修正')
  } else skipped.push('meta 分流规则')
  if (!opencodeRule) {
    opencodeRule = {
      id: genId(),
      type: 'inline',
      enable: true,
      payload: JSON.stringify({ domain_suffix: OPENCODE_DOMAINS }, null, 2),
      invert: false,
      action: 'route',
      outbound: opencodeGroup.id,
      sniffer: [],
      strategy: 'default',
      server: ''
    }
    created.push('opencode 分流规则（置顶 inline）')
  } else {
    const opencodePayload = JSON.stringify({ domain_suffix: OPENCODE_DOMAINS }, null, 2)
    let opencodeChanged = false
    if (opencodeRule.payload !== opencodePayload) {
      opencodeRule.payload = opencodePayload
      opencodeChanged = true
    }
    if (opencodeRule.outbound !== opencodeGroup.id) {
      opencodeRule.outbound = opencodeGroup.id
      opencodeChanged = true
    }
    if (opencodeChanged) created.push('opencode 分流规则已修正')
    else skipped.push('opencode 分流规则（置顶 inline）')
  }

  const pluginBlock = [speedRule, openaiRule, anthropicRule, metaRule, opencodeRule]
  const blockLabels = ['测速分流规则', 'openai 分流规则', 'anthropic 分流规则', 'meta 分流规则', 'opencode 分流规则']
  const beforeIdx = pluginBlock.map((r) => rules.indexOf(r))
  for (const r of pluginBlock) {
    const i = rules.indexOf(r)
    if (i !== -1) rules.splice(i, 1)
  }
  const insertIdx = rules.findIndex((r) => r && r.type === 'InsertionPoint')
  rules.splice(insertIdx === -1 ? 0 : insertIdx + 1, 0, ...pluginBlock)
  pluginBlock.forEach((r, k) => {
    if (beforeIdx[k] !== -1 && rules.indexOf(r) !== beforeIdx[k]) created.push(`${blockLabels[k]}已归位`)
  })

  try {
    await Plugins.WriteFile(`${PROFILES_PATH}${PROFILES_BAK_SUFFIX}`, raw)
  } catch (error) {
    Plugins.message.warn(`备份 profiles.yaml 失败（不影响本次写入）：${errorText(error)}`)
  }
  await Plugins.WriteFile(PROFILES_PATH, Plugins.YAML.stringify(doc))
  return { created, skipped }
}

const removeConfigSection = async (kind) => {
  const removed = []
  const { raw, doc, profile } = await getActiveProfile()
  const isSpeed = kind === 'speed'

  const rules = Array.isArray(profile.route?.rules) ? profile.route.rules : (profile.route.rules = [])
  const groups = (profile.outbounds || []).filter(
    (o) =>
      o &&
      (isSpeed ? o.type === 'selector' : true) &&
      (isSpeed
        ? String(o.tag || '').includes('测速')
        : String(o.tag || '').includes('AI出口') || (o.type === 'selector' && String(o.tag || '').includes('OpenCode')))
  )
  const groupIds = new Set(groups.map((g) => g.id))

  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i]
    if (!r) continue
    const isTargetRule = isSpeed
      ? (r.type === 'inline' && String(r.payload || '').includes('datapacket')) || groupIds.has(r.outbound)
      : (r.type === 'rule_set' && (r.payload === 'openai-geosite.json' || r.payload === 'anthropic-geosite.json' || r.payload === 'meta-geosite.json')) ||
        (r.type === 'inline' && String(r.payload || '').includes('opencode.ai')) ||
        groupIds.has(r.outbound)
    if (isTargetRule) {
      rules.splice(i, 1)
      removed.push(
        isSpeed ? '测速分流规则' : r.type === 'inline' ? 'opencode 分流规则' : String(r.payload || '') === 'meta-geosite.json' ? 'meta 分流规则' : 'AI 分流规则'
      )
    }
  }
  for (const g of groups) {
    profile.outbounds.splice(profile.outbounds.indexOf(g), 1)
    removed.push(`分组: ${g.tag}`)
  }
  const rs = Array.isArray(profile.route?.rule_set) ? profile.route.rule_set : []
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i]
    if (!r) continue
    const isTargetRuleset = isSpeed
      ? r.type === 'local' && r.tag === SPEED_RULESET_NAME
      : r.tag === 'openai-geosite.json' || r.tag === 'anthropic-geosite.json' || r.tag === 'meta-geosite.json'
    if (isTargetRuleset) {
      rs.splice(i, 1)
      removed.push(isSpeed ? '下载测速分流 规则集' : `规则集: ${r.tag}`)
    }
  }

  try {
    await Plugins.WriteFile(`${PROFILES_PATH}${PROFILES_BAK_SUFFIX}`, raw)
  } catch (error) {
    Plugins.message.warn(`备份 profiles.yaml 失败（不影响本次写入）：${errorText(error)}`)
  }
  await Plugins.WriteFile(PROFILES_PATH, Plugins.YAML.stringify(doc))
  return removed
}

const loadEgressHistory = async () => {
  try {
    const raw = await Plugins.ReadFile(EGRESS_HISTORY_PATH)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

const saveEgressHistory = async (list) => {
  try {
    await Plugins.MakeDir(DATA_DIR)
    await Plugins.WriteFile(EGRESS_HISTORY_PATH, JSON.stringify(list.slice(0, 20), null, 2))
  } catch (error) {
    Plugins.message.warn(`保存出口检测历史失败：${errorText(error)}`)
  }
}

/* ============================================================
 * 面板子模块（体检 / 测速 / 美国出口）
 * ============================================================ */

const setupHealthCheck = ({ api, checkRunBox }) => {
  const { ref, computed } = Vue
  const cards = ref(NETWORK_SOURCES.map((item) => ({ ...item, ok: false, ip: '', place: '', elapsed: 0, error: '', loading: false })))
  const sites = ref(SITES.map((site) => ({ ...site, latency: -1, color: 'text-red-500', error: '', loading: false })))
  const checkSummary = ref('准备就绪')
  const noEndpoint = ref(false)
  let endpoint = null
  try {
    endpoint = api.getProxyEndpoint()
  } catch {
    /* 无本地代理入站时保持为空，由 envDesc 表达 */
  }
  const envDesc = endpoint?.host && endpoint?.port ? `经本地代理入站（${endpoint.host}:${endpoint.port}）` : '未配置本地代理入站'
  const available = computed(() => sites.value.filter((s) => s.latency >= 0).length)
  const average = computed(() => {
    const v = sites.value.filter((s) => s.latency >= 0).map((s) => s.latency)
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '—'
  })
  const summarySite = computed(() => {
    const v = sites.value.filter((s) => s.latency >= 0)
    return v.length ? `最快 ${v.slice().sort((a, b) => a.latency - b.latency)[0].name}` : '无可用站点'
  })
  const setCheckRun = (run) => {
    checkRunBox.current = run
  }
  try {
    setCheckRun(createRun(createProxyUrl(api.getProxyEndpoint())))
  } catch (error) {
    noEndpoint.value = true
    checkSummary.value = errorText(error)
  }
  const refreshNetworkCard = async (card) => {
    if (card.loading || !checkRunBox.current) return
    card.loading = true
    try {
      const result =
        card.key === 'domestic'
          ? await networkDomesticInfo(checkRunBox.current)
          : card.key === 'overseas'
            ? await networkOverseasInfo(checkRunBox.current)
            : card.key === 'cloudflare'
              ? await networkCloudflareInfo(checkRunBox.current)
              : await networkXTraceInfo(checkRunBox.current)
      Object.assign(card, { ok: true, ip: result.ip, place: result.place, source: result.source, elapsed: result.elapsed, error: '' })
    } catch (error) {
      Object.assign(card, { ok: false, error: errorText(error) })
    } finally {
      card.loading = false
    }
  }
  const refreshSiteCard = async (site) => {
    if (site.loading || !checkRunBox.current) return
    site.loading = true
    try {
      const result = await siteLatency(checkRunBox.current, site)
      Object.assign(site, { latency: result.latency, status: result.status, error: '', color: latencyClass(result.latency) })
    } catch (error) {
      Object.assign(site, { latency: -1, error: errorText(error), color: 'text-red-500' })
    } finally {
      site.loading = false
    }
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const detect = async () => {
    cards.value.forEach((card) => {
      card.loading = true
    })
    sites.value.forEach((site) => {
      site.loading = true
    })
    try {
      const infoPromise = networkInfo(checkRunBox.current)
      const latency = []
      for (let i = 0; i < SITES.length; i += 2) {
        if (checkRunBox.current.cancelled) return
        const batch = SITES.slice(i, i + 2).map((site) => siteLatency(checkRunBox.current, site))
        latency.push(...(await Promise.allSettled(batch)))
        if (!checkRunBox.current.cancelled && i + 2 < SITES.length) await sleep(250)
      }
      const info = await infoPromise
      if (checkRunBox.current.cancelled) return
      cards.value = NETWORK_SOURCES.map((item, index) => {
        const result = info[index]
        return result?.status === 'fulfilled'
          ? { ...item, ...result.value, ok: true, loading: false }
          : { ...item, ok: false, error: errorText(result?.reason), loading: false }
      })
      sites.value = SITES.map((site, index) => {
        const result = latency[index]
        return result?.status === 'fulfilled'
          ? { ...result.value, color: latencyClass(result.value.latency), loading: false }
          : { ...site, latency: -1, error: errorText(result?.reason), loading: false }
      })
      checkSummary.value = '检测完成 · 点击卡片可单独刷新'
    } catch (error) {
      checkSummary.value = errorText(error)
    }
  }
  const retryCheck = async () => {
    try {
      setCheckRun(createRun(createProxyUrl(api.getProxyEndpoint())))
      noEndpoint.value = false
      checkSummary.value = '准备就绪'
      await detect()
    } catch (error) {
      noEndpoint.value = true
      checkSummary.value = errorText(error)
    }
  }

  return {
    cards,
    sites,
    checkSummary,
    noEndpoint,
    envDesc,
    available,
    average,
    summarySite,
    refreshNetworkCard,
    refreshSiteCard,
    retryCheck,
    detect,
    checkRun: () => checkRunBox.current
  }
}

const setupSpeedTest = ({ api }) => {
  const { ref, computed, watch, onMounted } = Vue
  const selectors = () => Object.values(api.proxies || {}).filter((p) => p?.type === 'Selector' && Array.isArray(p.all) && p.all.length)
  const initial = selectors()
  const speedSelector = initial.find((p) => /测速/.test(String(p.name || p.tag || '')))
  const defaultGroup =
    speedSelector?.name ||
    speedSelector?.tag ||
    '' ||
    (Plugin.GroupName && initial.some((p) => p.name === Plugin.GroupName || p.tag === Plugin.GroupName) ? Plugin.GroupName : '') ||
    initial[0]?.name ||
    initial[0]?.tag ||
    ''
  const form = ref({
    group: defaultGroup,
    url: Plugin.TestUrl || 'http://hkg.download.datapacket.com/100mb.bin',
    presetUrl: '',
    pingUrl: Plugin.PingUrl || 'https://www.gstatic.com/generate_204',
    maxDelay: Number(Plugin.MaxDelayMs) || 3000,
    seconds: Number(Plugin.TimeoutSeconds) || 10,
    concurrency: Number(Plugin.PrecheckConcurrency) || 20,
    limit: Number(Plugin.NodeCount) || 0,
    downloadLimit: Number(Plugin.DownloadLimit) || 0,
    filter: ''
  })
  const results = ref([])
  const running = ref(false)
  const progress = ref(0)
  const total = ref(0)
  const currentNode = ref('')
  const statusText = ref('准备就绪')
  const groupOptions = computed(() => selectors().map((p) => ({ label: p.name || p.tag, value: p.name || p.tag })))
  const presetUrlOptions = computed(() => [{ label: '自定义', value: '' }, ...PRESET_URLS])
  watch(
    () => form.value.presetUrl,
    (value) => {
      if (value) form.value.url = value
    }
  )
  watch(
    () => form.value.url,
    (value) => {
      if (value && !PRESET_URLS.some((p) => p.value === value)) form.value.presetUrl = ''
    }
  )
  const progressPercent = computed(() => (total.value ? Math.round((progress.value * 100) / total.value) : 0))
  const speedHistory = ref(null)
  const formatTime = (value) => (value ? new Date(value).toLocaleString() : '未知')
  const overseasText = (row) => {
    if (!row.overseasError) return row.overseasIp ? `${row.overseasPlace} · ${row.overseasIp}` : '—'
    return /deadline exceeded|timeout|context cancel/i.test(row.overseasError) ? '检测超时' : '检测失败'
  }
  const showUsOnly = ref(false)
  const filteredResults = computed(() => (showUsOnly.value ? results.value.filter((r) => r.overseasCountry === 'US') : results.value))
  const filteredHistoryResults = computed(() => {
    if (!speedHistory.value) return []
    return showUsOnly.value ? speedHistory.value.results.filter((r) => r.overseasCountry === 'US') : speedHistory.value.results
  })
  /** 从当前结果或历史中找出最快的美国出口节点，并一键切换到「AI出口」分组。 */
  const useFastestUsNode = async () => {
    if (running.value || egressRunning.value) return Plugins.message.warn('测速或出口检测进行中，请先完成')
    if (!api.running) return Plugins.message.error('内核未运行，请先启动内核')
    const pool = results.value.length ? results.value : speedHistory.value?.results || []
    const usNodes = pool.filter((r) => r.status === '成功' && r.overseasCountry === 'US')
    if (!usNodes.length) return Plugins.message.warn('没有检测到美国出口的成功节点，请先测速（或在历史区运行「国外出口」检测）')
    const best = usNodes.slice().sort(compareResultRows)[0]
    const proxy = (api.proxies || {})[best.name]
    if (!proxy) return Plugins.message.error('该节点可能因订阅更新已不存在，请重新测速')
    const aiGroup = Object.values(api.proxies || {}).find((g) => g?.type === 'Selector' && Array.isArray(g.all) && /AI出口/.test(String(g.name || g.tag || '')))
    if (!aiGroup) {
      let generated = false
      try {
        const { profile } = await getActiveProfile()
        generated = (profile.outbounds || []).some((o) => o && o.tag === GROUP_TAG)
      } catch {
        /* profiles.yaml 缺失或结构异常时视为未生成 */
      }
      return Plugins.message.error(
        generated ? 'AI出口 分组已生成但尚未进入内核，请重启 GUI 后再试' : 'AI出口 分组尚未生成，请先在「🇺🇸 美国出口」标签页一键生成配置'
      )
    }
    if (!aiGroup.all.includes(best.name)) return Plugins.message.error('最快美国节点不在 AI出口 分组中（订阅可能未更新），请刷新订阅后重试')
    await Plugins.handleUseProxy(aiGroup, proxy)
    Plugins.message.success(`已把 AI出口 切到最快美国节点：${best.name}（${best.mbps || '—'} Mbps）`)
  }
  const useResult = async (row) => {
    if (running.value) return Plugins.message.warn('批量测速进行中，请先停止测试再使用节点')
    if (row.status !== '成功') return Plugins.message.warn('仅成功测速的节点可以被使用')
    if (!api.running) return Plugins.message.error('内核未运行，请先启动内核')
    const groupName = row.groupName || form.value.group
    if (groupName !== form.value.group) return Plugins.message.error('该结果所属策略组与当前选择的策略组不一致')
    const proxy = (api.proxies || {})[row.name]
    if (!proxy) return Plugins.message.error('节点可能因订阅更新已不存在，请重新测速')
    const groups = Object.values(api.proxies || {}).filter((g) => g?.type === 'Selector' && Array.isArray(g.all) && g.all.includes(row.name))
    if (!groups.length) return Plugins.message.error('该节点不属于任何可切换的策略组，可能已不存在，请重新测速')
    const checked = Vue.reactive(Object.fromEntries(groups.map((g) => [g.name || g.tag, true])))
    const m = Plugins.modal({
      title: `切换节点：${row.name}`,
      width: '40',
      submitText: '切换',
      cancelText: '取消',
      onOk: async () => {
        const selected = groups.filter((g) => checked[g.name || g.tag])
        if (!selected.length) {
          Plugins.message.warn('请至少勾选一个策略组')
          return false
        }
        for (const g of selected) {
          await Plugins.handleUseProxy(g, proxy)
        }
        Plugins.message.success(`已切换到 ${row.name}（${selected.map((g) => g.name || g.tag).join('、')}）`)
        return true
      }
    })
    m.setContent({
      template: `
            <div class="p-8 text-12">
              <div class="mb-8 text-gray-500">节点 <span class="text-current font-medium">{{ nodeName }}</span> 属于以下策略组，勾选需要切换到该节点的组：</div>
              <div v-for="g in groups" :key="g.name || g.tag" class="flex items-center justify-between py-8 border-b border-gray-200 dark:border-gray-700">
                <span>{{ g.name || g.tag }}</span>
                <Switch v-model="checked[g.name || g.tag]" />
              </div>
            </div>`,
      setup() {
        return { groups, checked, nodeName: row.name }
      }
    })
    m.open()
  }
  const deleteHistory = async () => {
    if (!speedHistory.value || egressRunning.value) return
    const ok = await Plugins.confirm('删除历史记录', '确定删除已保存的测速历史结果吗？删除后不可恢复。').catch(() => false)
    if (!ok) return
    speedHistory.value = null
    await historySaveTask.catch(() => {})
    try {
      await Plugins.RemoveFile(SPEED_RESULTS_PATH)
    } catch (error) {
      Plugins.message.warn(`删除测速历史文件失败：${errorText(error)}`)
    }
  }
  const egressRunning = ref(false)
  const runEgress = async () => {
    if (running.value || egressRunning.value) return
    if (!speedHistory.value) return
    if (!api.running) return Plugins.message.error('内核未运行，请先启动内核')
    const groupName = form.value.group
    const group = (api.proxies || {})[groupName]
    if (!group || group.type !== 'Selector' || !Array.isArray(group.all)) return Plugins.message.error('策略组不存在或不是可用的 Selector')
    const endpoint = createProxyUrl(api.getProxyEndpoint())
    const speedGroup = Object.values(api.proxies || {}).find(
      (g) => g && g.type === 'Selector' && Array.isArray(g.all) && /测速/.test(String(g.name || g.tag || '')) && (g.name || g.tag) !== groupName
    )
    const speedOriginal = speedGroup ? speedGroup.now : null
    const rows = speedHistory.value.results.filter((r) => r.status === '成功')
    if (!rows.length) return Plugins.message.warn('历史中没有已成功测速的节点')
    let stopped = false
    let failedCount = 0
    const cancelIds = new Set()
    const isStopped = () => stopped
    const stop = () => {
      stopped = true
      for (const id of cancelIds) {
        try {
          Plugins.HttpCancel(id)
        } catch {
          /* 取消失败可忽略：请求可能已结束 */
        }
      }
    }
    egressStop = stop
    egressRunning.value = true
    statusText.value = '正在检测国外出口…'
    const original = group.now
    try {
      for (let i = 0; i < rows.length; i++) {
        if (stopped) break
        const row = rows[i]
        const proxy = (api.proxies || {})[row.name]
        currentNode.value = row.name
        statusText.value = `国外出口检测 ${i + 1}/${rows.length}`
        if (!proxy || !group.all.includes(row.name)) {
          row.overseasIp = ''
          row.overseasPlace = ''
          row.overseasSource = ''
          row.overseasCountry = ''
          row.overseasError = '节点不存在或不在当前策略组'
          failedCount += 1
          continue
        }
        await Plugins.handleUseProxy(group, proxy)
        if (speedGroup && speedGroup.all.includes(row.name)) {
          try {
            await Plugins.handleUseProxy(speedGroup, proxy)
          } catch {
            /* 测速组切换失败不影响主流程 */
          }
        }
        try {
          const result = await overseasInfo({ proxy: endpoint, cancelIds, isStopped })
          row.overseasIp = result.ip
          row.overseasPlace = result.place
          row.overseasSource = result.source
          row.overseasCountry = result.country || ''
          row.overseasError = ''
        } catch (error) {
          if (isStopped()) break
          row.overseasIp = ''
          row.overseasPlace = ''
          row.overseasSource = ''
          row.overseasCountry = ''
          row.overseasError = errorText(error)
          failedCount += 1
        }
      }
    } finally {
      egressStop = null
      egressRunning.value = false
      currentNode.value = ''
      statusText.value = stopped ? '出口检测已停止' : '出口检测完成'
      try {
        const fresh = original && (api.proxies || {})[original]
        if (fresh) await Plugins.handleUseProxy(group, fresh)
        if (speedGroup && speedOriginal) {
          const speedFresh = (api.proxies || {})[speedOriginal]
          if (speedFresh) await Plugins.handleUseProxy(speedGroup, speedFresh)
        }
      } catch (error) {
        Plugins.message.warn(`出口检测后恢复原分组节点失败：${errorText(error)}`)
      }
      if (speedHistory.value) saveSpeedResults(speedHistory.value)
      if (!stopped && failedCount > 0) {
        Plugins.message.warn(`出口检测完成：${failedCount} 个节点检测失败，${rows.length - failedCount} 个成功（详见历史表格）`)
      }
    }
  }
  const stopEgress = () => {
    egressStop?.()
  }
  onMounted(async () => {
    speedHistory.value = await loadSpeedResults()
  })
  const stop = () => {
    runBatchTest.stop?.()
  }
  const clearResults = () => {
    if (!running.value) results.value = []
  }
  const upsertResult = (row) => {
    const key = resultKeyOf(row)
    const list = results.value
    const index = list.findIndex((r) => resultKeyOf(r) === key)
    if (index === -1) {
      results.value = [...list, { ...row, key }]
      progress.value += 1
    } else results.value = list.map((r, i) => (i === index ? { ...r, ...row, key } : r))
  }
  const start = async () => {
    if (running.value || egressRunning.value) return
    const values = { ...form.value }
    const seconds = Number(values.seconds)
    const maxDelay = Number(values.maxDelay)
    const concurrency = Number(values.concurrency)
    const limit = Number(values.limit)
    const downloadLimit = Number(values.downloadLimit)
    if (!values.group || !/^https?:\/\//i.test(String(values.url).trim()) || !/^https?:\/\//i.test(String(values.pingUrl).trim()))
      return Plugins.message.error('请填写有效的策略组和 HTTP/HTTPS 下载/延迟测试 URL')
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) return Plugins.message.error('下载时长必须是 1-60 之间的数字（秒）')
    if (!Number.isFinite(maxDelay) || maxDelay < 100 || maxDelay > 30000) return Plugins.message.error('最大延迟必须在 100-30000 毫秒之间')
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 60) return Plugins.message.error('预检并发数必须是 1-60 的整数')
    if (!Number.isInteger(limit) || limit < 0) return Plugins.message.error('节点数量限制必须是非负整数')
    if (!Number.isInteger(downloadLimit) || downloadLimit < 0) return Plugins.message.error('下载数量限制必须是非负整数')
    const group = (api.proxies || {})[values.group]
    if (!group || group.type !== 'Selector' || !Array.isArray(group.all)) return Plugins.message.error('策略组不存在或不是可用的 Selector')
    running.value = true
    results.value = []
    progress.value = 0
    statusText.value = '正在读取 Clash API 配置…'
    runBatchTest.active = runBatchTest({
      api,
      groupName: values.group,
      url: String(values.url).trim(),
      pingUrl: String(values.pingUrl).trim(),
      maxDelay,
      seconds,
      concurrency,
      limit,
      downloadLimit,
      filter: String(values.filter).trim(),
      onTotal: (v) => {
        total.value = v
      },
      onPrecheck: (done, count, etaSec) => {
        statusText.value = etaSec ? `延迟预检 ${done}/${count} · 预计还需约 ${etaSec} 秒` : `延迟预检 ${done}/${count}`
        if (done >= count && results.value.length)
          results.value = [...results.value].sort((a, b) => {
            const aD = Number.isFinite(Number(a.delay)) && Number(a.delay) > 0 ? Number(a.delay) : Number.MAX_SAFE_INTEGER
            const bD = Number.isFinite(Number(b.delay)) && Number(b.delay) > 0 ? Number(b.delay) : Number.MAX_SAFE_INTEGER
            if (aD !== bD) return aD - bD
            return String(a.name).localeCompare(String(b.name))
          })
      },
      onNode: (v) => {
        currentNode.value = v
      },
      onNodeSpeed: (nodeName, mb, i, n) => {
        statusText.value = `第 ${i}/${n} 个 · ${nodeName || '—'} · 当前 ${Number.isFinite(Number(mb)) ? Number(mb).toFixed(2) + ' MB/s' : '测试中…'}`
      },
      onDownload: (done, target, etaSec, nodeName, mb) => {
        const speedText = nodeName ? ` · ${nodeName} · ${Number.isFinite(Number(mb)) && Number(mb) > 0 ? Number(mb).toFixed(2) + ' MB/s' : '失败'}` : ''
        statusText.value = etaSec ? `下载测速 ${done}/${target}${speedText} · 预计还需约 ${etaSec} 秒` : `下载测速 ${done}/${target}${speedText}`
      },
      onResult: (v) => {
        upsertResult(v)
      }
    })
      .then((summary) => {
        if (summary?.stopped) statusText.value = '已停止'
        else if (!summary || summary.qualifiedCount === 0) statusText.value = '预检完成，无合格节点'
        else
          statusText.value = `测试完成：成功 ${summary.successCount} 个，失败 ${summary.failCount} 个（合格 ${summary.qualifiedCount} 个，已下载 ${summary.downloadedCount} 个）`
        if (summary && !summary.stopped && summary.failCount > 0) {
          Plugins.message.warn(`测速完成：${summary.failCount} 个节点下载失败，${summary.successCount} 个成功，详情见结果表格`)
        }
      })
      .catch((error) => {
        Plugins.message.error(errorText(error))
        statusText.value = '无法开始测试'
      })
      .finally(() => {
        running.value = false
        currentNode.value = ''
        const rows = results.value
        if (rows.length) {
          rows.sort(compareResultRows)
          const payload = {
            schema: 'network-toolbox',
            version: 2,
            savedAt: new Date().toISOString(),
            groupName: form.value.group,
            testUrl: String(form.value.url).trim(),
            results: rows
          }
          saveSpeedResults(payload)
          speedHistory.value = payload
        }
        runBatchTest.active = null
        batchRunPromise = null
      })
    batchRunPromise = runBatchTest.active
    await batchRunPromise
  }

  return {
    form,
    results,
    running,
    progress,
    total,
    currentNode,
    statusText,
    groupOptions,
    presetUrlOptions,
    progressPercent,
    speedHistory,
    formatTime,
    formatDelay,
    overseasText,
    showUsOnly,
    filteredResults,
    filteredHistoryResults,
    useFastestUsNode,
    start,
    stop,
    clearResults,
    useResult,
    deleteHistory,
    egressRunning,
    runEgress,
    stopEgress,
    latencyClass
  }
}

const setupUsEgress = ({ api, kernelRunning, egressRunning }) => {
  const { ref } = Vue
  const subscribesStore = Plugins.useSubscribesStore()
  const checkedAt = ref('')
  const totalNodes = ref(0)
  const usTotal = ref(0)
  const usFixed = ref(0)
  const proxyIpOptions = PROXYIP_OPTIONS
  const selectedProxyIp = ref(DEFAULT_PROXYIP_HOST)
  const customProxyIp = ref('')
  const aiGroupOk = ref(false)
  const aiRulesOk = ref(false)
  const speedOk = ref(false)
  const opencodeOk = ref(false)
  const opencodeGroupOptions = ref([])
  const selectedOpencodeThird = ref('')
  const generating = ref(false)
  const genSummary = ref('')
  const nodeOptions = ref([])
  const selectedNode = ref('')
  const egressVerifyRunning = ref(false)
  const lastVerifyResult = ref(null)
  const egressHistory = ref([])

  const persistProxyIpSettings = async () => {
    const saved = await saveProxyIpSettings({
      proxyipHost: selectedProxyIp.value,
      customHost: customProxyIp.value,
      opencodeThirdId: selectedOpencodeThird.value
    })
    selectedProxyIp.value = saved.proxyipHost
    customProxyIp.value = saved.customHost
  }

  const onOpencodeThirdChange = async (value) => {
    try {
      const saved = await saveProxyIpSettings({
        proxyipHost: selectedProxyIp.value,
        customHost: customProxyIp.value,
        opencodeThirdId: String(value || '')
      })
      selectedProxyIp.value = saved.proxyipHost
      customProxyIp.value = saved.customHost
    } catch (error) {
      Plugins.message.error(`保存 OpenCode 第三出口设置失败：${errorText(error)}`)
    }
  }

  const loadDiskProxies = async () => {
    const all = []
    let failedCount = 0
    for (const sub of subscribesStore.subscribes || []) {
      const path = sub.path || sub.file
      if (!path) continue
      try {
        const raw = await Plugins.ReadFile(path)
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw
        const list = Array.isArray(data) ? data : data && Array.isArray(data.outbounds) ? data.outbounds : []
        for (const p of list) {
          if (p && typeof p.tag === 'string') all.push(p)
        }
      } catch {
        failedCount += 1
      }
    }
    if (failedCount) Plugins.message.warn(`读取订阅文件失败：${failedCount} 个（可能已被删除）`)
    return all
  }

  const refreshUs = async () => {
    checkedAt.value = new Date().toLocaleTimeString()
    kernelRunning.value = !!api.running
    const proxyIpSettings = await loadProxyIpSettings()
    selectedProxyIp.value = proxyIpSettings.proxyipHost
    customProxyIp.value = proxyIpSettings.customHost
    const proxyIpPath = getProxyIpPath(proxyIpSettings)
    const all = await loadDiskProxies()
    totalNodes.value = all.length
    const us = all.filter((p) => p.tag.includes('🇺🇸'))
    usTotal.value = us.length
    usFixed.value = us.filter((p) => p.transport && p.transport.path === proxyIpPath).length
    const speedGroups = Object.values(api.proxies || {}).filter(
      (g) => g?.type === 'Selector' && Array.isArray(g.all) && /测速/.test(String(g.name || g.tag || ''))
    )
    nodeOptions.value = speedGroups.flatMap((group) => {
      const groupName = group.name || group.tag
      return group.all
        .filter((nodeName) => (api.proxies || {})[nodeName] && !['DIRECT', 'REJECT'].includes(String(nodeName).toUpperCase()))
        .map((nodeName) => ({ label: `${groupName} / ${nodeName}`, value: `${groupName}::${nodeName}`, groupName, nodeName }))
    })
    if (!nodeOptions.value.some((item) => item.value === selectedNode.value)) selectedNode.value = nodeOptions.value[0]?.value || ''

    aiGroupOk.value = false
    aiRulesOk.value = false
    speedOk.value = false
    opencodeOk.value = false
    try {
      const { profile } = await getActiveProfile()
      const outs = profile.outbounds || []
      const aiGroup = outs.find((o) => o && o.tag === GROUP_TAG)
      const speedGroup = outs.find((o) => o && o.tag === SPEED_GROUP_TAG)
      const rs = profile.route?.rule_set || []
      const rules = profile.route?.rules || []
      const openaiRs = rs.find((r) => r && (r.url || '').includes('openai'))
      const anthropicRs = rs.find((r) => r && (r.url || '').includes('anthropic'))
      const metaRs = rs.find((r) => r && (r.tag === 'meta-geosite.json' || (r.url || '').includes('geosite/meta')))
      const opencodeGroup = outs.find((o) => o && o.tag === OPENCODE_GROUP_TAG)
      const speedInline = rules.find((r) => r && r.type === 'inline' && String(r.payload || '').includes('datapacket'))
      const opencodeInline = rules.find((r) => r && r.type === 'inline' && String(r.payload || '').includes('opencode.ai'))
      aiGroupOk.value = !!aiGroup
      aiRulesOk.value = !!(
        openaiRs &&
        anthropicRs &&
        metaRs &&
        rules.some((r) => r && r.payload === openaiRs.id && r.outbound === aiGroup?.id) &&
        rules.some((r) => r && r.payload === anthropicRs.id && r.outbound === aiGroup?.id) &&
        rules.some((r) => r && r.payload === metaRs.id && r.outbound === aiGroup?.id)
      )
      speedOk.value = !!(speedGroup && speedInline && speedInline.outbound === speedGroup.id)
      opencodeOk.value = !!(opencodeGroup && opencodeInline && opencodeInline.outbound === opencodeGroup.id)
      opencodeGroupOptions.value = outs.filter((o) => o && o.type === 'selector' && o.tag !== OPENCODE_GROUP_TAG).map((o) => ({ label: o.tag, value: o.id }))
      const thirdId = String(proxyIpSettings.opencodeThirdId || '').trim()
      const nodeSelectorOpt = opencodeGroupOptions.value.find((item) => String(item.label || '').includes('节点选择'))
      const fallbackThird = nodeSelectorOpt?.value || opencodeGroupOptions.value[0]?.value || ''
      selectedOpencodeThird.value = opencodeGroupOptions.value.some((item) => item.value === thirdId) ? thirdId : fallbackThird
    } catch (error) {
      Plugins.message.warn(`读取配置状态失败：${errorText(error)}`)
      opencodeGroupOptions.value = []
      selectedOpencodeThird.value = ''
    }
    egressHistory.value = await loadEgressHistory()
  }

  const doGenerate = async () => {
    if (generating.value) return
    const ok = await Plugins.confirm(
      '一键生成 / 修复配置',
      '将写入 profiles.yaml，并改写订阅中 🇺🇸 美国节点的 ProxyIP 路径（写入前自动创建 .bak-plugin 备份）。继续吗？'
    ).catch(() => false)
    if (!ok) return
    generating.value = true
    genSummary.value = ''
    try {
      await persistProxyIpSettings()
      const { created, skipped } = await ensureFullConfig()
      genSummary.value = created.length ? `已生成：${created.join('、')}（请重启 GUI 生效）` : `配置已完整（${skipped.length} 项均存在）`
      if (created.length) Plugins.message.success('配置已写入，请重启 GUI 使其生效')
      else Plugins.message.success('配置已完整，无需生成')
      await refreshUs()
    } catch (e) {
      Plugins.message.error(String(e?.message || e).slice(0, 120))
      genSummary.value = '生成失败'
    } finally {
      generating.value = false
    }
  }

  const removing = ref(false)
  const doRemove = async () => {
    if (removing.value) return
    const ok = await Plugins.confirm('清除测速配置', '确定删除「⚡ 测速专用」分组和测速分流规则吗？删除后请重启 GUI 生效。').catch(() => false)
    if (!ok) return
    removing.value = true
    genSummary.value = ''
    try {
      const removed = await removeConfigSection('speed')
      genSummary.value = removed.length ? `已清除：${removed.join('、')}（请重启 GUI 生效）` : '没有可清除的测速配置'
      Plugins.message.success(removed.length ? '已清除，请重启 GUI 生效' : '没有可清除的测速配置')
      await refreshUs()
    } catch (e) {
      Plugins.message.error(String(e?.message || e).slice(0, 120))
      genSummary.value = '清除失败'
    } finally {
      removing.value = false
    }
  }

  const aiRemoving = ref(false)
  const doRemoveAi = async () => {
    if (aiRemoving.value) return
    const ok = await Plugins.confirm(
      '清理 AI/OpenCode 配置',
      '确定删除所有「AI出口」「🤖 OpenCode」分组、OpenAI/Anthropic/meta 分流规则、opencode 分流规则与规则集定义吗？删除后请重启 GUI 生效。'
    ).catch(() => false)
    if (!ok) return
    aiRemoving.value = true
    genSummary.value = ''
    try {
      const removed = await removeConfigSection('ai')
      genSummary.value = removed.length ? `已清理：${removed.join('、')}（请重启 GUI 生效）` : '没有可清理的 AI/OpenCode 配置'
      Plugins.message.success(removed.length ? '已清理，请重启 GUI 生效' : '没有可清理的 AI/OpenCode 配置')
      await refreshUs()
    } catch (e) {
      Plugins.message.error(String(e?.message || e).slice(0, 120))
      genSummary.value = '清理失败'
    } finally {
      aiRemoving.value = false
    }
  }

  const runEgressVerify = async () => {
    if (egressVerifyRunning.value) return
    egressVerifyRunning.value = true
    let original = null
    let speedGroup = null
    let testedNode = ''
    try {
      const proxyUrl = createProxyUrl(api.getProxyEndpoint())
      const selected = nodeOptions.value.find((item) => item.value === selectedNode.value)
      if (!selected) throw new Error('请选择测速相关分组内的节点')
      speedGroup = (api.proxies || {})[selected.groupName]
      if (!speedGroup || speedGroup.type !== 'Selector' || !Array.isArray(speedGroup.all) || !/测速/.test(String(speedGroup.name || speedGroup.tag || ''))) {
        throw new Error('所选测速分组不存在，请刷新状态')
      }
      testedNode = selected.nodeName
      if (!speedGroup.all.includes(testedNode)) throw new Error('所选节点不在测速分组中')
      const proxy = (api.proxies || {})[testedNode]
      if (!proxy) throw new Error('所选节点不存在，请刷新订阅')
      original = speedGroup.now
      await Plugins.handleUseProxy(speedGroup, proxy)
      await new Promise((r) => setTimeout(r, 800))

      const sources = [
        { name: 'cmliussss API', url: 'https://api.cmliussss.net/api/ipinfo' },
        { name: 'ipinfo.io', url: 'https://ipinfo.io/json' },
        { name: 'ip.sb', url: 'https://api.ip.sb/geoip/' }
      ]
      const failures = []
      let info = null
      for (const source of sources) {
        try {
          const resp = await Plugins.Requests({
            method: 'GET',
            url: `${source.url}${source.url.includes('?') ? '&' : '?'}t=${Date.now()}`,
            autoTransformBody: true,
            headers: { Accept: 'application/json,*/*' },
            options: { Proxy: proxyUrl, Timeout: 8 }
          })
          if (resp.status < 200 || resp.status >= 300) throw new Error(`HTTP ${resp.status || '?'}`)
          const body = typeof resp.body === 'string' ? JSON.parse(resp.body || '{}') : resp.body || {}
          const ip = body.ip
          const country = body.country_code || body.country || ''
          const asnText = body.asn ? `AS${String(body.asn).replace(/^AS/i, '')}` : ''
          const org = body.as_name || body.org || body.asn_organization || body.organization || asnText
          if (!ip) throw new Error('响应缺少 IP')
          info = { ip, country, org, source: source.name }
          break
        } catch (error) {
          failures.push(`${source.name}: ${String(error?.message || error).replace(/^Error:\s*/, '')}`)
        }
      }
      if (!info) throw new Error(failures.join('；') || '出口查询失败')

      const unsupportedRegions = ['CN', 'HK', 'MO']
      const ok = info.country === 'US'
      const unsupported = unsupportedRegions.includes(info.country)
      const summary = ok
        ? `✓ 美国出口（${info.source}）`
        : unsupported
          ? `✗ 落在 ${info.country}（OpenAI 不支持地区）`
          : `△ 非美国出口（${info.country || '未知'}）`
      const row = {
        ts: Date.now(),
        time: new Date().toLocaleString(),
        node: testedNode,
        ip: info.ip,
        country: info.country || '?',
        org: info.org || '',
        summary
      }
      lastVerifyResult.value = row
      egressHistory.value.unshift(row)
      egressHistory.value = egressHistory.value.slice(0, 20)
      await saveEgressHistory(egressHistory.value)
      Plugins.message.success(summary)
    } catch (e) {
      const selected = nodeOptions.value.find((item) => item.value === selectedNode.value)
      const row = {
        ts: Date.now(),
        time: new Date().toLocaleString(),
        node: testedNode || selected?.nodeName || selectedNode.value,
        ip: '—',
        country: '',
        org: '',
        summary: '✗ ' + String(e?.message || e).slice(0, 240)
      }
      lastVerifyResult.value = row
      egressHistory.value.unshift(row)
      egressHistory.value = egressHistory.value.slice(0, 20)
      await saveEgressHistory(egressHistory.value)
      Plugins.message.error(`出口验证失败：${String(e?.message || e).slice(0, 120)}`)
    } finally {
      if (original && speedGroup) {
        try {
          const back = (api.proxies || {})[original]
          if (back) await Plugins.handleUseProxy(speedGroup, back)
        } catch (error) {
          Plugins.message.warn(`出口验证后恢复原节点失败：${errorText(error)}`)
        }
      }
      egressVerifyRunning.value = false
    }
  }

  const clearEgressHistory = async () => {
    if (!egressHistory.value.length) return
    const ok = await Plugins.confirm('清空出口检测历史', '确定清空最近 20 条出口检测记录吗？').catch(() => false)
    if (!ok) return
    egressHistory.value = []
    await saveEgressHistory([])
    Plugins.message.success('出口检测历史已清空')
  }

  return {
    checkedAt,
    totalNodes,
    usTotal,
    usFixed,
    proxyIpOptions,
    selectedProxyIp,
    customProxyIp,
    persistProxyIpSettings,
    aiGroupOk,
    aiRulesOk,
    speedOk,
    opencodeOk,
    opencodeGroupOptions,
    selectedOpencodeThird,
    onOpencodeThirdChange,
    generating,
    genSummary,
    doGenerate,
    removing,
    doRemove,
    aiRemoving,
    doRemoveAi,
    nodeOptions,
    selectedNode,
    egressVerifyRunning,
    lastVerifyResult,
    egressHistory,
    refreshUs,
    runEgressVerify,
    clearEgressHistory
  }
}

/* ============================================================
 * 主面板
 * ============================================================ */

const onRun = async () => {
  const modal = Plugins.modal({
    title: '网络工具箱',
    width: '92',
    height: '92',
    submit: false,
    cancelText: '关闭',
    onCancel: async () => {
      egressStop?.()
      cancelRun(checkRunBox.current)
      if (runBatchTest.active) {
        runBatchTest.stop?.()
        await runBatchTest.active
      }
      return true
    }
  })

  const checkRunBox = { current: null }

  const content = {
    template: `
      <div class="text-12" style="padding: 16px; line-height: 1.5">
        <div class="flex items-center justify-between gap-8" style="margin-bottom: 16px">
          <div class="flex items-center gap-8">
            <span class="text-20">🧰</span>
            <div>
              <div class="text-16 font-semibold">网络工具箱</div>
              <div class="text-gray-500">体检 · 测速 · 美国出口，一站搞定</div>
            </div>
          </div>
          <div class="flex items-center gap-6 px-8 py-4" style="border: 1px solid #cbd5e1; border-radius: 999px">
            <span :class="kernelRunning ? 'bg-green-500' : 'bg-red-500'" style="width: 7px; height: 7px; border-radius: 999px"></span>
            <span :class="kernelRunning ? 'text-green-500' : 'text-red-500'">{{ kernelRunning ? '内核运行中' : '内核未运行' }}</span>
          </div>
        </div>
        <div class="flex gap-8" style="margin-bottom: 16px">
          <Button :type="tab === 'check' ? 'primary' : 'default'" @click="tab = 'check'">🚀 体检</Button>
          <Button :type="tab === 'speed' ? 'primary' : 'default'" @click="tab = 'speed'">📶 测速</Button>
          <Button :type="tab === 'us' ? 'primary' : 'default'" @click="tab = 'us'">🇺🇸 美国出口</Button>
        </div>

        <div v-show="tab === 'check'">
          <div class="flex items-center justify-between" style="margin-bottom: 8px">
            <div class="text-gray-500">{{checkSummary}}</div>
            <div class="flex items-center gap-8">
              <span v-if="noEndpoint" class="text-red-500">{{envDesc}}</span>
              <Button size="small" @click="retryCheck">重新检测</Button>
            </div>
          </div>
          <div class="grid grid-cols-4 gap-8" style="margin-bottom: 12px">
            <Card v-for="card in cards" :key="card.key" :title="card.title" class="transition-colors cursor-pointer hover:bg-gray-50" @click="refreshNetworkCard(card)">
              <div class="text-18 font-bold" :class="card.loading ? 'text-gray-500' : (card.ok ? 'text-green-500' : 'text-red-500')">{{card.loading ? '检测中…' : (card.ok ? card.ip : '失败')}}</div>
              <div class="mt-4">{{card.place || card.error || '尚未检测'}}</div>
              <div class="mt-4 text-gray-500">{{card.source}} · {{card.elapsed ? card.elapsed.toFixed(0) + ' ms' : '—'}}</div>
            </Card>
          </div>
          <div class="flex items-center justify-between" style="margin-bottom: 8px">
            <div class="font-bold text-16">网站延迟</div>
            <div class="text-gray-500">可用 {{available}}/8 · 平均 {{average}} ms · {{summarySite}}</div>
          </div>
          <div class="grid grid-cols-4 gap-8">
            <Card v-for="site in sites" :key="site.name" :title="site.name" class="transition-colors cursor-pointer hover:bg-gray-50" @click="refreshSiteCard(site)">
              <div class="text-gray-500">{{site.region}}</div>
              <div class="text-18 font-bold mt-4" :class="site.loading ? 'text-gray-500' : (site.latency >= 0 ? site.color : 'text-red-500')">{{site.loading ? '检测中…' : (site.latency >= 0 ? site.latency + ' ms' : 'TIMEOUT')}}</div>
              <div class="text-red-500 mt-4">{{site.error}}</div>
            </Card>
          </div>
        </div>

        <div v-show="tab === 'speed'">
          <div class="grid grid-cols-2 gap-8" style="margin-bottom: 8px">
            <div><div class="text-gray-500 mb-4">策略组</div><Select v-model="form.group" :options="groupOptions" :disabled="running" /></div>
            <div><div class="text-gray-500 mb-4">下载测试 URL</div><div class="flex gap-8"><Select v-model="form.presetUrl" :options="presetUrlOptions" :disabled="running" style="width: 132px" /><Input v-model="form.url" :disabled="running" class="flex-1" /></div></div>
            <div><div class="text-gray-500 mb-4">延迟测试 URL</div><Input v-model="form.pingUrl" :disabled="running" /></div>
            <div><div class="text-gray-500 mb-4">最大延迟（毫秒）</div><Input v-model="form.maxDelay" type="number" :disabled="running" /></div>
            <div><div class="text-gray-500 mb-4">下载时长（秒）</div><Input v-model="form.seconds" type="number" :disabled="running" /></div>
            <div><div class="text-gray-500 mb-4">预检并发数</div><Input v-model="form.concurrency" type="number" :disabled="running" /></div>
            <div><div class="text-gray-500 mb-4">节点数量限制（0=全部）</div><Input v-model="form.limit" type="number" :disabled="running" /></div>
            <div><div class="text-gray-500 mb-4">节点过滤（关键词，留空=全部）</div><Input v-model="form.filter" :disabled="running" placeholder="如 US 美国 LAX" /></div>
            <div><div class="text-gray-500 mb-4">下载数量限制（0=全部合格）</div><Input v-model="form.downloadLimit" type="number" :disabled="running" /></div>
          </div>
          <div class="p-8 rounded bg-gray-50 dark:bg-gray-800" style="margin-bottom: 8px">
            <div class="flex items-center justify-between"><span>{{ statusText }}</span><span>{{ progress }}/{{ total }}</span></div>
            <div class="mt-6 h-4 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden"><div class="h-full bg-primary transition-all" :style="{width: progressPercent + '%'}"></div></div>
            <div class="mt-6 text-gray-500">当前节点：<span class="text-current">{{ currentNode || '—' }}</span></div>
          </div>
          <div class="flex items-center gap-8 flex-wrap" style="margin-bottom: 8px">
            <Button type="primary" :loading="running" @click="start">{{ running ? '测试中…' : '开始测试' }}</Button>
            <Button v-if="running" @click="stop">停止</Button>
            <Button v-else @click="clearResults">清空结果</Button>
            <Button size="small" type="primary" :disabled="running || egressRunning" @click="useFastestUsNode">🇺🇸 最快美国节点 → AI出口</Button>
            <span class="flex items-center gap-4 text-gray-500"><Switch v-model="showUsOnly" :disabled="running" />只看美国</span>
          </div>
          <div class="overflow-auto" style="max-height: 34vh; margin-bottom: 8px">
            <table class="w-full text-12"><thead><tr class="text-left text-gray-500" style="white-space: nowrap"><th class="p-4">节点</th><th class="p-4">延迟</th><th class="p-4">状态</th><th class="p-4">MB/s</th><th class="p-4">Mbps</th><th class="p-4">下载量</th><th class="p-4">有效时间</th><th class="p-4">错误原因</th><th class="p-4">国外出口</th><th class="p-4">操作</th></tr></thead>
            <tbody><tr v-for="row in filteredResults" :key="row.key || row.name" class="border-t border-gray-200 dark:border-gray-700"><td class="p-4">{{ row.name }}</td><td class="p-4" :class="latencyClass(row.delay)" style="white-space: nowrap">{{ formatDelay(row.delay) }}</td><td class="p-4">{{ row.status }}</td><td class="p-4 text-right" style="white-space: nowrap">{{ row.mb }}</td><td class="p-4 text-right" style="white-space: nowrap">{{ row.mbps }}</td><td class="p-4" style="white-space: nowrap">{{ row.bytesText }}</td><td class="p-4" style="white-space: nowrap">{{ row.time }}</td><td class="p-4 text-red-500">{{ row.error || '—' }}</td><td class="p-4" :class="row.overseasCountry === 'US' ? 'text-green-500' : (row.overseasError ? 'text-red-500' : '')" :title="row.overseasError || ''">{{ overseasText(row) }}</td><td class="p-4"><Button size="small" type="primary" :disabled="running || egressRunning || row.status !== '成功'" @click="useResult(row)">使用</Button></td></tr></tbody></table>
            <div v-if="!results.length" class="py-24 text-center text-gray-500">选择策略组后开始测试</div>
            <div v-else-if="!filteredResults.length" class="py-24 text-center text-gray-500">没有美国出口的成功节点，取消「只看美国」或重新测速</div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-gray-500">历史结果<span v-if="speedHistory"> · 保存于 {{ formatTime(speedHistory.savedAt) }} · 策略组 {{ speedHistory.groupName || '—' }}</span></span>
              <div class="flex gap-8">
                <Button v-if="speedHistory" size="small" type="primary" :loading="egressRunning" :disabled="running" @click="egressRunning ? stopEgress() : runEgress()">{{ egressRunning ? '停止' : '国外出口' }}</Button>
                <Button v-if="speedHistory" size="small" :disabled="running || egressRunning" @click="deleteHistory">删除历史</Button>
              </div>
            </div>
            <div v-if="!speedHistory" class="py-12 text-center text-gray-500">暂无历史记录</div>
            <div v-else class="overflow-auto" style="max-height: 22vh">
              <table class="w-full text-12"><thead><tr class="text-left text-gray-500" style="white-space: nowrap"><th class="p-4">节点</th><th class="p-4">延迟</th><th class="p-4">状态</th><th class="p-4">MB/s</th><th class="p-4">Mbps</th><th class="p-4">下载量</th><th class="p-4">有效时间</th><th class="p-4">错误原因</th><th class="p-4">国外出口</th><th class="p-4">操作</th></tr></thead>
              <tbody><tr v-for="row in filteredHistoryResults" :key="row.key || row.name" class="border-t border-gray-200 dark:border-gray-700"><td class="p-4">{{ row.name }}</td><td class="p-4" :class="latencyClass(row.delay)" style="white-space: nowrap">{{ formatDelay(row.delay) }}</td><td class="p-4">{{ row.status }}</td><td class="p-4 text-right" style="white-space: nowrap">{{ row.mb }}</td><td class="p-4 text-right" style="white-space: nowrap">{{ row.mbps }}</td><td class="p-4" style="white-space: nowrap">{{ row.bytesText }}</td><td class="p-4" style="white-space: nowrap">{{ row.time }}</td><td class="p-4 text-red-500">{{ row.error || '—' }}</td><td class="p-4" :class="row.overseasCountry === 'US' ? 'text-green-500' : (row.overseasError ? 'text-red-500' : '')" :title="row.overseasError || ''">{{ overseasText(row) }}</td><td class="p-4"><Button size="small" type="primary" :disabled="running || egressRunning || row.status !== '成功'" @click="useResult(row)">使用</Button></td></tr></tbody></table>
            </div>
          </div>
        </div>

        <div v-show="tab === 'us'">
          <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); background: rgba(148,163,184,.08); border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; margin-bottom: 12px">
            <div style="padding: 14px 16px; border-right: 1px solid #cbd5e1">
              <div class="text-gray-500">美国节点</div>
              <div class="text-16 font-semibold mt-4">{{ usTotal }} <span class="text-12 font-normal text-gray-500">/ {{ totalNodes }}</span></div>
            </div>
            <div style="padding: 14px 16px; border-right: 1px solid #cbd5e1">
              <div class="text-gray-500">ProxyIP 生效</div>
              <div class="text-16 font-semibold mt-4" :class="usTotal > 0 && usFixed === usTotal ? 'text-green-500' : 'text-orange-500'">{{ usFixed }} <span class="text-12 font-normal text-gray-500">/ {{ usTotal }}</span></div>
            </div>
            <div style="padding: 14px 16px">
              <div class="text-gray-500">测速候选</div>
              <div class="text-16 font-semibold mt-4">{{ nodeOptions.length }}</div>
            </div>
          </div>

          <section style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; margin-bottom: 12px">
            <div class="flex items-center justify-between" style="padding: 14px 16px; border-bottom: 1px solid #cbd5e1">
              <div><div class="text-14 font-semibold">配置状态</div><div class="text-gray-500">当前 Profile 的分组和路由规则</div></div>
              <Button size="small" @click="refreshUs">刷新状态</Button>
            </div>
            <div>
              <div class="flex items-center justify-between" style="padding: 12px 16px; border-bottom: 1px solid #cbd5e1">
                <div><div class="font-medium">AI 出口组</div><div class="text-gray-500">🇺🇸 AI出口</div></div>
                <span :class="aiGroupOk ? 'text-green-500' : 'text-red-500'">{{ aiGroupOk ? '✓ 正常' : '✕ 缺失' }}</span>
              </div>
              <div class="flex items-center justify-between" style="padding: 12px 16px; border-bottom: 1px solid #cbd5e1">
                <div><div class="font-medium">AI 分流</div><div class="text-gray-500">OpenAI + Anthropic + meta</div></div>
                <span :class="aiRulesOk ? 'text-green-500' : 'text-red-500'">{{ aiRulesOk ? '✓ 正常' : '✕ 缺失' }}</span>
              </div>
              <div class="flex items-center justify-between" style="padding: 12px 16px; border-bottom: 1px solid #cbd5e1">
                <div><div class="font-medium">测速分流</div><div class="text-gray-500">⚡ 测速相关分组</div></div>
                <span :class="speedOk ? 'text-green-500' : 'text-red-500'">{{ speedOk ? '✓ 正常' : '✕ 缺失' }}</span>
              </div>
              <div class="flex items-center justify-between" style="padding: 12px 16px; border-bottom: 1px solid #cbd5e1">
                <div><div class="font-medium">OpenCode 分组/分流</div><div class="text-gray-500">直连 / AI出口 / 可选分组</div></div>
                <span :class="opencodeOk ? 'text-green-500' : 'text-red-500'">{{ opencodeOk ? '✓ 正常' : '✕ 缺失' }}</span>
              </div>
              <div class="flex items-center justify-between gap-8" style="padding: 12px 16px">
                <div><div class="font-medium">OpenCode 第三出口</div><div class="text-gray-500">生成/修复时作为第三选项</div></div>
                <Select v-model="selectedOpencodeThird" :options="opencodeGroupOptions" :disabled="generating || egressRunning" @change="onOpencodeThirdChange" style="width: 220px" />
              </div>
            </div>
            <div style="padding: 14px 16px; border-top: 1px solid #cbd5e1; background: rgba(148,163,184,.08)">
              <div class="flex items-center justify-between gap-8 mb-8">
                <div><div class="font-medium">ProxyIP 出口池</div><div class="text-gray-500">自定义主机优先于地区预设</div></div>
                <span class="text-blue-500" style="padding: 4px 8px; border: 1px solid #bfdbfe; border-radius: 999px">{{ selectedProxyIp }}</span>
              </div>
              <div class="flex items-center gap-8">
                <Select v-model="selectedProxyIp" :options="proxyIpOptions" style="width: 120px" @change="persistProxyIpSettings" />
                <div style="flex: 1"><Input v-model="customProxyIp" placeholder="自定义 ProxyIP 主机（可选）" @change="persistProxyIpSettings" /></div>
              </div>
            </div>
            <div style="padding: 14px 16px; border-top: 1px solid #cbd5e1">
              <div class="flex items-center gap-8 flex-wrap">
                <Button type="primary" :loading="generating" @click="doGenerate">一键生成 / 修复配置</Button>
                <Button size="small" type="primary" @click="useFastestUsNode">🚀 用最快美国节点</Button>
                <Button size="small" :loading="removing" @click="doRemove">清除测速配置</Button>
                <Button size="small" :loading="aiRemoving" @click="doRemoveAi">清理 AI/OpenCode 配置</Button>
              </div>
              <div v-if="genSummary" class="text-blue-500" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #bfdbfe">{{ genSummary }}</div>
              <div class="text-gray-500" style="margin-top: 8px">配置写入后请重启 GUI，使新的路由和分组进入内核。</div>
            </div>
          </section>

          <section style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; margin-bottom: 12px">
            <div class="flex items-center justify-between" style="padding: 14px 16px; border-bottom: 1px solid #cbd5e1">
              <div><div class="text-14 font-semibold">出口验证</div><div class="text-gray-500">仅显示测速相关分组内的节点，检测后恢复原节点</div></div>
              <span class="text-gray-500" style="padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 999px">{{ nodeOptions.length }} 个候选</span>
            </div>
            <div class="flex items-center gap-8" style="padding: 14px 16px; border-bottom: 1px solid #cbd5e1">
              <div style="flex: 1"><Select v-model="selectedNode" :options="nodeOptions" style="width: 100%" :disabled="egressVerifyRunning" /></div>
              <Button type="primary" :loading="egressVerifyRunning" :disabled="!kernelRunning || !selectedNode" @click="runEgressVerify">{{ egressVerifyRunning ? '检测中…' : '检测出口' }}</Button>
            </div>
            <div v-if="lastVerifyResult" style="margin: 14px 16px; padding: 14px 16px; border: 1px solid #cbd5e1; border-left: 4px solid" :class="lastVerifyResult.country === 'US' ? 'border-green-500' : (lastVerifyResult.ip === '—' ? 'border-red-500' : 'border-orange-500')">
              <div class="flex items-start justify-between gap-12">
                <div style="min-width: 0"><div class="text-gray-500">当前检测结果</div><div class="text-16 font-medium mt-4" style="word-break: break-all">{{ lastVerifyResult.ip || '—' }}</div><div class="text-gray-500 mt-4" style="word-break: break-all">{{ lastVerifyResult.node }}</div></div>
                <div class="text-right" style="flex-shrink: 0"><div class="text-16 font-semibold" :class="lastVerifyResult.country === 'US' ? 'text-green-500' : (lastVerifyResult.ip === '—' ? 'text-red-500' : 'text-orange-500')">{{ lastVerifyResult.country || '未知' }}</div><div class="text-gray-500 mt-4">{{ lastVerifyResult.time || '' }}</div></div>
              </div>
              <div class="flex items-center justify-between gap-12" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #cbd5e1"><span class="font-medium">{{ lastVerifyResult.summary }}</span><span class="text-gray-500 text-right">{{ lastVerifyResult.org || '' }}</span></div>
            </div>
          </section>

          <section style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden">
            <div class="flex items-center justify-between" style="padding: 14px 16px; border-bottom: 1px solid #cbd5e1"><div><div class="text-14 font-semibold">检测历史</div><div class="text-gray-500">最近 20 条结果，成功和失败都会保留</div></div><Button v-if="egressHistory.length" size="small" @click="clearEgressHistory">清空记录</Button></div>
            <div v-if="!egressHistory.length" class="text-center text-gray-500" style="padding: 36px 16px">暂无出口检测记录</div>
            <div v-else style="overflow-x: auto">
              <table class="w-full text-12" style="border-collapse: collapse; min-width: 760px">
                <thead class="text-gray-500" style="background: rgba(148,163,184,.08)"><tr class="text-left"><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">时间</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">节点</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">出口 IP</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">地区</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">ASN / 组织</th><th style="padding: 10px 12px; border-bottom: 1px solid #cbd5e1">判定</th></tr></thead>
                <tbody><tr v-for="h in egressHistory" :key="h.ts" style="border-bottom: 1px solid #cbd5e1"><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; white-space: nowrap">{{ h.time }}</td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; max-width: 260px; word-break: break-all">{{ h.node }}</td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; white-space: nowrap">{{ h.ip }}</td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0"><span :class="h.country === 'US' ? 'text-green-500' : (h.ip === '—' ? 'text-red-500' : 'text-orange-500')">{{ h.country || '未知' }}</span></td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; max-width: 220px; word-break: break-all" class="text-gray-500">{{ h.org }}</td><td style="padding: 10px 12px; min-width: 200px; word-break: break-all">{{ h.summary }}</td></tr></tbody>
              </table>
            </div>
          </section>
        </div>
      </div>`,

    setup() {
      const { ref, onMounted } = Vue
      const api = Plugins.useKernelApiStore()
      const tab = ref('check')
      const kernelRunning = ref(!!api.running)
      const checkRunBox = { current: null }

      const health = setupHealthCheck({ api, checkRunBox })
      const speed = setupSpeedTest({ api })
      const us = setupUsEgress({ api, kernelRunning, egressRunning: speed.egressRunning })

      onMounted(() => {
        if (health.checkRun()) health.detect()
        us.refreshUs()
      })

      return {
        tab,
        kernelRunning,
        ...health,
        ...speed,
        ...us
      }
    }
  }

  modal.setContent(content)
  modal.open()
}
