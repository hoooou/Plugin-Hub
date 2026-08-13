/**
 * 美国出口与测速配置插件（带状态面板）
 *
 * 1. 一键生成配置 —— 按所选或自定义 ProxyIP 改写 🇺🇸 节点 path，并写入分组与分流规则
 * 2. on::generate —— 保持内核配置原样，不自动注入 AI 出口配置
 * 3. on::manual   —— 打开状态面板：
 *    - 显示节点改写 / 分组 / 规则状态
 *    - 「一键生成配置」：把 AI 出口分组/规则、测速分组/分流规则写入 GUI 配置（路由界面可见）
 *    - 「实测出口」：临时切换节点查 ipinfo 出口后自动恢复
 */

const PROXYIP_OPTIONS = [
  { label: 'SG', value: 'ProxyIP.SG.CMLiussss.net' },
  { label: 'JP', value: 'ProxyIP.JP.CMLiussss.net' },
  { label: 'TW', value: 'tw.william.us.ci' },
  { label: 'US', value: 'ProxyIP.US.CMLiussss.net' },
  { label: 'CA', value: 'ProxyIP.CA.CMLiussss.net' }
]
const DEFAULT_PROXYIP_HOST = 'ProxyIP.US.CMLiussss.net'
const SETTINGS_PATH = 'data/plugin-data/us-speed-config/settings.json'
const GROUP_TAG = '🇺🇸 AI出口'
const SPEED_GROUP_TAG = '⚡ 测速专用'
const SPEED_RULESET_NAME = '下载测速分流'
const SPEED_DOMAINS = ['datapacket.com', 'ipinfo.io', 'ipapi.co', 'cmliussss.net', 'api.ip.sb']

const OPENAI_DOMAINS = ['openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com', 'openaiapi.com', 'openai.org', 'sora.com']

const ANTHROPIC_DOMAINS = ['anthropic.com', 'claude.ai']

const OPENAI_GEOSITE_URL = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/openai.json'
const ANTHROPIC_GEOSITE_URL = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/anthropic.json'

const genId = () => 'ID_' + Math.random().toString(36).slice(2, 10)

/** 读取 ProxyIP 设置；文件缺失或内容异常时返回美国默认值。
 * --- @ty.aicoding@ --- */
const loadProxyIpSettings = async () => {
  try {
    const raw = await Plugins.ReadFile(SETTINGS_PATH)
    const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
    const proxyipHost = PROXYIP_OPTIONS.some((item) => item.value === data.proxyipHost) ? data.proxyipHost : DEFAULT_PROXYIP_HOST
    return { proxyipHost, customHost: String(data.customHost || '') }
  } catch {
    return { proxyipHost: DEFAULT_PROXYIP_HOST, customHost: '' }
  }
}

/** 持久化固定 ProxyIP 选择和自定义主机。
 * --- @ty.aicoding@ --- */
const saveProxyIpSettings = async (settings) => {
  const proxyipHost = PROXYIP_OPTIONS.some((item) => item.value === settings.proxyipHost) ? settings.proxyipHost : DEFAULT_PROXYIP_HOST
  const normalized = { proxyipHost, customHost: String(settings.customHost || '').trim() }
  await Plugins.MakeDir('data/plugin-data/us-speed-config')
  await Plugins.WriteFile(SETTINGS_PATH, JSON.stringify(normalized, null, 2))
  return normalized
}

/** 返回当前生效的 ProxyIP 主机，自定义值优先。
 * --- @ty.aicoding@ --- */
const getProxyIpHost = (settings) => String(settings.customHost || '').trim() || settings.proxyipHost || DEFAULT_PROXYIP_HOST

/** 生成订阅节点使用的 ProxyIP transport path。
 * --- @ty.aicoding@ --- */
const getProxyIpPath = (settings) => `/proxyip=${getProxyIpHost(settings)}?globalproxy`

/* ---------------- 自动化钩子 ---------------- */

const onSubscribe = async (proxies, subscription) => {
  return proxies
}

const onGenerate = async (config, profile) => {
  return config
}

/* ---------------- 一键生成配置（写入 GUI 配置，界面可见） ---------------- */

/** 把 AI 出口分组/规则、测速分组/分流规则写入 profiles.yaml / rulesets.yaml / 规则集文件。
 *  幂等：已存在的项跳过。返回 { created: [...], skipped: [...] }。 */
