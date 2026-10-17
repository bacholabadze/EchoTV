"""Offline art check for runtime face/hair variants. Not browser QA.
Blender 4.5: --background --python tools/render-editorial-cast.py
"""
import bpy,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/echo-editorial-review');OUT.mkdir(exist_ok=True)
def linear(h):
 a=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return tuple(v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in a)+(1,)
def point(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for name,crop,jaw,nose,skin,hair,shirt in [('echo',.42,-.055,0,'f4e9e1','a8a49a','7c8b78'),('atlas',.17,.13,.002,'d7b7a1','45372c','334e46')]:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=str(ROOT/'dist/studio/lookdev/assets/nova-editorial.glb'))
 for o in list(bpy.context.scene.objects):
  if o.type!='MESH':continue
  if o.name.startswith('Nova.earring'):bpy.data.objects.remove(o,do_unlink=True);continue
  if o.name=='Human':
   for key in o.data.shape_keys.key_blocks:
    for v in key.data:
     x,y,z=v.co.x,v.co.z,-v.co.y;front=max(0,min(1,(z-.01)/.08));j=math.exp(-((y-1.57)/.035)**2)*front;n=math.exp(-(x/.021)**2-((y-1.625)/.024)**2)*front
     v.co.x=x*(1+jaw*j);v.co.y=-(z+nose*n)
  if o.name=='Nova.sculpted_bob':
   for v in o.data.vertices:
    taper=1-.10*max(0,min(1,(1.715-v.co.z)/.06));v.co.x*=taper;v.co.y=-.012+(v.co.y+.012)*taper
    if v.co.z<1.692:v.co.z=1.692+(v.co.z-1.692)*crop
  for m in o.data.materials:
   p=m.node_tree.nodes.get('Principled BSDF');color=skin if 'porcelain skin' in m.name else hair if 'chestnut hair' in m.name else shirt if 'ivory knit' in m.name else None
   if color:
    if 'porcelain skin' in m.name:
     links=list(p.inputs['Base Color'].links)
     if links:
      source=links[0].from_socket;m.node_tree.links.remove(links[0]);mul=m.node_tree.nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;mul.inputs[2].default_value=linear(color);m.node_tree.links.new(source,mul.inputs[1]);m.node_tree.links.new(mul.outputs[0],p.inputs['Base Color'])
    else:
     for l in list(p.inputs['Base Color'].links):m.node_tree.links.remove(l)
     p.inputs['Base Color'].default_value=linear(color)
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.resolution_x=560;scene.render.resolution_y=660;scene.render.resolution_percentage=100
 world=scene.world;world.use_nodes=True;bg=world.node_tree.nodes.get('Background');tex=world.node_tree.nodes.new('ShaderNodeTexEnvironment');tex.image=bpy.data.images.load(str(ROOT/'dist/studio/lookdev/assets/studio-small-06.hdr'));world.node_tree.links.new(tex.outputs['Color'],bg.inputs['Color']);bg.inputs['Strength'].default_value=.18
 for n,loc,energy,size,col in [('Key',(-1,-1.5,2.4),42,1.5,(1,.89,.73)),('Fill',(1,-1,1.8),8,1,(.78,.9,1)),('Rim',(1,.35,2.2),55,.8,(1,.86,.65))]:
  data=bpy.data.lights.new(n,'AREA');data.energy=energy;data.size=size;data.color=col;o=bpy.data.objects.new(n,data);scene.collection.objects.link(o);o.location=loc;point(o,(0,0,1.6))
 bpy.ops.object.camera_add(location=(.23,-1.05,1.65));camera=bpy.context.object;camera.data.lens=60;point(camera,(0,-.01,1.58));scene.camera=camera
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
