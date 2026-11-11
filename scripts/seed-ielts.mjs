import { seedPapers } from '../server/data/ielts/catalog.js'
import { validatePaper } from '../server/src/services/ielts/engine.js'
import { execute, closePool } from '../server/src/db/pool.js'
try {
  for (const paper of seedPapers) {
    validatePaper(paper)
    // Immutable versions and INSERT IGNORE preserve edits/reviews on subsequent imports.
    await execute("INSERT IGNORE INTO ielts_papers(code,version,skill,title,status,body,source_info) VALUES(?,?,?,?,'draft',?,?)", [paper.code,paper.version,paper.skill,paper.title,JSON.stringify(paper),JSON.stringify(paper.source)])
  }
  console.log(`已导入 ${seedPapers.length} 份待复核草稿。公开目录仍只展示已审核发布内容。`)
} finally { await closePool() }
