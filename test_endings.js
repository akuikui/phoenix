const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * 读取 HTML 文件中的 <script> 段并在独立 VM 中执行，
 * 得到 storyNodes 与 determineEnding。
 */
function loadStoryFromHtml(htmlFiles) {
  const context = {
    console,
    // 提前准备一个 sceneMoodMap，避免结局脚本中 Object.assign 报错
    sceneMoodMap: {},
  };
  vm.createContext(context);

  const scriptTagRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;

  for (const file of htmlFiles) {
    const abs = path.join(__dirname, path.basename(file));
    const html = fs.readFileSync(abs, 'utf8');
    let match;
    while ((match = scriptTagRegex.exec(html)) !== null) {
      const js = match[1];
      if (!js.trim()) continue;
      vm.runInContext(js, context, { filename: path.basename(file) });
    }
  }

  // 将 VM 内的 storyNodes / determineEnding 暴露到 globalThis 上，方便读取
  try {
    vm.runInContext(
      'if (typeof storyNodes !== "undefined") { globalThis.storyNodes = storyNodes; }' +
        '\nif (typeof determineEnding !== "undefined") { globalThis.determineEnding = determineEnding; }',
      context
    );
  } catch (e) {
    console.error('暴露 storyNodes/determineEnding 失败:', e);
  }

  if (!context.storyNodes) {
    throw new Error('在脚本中没有找到 storyNodes。');
  }
  if (!context.determineEnding) {
    throw new Error('在脚本中没有找到 determineEnding。');
  }

  return {
    context,
    storyNodes: context.storyNodes,
    determineEnding: context.determineEnding,
  };
}

// 初始状态
const initialState = {
  safety: 50,
  caseProgress: 5,
  rank: 9,
  affection: { xch: 25, xjy: 20, gxz: 30, hlt: 0, xcy: 15 },
  trust: { swn: 60 },
  flags: {},
  clues: [],
};

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

// 应用节点 / 选项上的 effects
function applyEffects(state, effects) {
  if (!effects) return;

  if (typeof effects.safety === 'number') {
    state.safety += effects.safety;
  }
  if (typeof effects.case === 'number') {
    state.caseProgress += effects.case;
  }
  if (typeof effects.rank === 'number') {
    state.rank += effects.rank;
  }

  if (effects.affection) {
    state.affection = state.affection || {};
    for (const [k, v] of Object.entries(effects.affection)) {
      if (typeof v === 'number') {
        state.affection[k] = (state.affection[k] || 0) + v;
      }
    }
  }

  if (effects.trust) {
    state.trust = state.trust || {};
    for (const [k, v] of Object.entries(effects.trust)) {
      if (typeof v === 'number') {
        state.trust[k] = (state.trust[k] || 0) + v;
      }
    }
  }

  if (effects.flags) {
    state.flags = state.flags || {};
    Object.assign(state.flags, effects.flags);
  }

  if (effects.clue) {
    state.clues = state.clues || [];
    if (Array.isArray(effects.clue)) {
      state.clues.push(...effects.clue);
    } else {
      state.clues.push(effects.clue);
    }
  }
}

function getNestedNumber(obj, keyPath) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return 0;
    cur = cur[p];
  }
  return typeof cur === 'number' ? cur : 0;
}

