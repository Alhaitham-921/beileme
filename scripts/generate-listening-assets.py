import argparse,hashlib,json,time
from pathlib import Path
import numpy as np,soundfile as sf,onnxruntime as ort
from kokoro_onnx import Kokoro
parser=argparse.ArgumentParser(description='Generate original two-voice listening assets with the existing local Kokoro model.')
parser.add_argument('--models',type=Path,required=True)
parser.add_argument('--verification',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1];target=root/'server/data/listening-audio'
out=args.verification;out.mkdir(parents=True,exist_ok=True);models=args.models
options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
session=ort.InferenceSession(str(models/'kokoro-v1.0.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
model=Kokoro.from_session(session,str(models/'voices-v1.0.bin'))
lessons=json.loads((root/'server/data/listeningLessonsLong.json').read_text(encoding='utf-8'))
manifest=json.loads((target/'manifest.json').read_text(encoding='utf-8'));manifest.update({'source':'平台原创情境脚本，本地 Kokoro ONNX 双声线合成，不含用户录音','voices':['af_heart','am_michael'],'baseRate':.84,'createdOn':'2026-11-26'})
checks=[]
for lesson in lessons:
 start=time.monotonic();samples=[];speakers={}
 for turn in lesson['turns']:
  speaker=speakers.setdefault(turn['speaker'],len(speakers));voice='af_heart' if speaker%2==0 else 'am_michael'
  audio,sr=model.create(turn['text'],voice=voice,speed=.84,lang='en-us')
  samples.extend([audio,np.zeros(int(sr*.35),dtype=np.float32)])
 audio=np.concatenate(samples);seconds=len(audio)/sr
 if not 120<=seconds<=180:raise RuntimeError(f'{lesson["id"]} duration {seconds:.2f} is outside 2-3 minutes; adjust script/rate and regenerate')
 filename=lesson['id']+'.mp3';sf.write(str(target/filename),audio,sr,format='MP3',subtype='MPEG_LAYER_III',bitrate_mode='CONSTANT',compression_level=.75)
 decoded,decoded_sr=sf.read(str(target/filename));measured=len(decoded)/decoded_sr
 assert abs(measured-seconds)<.2 and np.sqrt(np.mean(decoded**2))>.005
 data=(target/filename).read_bytes();record={'file':filename,'mimeType':'audio/mpeg','transcriptSha256':hashlib.sha256(lesson['transcript'].encode()).hexdigest(),'audioSha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'durationSeconds':round(measured,2),'voices':['af_heart','am_michael'],'baseRate':.84}
 manifest['lessons'][lesson['id']]=record
 (target/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 checks.append({'id':lesson['id'],**record,'generationSeconds':round(time.monotonic()-start,1)})
 (out/'verification.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(checks[-1]),flush=True)
