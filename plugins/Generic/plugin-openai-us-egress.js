/**
 * 美国出口与测速配置插件（带状态面板）
 *
 * 1. on::subscribe —— 订阅更新后自动把 🇺🇸 节点的 path 改为纯美国 proxyip 池 + globalproxy
 * 2. on::generate —— 内核配置生成前兜底注入（GUI 配置缺失时）；已有规则则跳过
 * 3. on::manual   —— 打开状态面板：
 *    - 显示节点改写 / 分组 / 规则状态
 *    - 「一键生成配置」：把 AI 出口分组/规则、测速分组/分流规则写入 GUI 配置（路由界面可见）
 *    - 「实测出口」：临时切换节点查 ipinfo 出口后自动恢复
 */

const US_PROXYIP_PATH = '/proxyip=ProxyIP.US.CMLiussss.net?globalproxy'
const GROUP_TAG = '🇺🇸 AI出口'
const SPEED_GROUP_TAG = '⚡ 测速专用'
const SPEED_RULESET_NAME = '下载测速分流'
const SPEED_DOMAINS = ['datapacket.com', 'ipinfo.io', 'ipapi.co', 'cmliussss.net']

const OPENAI_DOMAINS = [
  'openai.com',
  'chatgpt.com',
  'oaistatic.com',
  'oaiusercontent.com',
  'openaiapi.com',
  'openai.org',
  'sora.com',
]

const ANTHROPIC_DOMAINS = ['anthropic.com', 'claude.ai']

const OPENAI_GEOSITE_URL = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/openai.json'
const ANTHROPIC_GEOSITE_URL = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo/geosite/anthropic.json'

const genId = () => 'ID_' + Math.random().toString(36).slice(2, 10)

/* ---------------- 自动化钩子 ---------------- */

const onSubscribe = async (proxies, subscription) => {
  for (const p of proxies || []) {
    if (p && typeof p.tag === 'string' && p.tag.includes('🇺🇸') && p.transport) {
      p.transport.path = US_PROXYIP_PATH
    }
  }
  return proxies
}

const onGenerate = async (config, profile) => {
  try {
    const outs = Array.isArray(config?.outbounds) ? config.outbounds : []
    const usTags = outs
      .filter((o) => o && typeof o.tag === 'string' && o.tag.includes('🇺🇸'))
      .map((o) => o.tag)
    if (usTags.length === 0) return config

    if (!outs.some((o) => o && o.tag === GROUP_TAG)) {
      outs.push({
        type: 'urltest',
        tag: GROUP_TAG,
        outbounds: usTags,
        url: 'https://www.gstatic.com/generate_204',
        interval: '3m',
        tolerance: 150,
      })
    }

    if (config.route && Array.isArray(config.route.rules)) {
      const rules = config.route.rules
      const hasOpenaiRule = rules.some((r) => {
        if (!r) return false
        const ds = r.domain_suffix
        if (Array.isArray(ds) && ds.some((d) => String(d).includes('openai.com'))) return true
        if (typeof ds === 'string' && ds.includes('openai.com')) return true
        const rs = r.rule_set
        const rsArr = Array.isArray(rs) ? rs : [rs]
        if (rsArr.some((t) => String(t || '').toLowerCase().includes('openai'))) return true
        return false
      })
      if (!hasOpenaiRule && !rules.some((r) => r && r.outbound === GROUP_TAG)) {
        rules.unshift(
          { domain_suffix: OPENAI_DOMAINS, outbound: GROUP_TAG },
          { domain_suffix: ANTHROPIC_DOMAINS, outbound: GROUP_TAG },
        )
      }
    }
  } catch (e) {
    console.error('[us-speed-config] onGenerate failed:', e)
  }
  return config
}

/* ---------------- 一键生成配置（写入 GUI 配置，界面可见） ---------------- */

/** 把 AI 出口分组/规则、测速分组/分流规则写入 profiles.yaml / rulesets.yaml / 规则集文件。
 *  幂等：已存在的项跳过。返回 { created: [...], skipped: [...] }。 */
