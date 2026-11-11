// Original teaching drafts, not official IELTS material. No draft is published by the importer.
import { drillPapers } from './drills.js'
const source = { kind: 'original', author: '背了么项目原创（AI 辅助起草）', license: 'CC BY 4.0', official: false, reviewRequired: true }
const facts = [
  {
    title: 'A library of things', topic: 'community',
    paragraphs: [
      'A. In the town of Westhaven, a public library has expanded beyond books. Its new lending collection includes tools, musical instruments and small kitchen appliances. The idea came from residents who needed expensive objects only a few times a year. Rather than buy a drill for one afternoon of work, a member can borrow one. The project opened in March, after a six-month consultation. During that consultation, the library asked people what they already owned, what they wanted to borrow and how far they were willing to travel. Repair tools were requested more often than any other category.',
      'B. Access is not entirely free. Members pay an annual fee of twelve pounds, which helps cover safety inspections. Every electrical item is checked when it returns, even if the borrower reports no problem. Borrowers must be eighteen or older. Most items can be kept for seven days; musical instruments are available for fourteen days because beginners need more time. Late fees are capped so that a mistake does not become a financial barrier. A volunteer may explain how a tool works, but specialist training is not included in the membership.',
      'C. Early results have surprised the organisers. They expected price to be the main attraction, but interviews suggest that storage space matters just as much. Several members live in small flats and do not want cupboards full of rarely used equipment. However, the project has not yet measured whether borrowing actually reduces purchases across the town. Counting loans is easy; estimating avoided production is harder. Researchers plan to follow a group of households for a year before drawing conclusions about environmental benefits.',
      'D. The service faces practical limits. Demand rises sharply before public holidays, while returns tend to arrive on Monday mornings. To reduce queues, the library introduced online reservations and a separate collection desk. It rejected a proposal for home delivery because transport costs would have exceeded the current budget. The organisers now publish availability data every month and invite members to suggest improvements. Their aim is a reliable local service, rather than rapid expansion into every neighbouring town.'
    ],
    details: [['Opening month','March','The project opened in March'],['Annual membership fee in pounds','twelve','an annual fee of twelve pounds'],['Minimum age','eighteen','Borrowers must be eighteen or older'],['Normal loan duration in days','seven','Most items can be kept for seven days'],['Instrument loan duration in days','fourteen','musical instruments are available for fourteen days'],['Most frequently requested category','repair tools','Repair tools were requested more often'],['Collection bottleneck day','Monday','returns tend to arrive on Monday mornings']],
    headings: ['A local sharing experiment','Rules and safety','Evidence and uncertainty','Managing demand'],
    assertions: [['All electrical items are checked after a loan.','TRUE','Every electrical item is checked when it returns'],['The library currently delivers equipment to homes.','FALSE','It rejected a proposal for home delivery'],['Most members own cars.','NOT GIVEN','The passage does not describe members’ car ownership.']],
    words: ['consultation','inspection','reservation','barrier','reliable']
  },
  {
    title: 'Cooling the city', topic: 'environment',
    paragraphs: [
      'A. Cities often remain warm long after the surrounding countryside has cooled. Dark surfaces absorb sunlight, buildings restrict air movement and engines release additional heat. A research team in Northbridge compared temperatures on streets with different amounts of tree cover. Sensors were placed at the same height and recorded data every ten minutes. Measurements continued through July and August. The researchers avoided comparing readings taken at different times, since even a passing cloud can change surface temperatures quickly.',
      'B. Streets with mature trees were generally cooler during the afternoon. Shade reduced the sunlight reaching pavements, while evaporation from leaves also contributed. Yet the size of the difference varied. Narrow streets between tall buildings received little direct sun already, so extra tree cover had a smaller effect there. The researchers warn against promising one fixed temperature reduction for every location. Tree species, water supply and the geometry of a street all influence outcomes.',
      'C. Planting trees requires choices about limited space. Roots can conflict with underground pipes, and young trees need regular watering. Northbridge is testing larger planting pits that collect rainwater from nearby pavements. The pilot includes thirty sites, chosen partly because maintenance teams can reach them easily. It does not compare every available design. A separate group is interviewing residents about shade, visibility and access for wheelchairs. Temperature is only one measure of a successful street.',
      'D. The council intends to use the results to guide maintenance as well as new planting. Keeping existing mature trees healthy may provide benefits sooner than planting large numbers of seedlings. However, diseased trees sometimes have to be replaced. The team recommends a mixture of species to reduce the risk that one pest affects the entire urban forest. It also argues for publishing failures, including sites where trees died, so that other towns can learn from the experience.'
    ],
    details: [['Time between measurements in minutes','ten','recorded data every ten minutes'],['First month of measurements','July','through July and August'],['Number of pilot sites','thirty','The pilot includes thirty sites'],['Collected resource','rainwater','collect rainwater from nearby pavements'],['Infrastructure affected by roots','pipes','Roots can conflict with underground pipes'],['Cooling process besides shade','evaporation','evaporation from leaves also contributed'],['Recommended variety','species','a mixture of species']],
    headings: ['Measuring urban heat','Why cooling varies','Designing workable spaces','Lessons for future management'],
    assertions: [['All streets showed the same temperature reduction.','FALSE','warn against promising one fixed temperature reduction'],['The pilot tests every possible planting design.','FALSE','It does not compare every available design'],['The council has doubled its tree budget.','NOT GIVEN','No change in budget is stated.']],
    words: ['evaporation','maintenance','geometry','mature','infrastructure']
  },
  {
    title: 'Learning through retrieval', topic: 'education',
    paragraphs: [
      'A. Students frequently judge learning by how familiar a page feels. Reading the same paragraph several times makes its wording easier to recognise, but this feeling does not necessarily predict later recall. A college study compared rereading with retrieval practice: trying to produce an answer without looking at the source. Participants first read a short science passage. Some reread it, while others closed the text and wrote down what they remembered. All groups spent the same total time on the activity.',
      'B. When tested immediately, the rereading group felt more confident and performed well on simple recognition questions. A week later, the retrieval group remembered more on questions that required an explanation. The authors do not conclude that reading is unnecessary. Students need an initial encounter with the material, and feedback after an unsuccessful retrieval attempt can correct misunderstandings. The point is to include opportunities to bring information to mind, rather than treating repeated exposure as sufficient.',
      'C. Classroom use introduces complications. A test can feel threatening if every mistake affects a final grade. Teachers in a follow-up project therefore used low-stakes quizzes and allowed discussion after each attempt. They mixed questions from recent lessons with older material. This made practice more difficult at first, but helped reveal which ideas needed attention. Students were asked to explain their answers, reducing the chance that a correct guess would be treated as secure understanding.',
      'D. The researchers also note limits to generalisation. Their original participants were volunteers from one college, and the passages were shorter than a typical textbook chapter. The results do not establish an ideal schedule for every learner or subject. Future work will examine longer courses and practical skills. In the meantime, the authors suggest a modest change: close the book occasionally, attempt an answer and then check it. A difficult practice session can sometimes be more informative than an easy one.'
    ],
    details: [['Main comparison activity','retrieval practice','compared rereading with retrieval practice'],['Subject of the passage','science','a short science passage'],['Delayed test interval','a week','A week later'],['Quizzes used in classrooms','low-stakes','used low-stakes quizzes'],['Original participants came from one','college','volunteers from one college'],['What can correct misunderstandings','feedback','feedback after an unsuccessful retrieval attempt can correct misunderstandings'],['What students explained','answers','Students were asked to explain their answers']],
    headings: ['Familiarity and recall','Delayed results','Practice in a classroom','Limits and next steps'],
    assertions: [['The authors believe reading is unnecessary.','FALSE','do not conclude that reading is unnecessary'],['Both initial groups spent the same study time.','TRUE','All groups spent the same total time'],['The study included every age group.','NOT GIVEN','The participants’ ages are not stated.']],
    words: ['retrieval','recognition','exposure','generalisation','misunderstanding']
  }
]

