import { COMPLETE_SCENE_CONTENT } from './completeScenarioContent.js'
import {airportWorkflow,enhanceWorkflow} from './classicWorkflowPresentation.js'
// Authored learning content, shared by the preview and the server state machine.
// A route is a complete way of handling a situation, not a mandatory sentence script.
const step = (id,title,actorId,opening,goals,expressions,question,choices,correctIndex=0) => {
  const offset=[...id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%choices.length
  return {id,title,actorId,opening,goals,expressions,
    listening:{question,choices:[...choices.slice(offset),...choices.slice(0,offset)],correctIndex:(correctIndex-offset+choices.length)%choices.length}}
}
const person=(id,name,englishName,responsibility)=>({id,name,englishName,role:name,responsibility})
const hotelActors=[person('reservations','预订专员','Reservations','处理模拟预约、日期、房型与价格；不索取真实身份或付款资料'),
  person('frontdesk','酒店前台','Front Desk','核对预订、虚构证件、早餐与房卡；不代替客人做决定'),
  person('housekeeping','客房服务','Housekeeping','核对房间设施并处理缺失用品'),
  person('breakfast','早餐接待员','Breakfast Host','核对早餐资格、座位和饮食需求'),
  person('manager','值班经理','Manager','处理合理的账单异议和例外协商')]

export const WORKFLOW_ROUTES = {
  hotel:[{id:'online',label:'线上预约后入住'},{id:'phone',label:'电话预约后入住'},{id:'walkin',label:'到店询房入住'},{id:'online-room-only',label:'线上预约 · 早餐另购'}],
  cafe:[{id:'counter',label:'柜台点单 · 堂食'},{id:'takeaway',label:'柜台点单 · 外带'},{id:'table',label:'桌边点单 · 堂食'}],
  restaurant:[{id:'dine-in',label:'堂食 · 预约与到店'},{id:'takeaway',label:'外带 · 到店点餐'}],
  directions:[{id:'walk',label:'步行问路'},{id:'transit',label:'公共交通与步行接驳'}],
  bank:[{id:'standard',label:'所选义项完整流程'}],
  airport:[{id:'standard',label:'值机、登机与到达'}],
  interview:[{id:'project',label:'项目与技术讨论'},{id:'teamwork',label:'协作与问题处理'}],
  shopping:[{id:'purchase',label:'购买后售后'},{id:'exchange',label:'携收据退换商品'}],
  campus:[{id:'planning',label:'项目规划与交付'},{id:'delay',label:'进度延误与协商'}],
  library:[{id:'borrow',label:'查找、借阅、续借与归还'}],
}

function hotel(route,transfer) {
  const night=transfer?'Saturday':'Friday', checkout=transfer?'Monday':'Sunday', price=transfer?'95':'80'
  const breakfastIncluded=route!=='online-room-only'
  const first=route==='phone'?'Thank you for calling. Which dates would you like to book?':route==='walkin'?'Welcome. We have rooms available tonight. How many nights will you stay?':`Welcome to our online booking chat. A standard room is ${price} pounds per night. Which dates would you like?`
  const stages=[
    step('booking','预约酒店与房型','reservations',first,
      ['说明入住日期、离店日期和人数','确认房型、每晚价格及取消条件'],
      [`I would like a standard room from ${night} to ${checkout}, please.`,`Could you check the price for two nights?`,`Before I book, could you explain the cancellation policy?`],
      '预订专员现在要你提供什么？',['入住日期和住宿需求','真实银行卡号','早餐桌号']),
    step('confirmation','核对预订确认','reservations',`Your two-night booking starts on ${night}. Please check the dates and room type before confirming.`,
      ['复述并确认入住和离店日期','询问并确认预订凭证或确认方式'],
      [`Please confirm my stay from ${night} to ${checkout}.`,`Could you send me a booking confirmation?`,`I would like to check the dates before confirming.`],
      '确认预订前应核对什么？',['日期和房型','朋友的护照号','房间里的毛巾']),
    step('arrival','到店办理入住与证件','frontdesk','Welcome. Do you have a reservation? I will need to see an ID to check you in. Please use fictional details for this practice.',
      ['说明已有预订或到店住宿需求','用英文说明出示证件并配合姓名核对，不提供真实证件号码'],
      ['I have a reservation under the name Alex Lee.','Here is my ID for the check-in.','Could you check my booking under Alex Lee?'],
      '前台办理入住需要核对什么？',['预订和证件','点咖啡的方法','退房发票']),
    step('breakfast-info','询问早餐与时间','frontdesk',`${breakfastIncluded?'Breakfast is included.':'Breakfast is not included. It costs ten pounds per person.'} It is served from seven to ten in the restaurant on the ground floor.`,
      ['确认早餐是否包含在房费中','确认早餐时间和地点'],
      ['Is breakfast included in the room rate?','What time is breakfast served?','Could you tell me where the breakfast room is?'],
      '早餐供应到几点？',['十点','七点','十一点']),
    step('key','领取房卡与去房间','frontdesk','Here are two key cards for room 203. Take the lift to the second floor. Check-out is at eleven.',
      ['确认房号、房卡使用方式和去房间的路线','确认退房时间'],
      ['Could you show me how to use the key card?','Which floor is room 203 on?','Did you say check-out is at eleven?'],
      '退房时间是几点？',['十一点','两点','十点']),
    step('room-check','检查房间物品与设施','housekeeping','Hello, this is housekeeping. Is everything in your room working, and do you have enough towels?',
      ['说明对毛巾、热水或房间设施的检查结果','提出具体缺失物品或设施问题'],
      ['The hot water is working, but a towel is missing.','I would like to check whether the hairdryer is included.','There are only two towels. Could I have one more?'],
      '客房服务正在确认什么？',['设施和用品是否齐全','订机票的信息','是否已退房']),
    step('room-request','联系客房服务并确认处理','housekeeping','We can bring an extra towel in ten minutes. Will someone be in the room?',
      ['礼貌提出补充用品或维修请求','确认送达时间和接收安排'],
      ['Could you bring an extra towel to room 203, please?','I will be in the room for the next ten minutes.','Could you let me know when someone will arrive?'],
      '额外毛巾大约多久送来？',['十分钟','一小时','明天']),
    step('breakfast','早餐使用或另购确认','breakfast',breakfastIncluded?'Good morning. May I have your room number? The buffet is on your left. Do you have any dietary requirements?':'Good morning. Breakfast costs ten pounds per person. Would you like to buy breakfast, or will you make other arrangements?',
      breakfastIncluded?['说明房号并确认早餐资格','表达座位、饮品或饮食需求']:['说明购买早餐或不使用早餐的决定','购买时确认价格或饮食需求；不使用时礼貌确认其他安排'],
      ['I am staying in room 203. Is breakfast included?','Could I have a table by the window?','I do not eat nuts. Could you tell me which dishes are suitable?'],
      breakfastIncluded?'早餐接待员询问哪类需求？':'另购早餐每人多少钱？',breakfastIncluded?['饮食要求','入住日期','维修价格']:['十英镑','八十英镑','免费']),
    step('checkout','办理退房与核对账单','frontdesk',`Good morning. Are you ready to check out? Please check the bill for your two nights at ${price} pounds per night.`,
      ['说明退房并核对房费或额外消费','对不明收费提问，或明确确认账单'],
      ['I would like to check out, please.','Could you explain this charge on my bill?','The room rate looks correct. Thank you.'],
      '前台请你核对什么？',['住宿账单','早餐菜单','房间楼层']),
    step('receipt','归还房卡与离店确认','frontdesk','Thank you. Please return both key cards. Would you like a receipt, and do you need help storing your luggage?',
      ['确认归还房卡并索取或确认收据','确认行李或离店安排并礼貌结束'],
      ['Here are both key cards. Could I have a receipt?','Could you store my luggage until this afternoon?','That is everything. Thank you for your help.'],
      '离店前需要归还什么？',['两张房卡','早餐菜单','预订邮件']),
  ]
  if(!breakfastIncluded)stages.find(s=>s.id==='breakfast').expressions=['I would like to buy breakfast, please.','No breakfast for me today, thank you.','Could you confirm the price and the available options?']
  return {id:'hotel-stay',title:'酒店住宿完整流程',route,actors:hotelActors,stages,
    sharedFacts:[`本练习入住日${night}，离店日${checkout}，一位住客两晚标准房，每晚${price}英镑`,
      `早餐${breakfastIncluded?'包含在房费中':'另购，每人10英镑'}，7点到10点在一楼餐厅；退房11点`,
      '房号203，两张房卡；客房可补送毛巾，预计十分钟；这不是已完成的用户请求',
      '仅模拟沟通，证件和付款使用虚构占位，不索取真实证件号、卡号或真实预订'],
    variation:transfer?'changed-dates-price':'standard'}
}

function cafe(route,transfer) {
  const drink=transfer?'tea':'coffee', price=transfer?'four':'three', actorId=route==='table'?'waiter':'barista'
  const actors=[person(actorId,route==='table'?'咖啡店服务员':'咖啡师',route==='table'?'Waiter':'Barista','核对点单、饮品规格、价格、取餐和订单问题')]
  return {id:'cafe-order',title:'咖啡店完整点单',route,actors,variation:transfer?'changed-drink-price':'standard',
    sharedFacts:[`一杯中杯${drink}售价${price}英镑，可选择不加糖和燕麦奶；不要预先替用户选择`,`本路线为${WORKFLOW_ROUTES.cafe.find(x=>x.id===route).label}`],stages:[
      step('arrival','入店与堂食外带',''+actorId,'Hello. Would you like to eat in or take your order away?', ['说明堂食或外带','说明需要点单或查看菜单'],
        [route==='takeaway'?'To take away, please.':'For here, please.','Could I see the drinks menu?','May I order at this table?'], '服务员先询问什么？',['堂食还是外带','护照号码','退房时间']),
      step('menu','询问菜单与推荐',actorId,`Our medium ${drink} is ${price} pounds. Would you like to know about the milk options?`, ['询问饮品或规格','确认价格或推荐'],
        [`How much is a medium ${drink}?`,'What would you recommend?','Do you have any non-dairy milk?'],'中杯饮品多少钱？',[`${price}英镑`,'十英镑','免费']),
      step('order','选择饮品与表达方式',actorId,'What can I get for you today?', ['明确饮品和杯型','表达数量及礼貌请求'],
        [`A medium ${drink}, please.`,`Could I have one medium ${drink}?`,`I would like to order a medium ${drink}, please.`],'现在应向对方说明什么？',['饮品和杯型','酒店房号','银行卡密码']),
      step('customize','调整口味与需求',actorId,'Would you like sugar, and which type of milk would you prefer?', ['说明糖量或温度','说明奶类、过敏或其他需求'],
        ['No sugar, please.','Could you make it with oat milk?','I cannot have dairy. Which option is suitable?'],'对方在问哪些选择？',['糖和奶','日期和人数','房卡和证件']),
      step('confirm','复述订单与付款',actorId,`That is one medium drink for ${price} pounds. Is your order correct?`, ['复述并确认订单或纠正错误','询问付款方式或收据'],
        ['Yes, that is correct. Can I pay by card?','Sorry, I asked for oat milk.','Could I have a receipt, please?'],'付款前应先确认什么？',['订单和价格','下次入住日期','朋友的联系方式']),
      step('collect','取餐与检查订单',actorId,route==='table'?'I will bring your order to the table in five minutes.':'Please collect your order at the counter in five minutes.', ['确认取餐地点或送餐安排','核对到手饮品是否符合要求'],
        ['Where should I collect my order?','Is this the drink with oat milk?','Thank you. Could you check the cup size?'],'饮品大约多久准备好？',['五分钟','五小时','明天']),
      step('resolve','处理不符与结束交流',actorId,'If anything is wrong with the order, please let me know. Is everything as you requested?', ['明确说明订单符合要求或提出具体问题','协商更换并确认结果，礼貌结束'],
        ['Everything is correct. Thank you.','Excuse me, I ordered this without sugar.','Could you replace it with the drink I ordered?'],'发现饮品不符应怎样做？',['说明问题并请求处理','必须接受错误订单','再次提供证件']),
    ]}
}

const paths={
  library:[['search','说明找书需求','明确书籍或主题'],['locate','查找馆藏','核对可借状态和位置'],['card','借阅条件与登记','询问借阅条件'],['loan','借期与续借规则','确认期限和续借条件'],['renew','处理续借与到期问题','提出问题并协商安排'],['return','归还与确认','确认归还方式和结果']],
  restaurant:[['arrival','入店与座位','说明人数和用餐需求'],['menu','阅读菜单与询问','询问配料、价格或推荐'],['order','点餐与饮食要求','说明菜品、数量和饮食限制'],['confirm','确认订单与等候','核对订单和等候时间'],['problem','用餐中处理问题','提出遗漏或合理调整请求'],['payment','结账与离店','核对账单、付款并结束交流']],
  directions:[['destination','说明目的地','说明要去的地点和出行方式'],['route','询问路线','询问道路、转弯和交通方式'],['details','确认距离与时间','核对距离、时间或换乘'],['clarify','澄清没听懂的信息','请求重复、拼写或更慢说明'],['check','复述并确认','用自己的话确认路线'],['arrival','到达前最后核对','核对入口或地标并致谢']],
  finance:[['need','说明业务需求','说明需要了解的账户或服务'],['requirements','询问办理条件','询问材料和资格，使用虚构信息'],['compare','比较方案与费用','确认费用、限制和可选方案'],['clarify','澄清不明条款','请求解释并核对自己的理解'],['confirm','确认办理安排','确认下一步和所需材料'],['followup','确认后续联系','询问处理时间和后续查询方式']],
  river:[['greet','介绍与问候','礼貌说明来意'],['route','询问步道与景点','表达散步兴趣并询问路线'],['conditions','确认环境与时间','询问路况和所需时间'],['preference','表达偏好与协商','说明自己的偏好和限制'],['confirm','确认出行安排','复述路线和时间安排'],['close','结束与致谢','确认是否还需注意事项并道别']],
  interview:[['opening','自我介绍','介绍相关学习和项目背景'],['experience','描述项目经历','说明任务、做法和自己的贡献'],['problem','解释问题与处理','描述一次问题及解决依据'],['requirements','了解岗位要求','询问工作职责和协作方式'],['questions','提问与澄清','提出具体问题并核对理解'],['next','确认下一步','确认后续安排并礼貌结束']],
  shopping:[['need','说明购物需求','说明物品、用途和预算'],['compare','比较商品','询问规格、价格和区别'],['try','试用与确认适合度','说明尺寸或使用需求'],['policy','询问退换条件','核对保修、收据和退换规则'],['payment','付款与收据','确认商品价格并索取收据'],['after','售后问题模拟','说明不符问题并协商处理']],
  campus:[['idea','说明项目目标','介绍想法与成果要求'],['tasks','协商分工','讨论任务和个人职责'],['time','安排进度','确认截止时间和讨论时间'],['issue','处理协作问题','说明阻碍并提出调整'],['check','核对进度与交付','确认完成标准和检查安排'],['next','总结下一步','复述分工、时间和后续联系']],
}

function rawWorkflowFor(scene,{route,transfer=false}={}) {
  if (scene.memoryImage || scene.challenge==='change_dates') return null
  const family=scene.sourceSceneId||scene.id
  if(family==='airport')return airportWorkflow(route,transfer)
  if(family==='hotel')return hotel(WORKFLOW_ROUTES.hotel.some(x=>x.id===route)?route:'online',transfer)
  if(family==='cafe')return cafe(WORKFLOW_ROUTES.cafe.some(x=>x.id===route)?route:'counter',transfer)
  if(scene.workflowPlan?.stages?.length)return structuredClone(scene.workflowPlan)
  if(scene.workflow?.stages?.length)return structuredClone(scene.workflow)
  const key=family==='bank'?scene.variant||'river':family
  const stages=paths[key]
  if(!stages || !COMPLETE_SCENE_CONTENT[key])return null
  const actorId=scene.actors?.[0]?.id||'partner'
  const chosenRoute=WORKFLOW_ROUTES[family]?.find(item=>item.id===route)||WORKFLOW_ROUTES[family]?.[0]||{id:'standard',label:'完整流程'}
  let details=structuredClone(COMPLETE_SCENE_CONTENT[key])
  if(transfer){
    const replacements={library:[['three weeks','two weeks'],['三周','两周']],restaurant:[['fifteen','twenty'],['十五分钟','二十分钟']],directions:[['twenty minutes','twenty-five minutes'],['二十分钟','二十五分钟']],finance:[['five pounds','eight pounds'],['五英镑','八英镑']],river:[['thirty minutes','forty-five minutes']],interview:[['next week','in two weeks'],['下周技术讨论','两周后技术讨论']],shopping:[['fourteen','twenty-one'],['forty pounds','forty-five pounds']],campus:[['Friday','Thursday'],['星期五','星期四']]}
    let encoded=JSON.stringify(details)
    for(const [before,after] of replacements[key]||[])encoded=encoded.replaceAll(before,after)
    details=JSON.parse(encoded)
  }
  if(key==='restaurant'&&chosenRoute.id==='takeaway'){details[0].opening='Hello. Would you like to order food to take away? Please tell me how many meals you need.';details[0].question='这条路线是在店内用餐还是外带？';details[0].choices=['外带','堂食','没有点餐'];details[0].expressions=['I would like two meals to take away.','Could I see the takeaway menu?','How long will the order take?']}
  if(key==='shopping'&&chosenRoute.id==='exchange'){details[0].opening='Welcome back. Did you bring the item and the receipt? What would you like to exchange?';details[0].question='退换商品先要说明什么？';details[0].choices=['商品、收据和退换需求','真实银行卡密码','酒店早餐时间'];details[0].expressions=['I would like to exchange this jacket.','I bought it yesterday and have the receipt.','Could I try a different size?']}
  if(key==='shopping'&&chosenRoute.id==='exchange'){
    Object.assign(details[4],{opening:'The replacement costs ten pounds more. Would you like to pay the difference or choose another item?',goal:'确认差价、选择和新的收据',expressions:['Could you confirm the price difference?','I would like to pay the difference.','Could I have an updated receipt?'],question:'更换商品的差价是多少？',choices:['十英镑','四十英镑','免费']})
    Object.assign(details[5],{opening:'Here is your replacement and the updated receipt. Please check the item before you leave.',goal:'核对替换商品和处理结果并致谢',expressions:['This is the correct size. Thank you.','Could you confirm that the exchange is complete?','I have the updated receipt. Thank you for your help.'],question:'离店前应检查什么？',choices:['替换商品和新收据','早餐和房卡','别人的账户']})
  }
  if(key==='campus'&&chosenRoute.id==='delay'){details[0].opening='Our project is behind schedule. Could we agree on the main goal and what needs to change?';details[0].question='这条项目路线有什么问题？';details[0].choices=['进度落后','项目已经全部完成','没有合作任务']}
  if(key==='directions'&&chosenRoute.id==='transit'){details[0].opening='Are you going to the museum by bus? The number eight stops near the park. Where are you starting from?';details[0].question='对方介绍哪种交通方式？';details[0].choices=['公交车','飞机','轮船']}
  if(key==='interview'&&chosenRoute.id==='teamwork'){details[0].opening='Welcome. Could you introduce yourself and describe your experience working with a project team?';details[0].question='这条面试路线重点是什么？';details[0].choices=['项目团队协作','办理银行服务','咖啡店点单']}
  return {id:key+'-complete',title:(scene.title||'情境')+'完整流程',actors:scene.actors,
    variation:transfer?'changed-constraints':'standard',route:chosenRoute.id,sharedFacts:[...(scene.sharedFacts||[]),`当前路线：${chosenRoute.label}；${transfer?'条件已变更，以当前阶段开场为准':'使用本次阶段给出的条件'}；不替用户作决定`],stages:stages.map(([id,title,goal],index)=>{
      const item=details[index]
      const primaryGoal=index===0&&key==='shopping'&&chosenRoute.id==='exchange'?'说明已购商品、收据和退换诉求':index===0&&key==='restaurant'&&chosenRoute.id==='takeaway'?'说明外带需求和餐份数量':goal
      return step(id,title,actorId,item.opening,[primaryGoal,item.goal],item.expressions,item.question,item.choices,item.correctIndex)
    })}
}

export const CAFE_SCENE={id:'cafe',title:'咖啡店点单',location:'咖啡店',role:'咖啡师',userRole:'点单顾客',difficulty:1,
  task:'从进店、看菜单、点单与口味调整，到确认付款、取餐和处理不符，完成一次咖啡店交流。',
  goals:['明确饮品和规格','确认口味、价格和取餐','处理不符或确认订单'],
  targets:[{word:'medium',sense:'中杯的；中等的',phrase:'a medium coffee',example:'Could I have a medium coffee?'},
    {word:'sugar',sense:'糖',phrase:'without sugar',example:'I would like it without sugar.'},
    {word:'receipt',sense:'收据',phrase:'a receipt',example:'Could I have a receipt, please?'}],
  words:['medium','sugar','receipt'],opening:'Hello. Would you like your order for here or to take away?',openingTranslation:'你好，请问堂食还是外带？'}

export const LIBRARY_SCENE={id:'library',title:'图书馆借阅与归还',location:'图书馆',role:'图书管理员',userRole:'借阅者',difficulty:1,
  task:'从查找书籍、询问借阅条件，到确认借期、续借与归还，完成一次图书馆交流。',goals:['找到合适书籍','确认借阅与续借条件','归还并确认结果'],
  targets:[{word:'borrow',sense:'借入',phrase:'borrow a book',example:'Could I borrow this book?'},{word:'renew',sense:'续借',phrase:'renew a book',example:'Can I renew this book?'},{word:'return',sense:'归还',phrase:'return the book',example:'I would like to return the book.'}],
  words:['borrow','renew','return'],opening:'Welcome to the library. How can I help you?',openingTranslation:'欢迎来到图书馆，有什么可以帮助你？'}

export function workflowFor(scene,options={}) {return enhanceWorkflow(scene,rawWorkflowFor(scene,options),options)}

export function workflowActorIds(session) {
  const stage=session.scene.workflow?.stages[session.journey?.flow?.index]
  if(!stage)return session.scene.actors.map(a=>a.id)
  if(stage.allowedActorIds?.length)return stage.allowedActorIds
  if(session.scene.workflow.id==='hotel-stay') {
    const extra={arrival:['manager'],confirmation:['frontdesk'],'room-check':['frontdesk'],'room-request':['frontdesk'],checkout:['manager']}
    return [stage.actorId,...(extra[stage.id]||[])]
  }
  return [stage.actorId]
}
