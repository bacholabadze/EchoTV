"""Edition 06: clean, texture-free character assets from the existing CC0 base.
Remove obsolete hair geometry and baked lighting. Preserve skeletal/morph data.
Run: Blender 4.5 --background --factory-startup --python tools/build-clean-cast.py
"""
import bpy,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'dist/studio/lookdev/assets'
def clear():
 
 for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
def linear(hex):
 a=[int(hex[i:i+2],16)/255 for i in [0,2,4]]
 return tuple(v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in a)+(1,)
def clean_material(m,color,roughness=.8,metal=0):
 m.use_nodes=True;m.node_tree.nodes.clear();out=m.node_tree.nodes.new('ShaderNodeOutputMaterial');p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');p.inputs['Base Color'].default_value=linear(color);p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metal;m.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface']);m.diffuse_color=linear(color);m.use_backface_culling=True
clear();bpy.ops.import_scene.gltf(filepath=str(OUT/'nova-editorial.glb'))
for o in list(bpy.context.scene.objects):
 if 'sculpted_bob' in o.name:bpy.data.objects.remove(o,do_unlink=True)
colors={'porcelain skin':('d1a283',.78,0),'ivory knit':('d4d0ba',.95,0),'teeth_base':('d9d2ba',.6,0),'tongue01':('7d413c',.8,0),'brows':('50382c',.9,0),'brushed brass':('9e8757',.5,.55),'sclera':('d2cec0',.44,0),'hazel iris':('687558',.7,0),'pupil':('151c18',.45,0)}
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 for a in list(o.data.color_attributes):o.data.color_attributes.remove(a)
 for m in o.data.materials:
  for term,v in colors.items():
   if term in m.name:clean_material(m,*v);break
  else:raise RuntimeError('Unclassified material '+m.name)
 bpy.context.view_layer.objects.active=o
# Only the base rig and meshes; no old bob, photographic atlas, baked AO or maps.
bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(OUT/'cast-clean-v6.glb'),export_format='GLB',use_selection=True,export_animations=False,export_morph=True,export_skins=True,export_yup=True)
clear();bpy.ops.import_scene.gltf(filepath=str(OUT/'studio-hair.glb'))
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 # Each cap is one connected mesh island. The old Nova knot is a separate island.
 # Remove the isolated rear component so the dark ball is absent from the file.
 mesh=o.data;neighbors=[[] for v in mesh.vertices]
 for edge in mesh.edges:
  a,b=edge.vertices;neighbors[a].append(b);neighbors[b].append(a)
 seen=set();groups=[]
 for i in range(len(neighbors)):
  if i in seen:continue
  group=[];todo=[i];seen.add(i)
  while todo:
   v=todo.pop();group.append(v)
   for n in neighbors[v]:
    if n not in seen:seen.add(n);todo.append(n)
  groups.append(group)
 # glTF UV seams can duplicate edge vertices. Keep cap components above nape,
 # and explicitly reject the isolated rear knot by its geometric center.
 remove=set()
 for group in groups:
  center=sum((mesh.vertices[i].co for i in group),Vector())/len(group)
  if center.y>.075 and center.z<1.71:remove.update(group)
 if remove:
  import bmesh
  bm=bmesh.new();bm.from_mesh(mesh);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i] for i in remove],context='VERTS');bm.to_mesh(mesh);bm.free()
 for a in list(mesh.color_attributes):mesh.color_attributes.remove(a)
 # Deliberate shallow part in the fitted cap, not an added round hair mass.
 for v in mesh.vertices:
  x,y,z=v.co.x,v.co.z,-v.co.y
  if y>1.71 and z>-.015:
   seam=math.exp(-((x-.023-.08*(y-1.74))/.0035)**2)
   v.co.z-=.0015*seam
 color={'HairNova':'50382c','HairEcho':'62635e','HairAtlas':'302a26'}[o.name]
 for m in o.data.materials:clean_material(m,color,.86,0)
 mesh.update()
bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(OUT/'hair-clean-v6.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
print('Clean assets exported. No texture images or occlusion maps.')
