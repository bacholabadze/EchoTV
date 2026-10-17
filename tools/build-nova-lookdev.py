"""Run with Blender 4.5 LTS --background --python. Source model CC0 MPFB.
Authors a self-contained Nova look-development GLB with all existing face shapes.
No third-party scripts are executed by the model.
"""
import bpy, math, os, json
from mathutils import Vector
from pathlib import Path
ROOT=Path('/workspace/sites/echo-stage')
OUT=ROOT/'dist/studio/lookdev/assets'; OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'dist/lab/assets/nova.glb'))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
for o in list(bpy.context.scene.objects):
 if o.type=='MESH' and (not o.name.startswith('Human') or any(x in o.name for x in ['high-poly','ponytail','eyebrow','eyelash'])):bpy.data.objects.remove(o,do_unlink=True)
def material(name,color,rough=.6,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
def xyz(x,y,z):return (x,-z,y)
def bind(o,bone='Head'):
 g=o.vertex_groups.new(name=bone);g.add(list(range(len(o.data.vertices))),1,'REPLACE');mod=o.modifiers.new('ECHO rig','ARMATURE');mod.object=arm;o.parent=arm
 for p in o.data.polygons:p.use_smooth=True
 return o
def geo(name,verts,faces,mat,bone='Head'):
 m=bpy.data.meshes.new(name);m.from_pydata([xyz(*v) for v in verts],[],faces);m.update();o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);o.data.materials.append(mat);return bind(o,bone)
def curve(name,points,radius,mat,bone='Head'):
 bpy.ops.object.select_all(action='DESELECT')
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=12;c.bevel_depth=radius;c.bevel_resolution=3;s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for p,v in zip(s.bezier_points,points):p.co=xyz(*v);p.handle_left_type=p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(mat);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);return bind(o,bone)
def sphere(name,location,scale,mat,bone='Head'):
 bpy.ops.object.select_all(action='DESELECT')
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=xyz(*location));o=bpy.context.object;o.name=name;o.scale=(scale[0],scale[2],scale[1]);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.data.materials.append(mat);return bind(o,bone)
# Subtle authored silhouette change applied consistently to Basis and every facial shape.
# Preserve eye centers and mouth landmarks, widen cheek plane and soften lower jaw.
body=bpy.data.objects['Human']
def sculpt(co):
 x,z,y=co.x,-co.y,co.z
 front=max(0,min(1,(z-.01)/.08))
 cheek=math.exp(-((y-1.625)/.033)**2)*front
 jaw=math.exp(-((y-1.565)/.035)**2)*front
 nx=x*(1+.12*cheek-.10*jaw)
 nose=math.exp(-(x/.021)**2-((y-1.625)/.024)**2)*front
 nz=z-.0035*nose
 return Vector((nx,-nz,y))
for key in body.data.shape_keys.key_blocks:
 for v in key.data:v.co=sculpt(v.co)
# Correct the inherited partial blink so both lids meet around the integrated eye.
basis=body.data.shape_keys.key_blocks['Basis']
for name in ['eyeBlinkLeft','eyeBlinkRight']:
 key=body.data.shape_keys.key_blocks[name]
 for i,v in enumerate(key.data):v.co=basis.data[i].co+(v.co-basis.data[i].co)*1.95
# Preserve facial UV colors, soften photographic microtexture in a deterministic offline pass.
for m in body.data.materials:
 if not m:continue
 m.name='Nova / warm porcelain skin';p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.72
 for n in m.node_tree.nodes:
  if n.type=='TEX_IMAGE' and n.image and 'diffuse' in n.image.name:
   import numpy as np
   image=n.image;w,h=image.size;a=np.array(image.pixels[:],dtype=np.float32).reshape(h,w,4);rgb=a[:,:,:3];soft=rgb.copy()
   for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:soft+=np.roll(np.roll(rgb,dy,axis=0),dx,axis=1)
   soft/=5;lum=soft.mean(axis=2,keepdims=True);a[:,:,:3]=np.clip((soft*.88+lum*.12)*[1.018,.99,.97],0,1);image.pixels[:]=a.ravel();image.pack()
