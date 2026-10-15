# 词根词缀数据接入

本项目用于非商业学生学习。上游文件于 2026-10-15 下载，原始文件校验值记录于 import-report.json。

## 数据来源及许可

- MorphoLex-en：https://github.com/hugomailhot/MorphoLex-en ，文件 MorphoLEX_en.xlsx。作者 Sánchez-Gutiérrez, C.H., Mailhot, H., Deacon, S.H. et al.。论文 DOI：https://doi.org/10.3758/s13428-017-0981-8 。许可 CC BY-NC-SA 4.0，完整原文保存在 LICENSE.md。该数据及其改编数据仅用于非商业用途；改编数据以相同许可共享。
- morphemes：https://github.com/colingoldberg/morphemes ，文件 data/morphemes.json。Copyright (c) 2019 Colin Goldberg。MIT 原文保存在 ../morphemes/LICENSE。

## 转换与教学限制

生成数据 src/data/morphologyImported.json 包含经过筛选、重新组织和匹配的上述数据，MorphoLex 派生内容按 CC BY-NC-SA 4.0 共享，MIT 部分保留原始署名与许可。用户界面也标注来源和非商业使用要求。

MorphoLex 仅导入现有词书中能以组成部分完整还原拼写的多部分记录；标准化词干、屈折变化未包含在拆解中的记录不导入。不把词干自动视为历史词源，不通过字符串猜测陌生词的拆解。上游数据未经全面人工教学复核。morphemes 的关联例词仅作为关联展示，不声称具备完整拆解；英语原释义保留，中文提示由现有人工内容覆盖。

同形词或存在多个形态学分析的词，需要结合语境进一步确认。数据覆盖不是准确率指标。

## 重建

1. 在仓库根目录运行 `node scripts/exportMorphologyWords.mjs`，读取当前词书的拼写及释义到 project-words.json（不含用户信息）。
2. 用安装了 openpyxl 的 Python 运行 `scripts/buildMorphology.py`，生成前端与后端共用的 JSON 和 import-report.json。
3. `npm run build`。词书新增或替换后可以重复重建，不产生模型费用。

原有人工词条优先于导入数据；库页面采用分页，避免一次渲染数千个条目。
