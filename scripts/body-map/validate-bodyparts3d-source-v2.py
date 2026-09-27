from __future__ import annotations
import argparse, hashlib, json, re, sys, zipfile
from pathlib import Path, PurePosixPath

EXPECTED={
 'isa_BP3D_4.0_obj_99.zip':('https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip',142903898,'40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e'),
 'partof_BP3D_4.0_obj_99.zip':('https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip',64888505,'9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97'),
}
TABLES=['isa_parts_list_e.txt','partof_parts_list_e.txt','isa_element_parts.txt','partof_element_parts.txt','isa_inclusion_relation_list.txt','partof_inclusion_relation_list.txt']
TARGETS=['latissimus dorsi','rectus abdominis','internal oblique','transversus abdominis']
ATTRIBUTION='BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International'
LEGACY='CC Attribution-Share Alike 2.1 Japan'

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1<<20),b''): h.update(chunk)
 return h.hexdigest()

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--source-root',required=True,type=Path); ap.add_argument('--report-name',default='source-validation-report-v2.json')
 args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 root=args.source_root.resolve(); out=root/args.report_name
 if out.exists(): raise FileExistsError(f'Refusing to overwrite {out}')
 prov=json.loads((root/'source-provenance.json').read_text(encoding='utf-8'))
 readme=(root/'README_e.html').read_text(encoding='utf-8',errors='replace')
 text=re.sub(r'<[^>]*>',' ',readme); text=re.sub(r'\s+',' ',text)
 required=['2025/02/27','isa_BP3D_4.0_obj_99.zip','partof_BP3D_4.0_obj_99.zip','Creative Commons Attribution 4.0 International',ATTRIBUTION]
 missing=[token for token in required if token.casefold() not in text.casefold()]
 if missing: raise ValueError('Official README missing required release/license evidence: '+repr(missing))
 archive_results=[]; old_notice_total=0; source_object_rows={}
 for name,(url,size,digest) in EXPECTED.items():
  path=root/name
  if path.stat().st_size!=size or sha(path)!=digest: raise ValueError('Official archive size/SHA mismatch: '+name)
  obj_count=0; header_notices={}; bad=None; targets={}
  with zipfile.ZipFile(path) as z:
   bad=z.testzip()
   if bad: raise ValueError(f'ZIP CRC failure {name}: {bad}')
   for info in z.infolist():
    pp=PurePosixPath(info.filename)
    if pp.is_absolute() or '..' in pp.parts: raise ValueError('Unsafe ZIP path: '+info.filename)
    if not info.filename.lower().endswith('.obj'): continue
    obj_count+=1
    with z.open(info) as f: header=f.read(4096).decode('utf-8','replace')
    if LEGACY.casefold() in header.casefold(): header_notices[LEGACY]=header_notices.get(LEGACY,0)+1
    if 'CC Attribution 4.0 International'.casefold() in header.casefold(): header_notices['CC Attribution 4.0 International']=header_notices.get('CC Attribution 4.0 International',0)+1
    base=Path(info.filename).name
    for fj in ('FJ1452','FJ1452M'):
     if re.match(re.escape(fj)+r'[_\.]',base):
      targets.setdefault(fj,[]).append({'archive':name,'member':info.filename,'header':header.splitlines()[:8]})
  old_notice_total+=header_notices.get(LEGACY,0)
  for fj,rows in targets.items(): source_object_rows.setdefault(fj,[]).extend(rows)
  archive_results.append({'name':name,'url':url,'bytes':size,'sha256':digest,'zipCrcValidation':'passed','objFileCount':obj_count,'OBJHeaderLicenseNoticeCounts':header_notices,'targetAbdominalElementFiles':targets})
 tables={}
 for name in TABLES:
  lines=(root/name).read_text(encoding='utf-8',errors='replace').splitlines(); found=[]
  for number,line in enumerate(lines,1):
   low=line.casefold()
   if any(target in low for target in TARGETS): found.append({'line':number,'text':line})
  tables[name]={'rowCount':len(lines)-1,'directTargetNameMatches':found}
  if found: raise ValueError(f'Unexpected target anatomy name found in {name}; re-review mapping instead of authoring geometry')
 # Record source compound evidence by concept/object identity rather than overstate it as specific anatomy.
 compound={}
 for name,concepts in {'isa_parts_list_e.txt':['FMA9620','FMA20278'],'isa_element_parts.txt':['FMA9620','FMA20278','FMA13335','FMA13336','FMA13337'],'isa_inclusion_relation_list.txt':['FMA9620','FMA20278','FMA13335'],'partof_parts_list_e.txt':['FMA78435','FMA86917'],'partof_element_parts.txt':['FMA78435','FMA86917','FMA13336','FMA13337'],'partof_inclusion_relation_list.txt':['FMA78435','FMA13336','FMA13337']}.items():
  rows=[]
  for number,line in enumerate((root/name).read_text(encoding='utf-8',errors='replace').splitlines(),1):
   if any(concept in line for concept in concepts): rows.append({'line':number,'text':line})
  compound[name]=rows
 if old_notice_total==0: raise ValueError('No legacy per-OBJ notice found; expected to disclose mismatch')
 result={
  'validatorVersion':'bodyparts3d-source-provenance-v2.0.0','dataset':'BodyParts3D','release':'4.0',
  'sourceRoot':str(root),'readme':{'url':'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html','date':'2025-02-27','archiveAndLicenseEvidence':'passed','files':['isa_BP3D_4.0_obj_99.zip','partof_BP3D_4.0_obj_99.zip'],'currentLicense':'CC BY 4.0','requiredAttribution':ATTRIBUTION},
  'archives':archive_results,'anatomyAvailability':{'targets':TARGETS,'directTargetRowsAcrossSixOfficialTables':sum(len(v['directTargetNameMatches']) for v in tables.values()),'directTargetSourceMeshes':'none found','officialTables':tables,
   'genericAbdominalCompounds':compound,'resolvedAbdominalElements':source_object_rows,
   'interpretation':'IS-A and PART-OF abdominal compounds resolve to FJ1452/FJ1452M, whose archived OBJ headers identify right/left external oblique. They do not provide rectus abdominis, internal oblique, transversus abdominis, or latissimus dorsi geometry.'},
  'licenseDiscrepancy':{'currentOfficialReadme':'CC BY 4.0; explicitly lists the exact Release 4.0 OBJ archives and required attribution. README date is 2025-02-27; license section states 2025/02/25 and update history says license updated 2025/02/27.','OBJHeaders':{'legacyNotice':'CC BY-SA 2.1 Japan','matchingOBJHeaderCount':old_notice_total,'coverage':'all OBJ member headers in both source archives scanned'},'resolution':'Use the current official README/database license for these expressly listed archives, preserve required attribution and modification notice, and disclose older embedded headers. The source archives and notices are not edited. The documented discrepancy remains an interpretive uncertainty; this validator does not erase or claim to settle it.'},
 }
 out.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\\n',encoding='utf-8')
 print(json.dumps({'report':str(out),'archiveCount':len(archive_results),'objHeadersScanned':sum(x['objFileCount'] for x in archive_results),'legacyNotices':old_notice_total,'exactTargetMeshRows':result['anatomyAvailability']['directTargetRowsAcrossSixOfficialTables'],'targetObjectsResolved':sorted(source_object_rows),'sha256':{x['name']:x['sha256'] for x in archive_results}},indent=2))
 return 0
if __name__=='__main__': raise SystemExit(main())