shirt=bpy.data.objects['Human.female_casualsuit01']
for m in shirt.data.materials:
 m.name='Nova / ivory knit';p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.94
 for link in list(m.node_tree.links):
  if link.to_socket==p.inputs['Base Color']:m.node_tree.links.remove(link)
 p.inputs['Base Color'].default_value=(.48,.46,.37,1)
# Sculpted dark-chestnut bob: closed volume, side part, tapered sides and restrained grooves.
hair=material('Nova / chestnut hair',(.025,.012,.008),.72)
hairLight=material('Nova / hair ridges',(.039,.019,.012),.80)
verts=[];faces=[];rows=32;cols=96
for i in range(rows+1):
 t=i/rows
 for j in range(cols):
  phi=j/cols*math.tau;front=max(0,math.cos(phi));limit=2.50-1.36*front**4+.14*math.sin(phi)*front**3
  theta=.012+t*limit
  # Sweep the fringe slightly to the character's right.
  groove=1+.014*math.sin(phi*73+t*3)+.007*math.sin(phi*129-t*2)
  x=.103*groove*math.sin(theta)*math.sin(phi)+.008*math.sin(theta)**2*front
  y=1.692+.108*math.cos(theta)-.018*t*t*(1-front)
  z=.012+.111*groove*math.sin(theta)*math.cos(phi)
  verts.append((x,y,z))
for i in range(rows):
 for j in range(cols):a=i*cols+j;b=i*cols+(j+1)%cols;faces.append((a,b,b+cols,a+cols))
