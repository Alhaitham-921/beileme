import imported from './morphologyImported.json' with { type: 'json' }
// 教学性简化拆解，逐词明确收录；不对任意拼写做前后缀猜测。
export const morphologySources = [
  { title: 'morphemes · MIT', url: 'https://github.com/colingoldberg/morphemes' },
  { title: 'MorphoLex-en · CC BY-NC-SA 4.0（非商业）', url: 'https://github.com/hugomailhot/MorphoLex-en' },
  { title: 'British Council：前缀与后缀', url: 'https://learnenglishteens.britishcouncil.org/exams/grammar-vocabulary-exams/does-it-have-prefix-or-suffix' },
  { title: 'Membean：词根索引', url: 'https://membean.com/roots/' },
]
export const morphemes = {
  un: ['prefix', '不；相反'], re: ['prefix', '再次；回'], dis: ['prefix', '不；分开'], mis: ['prefix', '错误地'], pre: ['prefix', '在前；预先'],
  im: ['prefix', '向内（此处用法）'], ex: ['prefix', '向外'], trans: ['prefix', '跨越'], tran: ['prefix', 'trans- 的拼写变体：转移；跨越'], in: ['prefix', '向内'], contra: ['prefix', '相反'], de: ['prefix', '向下；离开'],
  ful: ['suffix', '充满……的'], less: ['suffix', '没有……的'], ness: ['suffix', '性质；状态，构成名词'], ly: ['suffix', '以……方式，常构成副词'], able: ['suffix', '可以……的'], er: ['suffix', '做某事的人（此处用法）'],
  port: ['root', '携带；搬运'], spect: ['root', '看；观察'], dict: ['root', '说'], scrib: ['root', '写'], script: ['root', '写（scrib 的变体）'],
  happy: ['base', '快乐'], kind: ['base', '友善'], fair: ['base', '公平'], known: ['base', '已知的'], use: ['base', '使用'], build: ['base', '建造'], read: ['base', '阅读'], write: ['base', '写'],
  agree: ['base', '同意'], appear: ['base', '出现'], like: ['base', '喜欢'], understand: ['base', '理解'], spell: ['base', '拼写'], lead: ['base', '引导'], view: ['base', '看'], heat: ['base', '加热'], pay: ['base', '支付'],
  help: ['base', '帮助'], care: ['base', '小心；照料'], hope: ['base', '希望'], harm: ['base', '伤害'], slow: ['base', '慢'], quick: ['base', '快'], teach: ['base', '教'], work: ['base', '工作'],
  tion: ['suffix', '行为；过程，构成名词'], ator: ['suffix', '做某事的人'],
}
const curatedGroups = [
  { id: 'un', label: 'un-', type: 'prefix', meaning: '不；相反', tip: '先理解基础词，再加入否定含义。并非所有以 un 开头的词都能这样拆。' },
  { id: 're', label: 're-', type: 'prefix', meaning: '再次；回', tip: '把动作想象成“再做一次”。read 本身不能拆成 re- + ad。' },
  { id: 'dis', label: 'dis-', type: 'prefix', meaning: '不；分开', tip: '留意否定、消失或相反动作，结合整词含义理解。' },
  { id: 'mis', label: 'mis-', type: 'prefix', meaning: '错误地', tip: '把它和 dis- 区分：做错了，不一定是没有做。' },
  { id: 'pre', label: 'pre-', type: 'prefix', meaning: '预先；在前', tip: '用时间线联想：事情发生之前先做。' },
  { id: 'ful', label: '-ful', type: 'suffix', meaning: '充满……的', tip: '常将名词变成形容词。词缀只有一个 l，不是单词 full。' },
  { id: 'less', label: '-less', type: 'suffix', meaning: '没有……的', tip: '与 -ful 对照记忆，如 careful / careless。' },
  { id: 'ness', label: '-ness', type: 'suffix', meaning: '性质；状态', tip: '常将形容词变为名词；happy → happiness 时 y 变 i。' },
  { id: 'ly', label: '-ly', type: 'suffix', meaning: '以……方式', tip: '常构成副词，但不能认为所有 -ly 结尾词都是副词，如 friendly。' },
  { id: 'able', label: '-able', type: 'suffix', meaning: '可以……的', tip: '问自己“可以被怎样？”；有时基础词末尾 e 会省略。' },
  { id: 'er', label: '-er', type: 'suffix', meaning: '做某事的人', tip: '此处学习表示人的用法；比较级的 -er 是另一种用法。' },
  { id: 'port', label: 'port', type: 'root', meaning: '携带；搬运', tip: '以“搬运”为画面：向内运、向外运、跨越运输。' },
  { id: 'spect', label: 'spect', type: 'root', meaning: '看；观察', tip: '把观察者和检查动作联系起来，不要只靠字母重合判断同根。' },
  { id: 'dict', label: 'dict', type: 'root', meaning: '说', tip: '预先说出是预测，反着说是反驳；这是记忆线索，不替代整词释义。' },
  { id: 'scrib', label: 'scrib / script', type: 'root', meaning: '写', tip: 'scrib 与 script 是相关变体，可把书写与书面记录联想在一起。' },
]
const rows = [
  ['unhappy','un happy','不快乐的','un','不 + 快乐 → 不快乐'], ['unkind','un kind','不友善的','un','不 + 友善 → 不友善'], ['unfair','un fair','不公平的','un','不 + 公平 → 不公平'], ['unknown','un known','未知的','un','不 + 已知 → 未知'],
  ['reuse','re use','再使用','re','再次 + 使用 → 重复利用'], ['rebuild','re build','重建','re','再次 + 建造 → 重建'], ['reread','re read','重读','re','再次 + 阅读 → 重读'], ['rewrite','re write','重写','re','再次 + 写 → 重写'],
  ['disagree','dis agree','不同意','dis','否定 + 同意 → 不同意'], ['disappear','dis appear','消失','dis','不再出现 → 消失'], ['dislike','dis like','不喜欢','dis','不 + 喜欢 → 不喜欢'],
  ['misunderstand','mis understand','误解','mis','错误地 + 理解 → 误解'], ['misspell','mis spell','拼错','mis','错误地 + 拼写 → 拼错'], ['mislead','mis lead','误导','mis','错误地 + 引导 → 误导'],
  ['preview','pre view','预览','pre','预先 + 看 → 预览'], ['preheat','pre heat','预热','pre','预先 + 加热 → 预热'], ['prepay','pre pay','预付','pre','预先 + 支付 → 预付'],
  ['helpful','help ful','有帮助的','ful','有帮助 → 有用的'], ['careful','care ful','小心的','ful','充满小心 → 谨慎的'], ['hopeful','hope ful','充满希望的','ful','充满希望'], ['harmful','harm ful','有害的','ful','带来伤害'],
  ['helpless','help less','无助的','less','缺少帮助'], ['careless','care less','粗心的','less','缺少小心 → 粗心'], ['hopeless','hope less','无望的','less','没有希望'], ['harmless','harm less','无害的','less','没有伤害'],
  ['kindness','kind ness','友善','ness','友善的性质 → 友善'], ['happiness','happi ness','快乐；幸福','ness','happy + -ness；y 变 i 后拼写为 happi-'], ['carelessness','care less ness','粗心','ness','careless + -ness → 粗心这种状态'],
  ['slowly','slow ly','缓慢地','ly','以慢的方式'], ['quickly','quick ly','迅速地','ly','以快的方式'], ['carefully','care ful ly','小心地','ly','careful + -ly → 小心地'],
  ['readable','read able','可读的','able','可以被读懂的'], ['usable','us able','可使用的','able','use + -able；省略末尾 e'], ['portable','port able','便携的','port','能够被携带 → 便携'],
  ['teacher','teach er','教师','er','教书的人'], ['worker','work er','工人；工作者','er','工作的人'], ['reader','read er','读者','er','阅读的人'],
  ['import','im port','进口；导入','port','向内 + 搬运 → 进口'], ['export','ex port','出口；导出','port','向外 + 搬运 → 出口'], ['transport','trans port','运输','port','跨越 + 搬运 → 运输'],
  ['inspect','in spect','检查','spect','向里细看 → 检查'], ['spectator','spect ator','观众','spect','观看的人 → 观众'],
  ['predict','pre dict','预测','dict','预先 + 说 → 预测'], ['contradict','contra dict','反驳；与……矛盾','dict','相反 + 说 → 反驳'], ['prediction','pre dict ion','预测；预言','dict','predict 的名词形式，末尾 -ion 表示行为或结果'],
  ['describe','de scrib e','描述','scrib','用书写描绘；末尾 e 是拼写的一部分'], ['transcript','tran script','文字记录；成绩单','scrib','trans- 在此拼写为 tran-；将内容转成书面记录，成绩单是整词的另一用法'],
]
const curatedEntries = rows.map(([word, split, meaning, group, hint]) => ({
  word, meaning, group, hint,
  parts: split.split(' ').map(text => {
    const info = morphemes[text] || (text === 'happi' ? ['base', 'happy 的拼写变化：快乐'] : text === 'us' ? ['base', 'use 去掉 e：使用'] : text === 'ion' ? ['suffix', '行为或结果，构成名词'] : ['spelling', '拼写部分，不单独推断词义'])
    return { text, type: info[0], meaning: info[1] }
  }),
}))
export const morphologyEntries = [...new Map([...imported.entries, ...curatedEntries].map(e => [e.word, e])).values()]
export const morphologyGroups = [...curatedGroups, ...imported.groups]
const lookup = new Map(morphologyEntries.map(e => [e.word, e]))
const familyMap = new Map()
for (const entry of morphologyEntries) {
  if (!familyMap.has(entry.group)) familyMap.set(entry.group, [])
  familyMap.get(entry.group).push(entry)
}
export function entriesForGroup(id) { return familyMap.get(id) || [] }
export function getMorphology(word) {
  const entry = lookup.get(String(word || '').trim().toLowerCase())
  if (!entry) return null
  return { ...entry, family: entriesForGroup(entry.group).filter(e => e.word !== entry.word).slice(0, 5) }
}