function readingPaper(set) {
  const sections = facts.map((f,i)=>({ id:`p${i+1}`, title:f.title, text:f.paragraphs.join('\n\n') }))
  const questions=[]
  facts.forEach((f,index)=>{
    const sectionId=`p${index+1}`
    const make=q=>questions.push({id:`q${questions.length+1}`,sectionId,...q})
    f.details.forEach(([prompt,answer,evidence])=>make({type:'completion',prompt:`Complete the note: ${prompt}: ____`,maxWords:2,answer:[answer],evidence,explanation:`定位原文“${evidence}”，按字数限制填写。`,targetWords:f.words.slice(0,2)}))
    f.assertions.forEach(([prompt,answer,evidence])=>make({type:'true_false',prompt,options:['TRUE','FALSE','NOT GIVEN'].map(v=>({value:v,label:v})),answer,evidence,explanation:answer==='NOT GIVEN'?'原文未提供足够信息，不能用常识补全。':`根据原文“${evidence}”判断。`,targetWords:f.words.slice(2,3)}))
    ;[0,1,2].forEach(p=>make({type:'headings',prompt:`Choose the best heading for paragraph ${String.fromCharCode(65+p)}.`,options:f.headings.map((h,i)=>({value:String(i+1),label:`${i+1}. ${h}`})),answer:String(p+1),evidence:f.paragraphs[p].slice(0,120),explanation:`该段中心对应“${f.headings[p]}”。`,targetWords:[]}))
  })
  questions.push({id:'q40',sectionId:'p3',type:'short_answer',prompt:'What should students check after attempting an answer?',maxWords:2,answer:['the answer','answer','it'],evidence:'attempt an answer and then check it',explanation:'check it 中的 it 指代刚才尝试作答的答案。',targetWords:['retrieval']})
  return {code:`academic-${set}-reading`,version:1,skill:'reading',title:`Academic 综合练习 ${set} · 阅读`,durationSeconds:3600,sections,questions,source,reviewChecklist:['审核题目难度与篇章长度','逐题核对答案、字数限制与定位','核对替代表达及题型覆盖'],draftNote:'首批教学草稿，篇章长度与难度尚待教师校准，不是官方真题。'}
}

