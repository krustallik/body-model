from __future__ import annotations
import argparse, hashlib, json, math, sys, time
from pathlib import Path
import bmesh, bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1048576),b""): h.update(chunk)
    return h.hexdigest()

def skin_y(tree,x,z,anterior):
    origin=Vector((x,-1.0 if anterior else 1.0,z))
    direction=Vector((0.0,1.0 if anterior else -1.0,0.0))
    hit,_n,_i,_d=tree.ray_cast(origin,direction,2.0)
    if hit is None: raise ValueError(f"Skin ray missed x={x:.4f}, z={z:.4f}")
    return hit.y

def closed_volume(name,anatomy,side,rows,cols,point_at,inward_sign,collection,mat,layer,note):
    outer=[]; thick=[]
    for i in range(rows):
        t=i/(rows-1)
        for j in range(cols):
            p=point_at(t,j/(cols-1))
            if len(p)!=4 or not all(math.isfinite(float(v)) for v in p): raise ValueError(f"{name}: bad vertex")
            x,y,z,d=map(float,p)
            if d<=0: raise ValueError(f"{name}: invalid thickness")
            outer.append((x,y,z)); thick.append(d)
    n=len(outer); vertices=outer+[(x,y+inward_sign*thick[i],z) for i,(x,y,z) in enumerate(outer)]
    faces=[]
    for i in range(rows-1):
        for j in range(cols-1):
            a=i*cols+j; b=a+1; c=a+cols+1; d=a+cols
            faces.extend(((a,b,c,d),(n+d,n+c,n+b,n+a)))
    boundary=list(range(cols))
    boundary.extend(i*cols+cols-1 for i in range(1,rows))
    boundary.extend((rows-1)*cols+j for j in range(cols-2,-1,-1))
    boundary.extend(i*cols for i in range(rows-2,0,-1))
    for k,a in enumerate(boundary):
        b=boundary[(k+1)%len(boundary)]; faces.append((a,b,n+b,n+a))
    mesh=bpy.data.meshes.new(name+"_closed-volume")
    mesh.from_pydata(vertices,[],faces); mesh.validate(verbose=False,clean_customdata=True); mesh.update(calc_edges=True)
    bm=bmesh.new(); bm.from_mesh(mesh)
    if bm.faces: bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    loop_pairs=set()
    closed_boundary=boundary+[boundary[0]]
    for a,b in zip(closed_boundary,closed_boundary[1:]): loop_pairs.add(tuple(sorted((a,b))))
    for a,b in zip(closed_boundary,closed_boundary[1:]): loop_pairs.add(tuple(sorted((n+a,n+b))))
    bevel_edges=[e for e in bm.edges if tuple(sorted((e.verts[0].index,e.verts[1].index))) in loop_pairs]
    if bevel_edges:
        bmesh.ops.bevel(bm,geom=bevel_edges,offset=0.0015,segments=3,profile=0.5,affect='EDGES')
        bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bad=sum(not e.is_manifold for e in bm.edges); volume=abs(bm.calc_volume(signed=True))
    if bad or volume<=1e-9:
        bm.free(); bpy.data.meshes.remove(mesh)
        raise ValueError(f"{name}: nonmanifold={bad}, volume={volume}")
    bm.to_mesh(mesh); bm.free(); mesh.update(calc_edges=True)
    for poly in mesh.polygons: poly.use_smooth=True
    mesh.materials.append(mat)
    obj=bpy.data.objects.new(name,mesh); collection.objects.link(obj)
    obj["bodycastMeshId"]=name; obj["bodycastSelectable"]=True; obj["bodycastRole"]="selectable-muscle"
    obj["bodycastContextLayer"]=layer; obj["bodycastContextPresentation"]="selectable-surface"
    obj["bodycastSourceObjectName"]=anatomy.replace("_"," ").title(); obj["bodycastAnatomyIds"]=anatomy
    obj["bodycastSide"]=side; obj["bodycastGeometryOrigin"]="BodyCast-authored-volumetric-anatomy-v2.0.0"
    obj["bodycastGeometryMethod"]="Closed body-envelope-conformed volume; independently authored without copied source geometry."
    obj["bodycastAttachmentContract"]=note
    return {"meshId":name,"sourceObjectId":"BODYCAST-AUTHORED","selectable":True,"anatomyIds":[anatomy],
      "sourceFmaConceptIds":[],"bindingConceptIds":[],"sourceTermNames":[],
      "sourceObjectName":anatomy.replace("_"," ").title(),
      "geometryOrigin":"BodyCast-authored-volumetric-anatomy-v2.0.0",
      "geometryMethod":"Closed body-envelope-conformed volume with rounded perimeter, independently authored without copied source geometry.",
      "attachmentContract":note,"side":side,"depthLayer":layer,"contextPresentation":"selectable-surface",
      "vertexCount":len(mesh.vertices),"faceCount":len(mesh.polygons),
      "triangleCount":sum(max(0,len(p.vertices)-2) for p in mesh.polygons),
      "bounds":{"min":[min(v[i] for v in outer) for i in range(3)],"max":[max(v[i] for v in outer) for i in range(3)]},
      "sourcePath":None,"signedVolumeMetersCubed":volume}

