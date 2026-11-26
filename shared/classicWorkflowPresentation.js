import {assignClassicActors} from './classicLearning.js'
const translations={
 library:['欢迎来到图书馆。你在找某本书，还是某个主题的书？','目录显示有两本，一本在架上，另一本已借出。需要我帮你找在架的那本吗？','持借书卡可以借书。这次练习请使用虚构的姓名和卡号。','借期是三周。若没有其他读者预约，你可以续借。','需要更多时间时，请在到期前查看续借选项。其他读者的预约可能会导致无法续借。','你可以在柜台还书，也可以使用还书箱。需要归还确认吗？'],
 restaurant:['晚上好，请问有预订吗？今晚几位用餐？','这是菜单。蔬菜汤六英镑。需要推荐吗？','你想点什么？如果有过敏或饮食要求，请告诉我。','一份汤和一份沙拉，大约等十五分钟。订单正确吗？','用餐还顺利吗？如果少了什么，或者与点的不同，请告诉我。','这是账单，请核对项目。你们一起付还是分开付？'],
 directions:['你好，你要去哪里？步行还是乘公共交通？','去博物馆的话，经过银行后在第二个路口左转。入口在公园旁边。','步行大约二十分钟。八路公交车需要十分钟，但要在 B 站等车。','是第二个路口左转，不是第一个。要我慢一点重复路线吗？','对，经过银行后第二个路口左转，然后找公园。你能用自己的话复述路线吗？','博物馆入口有蓝色标牌。如果到了桥边，就走过了。还需要其他细节吗？'],
 interview:['感谢参加面试。请介绍自己，并说说你对软件开发的兴趣。','请选择一个项目。目标是什么？你亲自负责了哪一部分？','说说项目中的一个问题。你怎样调查？怎样检验修改是否有效？','这个岗位需要团队协作，并解释技术决策。你想了解哪些工作内容？','请具体说明你独立实现的部分。还需要学习的内容也可以坦诚说明。','谢谢。下一步是下周的一次简短技术交流。最后还有问题吗？'],
 shopping:['你好，今天想找什么？有特定的尺码或预算吗？','这两件夹克很相似。蓝色的更轻，黑色的贵十英镑。','试衣间在右边。如果需要其他尺码，请告诉我。','保留收据，未使用的商品十四天内可以换货。需要解释具体规则吗？','这件夹克四十英镑。付款前请核对尺码。需要纸质收据吗？','欢迎回来。商品有什么问题？请说明具体情况，我们再讨论换货。'],
 campus:['我们需要商定小组项目的目标。你觉得应该开发或研究什么？','研究、界面和测试都需要有人负责。你能承担哪项任务？','初稿周五截止，最终展示在周一。我们何时一起检查进度？','研究比预期慢。怎样调整任务，才能保留主要目标？','提交前需要检查主要流程和展示内容。什么证据能说明已经准备好？','我们总结一下负责人和截止时间。谁发下一次进展？何时再见面？'],
}
const goals={
 shopping:[['说明想买的商品或用途','补充尺码、预算等至少一项选购条件'],['询问两件商品的区别','表达选择或进一步比较的需求'],['说明试穿后的感受','确认尺码或提出调整要求'],['询问退换期限','确认收据或商品状态要求'],['核对价格及所选商品','确认付款方式或索取收据'],['说明商品问题','提出退换需求并确认处理安排']],
 library:[['说明书名或主题','说明阅读目的或书籍类型'],['核对可借状态','询问位置或可借的替代版本'],['询问办卡或借阅条件','说明如何配合登记'],['核对借期或到期日','询问续借条件'],['提出续借或到期问题','确认可行处理方式'],['说明归还需求','确认还书完成或归还方式']],
}
const p=(id,name,englishName,responsibility)=>({id,name,role:name,englishName,responsibility})
const airportRows=[
 ['checkin','办理值机','agent','Welcome. Where are you flying today, and do you have a booking confirmation?','欢迎。你今天飞往哪里？有预订确认吗？',['说明目的地与预订情况','询问如何完成值机'],['I am flying to London. Here is my booking confirmation.','Could you help me check in?'],'值机人员先核对什么？',['目的地与预订','早餐种类','房间楼层']],
 ['baggage','确认行李与登机牌','agent','You can check one bag and take one small case on board. Would you prefer an aisle or a window seat?','你可以托运一件行李，并随身带一个小箱子。喜欢靠过道还是靠窗？',['确认托运和随身行李要求','表达座位偏好并索取登机牌'],['Can I take this small case on board?','Could I have an aisle seat and my boarding pass, please?'],'允许带几件托运行李？',['一件','两件','不允许托运']],
 ['security','通过安检并澄清要求','security','Please put your bag in a tray. Do you have a laptop that needs to go in a separate tray?','请把包放进托盘。有需要单独放进托盘的笔记本电脑吗？',['回应行李或电子设备问询','询问或确认安检操作'],['Should I take my laptop out?','Could you show me where to put my bag?'],'对方特别询问哪样物品？',['笔记本电脑','酒店房卡','午餐订单']],
 ['gate','核对登机口与时间','gate','Your flight leaves from gate twelve. Boarding starts at ten thirty. Do you need help finding the gate?','你的航班在十二号登机口登机，十点半开始。需要帮忙找登机口吗？',['核对登机口和开始时间','确认如何前往或询问延误'],['Did you say gate twelve at ten thirty?','How do I get there, and is there any delay?'],'几点开始登机？',['十点半','十二点','九点半']],
 ['boarding','登机或处理转机问询','gate','We are boarding now. Please have your boarding pass ready. Do you have a question about your connection?','现在开始登机。请准备好登机牌。关于转机还有问题吗？',['回应登机牌核对','说明有无转机或提出转机问题'],['Here is my boarding pass.','Will I have enough time for my connection?'],'登机前应准备什么？',['登机牌','餐厅菜单','图书馆借书卡']],
 ['seat','找到座位与放置行李','crew','Welcome on board. Your seat is twenty-one C, on the aisle. Could you put the larger bag in the overhead locker?','欢迎登机。你的座位是二十一排 C，靠过道。请把较大的包放到头顶行李架。',['核对座位或寻求协助','确认行李存放或安全带使用'],['Could you help me find seat twenty-one C?','Where should I put this bag, and how do I fasten the seat belt?'],'座位在哪里？',['二十一排 C，靠过道','十二排 A，靠窗','没有指定座位']],
 ['service','客舱内提出合理需求','crew','Would you like some water? Let me know if you need help during the flight.','需要水吗？飞行途中如需帮助，请告诉我。',['表达饮水或其他合理需求','核对服务安排或礼貌确认'],['Could I have some water, please?','Could you tell me when we will arrive?'],'乘务员主动提供什么？',['水','新的酒店预订','办理借书卡']],
 ['arrival','到达与行李领取','crew','After arrival, follow the signs to baggage claim. Bags from this flight will be on belt four. Do you need any other information?','到达后请跟随标志前往行李提取处。本航班行李在四号转盘。还需要其他信息吗？',['确认行李领取位置','询问行李异常处理或结束交流'],['Where is belt four?','Who should I contact if my case does not arrive?'],'行李在哪个转盘？',['四号','十二号','二十一号']],
]
export function airportWorkflow(route='standard',transfer=false){
 const actors=[p('agent','值机工作人员','Check-in Agent','核对值机、行李和座位'),p('security','安检工作人员','Security Officer','解释安检操作，不代表登机口'),p('gate','登机口工作人员','Gate Agent','核对登机口、时间和转机信息'),p('crew','乘务员','Cabin Crew','协助客舱就座、合理需求和到达说明')]
 const plan={id:'airport-journey',title:'机场出行完整流程',route,actors,variation:transfer?'changed-constraints':'standard',sharedFacts:['使用虚构的预订信息；用户始终是旅客；不代办真实旅行'],stages:airportRows.map(([id,title,actorId,opening,openingTranslation,goals,expressions,question,choices],i)=>({id,title,actorId,allowedActorIds:[actorId],opening,openingTranslation,goals,expressions,listening:{question,choices,correctIndex:0}}))}
 if(transfer){let text=JSON.stringify(plan);for(const [a,b] of [['gate twelve','gate fourteen'],['ten thirty','eleven fifteen'],['十二号登机口','十四号登机口'],['十点半','十一点十五分'],['belt four','belt six'],['四号','六号']])text=text.replaceAll(a,b);return JSON.parse(text)}
 return plan
}
export function enhanceWorkflow(scene,workflow,{route,transfer}={}){
 if(!workflow)return null
 const key=scene.sourceSceneId||scene.id
 if(!['hotel','cafe',...Object.keys(translations),'airport'].includes(key))return workflow
 let stages=workflow.stages.map((s,i)=>({...s,openingTranslation:s.openingTranslation||translations[key]?.[i]||''}))
 if(goals[key])stages=stages.map((s,i)=>({...s,goals:goals[key][i]}))
 if(key==='hotel'){
  const breakfast=workflow.route!=='online-room-only',night=transfer?'周六':'周五',end=transfer?'周一':'周日',price=transfer?'95':'80'
  const values=[workflow.route==='phone'?'感谢来电。你想预订哪几天？':workflow.route==='walkin'?'欢迎。今晚还有空房。你想住几晚？':`欢迎来到在线预订咨询。标准间每晚 ${price} 英镑，你想住哪几天？`,`你预订的两晚住宿从${night}开始。确认前请核对日期和房型。`,'欢迎。有预订吗？入住需要核对证件，本次练习请使用虚构信息。',`${breakfast?'早餐已包含。':'早餐不包含，每人十英镑。'}供应时间是七点至十点，在一楼餐厅。`,'这是二〇三房间的两张房卡。乘电梯到二楼。十一点退房。','你好，这里是客房服务。房间设施是否正常，毛巾够用吗？','十分钟内可以送来额外毛巾。到时房间有人吗？',breakfast?'早上好。请问房号？自助餐在左边。有什么饮食要求吗？':'早上好。早餐每人十英镑。你想购买早餐，还是自行安排？',`早上好，准备退房了吗？请核对两晚、每晚 ${price} 英镑的账单。`,'这是更新后的收据。请归还房卡。需要临时寄存行李吗？']
  stages=stages.map((s,i)=>({...s,openingTranslation:values[i]}))
 }
 if(key==='cafe'){
  const atTable=workflow.route==='table'
  const actors=atTable?workflow.actors:[p('cashier','点单收银员','Cashier','接单、规格、口味和付款确认'),p('barista','咖啡师','Barista','制作、交付饮品并处理制作不符')]
  const values=[atTable?'欢迎，请入座。你想在这里用餐吗？':'欢迎。请问堂食还是外带？',`中杯饮品 ${transfer?'4':'3'} 英镑。需要菜单推荐吗？`,'今天想点什么？','要糖吗？喜欢哪种奶？',`一杯中杯饮品，${transfer?'4':'3'} 英镑。订单正确吗？`,atTable?'五分钟内我会把订单送到桌边。':'请五分钟后到柜台取餐。','订单有任何问题请告诉我。和你要求的一致吗？']
  return {...workflow,actors,stages:stages.map((s,i)=>({...s,actorId:atTable?s.actorId:i<5?'cashier':'barista',allowedActorIds:actors.map(a=>a.id),openingTranslation:values[i]}))}
 }
 if(key==='shopping'&&workflow.route==='exchange'){
  stages[0]={...stages[0],goals:['说明已购商品和退换诉求','确认收据或购买时间'],openingTranslation:'欢迎回来。带了商品和收据吗？你想更换哪件商品？'}
  stages[4].openingTranslation='替换商品贵十英镑。想补差价，还是再选一件？';stages[5].openingTranslation='这是替换商品和更新后的收据。离开前请检查。'
 }
 if(key==='restaurant'&&workflow.route==='takeaway')stages[0].openingTranslation='你好，想点外带食品吗？请告诉我需要几份。'
 if(key==='directions'&&workflow.route==='transit')stages[0].openingTranslation='你要乘公交去博物馆吗？八路车停在公园附近。你从哪里出发？'
 if(key==='campus'&&workflow.route==='delay')stages[0].openingTranslation='项目进度落后了。我们可以确认主要目标和需要调整的安排吗？'
 if(key==='interview'&&workflow.route==='teamwork')stages[0].openingTranslation='欢迎。请介绍自己，并说说参与项目团队协作的经历。'
 if(transfer){const replacements=[['三周','两周'],['十五分钟','二十分钟'],['步行大约二十分钟','步行大约二十五分钟'],['四十英镑','四十五英镑'],['十四天','二十一天'],['周五截止','周四截止'],['下周的一次','两周后的一次']];stages=stages.map(s=>({...s,openingTranslation:replacements.reduce((text,[from,to])=>text.replaceAll(from,to),s.openingTranslation)}))}
 return {...workflow,...assignClassicActors({...scene,actors:workflow.actors},stages,key)}
}
