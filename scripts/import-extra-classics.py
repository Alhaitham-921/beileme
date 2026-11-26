"""Import additional novels and classics from official, pinned Standard Ebooks checkouts.
Usage: python scripts/import-extra-classics.py --sources D:/.../sources
"""
import argparse, hashlib, json, re, subprocess
from pathlib import Path
import xml.etree.ElementTree as ET

parser=argparse.ArgumentParser()
parser.add_argument('--sources',type=Path,required=True)
parser.add_argument('--fallback-sources',type=Path)
args=parser.parse_args()
destination=Path(__file__).resolve().parents[1]/'server/data/library'
ns={'o':'http://www.idpf.org/2007/opf','h':'http://www.w3.org/1999/xhtml'}
specs=[
 ('treasure-island','金银岛','Robert Louis Stevenson','robert-louis-stevenson','treasure-island','进阶原版 · 航海与冒险'),
 ('sherlock-holmes','福尔摩斯历险记','Arthur Conan Doyle','arthur-conan-doyle','the-adventures-of-sherlock-holmes','挑战原版 · 推理短篇'),
 ('secret-garden','秘密花园','Frances Hodgson Burnett','frances-hodgson-burnett','the-secret-garden','进阶原版 · 成长故事'),
 ('little-women','小妇人','Louisa May Alcott','louisa-may-alcott','little-women','挑战原版 · 家庭与成长'),
 ('jane-eyre','简·爱','Charlotte Brontë','charlotte-bronte','jane-eyre','挑战原版 · 人物与成长'),
 ('great-gatsby','了不起的盖茨比','F. Scott Fitzgerald','f-scott-fitzgerald','the-great-gatsby','挑战原版 · 现代小说'),
 ('christmas-carol','圣诞颂歌','Charles Dickens','charles-dickens','a-christmas-carol','进阶原版 · 节日故事'),
 ('around-world','八十天环游地球','Jules Verne','jules-verne','around-the-world-in-eighty-days/george-makepeace-towle','进阶英译原版 · 旅行与冒险'),
 ('robinson-crusoe','鲁滨孙漂流记','Daniel Defoe','daniel-defoe','the-life-and-adventures-of-robinson-crusoe','挑战原版 · 生存与冒险'),
 ('tom-sawyer','汤姆·索亚历险记','Mark Twain','mark-twain','the-adventures-of-tom-sawyer','进阶原版 · 成长与冒险'),
 ('hound-baskervilles','巴斯克维尔的猎犬','Arthur Conan Doyle','arthur-conan-doyle','the-hound-of-the-baskervilles','挑战原版 · 长篇推理'),
 ('wizard-of-oz','绿野仙踪','L. Frank Baum','l-frank-baum','the-wonderful-wizard-of-oz','进阶原版 · 奇幻旅程'),
]
def normalized(element):
 return re.sub(r'\s+',' ',''.join(element.itertext())).strip()
for key,zh,author,author_slug,book_slug,level in specs:
 source=args.sources/key
 if not (source/'LICENSE.md').is_file() and args.fallback_sources:source=args.fallback_sources/key
 notice=(source/'LICENSE.md').read_text(encoding='utf-8')
 assert 'CC0' in notice
 commit=(source/'SOURCE_COMMIT').read_text().strip() if (source/'SOURCE_COMMIT').is_file() else subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
 package=ET.parse(source/'src/epub/content.opf').getroot()
 items={item.attrib['id']:item.attrib['href'] for item in package.findall('o:manifest/o:item',ns)}
 chapters=[];digest=hashlib.sha256()
 for ref in package.findall('o:spine/o:itemref',ns):
  path=Path(items[ref.attrib['idref']])
  if path.stem in {'titlepage','halftitlepage','imprint','colophon','uncopyright'}:continue
  raw=(source/'src/epub'/path).read_bytes();digest.update(raw)
  doc=ET.fromstring(raw);body=doc.find('h:body',ns)
  if body is None:continue
  paragraphs=[]
  def collect(node):
   tag=node.tag.rsplit('}',1)[-1]
   if tag in {'p','h1','h2','h3','h4','li','blockquote','figcaption'}:
    text=normalized(node)
    if text:paragraphs.append(text)
   else:
    for child in node:collect(child)
  collect(body)
  if not paragraphs:continue
  heading=next((node for node in body.iter() if node.tag.rsplit('}',1)[-1] in {'h1','h2','h3'}),None)
  title=normalized(heading) if heading is not None else path.stem.replace('-',' ').title()
  chapters.append({'id':str(len(chapters)+1),'title':title,'paragraphs':paragraphs})
 assert chapters and sum(len(c['paragraphs']) for c in chapters)>100
 title=package.find('o:metadata/{http://purl.org/dc/elements/1.1/}title',ns).text
 repo=f'https://github.com/standardebooks/{author_slug}_{book_slug.replace(chr(47),chr(95))}'
 book={'id':key,'title':title,'titleZh':zh,'author':author,'level':level,'sourceName':'Standard Ebooks',
  'sourceUrl':f'https://standardebooks.org/ebooks/{author_slug}/{book_slug}',
  'sourceRepository':repo,'sourceCommit':commit,'sourceSha256':digest.hexdigest(),
  'licenseLabel':'原作按来源声明在美国属公版；编校贡献 CC0，其他地区需核对适用状态',
  'licenseUrl':f'{repo}/blob/{commit}/LICENSE.md','notice':notice,
  'importedOn':'2026-11-26','chapters':chapters}
 if key=='around-world':book['translator']='George Makepeace Towle'
 (destination/f'{key}.json').write_text(json.dumps(book,ensure_ascii=False),encoding='utf-8')
 print(json.dumps({'id':key,'chapters':len(chapters),'paragraphs':sum(len(c['paragraphs']) for c in chapters),'commit':commit}))
