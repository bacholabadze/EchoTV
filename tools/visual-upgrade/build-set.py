"""Original event scenery only. Rebuild GLB + editable Blender source, no cast edits.
blender -b --python tools/visual-upgrade/build-set.py
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'dist/studio/visual-upgrade'; OUT.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT/'docs/visual-upgrade'; SOURCE.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def linear(hex):
    c=[int(hex[i:i+2],16)/255 for i in (0,2,4)]
    return [x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c]
def mat(name,color,metal=0,rough=.7,glow=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');c=(*linear(color),1)
    p.inputs['Base Color'].default_value=c;p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    if glow:p.inputs['Emission Color'].default_value=c;p.inputs['Emission Strength'].default_value=glow
    return m
M={
'deep':mat('ECHO / ink evergreen','112E2C'),
'panel':mat('ECHO / acoustic jade','23443D'),
'bronze':mat('ECHO / satin champagne','A89568',.5,.48),
'ivory':mat('ECHO / lettering porcelain','E9E6D7',0,.55,.15),
'lime':mat('ECHO / warm light inlay','DEEEA7',0,.6,.8),
'clay':mat('ECHO / clay pots','8F5949'),
'leaf':mat('ECHO / courtyard leaves','547257'),
'ochre':mat('ECHO / gallery relief','C6AE76')}
def xyz(p):return p[0],-p[2],p[1]
def finish(o,name,material):o.name=name;o.data.materials.append(M[material]);return o
def box(name,size,pos,material,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('Soft architectural edges','BEVEL');m.width=bevel;m.segments=3
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=m.name)
    return finish(o,name,material)
def cyl(name,r,h,pos,material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=h,location=xyz(pos));return finish(bpy.context.object,name,material)
def text(name,body,width,pos,material,size=1):
    c=bpy.data.curves.new(name,'FONT');c.body=body;c.align_x='CENTER';c.align_y='CENTER';c.size=size;c.extrude=.002;c.bevel_depth=.001;c.bevel_resolution=1;c.resolution_u=5;c.space_character=1.12
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.location=xyz(pos);o.rotation_euler=(math.pi/2,0,0);o.data.materials.append(M[material]);bpy.context.view_layer.update()
    if o.dimensions.x>0:o.scale*=width/o.dimensions.x
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);return o
# Backing and fluted side wings. Raised event wordmark stays above the presenter's head.
box('Quiet acoustic wall',(7.8,3.9,.12),(0,1.85,-2.14),'deep',.035)
box('Central inset',(3.75,3.1,.08),(0,1.68,-2.04),'panel',.08)
for x in [-1.98,1.98]:
    box('Portal upright',(.055,3.34,.08),(x,1.69,-1.92),'bronze',.012)
    box('Vertical warm inlay',(.012,3.16,.025),(x-.045*(1 if x>0 else -1),1.69,-1.86),'lime',.003)
box('Portal lintel',(4.02,.055,.08),(0,3.34,-1.92),'bronze',.012)
for sign in [-1,1]:
    for i in range(12):box('Acoustic fluting',(.035,3.6,.055),(sign*(2.18+i*.13),1.8,-2.02),'bronze',.008)
text('ECHO wordmark','ECHO',1.22,(0,2.48,-1.95),'ivory')
text('Event wordmark','HACKTOBERFEST',1.61,(0,2.13,-1.945),'lime')
text('Place and year','TBILISI  /  2026',.76,(0,1.94,-1.94),'ivory')
for x in [-.99,.99]:box('Wordmark rule',(.32,.009,.01),(x,2.13,-1.94),'bronze')
# Original miniature relief gallery; inspired by the campus's verified exhibition spaces.
for sign in [-1,1]:
    x=sign*2.61
    box('Gallery pedestal',(.56,.72,.52),(x,.36,-1.34),'panel',.035)
    box('Gallery cap',(.59,.035,.55),(x,.73,-1.34),'bronze',.012)
    box('Original relief mount',(.62,.74,.055),(x,1.22,-1.63),'ivory',.012)
    for i in range(4):
        o=box('Original abstract relief',(.055,.43,.05),(x+(i-1.5)*.12,1.22,-1.58),'ochre',.013)
        o.rotation_euler.y=math.radians(sign*(i-1.5)*10)
    # Courtyard vegetation is authored, never a downloaded campus asset.
    x=sign*3.28
    cyl('Courtyard pot',.22,.37,(x,.185,-1.0),'clay')
    cyl('Pot rim',.23,.035,(x,.37,-1.0),'bronze')
    for k in range(9):
        a=k*2.4;tip=(x+math.sin(a)*.24,.61+(k%3)*.17,-1+math.cos(a)*.23)
        o=box('Plant stem',(.009,.55,.009),(x,.57,-1),'bronze');o.rotation_euler[0]=math.sin(a)*.3;o.rotation_euler[1]=math.cos(a)*.3
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=1,location=xyz(tip));o=bpy.context.object;o.scale=(.09,.035,.20);o.rotation_euler=(math.sin(a)*.5,math.cos(a)*.6,a);finish(o,'Courtyard leaf','leaf')
# Merge by material: bounded draw calls, retaining separate named collections in blend through custom props.
for key,material in M.items():
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and material.name in o.data.materials]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name='FestivalSet / '+key
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'festival-set.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'festival-set.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH')
(SOURCE/'asset-stats.json').write_text(json.dumps({'blender':bpy.app.version_string,'meshObjects':len([o for o in bpy.context.scene.objects if o.type=='MESH']),'triangles':triangles,'bytes':(OUT/'festival-set.glb').stat().st_size},indent=2))
print('VISUAL ASSET',triangles,'triangles')