const ensureFullConfig = async () => {
  const created = []
  const skipped = []
  const proxyIpSettings = await loadProxyIpSettings()
  const proxyIpHost = getProxyIpHost(proxyIpSettings)
  const proxyIpPath = getProxyIpPath(proxyIpSettings)
  const profilesPath = 'data/profiles.yaml'
  const raw = await Plugins.ReadFile(profilesPath)
  if (!raw) throw new Error('未找到 profiles.yaml，请先创建 profile')
  const doc = Plugins.YAML.parse(raw)
  const activeProfileId = Plugins.useAppSettingsStore?.()?.app?.kernel?.profile
  const profile = Array.isArray(doc) ? doc.find((item) => item?.id === activeProfileId) : doc
  if (!profile || !Array.isArray(profile.outbounds)) throw new Error('未找到当前 profile 或 profiles.yaml 结构异常')

  /* 点击一键生成时改写订阅文件中的美国节点；订阅更新钩子不再自动改写 */
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

  /* 订阅引用：取第一个 Subscription 型 outbound 条目作为新分组的订阅来源 */
  const subRef =
    profile.outbounds.find((o) => o && o.type === 'Subscription') ||
    profile.outbounds.find((o) => o && Array.isArray(o.outbounds) && o.outbounds.some((x) => x && x.type === 'Subscription'))
  const subEntry = subRef && Array.isArray(subRef.outbounds) ? subRef.outbounds.find((x) => x && x.type === 'Subscription') : subRef
  if (!subEntry) throw new Error('没有找到订阅条目，请先添加订阅')

  /* 1. 🇺🇸 AI出口 组 */
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

  /* 2. 测速专用 组 */
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

  /* 3. 远程规则集（openai / anthropic） */
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

  /* 3.5 清理旧数据（初版：精确匹配、不迁移、有引用则保留） */
  const rulesPre = Array.isArray(profile.route?.rules) ? profile.route.rules : (profile.route.rules = [])
  /* 旧测速分流规则：仅清理旧版非 inline 型（rule_set 等）payload 含 datapacket 的规则；
   * 当前 inline 测速规则予以保留，交由第 4 步归位（避免每次运行删了重建的重复消息） */
  for (let i = rulesPre.length - 1; i >= 0; i--) {
    const r = rulesPre[i]
    if (r && r.type !== 'inline' && String(r.payload || '').includes('datapacket')) {
      rulesPre.splice(i, 1)
      created.push('清理旧测速分流规则')
    }
  }
  /* 旧测速组：仅精确匹配旧名「测速专用」（不含图标），且无任何规则引用时才删 */
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
  /* 旧「下载测速分流」规则集定义：仅精确匹配 local 类型同名条目 */
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i]
    if (r && r.type === 'local' && r.tag === SPEED_RULESET_NAME) {
      rs.splice(i, 1)
      created.push('清理旧规则集: 下载测速分流')
    }
  }

  /* 4. 路由规则：确保三块插件规则各恰有一条，并统一归位到 InsertionPoint 之后（无则数组首位） */
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
  /* 取第一个匹配；多余的同类匹配视为重复副本移除，保证每种插件规则只有一条 */
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
  /* 归位：把三块插件规则从原位置取出，按 speed、openai、anthropic 顺序插到
   * InsertionPoint 之后第一位（无则数组首位）；其余规则保持原相对顺序 */
  const pluginBlock = [speedRule, openaiRule, anthropicRule]
  const blockLabels = ['测速分流规则', 'openai 分流规则', 'anthropic 分流规则']
  const beforeIdx = pluginBlock.map((r) => rules.indexOf(r))
  for (const r of pluginBlock) {
    const i = rules.indexOf(r)
    if (i !== -1) rules.splice(i, 1)
  }
  const insertIdx = rules.findIndex((r) => r && r.type === 'InsertionPoint')
  rules.splice(insertIdx === -1 ? 0 : insertIdx + 1, 0, ...pluginBlock)
  /* 已存在且实际发生移动的规则补一条归位说明（仅在真正移动时提示，避免重复误导消息） */
  pluginBlock.forEach((r, k) => {
    if (beforeIdx[k] !== -1 && rules.indexOf(r) !== beforeIdx[k]) created.push(`${blockLabels[k]}已归位`)
  })

  /* 写回（先备份） */
  try {
    await Plugins.WriteFile(`${profilesPath}.bak-plugin`, raw)
  } catch {}
  await Plugins.WriteFile(profilesPath, Plugins.YAML.stringify(doc))
  return { created, skipped }
}