def rectus(tree,side,sign,coll,mat):
    z0,z1=.868,1.172
    def p(t,u):
        z=z0+(z1-z0)*t; width=.0035+.039*math.sin(math.pi*t)**.72; x=sign*(.010+width*u)
        sy=skin_y(tree,x,z,True); groove=max(math.exp(-((t-l)/.012)**2) for l in (.26,.49,.72))
        bulge=(.004+.006*math.sin(math.pi*t)*(.65+.35*math.sin(math.pi*u)))*(1-.5*groove)
        thick=(.010+.005*math.sin(math.pi*t))*(1-.34*groove)
        return x,sy+.0015-bulge,z,thick
    return closed_volume(f"bodycast-authored-rectus-abdominis-{side}","rectus_abdominis",side,65,25,p,1,coll,mat,"superficial",
      "Paired bellies from pubic symphysis to xiphoid/costal-cartilage region; linea-alba gap and three shallow tendinous intersections.")

def abdominal_sheet(tree,anatomy,side,sign,coll,mat,transverse):
    z0,z1=(.895,1.135) if transverse else (.882,1.158)
    def p(t,u):
        z=z0+(z1-z0)*t; taper=.008+.010*math.sin(math.pi*t)**.7
        inner=.050+(.008*t if not transverse else 0); outer=.137-(.008*(1-t) if transverse else 0)
        x=sign*(inner+taper+(outer-inner-taper)*u)
        if not transverse: x+=sign*.008*math.sin(math.pi*t)*(.5-u)
        sy=skin_y(tree,x,z,True); profile=math.sin(math.pi*u)**.65*math.sin(math.pi*t)**.55
        depth,thick,bulge=(.020,.009,.004) if transverse else (.011,.011,.005)
        return x,sy+depth-bulge*profile,z,thick
    note=("Lower costal cartilage, iliac crest and inguinal-ligament region; near-transverse fibers."
      if transverse else "Iliac/inguinal and lower-costal attachment region toward rectus sheath; diagonal superomedial fibers.")
    return closed_volume(f"bodycast-authored-{anatomy}-{side}",anatomy,side,49,33,p,1,coll,mat,"deep",note)