cap=geo('Nova.sculpted_bob',verts,faces,hair)
uv=cap.data.uv_layers.new(name='HairFlow')
for poly in cap.data.polygons:
 for li in poly.loop_indices:
  vi=cap.data.loops[li].vertex_index;uv.data[li].uv=((vi%cols)/cols,(vi//cols)/rows)
import numpy as np
width,height=1024,512;xx,yy=np.meshgrid(np.arange(width)/width,np.arange(height)/height)
rng=np.random.default_rng(23)
flow=.58+.18*np.sin(xx*math.tau*73+yy*3)+.10*np.sin(xx*math.tau*129-yy*2)+rng.random((height,width))*.12
rgba=np.ones((height,width,4),dtype=np.float32);rgba[:,:,:3]=flow[:,:,None]*np.array([.22,.125,.075])[None,None,:]
texture=bpy.data.images.new('Nova hair color',width=width,height=height);texture.pixels[:]=rgba.ravel();texture.pack()
node=hair.node_tree.nodes.new('ShaderNodeTexImage');node.image=texture;hair.node_tree.links.new(node.outputs['Color'],hair.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

# Solidify mesh before binding; no scalp holes at open ends.
mod=cap.modifiers.new('Hair edge thickness','SOLIDIFY');mod.thickness=.002
bpy.context.view_layer.objects.active=cap;bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_apply(modifier=mod.name)
# Hair flow is encoded by the authored surface and texture; no dense strand tubes.
# One soft swept forelock. Avoids the eye and makes the silhouette recognizably different.
# Asymmetric fringe is part of the scalp surface; no separate tube over the forehead.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
 if o.name.startswith(('Nova.sculpted_bob','Nova.hair_flow')):o.select_set(True)
bpy.context.view_layer.objects.active=cap;bpy.ops.object.join()
# Solid, low-density eyebrows with retained expression keys.
browmat=material('Nova / brows',(.055,.028,.019),.86)
for side,sign in [('Left',1),('Right',-1)]:
 points=[]
 for x,y in [(.013,1.670),(.027,1.675),(.042,1.673),(.055,1.665)]:
  vertex=min((v for v in body.data.vertices if v.co.y<-.07),key=lambda v:(v.co.x-sign*x)**2+(v.co.z-y)**2)
  points.append((sign*x,y,-vertex.co.y+.0025))
 brow=curve('Nova.brow.'+side,points,.00135,browmat);brow.shape_key_add(name='Basis')
 for name,amount in [('browInnerUp',.004),('browOuterUp'+side,.003),('browDown'+side,-.003)]:
  key=brow.shape_key_add(name=name)
  for v in key.data:v.co.z+=amount
# Integrated eye meshes; no painted highlight dots. The HDR environment creates catchlights.
sclera=material('Nova / sclera',(.69,.67,.59),.27)
iris=material('Nova / hazel iris',(.09,.16,.105),.40);pupil=material('Nova / pupil',(.004,.007,.005),.23)
for side,sign in [('Left',1),('Right',-1)]:
 bone=side+'Eye';x=sign*.0325
 sphere('Nova.eye.'+side,(x,1.6515,.1285),(.0162,.0162,.0162),sclera,bone)
 sphere('Nova.iris.'+side,(x,1.6515,.1434),(.0073,.0073,.0013),iris,bone)
 sphere('Nova.pupil.'+side,(x,1.6515,.1445),(.003,.003,.0006),pupil,bone)
# Small brushed-brass earrings, integrated with the head rig.
brass=material('Nova / brushed brass',(.42,.31,.13),.32,.72)
for sign in [-1,1]:
 bpy.ops.mesh.primitive_torus_add(major_radius=.009,minor_radius=.0013,major_segments=32,minor_segments=8,location=xyz(sign*.083,1.603,.015),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name='Nova.earring';bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.data.materials.append(brass);bind(o)
# Bake static local creases/contact shading into the body UV map for lightweight browser use.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
bodymat=body.data.materials[0];nodes=bodymat.node_tree.nodes
ao=bpy.data.images.new('Nova baked occlusion',width=1024,height=1024);ao.colorspace_settings.name='Non-Color'
tex=nodes.new('ShaderNodeTexImage');tex.image=ao;nodes.active=tex
bpy.ops.object.bake(type='AO',margin=8);ao.pack()
group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
output=nodes.new('ShaderNodeGroup');output.node_tree=group;bodymat.node_tree.links.new(tex.outputs['Color'],output.inputs['Occlusion'])
# Export only actor content; self-contained GLB, no Blender runtime dependencies.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
 if o.type in ['MESH','ARMATURE']:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'nova-editorial.glb'),export_format='GLB',use_selection=True,export_animations=False,export_morph=True,export_skins=True,export_yup=True,export_image_format='AUTO')
# Asset QA render: Cycles CPU, actual exported geometry and material intent, not browser QA.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=700;scene.render.resolution_y=820;scene.render.resolution_percentage=100
scene.world.color=(.04,.05,.04)
world=scene.world;world.use_nodes=True;bg=world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.16,.20,.16,1);bg.inputs['Strength'].default_value=.4
hdr=OUT/'studio-small-06.hdr'
if hdr.exists():
 tex=world.node_tree.nodes.new('ShaderNodeTexEnvironment');tex.image=bpy.data.images.load(str(hdr));world.node_tree.links.new(tex.outputs['Color'],bg.inputs['Color']);bg.inputs['Strength'].default_value=.18
# Muted studio backdrop and area lighting.
backmat=material('QA backdrop',(.025,.07,.05),1)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,.8,1.5),rotation=(math.pi/2,0,0));bpy.context.object.data.materials.append(backmat)
def point_at(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,energy,size,color in [('Key',(-1,-1.5,2.4),42,1.5,(1,.89,.73)),('Fill',(1,-1,1.8),8,1.0,(.78,.90,1)),('Rim',(1,.35,2.2),55,.8,(1,.86,.65))]:
 data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color;o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc;point_at(o,(0,0,1.60))
bpy.ops.object.camera_add(location=(.23,-1.05,1.65));camera=bpy.context.object;camera.data.lens=60;point_at(camera,(0,-.01,1.58));scene.camera=camera
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath='/workspace/scratch/0a15a2df26f1/lookdev/nova-neutral.png';bpy.ops.render.render(write_still=True)
for label,key in [('mouth','viseme_aa'),('blink','eyeBlinkLeft')]:
 for o in bpy.context.scene.objects:
  if o.type=='MESH' and o.data.shape_keys:
   for k in o.data.shape_keys.key_blocks:
    k.value=1 if (label=='blink' and k.name in ['eyeBlinkLeft','eyeBlinkRight']) else .56 if k.name==key else 0
 scene.render.filepath='/workspace/scratch/0a15a2df26f1/lookdev/nova-'+label+'.png';bpy.ops.render.render(write_still=True)
print('EXPORTED',str(OUT/'nova-editorial.glb'))
