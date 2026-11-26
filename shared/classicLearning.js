const vocabulary = rows => rows.map(([word,sense,phrase,example,...otherSenses])=>({word,sense,phrase,example,otherSenses}))
// Different meanings belong to the SAME word. These are authored sense contrasts,
// never definitions borrowed from another target word.
export const CLASSIC_VOCABULARY = {
  hotel:vocabulary([
    ['reservation','预订','a reservation','I have a reservation under Alex.','保留意见','保护区'],
    ['room','房间','a quiet room','Could I have a quiet room?','空间；余地'],
    ['breakfast','早餐','breakfast included','Is breakfast included?','吃早餐（动词）'],
    ['checkout','退房','the checkout time','What is the checkout time?','超市结账处','设备检查'],
    ['book','预订','book a room','Could I book a room for two nights?','书籍'],
    ['confirm','确认','confirm the dates','Could you confirm the dates?','使信念更加坚定'],
    ['standard','标准的','a standard room','I would like a standard room.','标准；准则'],
    ['rate','价格；收费标准','the room rate','Does the room rate include breakfast?','速度；比率','评价（动词）'],
    ['key','钥匙；房卡','a key card','My key card does not work.','关键的','键盘按键'],
    ['floor','楼层','the second floor','Which floor is my room on?','地板'],
    ['charge','收费','an extra charge','Could you explain this charge?','给电池充电','指控'],
    ['receipt','收据','a receipt','Could I have a receipt?','收到；接收'],
  ]),
  cafe:vocabulary([
    ['medium','中杯的','a medium coffee','Could I have a medium coffee?','传播媒介','灵媒'],
    ['sugar','糖','without sugar','I would like it without sugar.','给……加糖（动词）'],
    ['receipt','收据','a receipt','Could I have a receipt?','收到；接收'],
    ['order','点单；订购','place an order','I would like to place an order.','顺序','命令'],
    ['milk','奶','oat milk','Could you make it with oat milk?','挤奶（动词）'],
    ['hot','热的','a hot drink','Is this a hot drink?','辣的','热门的'],
    ['regular','普通规格的','a regular coffee','A regular coffee, please.','经常的','规则的'],
    ['light','清淡的','a light drink','I would like a light drink.','光线','轻的'],
    ['change','更改','change my order','Could I change my order?','零钱'],
    ['takeaway','外带食品','a takeaway coffee','Could I have a takeaway coffee?','要点；收获'],
    ['counter','柜台','at the counter','Should I collect it at the counter?','反驳（动词）','计数器'],
    ['bill','账单','the bill','Could I check the bill?','鸟喙','法案'],
  ]),
  restaurant:vocabulary([
    ['menu','菜单','the menu','Could I see the menu?','电脑功能选单'],
    ['recommend','推荐','recommend a dish','What dish would you recommend?','建议采取某做法'],
    ['order','点餐','order some food','I would like to order some food.','顺序','命令'],
    ['table','餐桌','a table for two','Could we have a table for two?','表格','把议案提交讨论（动词）'],
    ['course','一道菜','the main course','What is the main course today?','课程','路线'],
    ['starter','前菜','a light starter','Could you recommend a starter?','发动机启动装置','初学者'],
    ['dish','菜品','a vegetable dish','Does this dish contain nuts?','盘子'],
    ['rare','半生的（肉）','a rare steak','I would like a rare steak.','罕见的'],
    ['still','不含气泡的（水）','still water','Could we have still water?','仍然','静止的'],
    ['serve','上菜；供应','serve the soup','When will you serve the soup?','为……服务','发球'],
    ['bill','账单','the bill','Could we have the bill?','法案','鸟喙'],
    ['tip','小费','leave a tip','Is a tip included in the bill?','尖端','实用建议'],
  ]),
  directions:vocabulary([
    ['nearby','在附近','a museum nearby','Is there a museum nearby?','附近的（形容词）'],
    ['turn','转弯','turn left','Should I turn left here?','轮次','变化'],
    ['across','穿过；到另一边','across the street','Should I go across the street?','在……对面'],
    ['block','街区','two blocks','Is it two blocks from here?','阻挡（动词）','大块材料'],
    ['right','右边','on the right','Is the entrance on the right?','正确的','权利'],
    ['left','左边','on the left','Is the station on the left?','离开（leave的过去式）','剩下的'],
    ['straight','直地','go straight','Should I go straight ahead?','诚实坦率的'],
    ['line','公交或地铁线路','the green line','Should I take the green line?','排队形成的队伍','线条'],
    ['stop','车站','the next stop','Which is the next stop?','停止（动词）'],
    ['cross','穿过','cross the road','Where can I cross the road?','十字形','生气的'],
    ['change','换乘','change at Central','Do I change at Central?','零钱','变化'],
    ['fare','车费','the bus fare','How much is the bus fare?','进展；过得如何（动词）'],
  ]),
  shopping:vocabulary([
    ['size','尺码','a smaller size','Do you have a smaller size?','按大小分类（动词）'],
    ['price','价格','the price','What is the price of this jacket?','给……定价（动词）'],
    ['receipt','收据','keep the receipt','Should I keep the receipt?','收到；接收'],
    ['exchange','换货','exchange this shirt','Could I exchange this shirt?','交流','货币兑换'],
    ['fit','合身','fit well','Does this jacket fit well?','健康的','突然发作（名词）'],
    ['try','试穿；尝试','try it on','Could I try it on?','审判（动词）'],
    ['return','退货','return this item','Can I return this item?','返回','收益'],
    ['change','更换','change the size','Could I change the size?','零钱','变化'],
    ['match','相配','match these shoes','Does this jacket match these shoes?','比赛','火柴'],
    ['sale','促销','on sale','Is this jacket on sale?','出售；销售行为'],
    ['check','检查；核对','check the price','Could you check the price?','支票','方格图案'],
    ['card','银行卡','pay by card','Can I pay by card?','卡片','纸牌'],
  ]),
  interview:vocabulary([
    ['experience','经验；经历','project experience','I would like to share my project experience.','经历；体验（动词）'],
    ['strength','优势','my main strength','My main strength is explaining ideas.','体力','强度'],
    ['team','团队','work in a team','I enjoy working in a team.','组队合作（动词）'],
    ['responsibility','职责','my main responsibility','What would be my main responsibility?','对某事的责任或过错'],
    ['background','学习或工作背景','my academic background','May I describe my academic background?','图画背景','背景噪声'],
    ['role','岗位职责；角色','this role','What skills does this role require?','戏剧角色'],
    ['position','职位','the position','Could you tell me more about the position?','位置','立场'],
    ['challenge','困难；挑战','a technical challenge','We faced a technical challenge.','质疑（动词）'],
    ['lead','带领','lead the team','I helped lead the team.','铅（另一读音）','领先位置'],
    ['support','支持；协助','support my teammates','I support my teammates when they need help.','支撑物'],
    ['review','评审；检查','review the code','We review the code together.','评论文章','复习'],
    ['offer','职位录用意向','a job offer','When might I hear about a job offer?','提供（动词）','特价'],
  ]),
  campus:vocabulary([
    ['project','项目','our group project','What is the goal of our group project?','投射（动词）','预测（动词）'],
    ['deadline','截止时间','meet the deadline','How can we meet the deadline?','新闻截稿时间'],
    ['research','研究；调查','do some research','I can do some research this week.','研究（动词）'],
    ['schedule','安排时间','schedule a meeting','Can we schedule a meeting for Friday?','时间表（名词）'],
    ['task','任务','share the tasks','How should we share the tasks?','给……分派任务（动词）'],
    ['draft','初稿','the first draft','I can write the first draft.','穿堂风','征召'],
    ['note','笔记','take notes','Could you take notes at the meeting?','注意到（动词）','音符'],
    ['present','展示；汇报','present our results','Who will present our results?','礼物（另一读音）','在场的（另一读音）'],
    ['share','分享','share the document','Could you share the document?','股份','份额'],
    ['issue','问题','a technical issue','There is a technical issue to resolve.','期刊的一期','发行（动词）'],
    ['cover','负责；涵盖','cover this topic','Could you cover this topic?','封面','遮盖（动词）'],
    ['check','检查','check our work','When can we check our work?','支票','方格图案'],
  ]),
  library:vocabulary([
    ['borrow','借入','borrow a book','Could I borrow this book?','借用别人的想法或表达'],
    ['renew','续借','renew a book','Can I renew this book?','更新；恢复'],
    ['return','归还','return the book','I would like to return the book.','返回','收益'],
    ['copy','一本；一册','an available copy','Is there an available copy?','复制（动词）'],
    ['volume','一卷书','the second volume','Do you have the second volume?','音量','体积'],
    ['title','书名','the title','I know the title of the book.','头衔','冠军称号'],
    ['reserve','预约留书','reserve a copy','Could I reserve a copy?','自然保护区','储备'],
    ['fine','罚款','an overdue fine','Is there an overdue fine?','好的','细小的'],
    ['due','到期的','the due date','Could you confirm the due date?','由于……的','应得的'],
    ['reference','参考资料','the reference section','Where is the reference section?','推荐人证明','提及'],
    ['period','期限','the loan period','How long is the loan period?','句号','历史时期'],
    ['subject','主题','this subject','Do you have more books on this subject?','学科','句子主语'],
  ]),
  airport:vocabulary([
    ['check','办理手续；核对','check in','Where can I check in?','支票','方格图案'],
    ['boarding','登机','the boarding time','What is the boarding time?','寄宿；膳宿'],
    ['gate','登机口','the departure gate','Which gate should I go to?','院子大门','闸门'],
    ['case','行李箱','a small case','Can I take this small case on board?','情况','案件'],
    ['check','托运；检查','check this bag','Do I need to check this bag?','支票','方格图案'],
    ['connection','转机衔接','my connection','Will I have enough time for my connection?','网络连接','人际关系'],
    ['board','登上飞机','board the plane','When can we board the plane?','木板','董事会'],
    ['seat','座位','an aisle seat','Could I have an aisle seat?','使就座（动词）'],
    ['belt','安全带','the seat belt','How do I fasten the seat belt?','皮带','地带'],
    ['claim','领取行李','baggage claim','Where is baggage claim?','声称（动词）','索赔'],
    ['terminal','航站楼','the other terminal','How do I get to the other terminal?','计算机终端','末期的'],
    ['delay','延误','a short delay','Is there a delay to boarding?','推迟（动词）'],
  ]),
}
// Avoid duplicate targets while retaining the first, scene-specific meaning.
CLASSIC_VOCABULARY.airport[4]={word:'pass',sense:'通行凭证',phrase:'a boarding pass',example:'Here is my boarding pass.',otherSenses:['通过（动词）','传球（动词）']}
export function withClassicVocabulary(scene,count=8){
  const pool=CLASSIC_VOCABULARY[scene.sourceSceneId||scene.id]
  if(!pool)return scene
  const targetCount=Math.max(4,Math.min(pool.length,Number(count)||8))
  const targets=structuredClone(pool.slice(0,targetCount))
  return {...scene,targets,words:targets.map(t=>t.word),vocabularyCount:targets.length,vocabularyLimit:pool.length}
}
export const CLASSIC_ACTORS={
 restaurant:[['host','餐厅接待员','Host','安排座位与等位'],['waiter','餐桌服务员','Server','解释菜单、接单并处理用餐问题'],['cashier','收银员','Cashier','核对账单与收据']],
 shopping:[['assistant','导购员','Sales Assistant','了解需求、介绍商品'],['fitting','试衣区工作人员','Fitting Attendant','协助试穿和尺码'],['cashier','收银员','Cashier','核对价格、模拟结账与收据'],['service','售后工作人员','Customer Service','解释退换规则和处理售后']],
 interview:[['hr','招聘专员','Recruiter','介绍流程与后续安排'],['interviewer','业务面试官','Interviewer','讨论项目、问题处理和岗位协作']],
 campus:[['teammate','项目组员','Teammate','交流想法与自己的任务'],['coordinator','小组协调员','Coordinator','协调分工、时间和交付；不代替其他组员作答']],
}
const roles={restaurant:['host','waiter','waiter','waiter','waiter','cashier'],shopping:['assistant','assistant','fitting','service','cashier','service'],interview:['hr','interviewer','interviewer','interviewer','interviewer','hr'],campus:['teammate','coordinator','coordinator','teammate','coordinator','coordinator']}
export function assignClassicActors(scene,stages,key){
 const definitions=CLASSIC_ACTORS[key]
 if(!definitions)return {actors:scene.actors,stages}
 const actors=definitions.map(([id,name,englishName,responsibility])=>({id,name,role:name,englishName,responsibility}))
 return {actors,stages:stages.map((s,i)=>({...s,actorId:roles[key][i],allowedActorIds:actors.map(a=>a.id)}))}
}
export const AIRPORT_SCENE={id:'airport',title:'机场出行',location:'机场与航班客舱',role:'值机工作人员',userRole:'乘机旅客',userRoleEnglish:'Passenger',difficulty:1,
 task:'完成值机、行李与安检问询、登机口核对、登机就座和到达取行李；可练习延误或转机澄清。',
 goals:['确认登机与行李要求','听懂安检和登机安排','确认座位与到达后行李领取'],targets:CLASSIC_VOCABULARY.airport.slice(0,4),
 words:CLASSIC_VOCABULARY.airport.slice(0,4).map(t=>t.word),opening:'Welcome. Where are you flying today, and do you have a booking confirmation?',openingTranslation:'欢迎，请问你今天飞往哪里，有预订确认吗？'}