const ENDING_CONFIGS = [
  {
    id: 'ending_empress',
    name: '女皇结局',
    primaryStatKey: 'caseProgress',
    avoidFlags: ['prince_alliance', 'xjy_alliance', 'gxz_alliance'],
    conditions: [
      { type: 'max', key: 'rank', limit: 2, desc: 'rank ≤ 2' },
      { type: 'min', key: 'caseProgress', limit: 85, desc: 'caseProgress ≥ 85' },
    ],
  },
  {
    id: 'ending_emperor_queen',
    name: '帝后结局',
    primaryStatKey: 'affection.xcy',
    conditions: [
      { type: 'min', key: 'affection.xcy', limit: 50, desc: 'xcy ≥ 50' },
      { type: 'flag', flag: 'emperor_permission', desc: 'flag emperor_permission' },
      { type: 'min', key: 'caseProgress', limit: 75, desc: 'caseProgress ≥ 75' },
    ],
  },
  {
    id: 'ending_new_emperor_xch',
    name: '新皇结局·瑾王',
    primaryStatKey: 'affection.xch',
    conditions: [
      { type: 'min', key: 'affection.xch', limit: 45, desc: 'xch ≥ 45' },
      { type: 'flag', flag: 'prince_coup', desc: 'flag prince_coup' },
    ],
  },
  {
    id: 'ending_new_emperor_xjy',
    name: '新皇结局·三皇子',
    primaryStatKey: 'affection.xjy',
    conditions: [
      { type: 'min', key: 'affection.xjy', limit: 40, desc: 'xjy ≥ 40' },
      { type: 'flag', flag: 'xjy_alliance', desc: 'flag xjy_alliance' },
    ],
  },
  {
    id: 'ending_regent',
    name: '垂帘结局',
    primaryStatKey: 'safety',
    avoidFlags: ['xjy_alliance', 'prince_alliance', 'gxz_alliance', 'prince_coup'],
    conditions: [
      { type: 'min', key: 'affection.xjy', limit: 25, desc: 'xjy ≥ 25' },
      { type: 'max', key: 'rank', limit: 5, desc: 'rank ≤ 5' },
      { type: 'min', key: 'caseProgress', limit: 50, desc: 'caseProgress ≥ 50' },
    ],
  },
  {
    id: 'ending_prince',
    name: '远走结局·瑾王',
    primaryStatKey: 'affection.xch',
    conditions: [
      { type: 'min', key: 'affection.xch', limit: 50, desc: 'xch ≥ 50' },
      { type: 'flag', flag: 'prince_alliance', desc: 'flag prince_alliance' },
    ],
  },
  {
    id: 'ending_scholar',
    name: '远走结局·状元',
    primaryStatKey: 'affection.gxz',
    conditions: [
      { type: 'min', key: 'affection.gxz', limit: 45, desc: 'gxz ≥ 45' },
      { type: 'min', key: 'caseProgress', limit: 75, desc: 'caseProgress ≥ 75' },
    ],
  },
  {
    id: 'ending_grassland',
    name: '草原结局',
    primaryStatKey: 'affection.hlt',
    conditions: [
      { type: 'min', key: 'affection.hlt', limit: 25, desc: 'hlt ≥ 25' },
    ],
  },
  {
    id: 'ending_sisters',
    name: '姐妹结局',
    primaryStatKey: 'trust.swn',
    avoidFlags: ['prince_alliance', 'xjy_alliance', 'gxz_alliance'],
    conditions: [
      { type: 'min', key: 'trust.swn', limit: 85, desc: 'trust.swn ≥ 85' },
    ],
  },
  {
    id: 'ending_lonely',
    name: '孤寂结局',
    primaryStatKey: 'safety',
    avoidFlags: ['prince_alliance', 'xjy_alliance', 'gxz_alliance', 'prince_coup', 'avoided_heqin'],
    conditions: [], // 作为兜底结局，不再额外硬编码数值条件
  },
];

function computeScoreForEnding(config, state) {
  let score = getNestedNumber(state, config.primaryStatKey);
  // Bonus for achieving required flags
  if (config.conditions) {
    for (const cond of config.conditions) {
      if (cond.type === 'flag' && state.flags && state.flags[cond.flag]) {
        score += 100;
      }
    }
  }
  // Penalty for setting flags that should be avoided
  if (config.avoidFlags && state.flags) {
    for (const flag of config.avoidFlags) {
      if (state.flags[flag]) {
        score -= 200;
      }
    }
  }
  return score;
}

function summarizeState(state, actualEndingId) {
  const a = state.affection || {};
  const t = state.trust || {};
  const flags = state.flags || {};
  return (
    `ending=${actualEndingId || 'N/A'}, ` +
    `safety=${state.safety}, caseProgress=${state.caseProgress}, rank=${state.rank}, ` +
    `xcy=${a.xcy || 0}, xch=${a.xch || 0}, xjy=${a.xjy || 0}, gxz=${a.gxz || 0}, hlt=${a.hlt || 0}, ` +
    `trust.swn=${t.swn || 0}, flags=${JSON.stringify(flags)}`
  );
}