/* ---------------- 清除测速配置 ---------------- */

/** 删除「⚡ 测速专用」分组与测速分流规则（精确匹配，不动其它配置）。
 *  返回被删除项列表；无匹配项返回空数组。 */
const removeSpeedConfig = async () => {
  const removed = []
  const profilesPath = 'data/profiles.yaml'
  const raw = await Plugins.ReadFile(profilesPath)
  if (!raw) throw new Error('未找到 profiles.yaml，请先创建 profile')
  const doc = Plugins.YAML.parse(raw)
  const activeProfileId = Plugins.useAppSettingsStore?.()?.app?.kernel?.profile
  const profile = Array.isArray(doc) ? doc.find((item) => item?.id === activeProfileId) : doc
  if (!profile || !Array.isArray(profile.outbounds)) throw new Error('未找到当前 profile 或 profiles.yaml 结构异常')

  const rules = Array.isArray(profile.route?.rules) ? profile.route.rules : (profile.route.rules = [])

  /* 0. 找出所有 tag 含「测速」的 selector 分组（清除范围，含任何图标/空格变体） */
  const speedGroups = (profile.outbounds || []).filter((o) => o && o.type === 'selector' && String(o.tag || '').includes('测速'))
  const speedGroupIds = new Set(speedGroups.map((g) => g.id))

  /* 1. 删除测速分流规则：payload 含 datapacket 的 inline 规则，或 outbound 指向任何测速组的规则 */
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i]
    if (!r) continue
    const isSpeedRule = (r.type === 'inline' && String(r.payload || '').includes('datapacket')) || speedGroupIds.has(r.outbound)
    if (isSpeedRule) {
      rules.splice(i, 1)
      removed.push('测速分流规则')
    }
  }

  /* 2. 删除所有含「测速」的分组 */
  for (const g of speedGroups) {
    profile.outbounds.splice(profile.outbounds.indexOf(g), 1)
    removed.push(`分组: ${g.tag}`)
  }

  /* 3. 删除「下载测速分流」规则集定义（local 同名） */
  const rs = Array.isArray(profile.route?.rule_set) ? profile.route.rule_set : []
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i]
    if (r && r.type === 'local' && r.tag === SPEED_RULESET_NAME) {
      rs.splice(i, 1)
      removed.push('下载测速分流 规则集')
    }
  }

  /* 写回（先备份） */
  try {
    await Plugins.WriteFile(`${profilesPath}.bak-plugin`, raw)
  } catch {}
  await Plugins.WriteFile(profilesPath, Plugins.YAML.stringify(doc))
  return removed
}

/* ---------------- 清除 AI 配置 ---------------- */

/** 删除所有 tag 含「AI出口」的 selector 分组、openai/anthropic 规则集分流规则及其引用规则、
 *  openai/anthropic 规则集定义（精确匹配，不动其它配置）。
 *  返回被删除项列表；无匹配项返回空数组。
 * --- @ty.aicoding@ --- */
