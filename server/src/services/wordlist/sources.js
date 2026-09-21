/**
 * 词库来源目录与下载缓存。
 *
 * 数据来自两个开源仓库，两者格式与覆盖范围互补：
 *  - mahavivo/english-wordlists：考研/托福/GRE/四六级等权威大纲词表，另含 COCA 词频表
 *  - KyleBing/english-vocabulary：初中/高中词表，采用制表符分隔、释义更完整
 *
 * 雅思词表在两个仓库里都没有，因此映射到托福学术词表（见 IELTS_FALLBACK_CODE）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { SERVER_ROOT } from '../../config.js'

/** 下载缓存目录（已加入 .gitignore）。缓存让导入可以离线重跑，也避免反复抓取别人的仓库。 */
export const CACHE_DIR = path.join(SERVER_ROOT, 'data', 'wordlists')

const MAHAVIVO = 'mahavivo/english-wordlists'
const KYLEBING = 'KyleBing/english-vocabulary'

/**
 * 词书定义。每本书对应一个源文件，导入后成为词库里的一本词书。
 */
export const BOOK_SOURCES = [
  {
    code: 'primary',
    name: '小学英语大纲词汇',
    scope: '小学',
    description: '小学英语教学大纲词汇，释义由同仓库其他词表补全',
    repo: MAHAVIVO,
    file: '小学英语大纲词汇.txt',
    format: 'bare',
  },
  {
    code: 'zhongkao',
    name: '中考核心词汇',
    scope: '中考',
    description: '初中阶段核心词汇（KyleBing/english-vocabulary）',
    repo: KYLEBING,
    file: '1 初中-乱序.txt',
    format: 'tab',
  },
  {
    code: 'gaokao',
    name: '高考核心词汇',
    scope: '高考',
    description: '高中阶段核心词汇（KyleBing/english-vocabulary）',
    repo: KYLEBING,
    file: '2 高中-乱序.txt',
    format: 'tab',
  },
  {
    code: 'cet4',
    name: '大学英语四级大纲词汇',
    scope: '四级',
    description: '《全国大学英语四、六级考试大纲》2016 年版词汇表（mahavivo/english-wordlists）',
    repo: MAHAVIVO,
    file: 'CET4_edited.txt',
    format: 'rich',
  },
  {
    code: 'cet6',
    name: '大学英语六级大纲词汇',
    scope: '六级',
    description: '《全国大学英语四、六级考试大纲》2016 年版词汇表（mahavivo/english-wordlists）',
    repo: MAHAVIVO,
    file: 'CET6_edited.txt',
    format: 'rich',
  },
  {
    code: 'npee',
    name: '考研核心词汇',
    scope: '考研',
    description: '考研英语词汇表（mahavivo/english-wordlists）',
    repo: MAHAVIVO,
    file: 'NPEE_Wordlist.txt',
    format: 'rich',
  },
  {
    code: 'toefl',
    name: '托福核心词汇',
    scope: '托福',
    description: '托福词汇表（mahavivo/english-wordlists）。雅思无开源词表，暂以此替代',
    repo: MAHAVIVO,
    file: 'TOEFL.txt',
    format: 'rich',
  },
  {
    code: 'gre',
    name: 'GRE 核心词汇',
    scope: 'GRE',
    description: 'GRE 词汇精选（mahavivo/english-wordlists）',
    repo: MAHAVIVO,
    file: 'GRE_8000_Words.txt',
    format: 'rich',
  },
]

/** COCA 20000 词频表：按出现频率从高到低排列，用于给单词自动标注词频等级 */
export const FREQUENCY_SOURCE = {
  repo: MAHAVIVO,
  file: 'COCA_20000.txt',
}

/** 学习目标 → 词书 code。PRD 里的目标选项都能落在一本具体词书上。 */
export const GOAL_TO_BOOK = {
  小学: 'primary',
  中考: 'zhongkao',
  高考: 'gaokao',
  四级: 'cet4',
  六级: 'cet6',
  考研: 'npee',
  托福: 'toefl',
  雅思: 'toefl', // 缺少开源雅思词表，用学术类托福词表替代
  GRE: 'gre',
  纯兴趣: 'cet4',
  自定义: 'cet4',
}