const listeningScripts = [
  ['Community workshop booking', 'Receptionist: Good morning, Westhaven workshop. Caller: I would like to book the bicycle repair course. Receptionist: The next course starts on Saturday, at nine thirty. It runs in Room seven, beside the garden. Caller: How much is it? Receptionist: Twenty pounds, including materials. Please bring gloves and wear old clothes. There are twelve places. You can reserve by email. Our address is workshop at westhaven dot org. Caller: Is there parking? Receptionist: The nearest car park is behind the library. Buses stop at the main entrance. The tutor is Maya Green. Please arrive ten minutes before the class starts.',
    [['Course topic','bicycle repair'],['Day','Saturday'],['Start time','nine thirty'],['Room number','seven'],['Nearby outdoor area','garden'],['Price in pounds','twenty'],['Item to bring','gloves'],['Number of places','twelve'],['Car park landmark','library'],['Tutor surname','Green']]],
  ['A tour of the learning centre','Welcome to the new learning centre. We are standing at the south entrance. The reception desk is directly ahead. To the west is the quiet study room, and to the east is the cafe. The computer room is north of reception, next to the stairs. Workshops take place on the first floor. The centre opens at eight and closes at ten on weekdays. On Sundays it closes at six. Membership is free for local residents. Visitors may borrow two books at a time. Printing costs ten pence a page. Please book group rooms one day in advance. Our monthly open meeting is on the first Tuesday.',
    [['Quiet room direction','west'],['Cafe direction','east'],['Computer room direction','north'],['Workshop floor','first'],['Opening hour','eight'],['Weekday closing hour','ten'],['Sunday closing hour','six'],['Maximum books for visitors','two'],['Printing cost in pence','ten'],['Open meeting day','Tuesday']]],
  ['Planning a student project','Tutor: What is your project about? Student one: Food waste in university kitchens. Student two: We plan to interview staff, rather than rely only on a questionnaire. Tutor: How many kitchens? Student one: Four. We will visit them in November. Tutor: Remember to get written permission. Student two: We will weigh waste each morning for five days. Student one: We originally planned to include restaurants, but travel would cost too much. Tutor: Compare the same types of meal, and separate preparation waste from leftovers. Student two: We will present the results as a poster. Tutor: Good. Your deadline is the fifteenth of December. Include a section explaining limitations. Student one: We can discuss seasonal changes there.',
    [['Project topic','food waste'],['Main research method','interview'],['Number of kitchens','four'],['Visit month','November'],['Required permission format','written'],['Measurement duration in days','five'],['Excluded business type','restaurants'],['Output format','poster'],['Deadline month','December'],['Possible limitation','seasonal changes']]],
  ['Restoring urban wetlands','Today I will discuss the restoration of urban wetlands. Historically, many wetlands were drained to provide land for construction. Restoration can offer flood storage, wildlife habitat and opportunities for education. One city project began in April and covered eighteen hectares. Engineers first tested the soil, then removed a concrete channel. Water levels were monitored with sensors. Volunteers planted reeds along the edges. Public paths were placed on raised boardwalks to reduce damage. The team counted birds every Friday. After two years, water quality had improved, but the researchers cautioned that rainfall also influenced the results. Long-term maintenance is funded by the city council. The next stage will examine how visitors use the site.',
    [['Previous land use purpose','construction'],['Benefit related to water','flood storage'],['Starting month','April'],['Area in hectares','eighteen'],['First material tested','soil'],['Monitoring equipment','sensors'],['Plants introduced','reeds'],['Visitor path structure','boardwalks'],['Bird count day','Friday'],['Maintenance funder','city council']]]
]
function listeningPaper(set) {
  const sections=listeningScripts.map(([title,text],i)=>({id:`p${i+1}`,title,text,audioUrl:`/api/v1/ielts/audio/academic-${set}-p${i+1}.wav`,segments:[]}))
  const questions=[]
  listeningScripts.forEach(([title,text,details],i)=>details.forEach(([prompt,answer],j)=>{
    questions.push({id:`q${questions.length+1}`,sectionId:`p${i+1}`,type:i===1&&j<3?'map':'completion',prompt:`${prompt}: ____`,maxWords:2,answer:[answer],evidence:text,explanation:`在“${title}”录音中定位该信息。`,targetWords:i===3?['restoration','maintenance']:['reservation']})
  }))
  return {code:`academic-${set}-listening`,version:1,skill:'listening',title:`Academic 综合练习 ${set} · 听力`,durationSeconds:1800,sections,questions,source,draftNote:'待配音和教师扩写、计时复核；当前脚本为短篇教学样稿，不能作为已校准完整听力试卷发布。'}
}