def latissimus(tree,side,sign,coll,mat):
    z0,z1=.895,1.328
    def p(t,u):
        z=z0+(z1-z0)*t; medial=.014+.150*t**2.2
        width=.055*(1-t)+.005+.045*math.sin(math.pi*t)*(1-t**3)
        x=sign*(medial+width*u); sy=skin_y(tree,x,z,False)
        belly=math.sin(math.pi*t)**.7*math.sin(math.pi*u)**.65
        return x,sy-.004+.010*belly,z,.014+.008*belly
    return closed_volume(f"bodycast-authored-latissimus-dorsi-{side}","latissimus_dorsi",side,73,41,p,-1,coll,mat,"superficial",
      "Broad lower thoracic/lumbar fascia, posterior iliac crest and lower-rib origin converging superolaterally to humeral intertubercular-groove region.")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--base-report",required=True,type=Path); parser.add_argument("--mapping",required=True,type=Path)
    parser.add_argument("--out-dir",required=True,type=Path); parser.add_argument("--revision",default="v2",choices=("v2","v3"))
    a=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    base=a.base_report.resolve(); mapping_path=a.mapping.resolve(); out=a.out_dir.resolve()
    revision=a.revision
    suffix="-v2" if revision=="v2" else "-v3"
    blend=out/f"bodyparts3d-v4.0-full-body{suffix}.blend"; glb=out/f"bodyparts3d-v4.0-full-body{suffix}.glb"
    report_path=out/f"bodyparts3d-v4.0-generation-report{suffix}.json"; previews=out/"previews"
    for path in (blend,glb,report_path,previews):
        if path.exists(): raise FileExistsError(f"Refusing to overwrite {path}")
    report=json.loads(base.read_text(encoding="utf-8")); mapping=json.loads(mapping_path.read_text(encoding="utf-8"))
    required={"latissimus_dorsi","rectus_abdominis","internal_oblique","transversus_abdominis"}
    if {x["anatomyId"] for x in mapping.get("independentGeometry",[])}!=required: raise ValueError("v2 mapping missing required anatomy")
    if required & {x["anatomyId"] for x in mapping.get("unavailable",[])}: raise ValueError("Required anatomy still unavailable")
    skin=next((o for o in bpy.context.scene.objects if o.get("bodyparts3dFileId")=="FJ2810"),None)
    if skin is None: raise RuntimeError("BodyParts3D skin envelope FJ2810 is absent")
    root=next((c for c in bpy.context.scene.collection.children if c.name=="BodyCast BodyParts3D 4.0"),None)
    if root is None: raise RuntimeError("BodyParts3D root collection is absent")
    tree=BVHTree.FromObject(skin,bpy.context.evaluated_depsgraph_get())
    coll=bpy.data.collections.new("BodyCast independently authored muscle volumes v1.0.0"); root.children.link(coll)
    surf=bpy.data.materials.get("BodyCast muscle surface"); deep=bpy.data.materials.get("BodyCast deep muscle")
    if surf is None or deep is None: raise RuntimeError("Base muscle materials are absent")
    generated=[]
    for side,sign in (("left",1.0),("right",-1.0)):
        generated.extend((latissimus(tree,side,sign,coll,surf),rectus(tree,side,sign,coll,surf),
            abdominal_sheet(tree,"internal_oblique",side,sign,coll,deep,False),
            abdominal_sheet(tree,"transversus_abdominis",side,sign,coll,deep,True)))
    ids={x["meshId"] for x in report["selectableRegions"]}
    if ids & {x["meshId"] for x in generated}: raise ValueError("Generated mesh identity collision")
    report["selectableRegions"].extend(generated); report["selectableMeshCount"]=len(report["selectableRegions"])
    report["authoredMeshCount"]=len(generated); report["mappingVersion"]=mapping["version"]
    report["unavailableAnatomy"]=mapping.get("unavailable",[]); report["licenseReview"]=mapping["licenseReview"]
    report["authoredAnatomyContract"]={"version":mapping["independentGeometry"][0]["geometryId"],
      "source":"Independently authored Blender volumes guided by documented attachment/fascicle-direction anatomy; no copied source meshes.",
      "limitations":"Educational visual approximations, not surgical or patient-specific models; geometry needs anatomy review.",
      "anatomyIds":sorted(required)}
    report["geometryProcessing"]="BodyParts3D 4.0 OBJ meshes retained; eight paired BodyCast-authored closed muscle volumes added. No Z-Anatomy, mirrored source mesh or decorative plane."
    bpy.ops.wm.save_as_mainfile(filepath=str(blend),check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format="GLB",export_extras=True,
      export_meshopt_compression_enable=True,export_yup=True,export_apply=True,export_materials="EXPORT",
      export_normals=True,export_texcoords=False,export_cameras=False,export_lights=False,export_animations=False)
    if not glb.is_file() or not glb.stat().st_size: raise RuntimeError("GLB export failed")
    report.update({"generatedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"glbBytes":glb.stat().st_size,
      "glbSha256":sha256(glb),"blendBytes":blend.stat().st_size,"blendSha256":sha256(blend),
      "glbPath":str(glb),"blendPath":str(blend),
      "triangleCount":report["triangleCount"]+sum(x["triangleCount"] for x in generated),
      "faceCount":report["faceCount"]+sum(x["faceCount"] for x in generated),
      "vertexCount":report["vertexCount"]+sum(x["vertexCount"] for x in generated)})
    report_path.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    scene=bpy.context.scene; scene.render.engine="BLENDER_EEVEE"; scene.render.resolution_x=1120
    scene.render.resolution_y=1560; scene.render.resolution_percentage=75; scene.render.image_settings.file_format="PNG"
    scene.render.film_transparent=False; scene.view_settings.view_transform="AgX"; previews.mkdir(parents=True,exist_ok=False)
    camera=scene.camera
    if camera is None: raise RuntimeError("Preview camera is absent")
    targets={"full-body-front":((0,-4,.82),(0,0,.82),1.92),"full-body-back":((0,4,.82),(0,0,.82),1.92),
      "full-body-side":((3.8,0,.82),(0,0,.82),1.92),"muscles-only-front":((0,-4,.82),(0,0,.82),1.92),
      "muscles-only-back":((0,4,.82),(0,0,.82),1.92),"latissimus-close-up":((0,2.2,1.1),(0,0,1.1),.70),
      "abdomen-close-up":((0,-2.2,1.03),(0,0,1.03),.54)}
    for name,(location,target,scale) in targets.items():
        camera.location=location; camera.rotation_euler=(Vector(target)-camera.location).to_track_quat("-Z","Y").to_euler()
        camera.data.type="ORTHO"; camera.data.ortho_scale=scale; skin.hide_render=name.startswith("muscles-only-")
        scene.render.filepath=str((previews/f"{name}.png").resolve()); bpy.ops.render.render(write_still=True)
    skin.hide_render=False
    print(json.dumps({k:report[k] for k in ("selectableMeshCount","authoredMeshCount","contextMeshCount","triangleCount","glbBytes","glbSha256","blendBytes","blendSha256")},indent=2))
    print(f"report: {report_path}")

if __name__=="__main__": raise SystemExit(main())
