export function mergeSignals(signals){
 const values=signals.filter(Boolean)
 if(!values.length)return undefined
 if(values.length===1)return values[0]
 if(AbortSignal.any)return AbortSignal.any(values)
 const controller=new AbortController()
 for(const signal of values){if(signal.aborted){controller.abort(signal.reason);break}signal.addEventListener('abort',()=>controller.abort(signal.reason),{once:true})}
 return controller.signal
}
export function uploadRequest(url,{headers,body,signal,onUploadComplete}){
 if(typeof XMLHttpRequest==='undefined')return fetch(url,{method:'POST',headers,body,signal})
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest()
  const abort=()=>xhr.abort()
  const cleanup=()=>signal?.removeEventListener('abort',abort)
  xhr.open('POST',url)
  for(const [key,value] of Object.entries(headers))xhr.setRequestHeader(key,value)
  xhr.upload.onload=()=>onUploadComplete?.()
  xhr.onload=()=>{cleanup();resolve(new Response(xhr.responseText,{status:xhr.status,headers:{'Content-Type':'application/json'}}))}
  xhr.onerror=()=>{cleanup();reject(new TypeError('Network request failed'))}
  xhr.onabort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'))}
  if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return}
  signal?.addEventListener('abort',abort,{once:true})
  xhr.send(body)
 })
}