const removeAiConfig = async () => {
  const removed = []
  const profilesPath = 'data/profiles.yaml'
  const raw = await Plugins.ReadFile(profilesPath)
  if (!raw) throw new Error('未找到 profiles.yaml，请先创建 profile')
  const doc = Plugins.YAML.parse(raw)
  const activeProfileId = Plugins.useAppSettingsStore?.()?.app?.kernel?.profile
  const profile = Array.isArray(doc) ? doc.find((item) => item?.id === activeProfileId) : doc
  if (!profile || !Array.isArray(profile.outbounds)) throw new Error('未找到当前 profile 或 profiles.yaml 结构异常')

  const rules = Array.isArray(profile.route?.rules) ? profile.route.rules : (profile.route.rules = [])

  /* 0. 找出所有 tag 含「AI出口」的 selector 分组（清除范围，含任何图标/空格变体） */
  const aiGroups = (profile.outbounds || []).filter((o) => o && String(o.tag || '').includes('AI出口'))
  const aiGroupIds = new Set(aiGroups.map((g) => g.id))

  /* 1. 删除 openai/anthropic 规则集分流规则，或 outbound 指向任何 AI 出口组的规则（不论规则类型） */
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i]
    if (!r) continue
    const isAiRule = (r.type === 'rule_set' && (r.payload === 'openai-geosite.json' || r.payload === 'anthropic-geosite.json')) || aiGroupIds.has(r.outbound)
    if (isAiRule) {
      rules.splice(i, 1)
      removed.push('AI 分流规则')
    }
  }

  /* 2. 删除所有含「AI出口」的分组 */
  for (const g of aiGroups) {
    profile.outbounds.splice(profile.outbounds.indexOf(g), 1)
    removed.push(`分组: ${g.tag}`)
  }

  /* 3. 删除 openai/anthropic 规则集定义（tag 精确匹配） */
  const rs = Array.isArray(profile.route?.rule_set) ? profile.route.rule_set : []
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i]
    if (r && (r.tag === 'openai-geosite.json' || r.tag === 'anthropic-geosite.json')) {
      rs.splice(i, 1)
      removed.push(`规则集: ${r.tag}`)
    }
  }

  /* 写回（先备份） */
  try {
    await Plugins.WriteFile(`${profilesPath}.bak-plugin`, raw)
  } catch {}
  await Plugins.WriteFile(profilesPath, Plugins.YAML.stringify(doc))
  return removed
}

/* ---------------- 状态面板 ---------------- */

const HISTORY_PATH = () => 'data/plugin-data/us-speed-config/history.json'

const createProxyUrl = (endpoint) => {
  if (!endpoint || !endpoint.host || !endpoint.port) throw new Error('没有可用的本地代理入站')
  const host = String(endpoint.host).includes(':') && !String(endpoint.host).startsWith('[') ? `[${endpoint.host}]` : endpoint.host
  const auth = endpoint.username ? `${encodeURIComponent(endpoint.username)}:${encodeURIComponent(endpoint.password || '')}@` : ''
  return `${endpoint.schema || endpoint.proxyType || 'http'}://${auth}${host}:${endpoint.port}`
}