function computeShortfalls(config, state) {
  const res = [];
  for (const cond of config.conditions) {
    if (cond.type === 'flag') {
      const hasFlag = !!(state.flags && state.flags[cond.flag]);
      if (!hasFlag) {
        res.push(`缺少标志 ${cond.flag}`);
      }
      continue;
    }

    const value = getNestedNumber(state, cond.key);
    if (cond.type === 'min' && value < cond.limit) {
      res.push(`${cond.key}=${value} < ${cond.limit}`);
    } else if (cond.type === 'minExclusive' && value <= cond.limit) {
      res.push(`${cond.key}=${value} ≤ ${cond.limit}`);
    } else if (cond.type === 'max' && value > cond.limit) {
      res.push(`${cond.key}=${value} > ${cond.limit}`);
    }
  }
  return res;
}

function simulateGreedyForEnding(storyNodes, determineEnding, vmContext, endingConfig) {
  const state = cloneState(initialState);
  const path = [];
  let currentId = 'start';
  let steps = 0;
  const MAX_STEPS = 2000;

  while (currentId && steps++ < MAX_STEPS) {
    const node = storyNodes[currentId];
    if (!node) {
      console.warn(`节点 ${currentId} 未在 storyNodes 中找到，提前结束。`);
      break;
    }

    path.push(currentId);

    if (node.effects) {
      applyEffects(state, node.effects);
    }

    if (currentId === 'ending_branch') {
      // 到达终幕分支，按当前状态调用 determineEnding
      vmContext.gameState = state;
      const eid = determineEnding.call(vmContext);
      return {
        targetEndingId: endingConfig.id,
        actualEndingId: eid,
        finalState: state,
        path,
      };
    }

    if (currentId.startsWith('ending_') && currentId !== 'ending_branch') {
      // 若脚本直接跳入某个结局节点，也视为终止
      return {
        targetEndingId: endingConfig.id,
        actualEndingId: currentId,
        finalState: state,
        path,
      };
    }

    const choices = node.choices || [];
    if (!choices.length) {
      break;
    }

    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const simState = cloneState(state);
      if (choice.effects) {
        applyEffects(simState, choice.effects);
      }
      const score = computeScoreForEnding(endingConfig, simState);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const chosen = choices[bestIdx];
    if (chosen.effects) {
      applyEffects(state, chosen.effects);
    }

    let next = chosen.next;
    if (typeof next === 'string') {
      currentId = next;
    } else {
      // 对于此测试脚本，除 ending_branch 外不期望出现函数 next。
      // 若出现，则直接结束并用当前状态判定结局。
      console.warn(`节点 ${currentId} 的选项包含非字符串 next，提前结束。`);
      break;
    }
  }

  // 未显式到达 ending_branch 时，作为兜底仍调用一次 determineEnding
  vmContext.gameState = state;
  const eid = determineEnding.call(vmContext);
  return {
    targetEndingId: endingConfig.id,
    actualEndingId: eid,
    finalState: state,
    path,
  };
}

function main() {
  const { context, storyNodes, determineEnding } = loadStoryFromHtml([
    'part_04_act1.html',
    'part_05_act2.html',
    'part_06_act3.html',
    'part_07_act4.html',
    'part_14_endings_full.html',
  ]);

  const rows = [];

  for (const cfg of ENDING_CONFIGS) {
    const result = simulateGreedyForEnding(storyNodes, determineEnding, context, cfg);
    const reachable = result.actualEndingId === cfg.id;
    const finalStateSummary = summarizeState(result.finalState, result.actualEndingId);
    const shortfalls = reachable ? [] : computeShortfalls(cfg, result.finalState);

    rows.push({
      endingId: cfg.id,
      endingName: cfg.name,
      reachable,
      finalStateSummary,
      shortfalls,
    });
  }

  // 输出表格
  console.log('结局达成模拟结果（贪心策略，每个结局单独一次模拟）');
  console.log('='.repeat(120));
  const header = ['Ending', 'Reachable', 'Final stats (greedy path)', 'Shortfalls (if any)'];
  console.log(header.join(' | '));
  console.log('-'.repeat(120));

  for (const r of rows) {
    const reachableText = r.reachable ? 'YES' : 'NO';
    const shortText = r.shortfalls.length ? r.shortfalls.join(', ') : '';
    console.log(`${r.endingId} (${r.endingName}) | ${reachableText} | ${r.finalStateSummary} | ${shortText}`);
  }
}

if (require.main === module) {
  main();
}