function writingPaper(set) {
  const chart = set===1 ? {kind:'bar',title:'Share of commuters using public transport (%)',labels:['2010','2015','2020','2025'],series:[{name:'City A',values:[25,32,40,48]},{name:'City B',values:[40,42,43,45]}]} : {kind:'line',title:'Households with internet access (%)',labels:['2005','2010','2015','2020'],series:[{name:'Urban',values:[45,62,79,92]},{name:'Rural',values:[18,30,50,74]}]}
  return {code:`academic-${set}-writing`,version:1,skill:'writing',title:`Academic 综合练习 ${set} · 写作`,durationSeconds:3600,source,
    sections:[{id:'task1',title:'Task 1',text:'Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',chart},{id:'task2',title:'Task 2',text:set===1?'Some people believe that public libraries should focus on books, while others think they should provide a wider range of community services. Discuss both views and give your own opinion.':'Some people think that cities should spend more money on public transport than on roads. To what extent do you agree or disagree?'}],
    questions:[{id:'task1',sectionId:'task1',type:'essay',prompt:'Write at least 150 words. Recommended time: 20 minutes.',minimumWords:150},{id:'task2',sectionId:'task2',type:'essay',prompt:'Write at least 250 words. Recommended time: 40 minutes.',minimumWords:250}]}
}
export const speakingTopics = [
 ['education','学习','a skill you learned outside school','practical skills','How should schools balance theory and practical skills?'],
 ['environment','环境','a place in nature you enjoyed visiting','green spaces','Who should pay for protecting natural areas?'],
 ['technology','科技','a piece of technology that helps you','digital tools','How has technology changed the way people learn?'],
 ['community','社区','a helpful person in your neighbourhood','community services','What makes a community a good place to live?'],
 ['transport','出行','a memorable journey on public transport','public transport','How can cities reduce traffic congestion?'],
 ['work','工作','a job you would like to try','working conditions','Which skills will be valuable in future workplaces?'],
 ['health','健康','a habit that helps you stay healthy','healthy habits','How can employers support healthy lifestyles?'],
 ['culture','文化','a cultural event you attended','local traditions','Why do some traditions change over time?'],
 ['housing','居住','a home you would like to live in','housing choices','What housing problems do large cities face?'],
 ['travel','旅行','a place you would recommend to a visitor','tourism','How can tourism benefit local communities?']
]
function speakingPaper(topic,index) {
  const [code,name,cue,subject,discussion]=topic
  return {code:`speaking-${code}`,version:1,skill:'speaking',title:`口语话题 · ${name}`,durationSeconds:840,source,topic:code,
    sections:[{id:'part1',title:'Part 1',text:`Short questions about ${subject}.`},{id:'part2',title:'Part 2',text:`Describe ${cue}. You should say what it was, when it happened, who was involved, and explain why it was important to you.`},{id:'part3',title:'Part 3',text:'Discuss the broader ideas connected to the topic.'}],
    questions:[{id:'p1a',sectionId:'part1',type:'spoken',prompt:`How often do you think about ${subject}?`,answerSeconds:60},{id:'p1b',sectionId:'part1',type:'spoken',prompt:`Has your interest in ${subject} changed since childhood?`,answerSeconds:60},{id:'p2',sectionId:'part2',type:'spoken',prompt:`Describe ${cue}.`,preparationSeconds:60,answerSeconds:120},{id:'p3a',sectionId:'part3',type:'spoken',prompt:discussion,answerSeconds:90},{id:'p3b',sectionId:'part3',type:'spoken',prompt:'How might this situation change in the next twenty years?',answerSeconds:90}]}
}