const loadHistory = async () => {
  try {
    const raw = await Plugins.ReadFile(HISTORY_PATH())
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

const saveHistory = async (list) => {
  try {
    await Plugins.MakeDir('data/plugin-data/us-speed-config')
    await Plugins.WriteFile(HISTORY_PATH(), JSON.stringify(list.slice(0, 20), null, 2))
  } catch {}
}

const onRun = async () => {
  const modal = Plugins.modal({
    title: '美国出口与测速配置',
    width: '88',
    height: '88',
    submit: false,
    cancelText: '关闭'
  })

  const content = {
    template: `
      <div class="text-12" style="padding: 16px; line-height: 1.5">
        <section style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; margin-bottom: 12px">
          <div class="flex items-center justify-between" style="padding: 14px 16px; border-bottom: 1px solid #cbd5e1; background: rgba(59,130,246,.08)">
            <div class="flex items-center gap-8">
              <span class="text-20">🇺🇸</span>
              <div>
                <div class="text-16 font-semibold">AI 出口控制台</div>
                <div class="text-gray-500">ProxyIP 改写、AI 分流与出口验证</div>
              </div>
            </div>
            <div class="flex items-center gap-6 px-8 py-4" style="border: 1px solid #cbd5e1; border-radius: 999px; background: rgba(255,255,255,.55)">
              <span :class="kernelRunning ? 'bg-green-500' : 'bg-red-500'" style="width: 7px; height: 7px; border-radius: 999px"></span>
              <span :class="kernelRunning ? 'text-green-500' : 'text-red-500'">{{ kernelRunning ? '内核运行中' : '内核未运行' }}</span>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); background: rgba(148,163,184,.08)">
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
          <div class="text-gray-500" style="padding: 10px 16px; border-top: 1px solid #cbd5e1">最后检查：{{ checkedAt || '—' }}</div>
        </section>

        <section style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; margin-bottom: 12px">
          <div class="flex items-center justify-between" style="padding: 14px 16px; border-bottom: 1px solid #cbd5e1">
            <div>
              <div class="text-14 font-semibold">配置状态</div>
              <div class="text-gray-500">当前 Profile 的分组和路由规则</div>
            </div>
            <Button size="small" @click="refresh">刷新状态</Button>
          </div>
          <div>
            <div class="flex items-center justify-between" style="padding: 12px 16px; border-bottom: 1px solid #cbd5e1">
              <div><div class="font-medium">AI 出口组</div><div class="text-gray-500">🇺🇸 AI出口</div></div>
              <span :class="aiGroupOk ? 'text-green-500' : 'text-red-500'">{{ aiGroupOk ? '✓ 正常' : '✕ 缺失' }}</span>
            </div>
            <div class="flex items-center justify-between" style="padding: 12px 16px; border-bottom: 1px solid #cbd5e1">
              <div><div class="font-medium">AI 分流</div><div class="text-gray-500">OpenAI + Anthropic</div></div>
              <span :class="aiRulesOk ? 'text-green-500' : 'text-red-500'">{{ aiRulesOk ? '✓ 正常' : '✕ 缺失' }}</span>
            </div>
            <div class="flex items-center justify-between" style="padding: 12px 16px">
              <div><div class="font-medium">测速分流</div><div class="text-gray-500">⚡ 测速相关分组</div></div>
              <span :class="speedOk ? 'text-green-500' : 'text-red-500'">{{ speedOk ? '✓ 正常' : '✕ 缺失' }}</span>
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
              <Button size="small" :loading="removing" @click="doRemove">清除测速配置</Button>
              <Button size="small" :loading="aiRemoving" @click="doRemoveAi">清理 AI 配置</Button>
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
            <div style="flex: 1"><Select v-model="selectedNode" :options="nodeOptions" style="width: 100%" :disabled="egressRunning" /></div>
            <Button type="primary" :loading="egressRunning" :disabled="!kernelRunning || !selectedNode" @click="runEgress">{{ egressRunning ? '检测中…' : '检测出口' }}</Button>
          </div>
          <div v-if="lastResult" style="margin: 14px 16px; padding: 14px 16px; border: 1px solid #cbd5e1; border-left: 4px solid" :class="lastResult.country === 'US' ? 'border-green-500' : (lastResult.ip === '—' ? 'border-red-500' : 'border-orange-500')">
            <div class="flex items-start justify-between gap-12">
              <div style="min-width: 0"><div class="text-gray-500">当前检测结果</div><div class="text-16 font-medium mt-4" style="word-break: break-all">{{ lastResult.ip || '—' }}</div><div class="text-gray-500 mt-4" style="word-break: break-all">{{ lastResult.node }}</div></div>
              <div class="text-right" style="flex-shrink: 0"><div class="text-16 font-semibold" :class="lastResult.country === 'US' ? 'text-green-500' : (lastResult.ip === '—' ? 'text-red-500' : 'text-orange-500')">{{ lastResult.country || '未知' }}</div><div class="text-gray-500 mt-4">{{ lastResult.time || '' }}</div></div>
            </div>
            <div class="flex items-center justify-between gap-12" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #cbd5e1"><span class="font-medium">{{ lastResult.summary }}</span><span class="text-gray-500 text-right">{{ lastResult.org || '' }}</span></div>
          </div>
        </section>

        <section style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden">
          <div class="flex items-center justify-between" style="padding: 14px 16px; border-bottom: 1px solid #cbd5e1"><div><div class="text-14 font-semibold">检测历史</div><div class="text-gray-500">最近 20 条结果，成功和失败都会保留</div></div><Button v-if="history.length" size="small" @click="clearHistory">清空记录</Button></div>
          <div v-if="!history.length" class="text-center text-gray-500" style="padding: 36px 16px">暂无出口检测记录</div>
          <div v-else style="overflow-x: auto">
            <table class="w-full text-12" style="border-collapse: collapse; min-width: 760px">
              <thead class="text-gray-500" style="background: rgba(148,163,184,.08)"><tr class="text-left"><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">时间</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">节点</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">出口 IP</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">地区</th><th style="padding: 10px 12px; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1">ASN / 组织</th><th style="padding: 10px 12px; border-bottom: 1px solid #cbd5e1">判定</th></tr></thead>
              <tbody><tr v-for="h in history" :key="h.ts" style="border-bottom: 1px solid #cbd5e1"><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; white-space: nowrap">{{ h.time }}</td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; max-width: 260px; word-break: break-all">{{ h.node }}</td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; white-space: nowrap">{{ h.ip }}</td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0"><span :class="h.country === 'US' ? 'text-green-500' : (h.ip === '—' ? 'text-red-500' : 'text-orange-500')">{{ h.country || '未知' }}</span></td><td style="padding: 10px 12px; border-right: 1px solid #e2e8f0; max-width: 220px; word-break: break-all" class="text-gray-500">{{ h.org }}</td><td style="padding: 10px 12px; min-width: 200px; word-break: break-all">{{ h.summary }}</td></tr></tbody>
            </table>
          </div>
        </section>
      </div>`,
    setup() {
      const { ref, onMounted } = Vue
      const kernelApi = Plugins.useKernelApiStore()
      const subscribesStore = Plugins.useSubscribesStore()

      const checkedAt = ref('')
      const kernelRunning = ref(false)
      const totalNodes = ref(0)
      const usTotal = ref(0)
      const usFixed = ref(0)
      const proxyIpOptions = PROXYIP_OPTIONS
      const selectedProxyIp = ref(DEFAULT_PROXYIP_HOST)
      const customProxyIp = ref('')
      const aiGroupOk = ref(false)
      const aiRulesOk = ref(false)
      const speedOk = ref(false)
      const generating = ref(false)
      const genSummary = ref('')
      const nodeOptions = ref([])
      const selectedNode = ref('')
      const egressRunning = ref(false)
      const lastResult = ref(null)
      const history = ref([])

      /** 保存面板中的 ProxyIP 设置，并将规范化后的值同步回控件。
       * --- @ty.aicoding@ --- */
      const persistProxyIpSettings = async () => {
        const saved = await saveProxyIpSettings({ proxyipHost: selectedProxyIp.value, customHost: customProxyIp.value })
        selectedProxyIp.value = saved.proxyipHost
        customProxyIp.value = saved.customHost
      }

      const loadDiskProxies = async () => {
        const all = []
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
          } catch {}
        }
        return all
      }

      const refresh = async () => {
        checkedAt.value = new Date().toLocaleTimeString()
        kernelRunning.value = !!kernelApi.running
        const proxyIpSettings = await loadProxyIpSettings()
        selectedProxyIp.value = proxyIpSettings.proxyipHost
        customProxyIp.value = proxyIpSettings.customHost
        const proxyIpPath = getProxyIpPath(proxyIpSettings)
        const all = await loadDiskProxies()
        totalNodes.value = all.length
        const us = all.filter((p) => p.tag.includes('🇺🇸'))
        usTotal.value = us.length
        usFixed.value = us.filter((p) => p.transport && p.transport.path === proxyIpPath).length
        const speedGroups = Object.values(kernelApi.proxies || {}).filter(
          (g) => g?.type === 'Selector' && Array.isArray(g.all) && /测速/.test(String(g.name || g.tag || ''))
        )
        nodeOptions.value = speedGroups.flatMap((group) => {
          const groupName = group.name || group.tag
          return group.all
            .filter((nodeName) => (kernelApi.proxies || {})[nodeName] && !['DIRECT', 'REJECT'].includes(String(nodeName).toUpperCase()))
            .map((nodeName) => ({ label: `${groupName} / ${nodeName}`, value: `${groupName}::${nodeName}`, groupName, nodeName }))
        })
        if (!nodeOptions.value.some((item) => item.value === selectedNode.value)) selectedNode.value = nodeOptions.value[0]?.value || ''

        /* 读 profiles.yaml 检查 GUI 配置项 */
        aiGroupOk.value = false
        aiRulesOk.value = false
        speedOk.value = false
        try {
          const raw = await Plugins.ReadFile('data/profiles.yaml')
          if (raw) {
            const doc = Plugins.YAML.parse(raw)
            const activeProfileId = Plugins.useAppSettingsStore?.()?.app?.kernel?.profile
            const profile = Array.isArray(doc) ? doc.find((item) => item?.id === activeProfileId) : doc
            if (!profile) throw new Error('未找到当前 profile')
            const outs = profile.outbounds || []
            const aiGroup = outs.find((o) => o && o.tag === GROUP_TAG)
            const speedGroup = outs.find((o) => o && o.tag === SPEED_GROUP_TAG)
            const rs = profile.route?.rule_set || []
            const rules = profile.route?.rules || []
            const openaiRs = rs.find((r) => r && (r.url || '').includes('openai'))
            const anthropicRs = rs.find((r) => r && (r.url || '').includes('anthropic'))
            const speedInline = rules.find((r) => r && r.type === 'inline' && String(r.payload || '').includes('datapacket'))
            aiGroupOk.value = !!aiGroup
            aiRulesOk.value = !!(
              openaiRs &&
              anthropicRs &&
              rules.some((r) => r && r.payload === openaiRs.id && r.outbound === aiGroup?.id) &&
              rules.some((r) => r && r.payload === anthropicRs.id && r.outbound === aiGroup?.id)
            )
            speedOk.value = !!(speedGroup && speedInline && speedInline.outbound === speedGroup.id)
          }
        } catch {}
        history.value = await loadHistory()
      }

      const doGenerate = async () => {
        if (generating.value) return
        generating.value = true
        genSummary.value = ''
        try {
          await persistProxyIpSettings()
          const { created, skipped } = await ensureFullConfig()
          genSummary.value = created.length ? `已生成：${created.join('、')}（请重启 GUI 生效）` : `配置已完整（${skipped.length} 项均存在）`
          if (created.length) Plugins.message.success('配置已写入，请重启 GUI 使其生效')
          else Plugins.message.success('配置已完整，无需生成')
          await refresh()
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
          const removed = await removeSpeedConfig()
          genSummary.value = removed.length ? `已清除：${removed.join('、')}（请重启 GUI 生效）` : '没有可清除的测速配置'
          Plugins.message.success(removed.length ? '已清除，请重启 GUI 生效' : '没有可清除的测速配置')
          await refresh()
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
        const ok = await Plugins.confirm('清理 AI 配置', '确定删除所有「AI出口」分组、OpenAI/Anthropic 分流规则与规则集定义吗？删除后请重启 GUI 生效。').catch(
          () => false
        )
        if (!ok) return
        aiRemoving.value = true
        genSummary.value = ''
        try {
          const removed = await removeAiConfig()
          genSummary.value = removed.length ? `已清理：${removed.join('、')}（请重启 GUI 生效）` : '没有可清理的 AI 配置'
          Plugins.message.success(removed.length ? '已清理，请重启 GUI 生效' : '没有可清理的 AI 配置')
          await refresh()
        } catch (e) {
          Plugins.message.error(String(e?.message || e).slice(0, 120))
          genSummary.value = '清理失败'
        } finally {
          aiRemoving.value = false
        }
      }

      const runEgress = async () => {
        if (egressRunning.value) return
        egressRunning.value = true
        let original = null
        let speedGroup = null
        let testedNode = ''
        try {
          const proxyUrl = createProxyUrl(kernelApi.getProxyEndpoint())
          const selected = nodeOptions.value.find((item) => item.value === selectedNode.value)
          if (!selected) throw new Error('请选择测速相关分组内的节点')
          speedGroup = (kernelApi.proxies || {})[selected.groupName]
          if (
            !speedGroup ||
            speedGroup.type !== 'Selector' ||
            !Array.isArray(speedGroup.all) ||
            !/测速/.test(String(speedGroup.name || speedGroup.tag || ''))
          ) {
            throw new Error('所选测速分组不存在，请刷新状态')
          }
          testedNode = selected.nodeName
          if (!speedGroup.all.includes(testedNode)) throw new Error('所选节点不在测速分组中')
          const proxy = (kernelApi.proxies || {})[testedNode]
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
          lastResult.value = row
          history.value.unshift(row)
          history.value = history.value.slice(0, 20)
          await saveHistory(history.value)
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
          lastResult.value = row
          history.value.unshift(row)
          history.value = history.value.slice(0, 20)
          await saveHistory(history.value)
        } finally {
          if (original && speedGroup) {
            try {
              const back = (kernelApi.proxies || {})[original]
              if (back) await Plugins.handleUseProxy(speedGroup, back)
            } catch {}
          }
          egressRunning.value = false
        }
      }

      const clearHistory = async () => {
        history.value = []
        await saveHistory([])
      }

      onMounted(() => {
        refresh()
      })

      return {
        checkedAt,
        kernelRunning,
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
        generating,
        genSummary,
        doGenerate,
        removing,
        doRemove,
        aiRemoving,
        doRemoveAi,
        nodeOptions,
        selectedNode,
        egressRunning,
        lastResult,
        history,
        refresh,
        runEgress,
        clearHistory
      }
    }
  }

  modal.setContent(content)
  modal.open()
}