const ensureFullConfig = async () => {
  const created = []
  const skipped = []
  const profilesPath = 'data/profiles.yaml'
  const raw = await Plugins.ReadFile(profilesPath)
  if (!raw) throw new Error('未找到 profiles.yaml，请先创建 profile')
  const doc = Plugins.YAML.parse(raw)
  const profile = Array.isArray(doc) ? doc[0] : doc
  if (!profile || !Array.isArray(profile.outbounds)) throw new Error('profiles.yaml 结构异常')

  /* 订阅引用：取第一个 Subscription 型 outbound 条目作为新分组的订阅来源 */
  const subRef = profile.outbounds.find((o) => o && o.type === 'Subscription') || profile.outbounds.find((o) => o && Array.isArray(o.outbounds) && o.outbounds.some((x) => x && x.type === 'Subscription'))
  const subEntry = subRef && Array.isArray(subRef.outbounds) ? subRef.outbounds.find((x) => x && x.type === 'Subscription') : subRef
  if (!subEntry) throw new Error('没有找到订阅条目，请先添加订阅')

  /* 1. 🇺🇸 AI出口 组 */
  let aiGroup = profile.outbounds.find((o) => o && o.tag === GROUP_TAG)
  if (!aiGroup) {
    aiGroup = {
      id: genId(), tag: GROUP_TAG, type: 'selector',
      outbounds: [{ id: subEntry.id, tag: subEntry.tag, type: 'Subscription' }],
      interrupt_exist_connections: true,
      url: 'https://www.gstatic.com/generate_204', interval: '3m', tolerance: 150,
      include: '🇺🇸|US|美', exclude: '', icon: '', hidden: false,
    }
    profile.outbounds.push(aiGroup)
    created.push('🇺🇸 AI出口 分组')
  } else skipped.push('🇺🇸 AI出口 分组')

  /* 2. 测速专用 组 */
  let speedGroup = profile.outbounds.find((o) => o && o.tag === SPEED_GROUP_TAG)
  if (!speedGroup) {
    speedGroup = {
      id: genId(), tag: SPEED_GROUP_TAG, type: 'selector',
      outbounds: [{ id: subEntry.id, tag: subEntry.tag, type: 'Subscription' }],
      interrupt_exist_connections: true,
      url: 'https://www.gstatic.com/generate_204', interval: '3m', tolerance: 150,
      include: '', exclude: '', icon: '', hidden: false,
    }
    profile.outbounds.push(speedGroup)
    created.push('测速专用 分组')
  } else skipped.push('测速专用 分组')

  /* 3. 远程规则集（openai / anthropic） */
  const rs = Array.isArray(profile.route?.rule_set) ? profile.route.rule_set : (profile.route.rule_set = [])
  let openaiRs = rs.find((r) => r && (r.url || '').includes('openai'))
  if (!openaiRs) {
    openaiRs = { id: genId(), type: 'remote', tag: 'openai-geosite.json', format: 'source', url: OPENAI_GEOSITE_URL, download_detour: '', update_interval: '', rules: '', path: '' }
    rs.push(openaiRs)
    created.push('openai 规则集')
  } else skipped.push('openai 规则集')
  let anthropicRs = rs.find((r) => r && (r.url || '').includes('anthropic'))
  if (!anthropicRs) {
    anthropicRs = { id: genId(), type: 'remote', tag: 'anthropic-geosite.json', format: 'source', url: ANTHROPIC_GEOSITE_URL, download_detour: '', update_interval: '', rules: '', path: '' }
    rs.push(anthropicRs)
    created.push('anthropic 规则集')
  } else skipped.push('anthropic 规则集')

  /* 3.5 清理旧数据（初版：精确匹配、不迁移、有引用则保留） */
  const rulesPre = Array.isArray(profile.route?.rules) ? profile.route.rules : (profile.route.rules = [])
  /* 旧测速分流规则：任何 payload 含 datapacket 的规则（inline 或 rule_set 型），统一删除，稍后重建 */
  for (let i = rulesPre.length - 1; i >= 0; i--) {
    const r = rulesPre[i]
    if (r && String(r.payload || '').includes('datapacket')) {
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

  /* 4. 路由规则 */
  const rules = rulesPre
  const mkRule = (id, payload, outbound) => ({ id, type: 'rule_set', enable: true, payload, invert: false, action: 'route', outbound, sniffer: [], strategy: 'default', server: '' })
  if (!rules.some((r) => r && r.payload === openaiRs.id)) {
    rules.push(mkRule(genId(), openaiRs.id, aiGroup.id))
    created.push('openai 分流规则')
  } else skipped.push('openai 分流规则')
  if (!rules.some((r) => r && r.payload === anthropicRs.id)) {
    rules.push(mkRule(genId(), anthropicRs.id, aiGroup.id))
    created.push('anthropic 分流规则')
  } else skipped.push('anthropic 分流规则')
  if (!rules.some((r) => r && r.type === 'inline' && String(r.payload || '').includes('datapacket'))) {
    const speedRule = {
      id: genId(), type: 'inline', enable: true,
      payload: JSON.stringify({ domain: SPEED_DOMAINS }, null, 2),
      invert: false, action: 'route', outbound: speedGroup.id,
      sniffer: [], strategy: 'default', server: '',
    }
    /* 放最上面：InsertionPoint 之后第一位 */
    const insertIdx = rules.findIndex((r) => r && r.type === 'InsertionPoint')
    if (insertIdx === -1) rules.unshift(speedRule)
    else rules.splice(insertIdx + 1, 0, speedRule)
    created.push('测速分流规则（置顶 inline）')
  } else skipped.push('测速分流规则（置顶 inline）')

  /* 写回（先备份） */
  try { await Plugins.WriteFile(`${profilesPath}.bak-plugin`, raw) } catch {}
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
  const profile = Array.isArray(doc) ? doc[0] : doc
  if (!profile || !Array.isArray(profile.outbounds)) throw new Error('profiles.yaml 结构异常')

  const rules = Array.isArray(profile.route?.rules) ? profile.route.rules : (profile.route.rules = [])

  /* 0. 找出所有 tag 含「测速」的 selector 分组（清除范围，含任何图标/空格变体） */
  const speedGroups = (profile.outbounds || []).filter((o) => o && o.type === 'selector' && String(o.tag || '').includes('测速'))
  const speedGroupIds = new Set(speedGroups.map((g) => g.id))

  /* 1. 删除测速分流规则：payload 含 datapacket 的规则，或 outbound 指向任何测速组的规则 */
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i]
    if (!r) continue
    const isSpeedRule = String(r.payload || '').includes('datapacket') || speedGroupIds.has(r.outbound)
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
  try { await Plugins.WriteFile(`${profilesPath}.bak-plugin`, raw) } catch {}
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
  } catch { return [] }
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
    width: '72',
    height: '85',
    submit: false,
    cancelText: '关闭',
  })

  const content = {
    template: `
      <div class="p-8 text-12">
        <div class="text-gray-500 mb-4">自动化状态（{{ checkedAt }}）</div>
        <div class="grid grid-cols-2 gap-8">
          <div class="p-8 rounded bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <span>内核</span>
            <span :class="kernelRunning ? 'text-green-500' : 'text-red-500'">{{ kernelRunning ? '运行中' : '未运行' }}</span>
          </div>
          <div class="p-8 rounded bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <span>🇺🇸 节点 / 总数</span>
            <span>{{ usTotal }} / {{ totalNodes }}</span>
          </div>
          <div class="p-8 rounded bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <span>US 池改写</span>
            <span :class="usTotal > 0 && usFixed === usTotal ? 'text-green-500' : 'text-red-500'">
              {{ usFixed }}/{{ usTotal }} {{ usTotal > 0 && usFixed === usTotal ? '✓ 全部生效' : '✗ 未全部生效' }}
            </span>
          </div>
          <div class="p-8 rounded bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <span>🇺🇸 AI出口 分组</span>
            <span :class="aiGroupOk ? 'text-green-500' : 'text-red-500'">{{ aiGroupOk ? '✓ 已配置' : '✗ 缺失' }}</span>
          </div>
          <div class="p-8 rounded bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <span>AI 分流规则</span>
            <span :class="aiRulesOk ? 'text-green-500' : 'text-red-500'">{{ aiRulesOk ? '✓ 已配置' : '✗ 缺失' }}</span>
          </div>
          <div class="p-8 rounded bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <span>测速专用 分组 + 分流规则</span>
            <span :class="speedOk ? 'text-green-500' : 'text-red-500'">{{ speedOk ? '✓ 已配置' : '✗ 缺失' }}</span>
          </div>
        </div>

        <div class="flex gap-8 mt-8 items-center flex-wrap">
          <Button type="primary" :loading="generating" @click="doGenerate">一键生成配置（写入路由界面）</Button>
          <Button size="small" :loading="removing" @click="doRemove">清除测速配置</Button>
          <Button size="small" @click="refresh">刷新状态</Button>
          <span v-if="genSummary" class="text-gray-500">{{ genSummary }}</span>
        </div>
        <div class="mt-4 text-gray-400">生成或清除后请立即重启 GUI（运行中会被 GUI 覆盖）</div>

        <div class="mt-12 text-gray-500 mb-4">实测出口（临时切换主节点，完成后自动恢复）</div>
        <div class="flex gap-8 items-center">
          <Select v-model="selectedNode" :options="nodeOptions" style="width: 300px" :disabled="egressRunning" />
          <Button type="primary" :loading="egressRunning" :disabled="!kernelRunning || !selectedNode" @click="runEgress">
            {{ egressRunning ? '测试中…' : '实测出口' }}
          </Button>
        </div>
        <div v-if="lastResult" class="mt-8 p-8 rounded bg-gray-50 dark:bg-gray-800">
          <div class="flex items-center gap-8 flex-wrap">
            <span class="text-16 font-medium">{{ lastResult.ip || '—' }}</span>
            <span :class="lastResult.country === 'US' ? 'text-green-500' : (lastResult.country && lastResult.country !== 'US' ? 'text-orange-500' : '')">{{ lastResult.country || '未知' }}</span>
            <span class="text-gray-500">{{ lastResult.org || '' }}</span>
            <span class="text-gray-400">{{ lastResult.time || '' }}</span>
          </div>
          <div class="mt-4 text-12" :class="lastResult.country === 'US' ? 'text-green-500' : 'text-orange-500'">{{ lastResult.summary }}</div>
        </div>

        <div class="mt-8">
          <div class="flex items-center justify-between mb-4">
            <span class="text-gray-500">历史记录（最近 20 条）</span>
            <Button v-if="history.length" size="small" @click="clearHistory">清空</Button>
          </div>
          <div v-if="!history.length" class="py-12 text-center text-gray-500">暂无记录</div>
          <table v-else class="w-full text-12">
            <thead><tr class="text-left text-gray-500"><th class="p-4">时间</th><th class="p-4">节点</th><th class="p-4">出口 IP</th><th class="p-4">国家</th><th class="p-4">ASN</th><th class="p-4">判定</th></tr></thead>
            <tbody>
              <tr v-for="h in history" :key="h.ts" class="border-t border-gray-200 dark:border-gray-700">
                <td class="p-4">{{ h.time }}</td>
                <td class="p-4">{{ h.node }}</td>
                <td class="p-4">{{ h.ip }}</td>
                <td class="p-4" :class="h.country === 'US' ? 'text-green-500' : 'text-orange-500'">{{ h.country }}</td>
                <td class="p-4 text-gray-500">{{ h.org }}</td>
                <td class="p-4">{{ h.summary }}</td>
              </tr>
            </tbody>
          </table>
        </div>
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

      const loadDiskProxies = async () => {
        const all = []
        for (const sub of subscribesStore.subscribes || []) {
          const path = sub.path || sub.file
          if (!path) continue
          try {
            const raw = await Plugins.ReadFile(path)
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw
            const list = Array.isArray(data) ? data : (data && Array.isArray(data.outbounds) ? data.outbounds : [])
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
        const all = await loadDiskProxies()
        totalNodes.value = all.length
        const us = all.filter((p) => p.tag.includes('🇺🇸'))
        usTotal.value = us.length
        usFixed.value = us.filter((p) => p.transport && p.transport.path === US_PROXYIP_PATH).length
        nodeOptions.value = us.map((p) => ({ label: p.tag, value: p.tag }))
        if (!selectedNode.value && nodeOptions.value.length) selectedNode.value = nodeOptions.value[0].value

        /* 读 profiles.yaml 检查 GUI 配置项 */
        aiGroupOk.value = false
        aiRulesOk.value = false
        speedOk.value = false
        try {
          const raw = await Plugins.ReadFile('data/profiles.yaml')
          if (raw) {
            const doc = Plugins.YAML.parse(raw)
            const profile = Array.isArray(doc) ? doc[0] : doc
            const outs = profile.outbounds || []
            const aiGroup = outs.find((o) => o && o.tag === GROUP_TAG)
            const speedGroup = outs.find((o) => o && o.tag === SPEED_GROUP_TAG)
            const rs = profile.route?.rule_set || []
            const rules = profile.route?.rules || []
            const openaiRs = rs.find((r) => r && (r.url || '').includes('openai'))
            const anthropicRs = rs.find((r) => r && (r.url || '').includes('anthropic'))
            const speedInline = rules.find((r) => r && r.type === 'inline' && String(r.payload || '').includes('datapacket'))
            aiGroupOk.value = !!aiGroup
            aiRulesOk.value = !!(openaiRs && anthropicRs && rules.some((r) => r && r.payload === openaiRs.id && r.outbound === aiGroup?.id) && rules.some((r) => r && r.payload === anthropicRs.id && r.outbound === aiGroup?.id))
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
          const { created, skipped } = await ensureFullConfig()
          genSummary.value = created.length
            ? `已生成：${created.join('、')}（请重启 GUI 生效）`
            : `配置已完整（${skipped.length} 项均存在）`
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

      const runEgress = async () => {
        if (egressRunning.value) return
        egressRunning.value = true
        let original = null
        let mainGroup = null
        try {
          const proxyUrl = createProxyUrl(kernelApi.getProxyEndpoint())
          const groups = Object.values(kernelApi.proxies || {}).filter((g) => g?.type === 'Selector' && Array.isArray(g.all))
          mainGroup = groups.find((g) => (g.name || g.tag || '').includes('节点选择')) || groups.find((g) => (g.name || g.tag) === 'GLOBAL') || groups[0]
          if (!mainGroup) throw new Error('找不到可切换的主策略组')
          const proxy = (kernelApi.proxies || {})[selectedNode.value]
          if (!proxy) throw new Error('所选节点不存在，请刷新订阅')
          original = mainGroup.now
          await Plugins.handleUseProxy(mainGroup, proxy)
          await new Promise((r) => setTimeout(r, 800))
          const resp = await Plugins.Requests({
            method: 'GET',
            url: 'https://ipinfo.io/json',
            autoTransformBody: true,
            headers: {},
            options: { Proxy: proxyUrl, Timeout: 15 }
          })
          let info = null
          try {
            info = typeof resp.body === 'string' ? JSON.parse(resp.body || '{}') : (resp.body || null)
          } catch { info = null }
          if (!info || !info.ip) throw new Error(`出口查询失败（HTTP ${resp.status || '?'}）`)
          const badRegions = ['CN', 'HK', 'MO', 'TW']
          const ok = info.country === 'US'
          const bad = badRegions.includes(info.country)
          const summary = ok
            ? '✓ 美国出口'
            : bad
              ? `✗ 落在 ${info.country}（OpenAI 不支持地区）`
              : `△ 非美国但可用（${info.country}）`
          const row = {
            ts: Date.now(),
            time: new Date().toLocaleString(),
            node: selectedNode.value,
            ip: info.ip,
            country: info.country || '?',
            org: info.org || '',
            summary,
          }
          lastResult.value = row
          history.value.unshift(row)
          history.value = history.value.slice(0, 20)
          await saveHistory(history.value)
        } catch (e) {
          lastResult.value = {
            ts: Date.now(),
            time: new Date().toLocaleString(),
            node: selectedNode.value,
            ip: '—',
            country: '',
            org: '',
            summary: '✗ ' + String(e?.message || e).slice(0, 120),
          }
        } finally {
          if (original && mainGroup) {
            try {
              const back = (kernelApi.proxies || {})[original]
              if (back) await Plugins.handleUseProxy(mainGroup, back)
            } catch {}
          }
          egressRunning.value = false
        }
      }

      const clearHistory = async () => {
        history.value = []
        await saveHistory([])
      }

      onMounted(() => { refresh() })

      return {
        checkedAt, kernelRunning, totalNodes, usTotal, usFixed,
        aiGroupOk, aiRulesOk, speedOk,
        generating, genSummary, doGenerate,
        removing, doRemove,
        nodeOptions, selectedNode, egressRunning, lastResult, history,
        refresh, runEgress, clearHistory,
      }
    },
  }

  modal.setContent(content)
  modal.open()
}
