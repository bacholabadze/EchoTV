"""Validate browser evidence, extract frames and mux existing dialogue at measured playback offsets."""
from pathlib import Path
import base64, hashlib, json, re, shutil, subprocess, sys
root=Path(__file__).resolve().parents[2]
d=json.loads(Path(sys.argv[1]).read_text())
assert d['baseline']=='9ca8eceb28ba32c6f10207c469f62757d78d0f4b'
assert not d['failures'],d['failures']
assert len(d['captures'])==7 and len(d['benchmarks'])==4
assert {e['turn'] for e in d['audioEvents']}=={'01','02','03','07'},d['audioEvents']
for file,sha in d['sourceSha256'].items():
 path=(root/file).resolve();assert path.is_relative_to(root)
 assert hashlib.sha256(path.read_bytes()).hexdigest()==sha,f'Stale evidence: {file}'
out=root/'docs/performance-wave2/evidence';out.mkdir(parents=True,exist_ok=True)
for c in d['captures']:
 assert re.fullmatch('[a-z-]+',c['label'])
 prefix,png=c.pop('png').split(',',1);assert prefix=='data:image/png;base64'
 data=base64.b64decode(png,validate=True);assert data[:8]==b'\x89PNG\r\n\x1a\n'
 c['file']=c['label']+'.png';c['sha256']=hashlib.sha256(data).hexdigest();(out/c['file']).write_bytes(data)
video=Path(sys.argv[2]);assert video.stat().st_size==d['recording']['bytes'],'Video must match this recording'
shutil.copyfile(video,out/'browser-capture.webm')
turns={t['id']:t for t in json.loads((root/'dist/studio/dialogue.json').read_text())}
inputs=['-i',str(video)];filters=[]
# Canvas capture starts at its first produced frame, not recorder.start().
# This recording's first frame contains turn 01's opening caption.
origin=d['audioEvents'][0]['wallOffsetMs']
d['recording']['mediaOriginMs']=origin
for i,event in enumerate(d['audioEvents'],1):
 t=turns[event['turn']];inputs+=['-i',str(root/'dist/studio'/t['audio'])]
 offset=max(0,round(event['wallOffsetMs']-origin))
 following=next((e for e in d['audioEvents'][i:] if e['turn']==event['turn']),None)
 end=following['mediaTime'] if following else t['duration']
 filters.append(f"[{i}:a]atrim={event['mediaTime']:.6f}:{end:.6f},asetpts=PTS-STARTPTS,adelay={offset}:all=1[a{i}]")
filters.append(''.join(f'[a{i}]' for i in range(1,len(d['audioEvents'])+1))+f"amix=inputs={len(d['audioEvents'])}:normalize=0,apad[mix]")
command=['ffmpeg','-y','-v','warning',*inputs,'-filter_complex',';'.join(filters),'-map','0:v:0','-map','[mix]','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',str(out/'preview.mp4')]
subprocess.run(command,check=True)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-count_frames','-of','json',str(out/'preview.mp4')]))
(out/'video-metadata.json').write_text(json.dumps(probe,indent=2)+'\n')
subprocess.run(['ffmpeg','-v','error','-i',str(out/'preview.mp4'),'-f','null','-'],check=True)
d['recording']['sha256']=hashlib.sha256((out/'browser-capture.webm').read_bytes()).hexdigest()
d['recording']['mp4Sha256']=hashlib.sha256((out/'preview.mp4').read_bytes()).hexdigest()
d['recording']['mux']='Original unchanged MP3s aligned to observed media playing/resume events relative to first rendered playback frame; approximate frame alignment, not captured system audio.'
(out/'measurements.json').write_text(json.dumps(d,indent=2)+'\n')
print(json.dumps({'recording':d['recording'],'benchmarks':d['benchmarks'],'audioEvents':d['audioEvents']},indent=2))
