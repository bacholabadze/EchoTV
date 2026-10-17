"""Render exported, posed Three scene geometry in Blender for composition review.
Not a browser screenshot. No WebGL shader or performance validation.
"""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path('/tmp/echo-scene-review')
def xyz(p):return (p[0],-p[2],p[1])
def point(o,p):o.rotation_euler=(Vector(xyz(p))-o.location).to_track_quat('-Z','Y').to_euler()
shots=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['wide','echo','nova','atlas','two']
for shot in shots:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 d=json.loads((ROOT/(shot+'.json')).read_text());cache={}
 for m in d['meshes']:
  mesh=bpy.data.meshes.new(m['name']);idx=m['indices'];mesh.from_pydata([xyz(p) for p in m['points']],[],[idx[i:i+3] for i in range(0,len(idx),3)]);mesh.update();o=bpy.data.objects.new(m['name'],mesh);bpy.context.collection.objects.link(o)
  for p in mesh.polygons:p.use_smooth=True
  if m['uv']:
   uv=mesh.uv_layers.new();a=m['uv']
   for loop in mesh.loops:uv.data[loop.index].uv=(a[loop.vertex_index*2],1-a[loop.vertex_index*2+1])
  key=str((m['color'],m['map'],m['roughness']))
  if key not in cache:
   mat=bpy.data.materials.new(key);mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*m['color'],1);p.inputs['Roughness'].default_value=m['roughness'];p.inputs['Metallic'].default_value=m['metalness']
   if m['map']:
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(m['map'],check_existing=True);mul=mat.node_tree.nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;mul.inputs[2].default_value=(*m['color'],1);mat.node_tree.links.new(tex.outputs['Color'],mul.inputs[1]);mat.node_tree.links.new(mul.outputs[0],p.inputs['Base Color'])
   cache[key]=mat
  mesh.materials.append(cache[key])
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.resolution_y=600;scene.render.resolution_x=int(600*d['aspect']);scene.render.resolution_percentage=100
 scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.16,.22,.17,1);bg.inputs['Strength'].default_value=.4
 for n,power,pos,col in [('Key',100,[-2.5,3,2.4],(1,.85,.65)),('Fill',45,[2,1.8,2],(.8,1,.85)),('Rim',100,[1,2.8,-1.3],(.9,1,.72))]:
  data=bpy.data.lights.new(n,'AREA');data.energy=power;data.size=2;o=bpy.data.objects.new(n,data);scene.collection.objects.link(o);o.location=xyz(pos);point(o,[0,1,.1])
 c=d['camera'];bpy.ops.object.camera_add(location=xyz(c[:3]));cam=bpy.context.object;point(cam,c[3:6]);cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=24;cam.data.lens=24/(2*math.tan(math.radians(c[6])/2));scene.camera=cam
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/(shot+'.png'));bpy.ops.render.render(write_still=True)
