import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler,ok } from '../utils/http.js'
import { libraryOverview,listeningLesson,listeningAudio,checkListening,getReading,saveReading,readingNotice } from '../services/libraryService.js'
import {libraryPreferences,setLibraryPreferences,explainReadingPage,analyseReadingSelection,explainListeningAttempt} from '../services/libraryAssistanceService.js'

export function createLibraryRouter({authenticate=requireAuth,service={libraryOverview,listeningLesson,listeningAudio,checkListening,getReading,saveReading,readingNotice}}={}) {
  const router=Router();router.use(authenticate)
  const params=z.object({id:z.string().regex(/^[a-z][a-z-]{0,63}$/)})
  const range=z.object({startParagraph:z.number().int().min(0),startOffset:z.number().int().min(0),endParagraph:z.number().int().min(0),endOffset:z.number().int().min(0)})
  const readingBody=z.object({chapterId:z.string().regex(/^\d{1,3}$/),range})
  router.get('/preferences',asyncHandler(async(req,res)=>ok(res,await libraryPreferences(req.user.id))))
  router.put('/preferences',validate({body:z.object({showChinese:z.boolean()})}),asyncHandler(async(req,res)=>ok(res,await setLibraryPreferences(req.user.id,req.valid.body.showChinese))))
  router.post('/books/:id/explain-page',validate({params,body:readingBody}),asyncHandler(async(req,res)=>ok(res,await explainReadingPage(req.user.id,req.valid.params.id,req.valid.body))))
  router.post('/books/:id/analyse-selection',validate({params,body:readingBody.extend({text:z.string().trim().min(2).max(2400)})}),asyncHandler(async(req,res)=>ok(res,await analyseReadingSelection(req.user.id,req.valid.params.id,req.valid.body))))
  router.post('/listening/:id/attempts/:attemptId/explain',validate({params:params.extend({attemptId:z.coerce.number().int().positive()})}),asyncHandler(async(req,res)=>ok(res,await explainListeningAttempt(req.user.id,req.valid.params.id,req.valid.params.attemptId))))
  router.get('/',asyncHandler(async(req,res)=>ok(res,await service.libraryOverview(req.user.id))))
  router.get('/listening/:id',validate({params}),asyncHandler(async(req,res)=>ok(res,await service.listeningLesson(req.valid.params.id))))
  router.get('/listening/:id/audio',validate({params}),asyncHandler(async(req,res)=>{
    res.set('Cache-Control','private, max-age=3600').vary('Authorization').type('audio/wav').send(await service.listeningAudio(req.valid.params.id))
  }))
  router.post('/listening/:id',validate({params,body:z.object({answers:z.array(z.number().int().min(0).max(7)).min(1).max(10),transcriptShown:z.boolean()})}),
    asyncHandler(async(req,res)=>ok(res,await service.checkListening(req.user.id,req.valid.params.id,req.valid.body))))
  router.get('/books/:id',validate({params,query:z.object({chapter:z.string().regex(/^\d{1,3}$/).optional()})}),
    asyncHandler(async(req,res)=>ok(res,await service.getReading(req.user.id,req.valid.params.id,req.valid.query.chapter))))
  router.get('/books/:id/notice',validate({params}),asyncHandler(async(req,res)=>{
    ok(res,{notice:await service.readingNotice(req.valid.params.id)})
  }))
  router.put('/books/:id/progress',validate({params,body:z.object({chapterId:z.string().regex(/^\d{1,3}$/),paragraph:z.number().int().min(0).max(100000),offset:z.number().int().min(0).max(100000).optional()})}),
    asyncHandler(async(req,res)=>ok(res,await service.saveReading(req.user.id,req.valid.params.id,req.valid.body))))
  return router
}
export default createLibraryRouter()
