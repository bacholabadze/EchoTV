"""Scalp-fitted opaque hair meshes. Blender 4.5, no external scripts/assets.
Exports a small shared library; render checks are offline, not browser QA.
"""
import bpy,math,random
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'dist/studio/lookdev/assets';QA=Path('/tmp/echo-hair-review');QA.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(OUT/'nova-editorial.glb'))
body=bpy.data.objects['Human'];tree=BVHTree.FromPolygons([v.co for v in body.data.vertices],[list(p.vertices) for p in body.data.polygons])
center=Vector((0,-.012,1.685))
def xyz(x,y,z):return (x,-z,y)
def fit(theta,phi,offset):
 d=Vector((math.sin(theta)*math.sin(phi),-math.sin(theta)*math.cos(phi),math.cos(theta)))
 hit,n,_,_=tree.ray_cast(center,d,.3)
 if hit is None:raise RuntimeError('Scalp ray missed')
 return hit+d*offset
hair_objects=[]
for name,color,volume in [('Nova',(.035,.016,.009),.006),('Echo',(.13,.145,.135),.005),('Atlas',(.016,.011,.008),.0025)]:
 verts=[];faces=[];colors=[];cols=128;rows=32
 for i in range(rows+1):
  t=i/rows
  for j in range(cols):
   phi=math.tau*j/cols;front=max(0,math.cos(phi))
   # Natural curved hairline: front above brows, temples above ears, nape lower.
   end=2.12-.93*front**2-.20*abs(math.sin(phi))**8
   end+=.013*math.sin(phi*13)+.006*math.sin(phi*31)
   theta=.008+t*end
   sweep=.22*math.sin(theta)*math.sin(phi+.55) if name!='Atlas' else .03*math.sin(phi*4)
   root=.001+volume*(math.sin(math.pi*t/2)**.4)*(1-.55*t**8)
   root+=volume*.65*math.exp(-((phi-.55)/.8)**2)*math.sin(math.pi*t)
   # Sub-millimeter texture instead of deep radially ribbed geometry.
   strand=math.sin(phi*171+sweep*22+t*9)*.00022
   p=fit(theta,phi+sweep,root+strand);verts.append(p)
   c=.82+.13*math.sin(phi*71+t*7+sweep*22)+.05*math.sin(phi*173+t*19)
   colors.append(tuple(v*c for v in color)+(1,))
 for i in range(rows):
  for j in range(cols):a=i*cols+j;b=i*cols+(j+1)%cols;faces.append((a,a+cols,b+cols,b))
 mesh=bpy.data.meshes.new('Hair'+name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('Hair'+name,mesh);bpy.context.collection.objects.link(o)
 attr=mesh.color_attributes.new(name='HairTone',type='FLOAT_COLOR',domain='POINT')
 for c,v in zip(attr.data,colors):c.color=v
 mat=bpy.data.materials.new('Hair / '+name);mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.76
 c=mat.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name='HairTone';mat.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color']);o.data.materials.append(mat)
 for p in mesh.polygons:p.use_smooth=True
 if name=='Nova':
  # Pulled-back knot, seated against the occipital scalp; avoids a floating bob rim.
  bpy.ops.object.select_all(action='DESELECT');bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=xyz(0,1.665,-.101));bun=bpy.context.object;bun.scale=(.039,.034,.038);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
  bun.data.materials.append(mat);a=bun.data.color_attributes.new(name='HairTone',type='FLOAT_COLOR',domain='POINT')
  for v,c in zip(bun.data.vertices,a.data):
   f=.82+.12*math.sin(math.atan2(v.co.x,v.co.z-1.665)*49);c.color=tuple(t*f for t in color)+(1,)
  for p in bun.data.polygons:p.use_smooth=True
  o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.join()
 # Fine direction-following strand color and normal map; no alpha-card overdraw.
 uv=o.data.uv_layers.new(name='HairFlow')
 for poly in o.data.polygons:
  for li in poly.loop_indices:
   vi=o.data.loops[li].vertex_index
   if vi<(rows+1)*cols:
    u=(vi%cols)/cols
    if u==0 and any(o.data.loops[k].vertex_index%cols==cols-1 for k in poly.loop_indices):u=1
    uv.data[li].uv=(u,(vi//cols)/rows)
   else:
    v=o.data.vertices[vi].co;uv.data[li].uv=(math.atan2(v.x,v.z-1.665)/math.tau+.5,(v.y+.14)/.08)
 width=1024;height=512;u,v=np.meshgrid(np.arange(width)/width,np.arange(height)/height)
 phase=u*math.tau*241+np.sin(v*3+u*9)*3
 grain=np.random.default_rng(31).random((height,width))
 strands=.70+.17*np.sin(phase)+.07*np.sin(u*math.tau*389+v*7)+.06*grain
 rgba=np.ones((height,width,4),dtype=np.float32);rgba[:,:,:3]=strands[:,:,None]*np.array(color)[None,None,:]
 image=bpy.data.images.new('Strands '+name,width=width,height=height);image.pixels[:]=rgba.ravel();image.pack()
 shader=mat.node_tree.nodes.get('Principled BSDF');node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
 mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
 # Tangent-space normal texture, restrained so it reads as fibers rather than ribs.
 normal=np.ones((height,width,4),dtype=np.float32);normal[:,:,0]=.5+.085*np.cos(phase);normal[:,:,1]=.5;normal[:,:,2]=.99
 image=bpy.data.images.new('Fiber normals '+name,width=width,height=height);image.colorspace_settings.name='Non-Color';image.pixels[:]=normal.ravel();image.pack()
 node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;n=mat.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.65;mat.node_tree.links.new(node.outputs['Color'],n.inputs['Color']);mat.node_tree.links.new(n.outputs['Normal'],shader.inputs['Normal'])
 for a in list(o.data.color_attributes):o.data.color_attributes.remove(a)
 hair_objects.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in hair_objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'studio-hair.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
# Actual geometry renders. Hide old hair; render each new style in turn.
for o in list(bpy.context.scene.objects):
 if 'sculpted_bob' in o.name:o.hide_render=True
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=600;scene.render.resolution_y=700;scene.render.resolution_percentage=100
world=scene.world;world.use_nodes=True;bg=world.node_tree.nodes.get('Background');tex=world.node_tree.nodes.new('ShaderNodeTexEnvironment');tex.image=bpy.data.images.load(str(OUT/'studio-small-06.hdr'));world.node_tree.links.new(tex.outputs['Color'],bg.inputs['Color']);bg.inputs['Strength'].default_value=.14

def point(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for n,loc,energy,size,col in [('Key',(-1,-1.5,2.4),42,1.5,(1,.89,.73)),('Fill',(1,-1,1.8),8,1,(.78,.9,1)),('Rim',(1,.35,2.2),40,.8,(1,.86,.65))]:
 data=bpy.data.lights.new(n,'AREA');data.energy=energy;data.size=size;data.color=col;o=bpy.data.objects.new(n,data);scene.collection.objects.link(o);o.location=loc;point(o,(0,0,1.6))
bpy.ops.object.camera_add(location=(.23,-1.05,1.65));camera=bpy.context.object;camera.data.lens=60;point(camera,(0,-.01,1.58));scene.camera=camera
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
for name in ['Nova','Echo','Atlas']:
 for o in hair_objects:o.hide_render=o.name!='Hair'+name
 scene.render.filepath=str(QA/(name+'.png'));bpy.ops.render.render(write_still=True)
# One facial intent frame for assessing small expression weights on the actual base.
for o in hair_objects:o.hide_render=o.name!='HairNova'
for k in body.data.shape_keys.key_blocks:
 if k.name in ['browInnerUp','browOuterUpLeft']:k.value=.18
 if k.name in ['mouthSmileLeft','mouthSmileRight']:k.value=.13
 if k.name in ['cheekSquintLeft','cheekSquintRight']:k.value=.07
for o in bpy.context.scene.objects:
 if 'brow' in o.name and o.type=='MESH' and o.data.shape_keys:
  for k in o.data.shape_keys.key_blocks:
   if k.name in ['browInnerUp','browOuterUpLeft']:k.value=.18
scene.render.filepath=str(QA/'Nova-expression.png');bpy.ops.render.render(write_still=True)
