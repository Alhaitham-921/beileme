"""Import chapter XHTML from explicitly supplied Standard Ebooks official checkouts.
Example: python scripts/import-standard-ebooks.py --alice PATH --pride PATH
The source LICENSE.md and exact Git commit are preserved in the output.
"""
import argparse,json,re,subprocess,hashlib
from pathlib import Path
import xml.etree.ElementTree as ET

parser=argparse.ArgumentParser();parser.add_argument('--alice',type=Path,required=True);parser.add_argument('--pride',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/'server/data/library';root.mkdir(parents=True,exist_ok=True)
sources=[('alice',args.alice,"Alice’s Adventures in Wonderland",'爱丽丝梦游仙境','Lewis Carroll','进阶原版 · 童话与文学表达',
  'https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel',
  'https://github.com/standardebooks/lewis-carroll_alices-adventures-in-wonderland_john-tenniel'),
  ('pride-prejudice',args.pride,'Pride and Prejudice','傲慢与偏见','Jane Austen','挑战原版 · 长篇与历史用语',
  'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice','https://github.com/standardebooks/jane-austen_pride-and-prejudice')]
ns={'h':'http://www.w3.org/1999/xhtml'}
for key,path,title,zh,author,level,url,repo in sources:
  notice=(path/'LICENSE.md').read_text(encoding='utf-8')
  if 'CC0' not in notice:raise ValueError('Source dedication missing')
  commit=subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()
  files=list((path/'src/epub/text').glob('chapter-*.xhtml'))
  files.sort(key=lambda p:int(re.search(r'chapter-(\d+)',p.name).group(1)))
  chapters=[];digest=hashlib.sha256()
  for file in files:
    raw=file.read_bytes();digest.update(raw);doc=ET.fromstring(raw)
    heading=doc.find('.//h:h2',ns)
    chapter_title=re.sub(r'\s+',' ',''.join(heading.itertext())).strip() if heading is not None else f'Chapter {len(chapters)+1}'
    paragraphs=[re.sub(r'\s+',' ',''.join(p.itertext())).strip() for p in doc.findall('.//h:body//h:p',ns)]
    paragraphs=[p for p in paragraphs if p]
    if not paragraphs:raise ValueError('Empty source chapter')
    chapters.append({'id':str(len(chapters)+1),'title':chapter_title,'paragraphs':paragraphs})
  expected=12 if key=='alice' else 61
  if len(chapters)!=expected:raise ValueError(f'Expected {expected} chapters, found {len(chapters)}')
  data={'id':key,'title':title,'titleZh':zh,'author':author,'level':level,
    'sourceName':'Standard Ebooks','sourceUrl':url,'sourceRepository':repo,'sourceCommit':commit,
    'licenseLabel':'原作按来源声明在美国属公版；编校贡献 CC0，其他地区需核对适用状态',
    'licenseUrl':repo+'/blob/'+commit+'/LICENSE.md','notice':notice,
    'importedOn':'2026-11-26','sourceSha256':digest.hexdigest(),'chapters':chapters}
  if key=='alice':
    data['audio']={'source':'LibriVox','sourceUrl':'https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll/','note':'真人朗读来自另一公版底本，措辞可能略有不同，未作逐句同步；来源声明录音在美国属公版。'}
    for chapter in chapters:chapter['audioUrl']=f"https://archive.org/download/alice_in_wonderland_librivox/wonderland_ch_{int(chapter['id']):02}.mp3"
  (root/f'{key}.json').write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
  print(json.dumps({'book':key,'chapters':len(chapters),'paragraphs':sum(len(c['paragraphs']) for c in chapters),'commit':commit}))
