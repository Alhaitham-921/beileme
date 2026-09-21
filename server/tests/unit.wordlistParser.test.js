import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseWordlist,
  parseEntryLine,
  parseTabLine,
  parseBareLine,
  detectFormat,
  parseDefinitions,
  extractPos,
} from '../src/services/wordlist/parse.js'
import { GOAL_TO_BOOK, BOOK_SOURCES, FALLBACK_BOOK_CODE } from '../src/services/wordlist/sources.js'
import { GOALS } from '../src/services/profileService.js'

describe('带音标词条行（格式 A）', () => {
  test('解析出拼写、音标、词性与释义', () => {
    const entry = parseEntryLine('abandon [əˈbændən] vt.丢弃；放弃，抛弃')
    assert.equal(entry.spelling, 'abandon')
    assert.equal(entry.phonetic, '[əˈbændən]')
    assert.equal(entry.pos, 'vt')
    assert.deepEqual(entry.definitions, ['丢弃', '放弃', '抛弃'])
  })

  test('没有音标也能解析（CET4 词表里 a 这类词就没有音标）', () => {
    const entry = parseEntryLine('a art.一(个)；每一(个)')
    assert.equal(entry.spelling, 'a')
    assert.equal(entry.phonetic, '')
    assert.equal(entry.pos, 'art')
    // 括号是配对的，不能被当成噪音削掉
    assert.deepEqual(entry.definitions, ['一(个)', '每一(个)'])
  })

  test('多空格对齐的排版也能解析（托福词表用空格对齐词性）', () => {
    const entry = parseEntryLine("abandon           [ə'bændən]            vt.  放弃,沉溺n.  放任")
    assert.equal(entry.spelling, 'abandon')
    assert.equal(entry.phonetic, "[ə'bændən]")
    assert.ok(entry.pos.includes('vt'))
    assert.ok(entry.pos.includes('n'), '夹在释义中间的词性也要被识别出来')
    assert.ok(entry.definitions.includes('放弃'))
  })

  test('带编号的释义按编号拆分，编号本身不进入释义', () => {
    const entry = parseEntryLine(
      'abandon [əˈbændən] v. 1. 抛弃，放弃 2. 离弃(家园、船只、飞机等) 3. 遗弃(妻、子女等)'
    )
    assert.deepEqual(entry.definitions, [
      '抛弃',
      '放弃',
      '离弃(家园、船只、飞机等)',
      '遗弃(妻、子女等)',
    ])
  })

  test('词形变体（a (an)）不会被当成拼写的一部分', () => {
    const entry = parseEntryLine('a (an) [ə, eɪ(ən)] art. 一（个、件……）')
    assert.equal(entry.spelling, 'a')
    assert.equal(entry.pos, 'art')
  })

  test('缩略词 a.m. 不会被截断成 a', () => {
    const entry = parseEntryLine('a.m. [ˌeɪ ˈem] n. 上午，午前')
    assert.equal(entry.spelling, 'a.m.')
    assert.deepEqual(entry.definitions, ['上午', '午前'])
  })

  test('表头、分段字母、空行都被跳过', () => {
    assert.equal(parseEntryLine('大学英语四级大纲单词表'), null)
    assert.equal(parseEntryLine('(共 4615 词)'), null)
    assert.equal(parseEntryLine('A'), null)
    assert.equal(parseEntryLine('   '), null)
  })

  test('没有中文释义的行不产生词条（避免把纯英文注释当成词）', () => {
    assert.equal(parseEntryLine('abandon [əˈbændən] vt. to give up'), null)
  })

  test('解析不出拼写时返回 null 而不是抛错', () => {
    assert.equal(parseEntryLine('~~~ 无法解析 ~~~'), null)
    assert.equal(parseEntryLine(''), null)
    assert.equal(parseEntryLine(null), null)
  })

  test('超长释义被丢弃，避免选择题选项变成一整句话', () => {
    const entry = parseEntryLine(
      'test [test] n. 这是一个非常长的解释性释义用来描述某个概念的完整含义和用法说明'
    )
    // 该释义超过 24 字上限被过滤，整条词条没有可用释义
    assert.equal(entry, null)
  })
})

describe('制表符词表（格式 C）', () => {
  test('解析出拼写、词性与释义（初高中词表用这种格式）', () => {
    const entry = parseTabLine('although\tconj. 尽管；虽然；但是；然而')
    assert.equal(entry.spelling, 'although')
    assert.equal(entry.pos, 'conj')
    assert.deepEqual(entry.definitions, ['尽管', '虽然', '但是', '然而'])
  })

  test('词性可以出现在每个释义前面', () => {
    const entry = parseTabLine('boat\tn. 小船；轮船 v. 划船')
    assert.equal(entry.spelling, 'boat')
    assert.ok(entry.pos.includes('n'))
    assert.ok(entry.pos.includes('v'))
    assert.deepEqual(entry.definitions, ['小船', '轮船', '划船'])
  })

  test('方括号里的语法说明被剔除', () => {
    const entry = parseTabLine('party\tn. 政党，党派；聚会，派对；当事人 [复数 parties] v. 参加社交聚会')
    assert.ok(entry.definitions.includes('政党'))
    assert.ok(entry.definitions.includes('聚会'))
    assert.equal(entry.definitions.some((d) => d.includes('parties')), false)
  })

  test('没有制表符或拼写不合法时返回 null', () => {
    assert.equal(parseTabLine('just a plain sentence'), null)
    assert.equal(parseTabLine('123\tn. 数字'), null)
    assert.equal(parseTabLine(''), null)
  })
})