export const seedPapers = [1,2].flatMap(set=>[listeningPaper(set),readingPaper(set),writingPaper(set),{...speakingPaper(speakingTopics[set-1],set),code:`academic-${set}-speaking`,title:`Academic 综合练习 ${set} · 口语`}]).concat(speakingTopics.map(speakingPaper),drillPapers)

export const vocabularyCards = [
 ['sustainable','可持续的','sustainable development','Development that can continue without exhausting resources.','lasting','maintainable'],
 ['significant','显著的','a significant increase','The survey found a significant increase in bicycle use.','substantial','important'],
 ['accessible','易于使用或到达的','accessible public transport','Public buildings should be accessible to everyone.','available','reachable'],
 ['consequence','后果','an unintended consequence','The policy had an unintended consequence for small shops.','result','outcome'],
 ['evidence','证据','reliable evidence','More reliable evidence is needed before drawing conclusions.','proof','support'],
 ['maintain','维护；保持','maintain equipment','The centre employs technicians to maintain its equipment.','preserve','keep'],
 ['allocate','分配','allocate resources','Councils must allocate limited resources carefully.','distribute','assign'],
 ['adapt','适应；调整','adapt to change','Schools need to adapt to changing social needs.','adjust','modify'],
 ['benefit','益处','a long-term benefit','The long-term benefit may exceed the initial cost.','advantage','gain'],
 ['approach','方法','a practical approach','The team adopted a practical approach to the problem.','method','strategy']
].map(([word,meaning,collocation,example,synonym,alternative],i)=>({id:`v${i+1}`,word,meaning,collocation,example,synonym,alternative,source}))