/** 兜底词书：目标为空或拼写不认识时用它 */
export const FALLBACK_BOOK_CODE = 'cet4'

export function cachePathFor(repo, file) {
  const safe = `${repo.replace('/', '__')}__${file}`.replace(/[\\/:*?"<>|]/g, '_')
  return path.join(CACHE_DIR, safe)
}

/**
 * 读取本地缓存。
 * @returns {Promise<string|null>} 无缓存时返回 null
 */
export async function readCache(repo, file) {
  try {
    return await fs.readFile(cachePathFor(repo, file), 'utf8')
  } catch {
    return null
  }
}

export async function writeCache(repo, file, text) {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(cachePathFor(repo, file), text, 'utf8')
}

/** 严格 UTF-8 解码，失败则按 GBK 再试（中文词表常见两种编码混用） */
export function decodeBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk' }
    } catch {
      // 两种都不行就退回宽松 UTF-8，至少不会整体失败
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8-lossy' }
    }
  }
}

/**
 * 下载源文件。优先走 GitHub contents API（对大文件会失败），
 * 失败再退回 raw 地址，并做指数退避重试。
 *
 * @returns {Promise<{text:string, bytes:number, encoding:string, via:string}>}
 */
export async function downloadSource(repo, file, { tries = 3, logger = console } = {}) {
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  const attempts = []

  // 1) contents API：能拿到 base64 内容（限 1MB 以内的文件）
  attempts.push({
    via: 'api',
    run: async () => {
      const response = await fetch(`https://api.github.com/repos/${repo}/contents/${encoded}`, {
        headers: { 'User-Agent': 'beileme-wordlist-importer', Accept: 'application/vnd.github+json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const meta = await response.json()
      if (!meta.content) throw new Error('文件超过 1MB，contents API 不返回内容')
      return Buffer.from(meta.content, 'base64')
    },
  })

  // 2) raw 地址：对超过 1MB 的文件兜底
  attempts.push({
    via: 'raw',
    run: async () => {
      const response = await fetch(
        `https://raw.githubusercontent.com/${repo}/master/${encoded}`,
        { headers: { 'User-Agent': 'beileme-wordlist-importer' } }
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    },
  })

  let lastError = null
  for (const attempt of attempts) {
    for (let i = 0; i < tries; i += 1) {
      try {
        const buffer = await attempt.run()
        const { text, encoding } = decodeBuffer(buffer)
        return { text, bytes: buffer.length, encoding, via: attempt.via }
      } catch (error) {
        lastError = error
        if (i < tries - 1) {
          // 退避重试：这些网络偶发重置比较常见
          await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)))
        }
      }
    }
    logger.warn?.(`[wordlist] ${repo}/${file} 通过 ${attempt.via} 获取失败：${lastError?.message}`)
  }

  throw new Error(`下载 ${repo}/${file} 失败：${lastError?.message}`)
}

/**
 * 取词表内容：默认优先用缓存，缓存缺失再下载并写回。
 * @returns {Promise<{text:string, source:'cache'|'network', bytes?:number, encoding?:string}>}
 */
export async function loadSource(repo, file, { refresh = false, logger = console } = {}) {
  if (!refresh) {
    const cached = await readCache(repo, file)
    if (cached != null) return { text: cached, source: 'cache' }
  }

  const downloaded = await downloadSource(repo, file, { logger })
  await writeCache(repo, file, downloaded.text)
  return { text: downloaded.text, ...downloaded, source: 'network' }
}

export default {
  BOOK_SOURCES,
  FREQUENCY_SOURCE,
  GOAL_TO_BOOK,
  FALLBACK_BOOK_CODE,
  CACHE_DIR,
  loadSource,
  downloadSource,
  decodeBuffer,
}
