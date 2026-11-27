// Original extended scripts. Immutable lesson IDs preserve historical attempt meaning.
import lessons from './listeningLessonsLong.json' with {type:'json'}
import {LEGACY_LISTENING_LESSONS} from './listeningLessonsLegacy.js'
export const LISTENING_LESSONS=lessons
export const findListeningLesson=id=>LISTENING_LESSONS.find(l=>l.id===id)||LEGACY_LISTENING_LESSONS.find(l=>l.id===id)
export const EXTERNAL_RESOURCES=[
  {id:'voa-course',title:'VOA Let’s Learn English',type:'课程与播客',level:'入门–进阶',
    url:'https://learningenglish.voanews.com/p/5644.html',source:'VOA Learning English',
    note:'52课官方课程，含听说、词汇、练习和教学资料；在来源站点学习。',
    licenseUrl:'https://learningenglish.voanews.com/p/6861.html',license:'自制素材需注明来源；AP、Reuters、AFP 等第三方素材不在转载范围。'},
  {id:'voa-podcast',title:'VOA Learning English Podcast',type:'播客',level:'入门–进阶',
    url:'https://learningenglish.voanews.com/',source:'VOA Learning English',note:'从官方主页进入 Learning English Podcast；按兴趣收听后用英语复述。',
    licenseUrl:'https://learningenglish.voanews.com/p/6861.html',license:'这里提供官方入口，不复制第三方新闻素材。'},
  {id:'british-listening',title:'British Council 分级听力',type:'听力课程',level:'A1–C1',
    url:'https://learnenglish.britishcouncil.org/free-resources/listening',source:'British Council',
    note:'按 CEFR 分级，有情境录音和互动练习；在官方网站使用。',
    licenseUrl:'https://www.britishcouncil.org/terms',license:'官方学习入口；未将免费访问视为转载许可。'},
  {id:'librivox',title:'LibriVox 公版有声书',type:'有声书',level:'原版阅读',
    url:'https://librivox.org/',source:'LibriVox',note:'可寻找与所读经典对应的真人朗读。录音口音与速度因朗读者而异。',
    licenseUrl:'https://librivox.org/pages/public-domain/',license:'来源声明在美国属公版；其他地区需核对适用状态。'},
]