describe('裸词表（格式 B）', () => {
  test('每行只取单词，不带释义', () => {
    assert.deepEqual(parseBareLine('abandon'), {
      spelling: 'abandon',
      phonetic: '',
      pos: '',
      definitions: [],
    })
  })

  test('含空格或数字的行不算单词', () => {
    assert.equal(parseBareLine('the quick brown'), null)
    assert.equal(parseBareLine('word1'), null)
  })
})

describe('排版自动识别', () => {
  test('制表符占比高判定为 tab 格式', () => {
    assert.equal(detectFormat('although\tconj. 尽管\neffort\tn. 努力\n'), 'tab')
  })

  test('含中文释义但无制表符判定为 rich 格式', () => {
    assert.equal(detectFormat('abandon [əˈbændən] vt.放弃\neffort [ˈefət] n.努力\n'), 'rich')
  })

  test('几乎没有中文判定为裸词表', () => {
    assert.equal(detectFormat('the\nbe\nand\nof\na\nin\n'), 'bare')
  })
})

describe('释义切分规则', () => {
  test('括号内的顿号不切分（否则会切出「离弃(家园」这种碎片）', () => {
    assert.deepEqual(parseDefinitions('离弃(家园、船只、飞机等)'), ['离弃(家园、船只、飞机等)'])
  })

  test('括号外的顿号正常切分', () => {
    assert.deepEqual(parseDefinitions('事故、意外'), ['事故', '意外'])
  })

  test('英文语法注释被剔除', () => {
    assert.deepEqual(parseDefinitions('indefinite article. 一〔用于…〕'), ['一〔用于…〕'])
  })

  test('省略号被规整', () => {
    assert.deepEqual(parseDefinitions('为. . . 伴奏'), ['为...伴奏'])
  })

  test('没有汉字的片段一律丢弃', () => {
    assert.deepEqual(parseDefinitions('n. / adj. / to give up'), [])
  })

  test('单字释义在有更完整释义时被丢弃（避免正确选项显示成「部」）', () => {
    assert.deepEqual(parseDefinitions('部，司，局，处；部门'), ['部门'])
    assert.deepEqual(parseDefinitions('部，司，局，处；部门，系'), ['部门'])
  })

  test('整条词只有单字释义时保留，否则这个词会因缺少释义被丢弃', () => {
    assert.deepEqual(parseDefinitions('年'), ['年'])
  })

  test('空输入返回空数组', () => {
    assert.deepEqual(parseDefinitions(''), [])
    assert.deepEqual(parseDefinitions(null), [])
  })
})

describe('词性提取', () => {
  test('归一化常见缩写', () => {
    assert.equal(extractPos('a. 有能力的').pos, 'adj')
    assert.equal(extractPos('ad. 在国外').pos, 'adv')
    assert.equal(extractPos('int. 你好').pos, 'interj')
  })

  test('多个词性去重并保持出现顺序', () => {
    const { pos } = extractPos('v./n. 放弃')
    assert.equal(pos, 'v/n')
  })

  test('不会把英文单词内部的字母误判成词性', () => {
    // `can.` 里的 `n.` 前面是字母，不应被识别
    const { pos } = extractPos('to scan. 扫描')
    assert.equal(pos, '')
  })
})

describe('整份词表解析', () => {
  test('同一单词的多条词性行会合并释义，而不是丢弃', () => {
    const { entries, merged } = parseWordlist(
      'miss\tn. 女士，小姐\nMiss\tn. 女士，小姐\nmiss\tv. 错过；思念\n',
      'tab'
    )
    assert.equal(entries.length, 1)
    assert.equal(merged, 2, '两条重复行应被合并')
    assert.deepEqual(entries[0].definitions, ['女士', '小姐', '错过', '思念'])
  })

  test('合并时词性取并集', () => {
    const { entries } = parseWordlist('record\tn. 记录\nrecord\tv. 记录\n', 'tab')
    assert.equal(entries.length, 1)
    assert.ok(entries[0].pos.includes('n'))
    assert.ok(entries[0].pos.includes('v'))
  })

  test('统计被跳过的行数', () => {
    const { entries, skipped } = parseWordlist('A\n\nabandon [əˈbændən] vt.放弃\n？？？\n', 'rich')
    assert.equal(entries.length, 1)
    assert.equal(skipped, 1, '只有无法解析的非空行计入跳过')
  })

  test('空输入返回空结果而不是报错', () => {
    const result = parseWordlist('', 'rich')
    assert.deepEqual(result.entries, [])
  })
})

describe('词库来源配置', () => {
  test('每本词书的 code 唯一', () => {
    const codes = BOOK_SOURCES.map((book) => book.code)
    assert.equal(new Set(codes).size, codes.length, 'code 重复会导致写进同一本书')
  })

  test('Onboarding 的每个学习目标都能映射到词书', () => {
    for (const goal of GOALS) {
      assert.ok(GOAL_TO_BOOK[goal], `学习目标「${goal}」缺少词书映射`)
    }
  })

  test('映射目标都指向已配置的源（或明确的兜底）', () => {
    const known = new Set([...BOOK_SOURCES.map((book) => book.code), FALLBACK_BOOK_CODE])
    for (const code of Object.values(GOAL_TO_BOOK)) {
      assert.ok(known.has(code), `映射到了未配置的词书 code：${code}`)
    }
  })

  test('每本词书都声明了仓库、文件与排版格式', () => {
    for (const book of BOOK_SOURCES) {
      assert.ok(book.repo.includes('/'), `${book.code} 缺少仓库`)
      assert.ok(book.file, `${book.code} 缺少文件名`)
      assert.ok(['rich', 'tab', 'bare'].includes(book.format), `${book.code} 格式声明不合法`)
    }
  })
})
