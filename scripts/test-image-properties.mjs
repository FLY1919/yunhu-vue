import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { build } from 'esbuild'
const result = await build({stdin:{contents:"export * from './src/core/image-properties'",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false})
const core = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'))
for (const ext of ['jpg','png','webp']) {
  await test(`${ext}: EXIF devices, shooting time and GPS are read; clean removes EXIF and keeps unrelated bytes`,async()=>{
    const bytes=await readFile(`scripts/image-properties-fixtures/photo.${ext}`)
    const info=await core.readImageProperties(new File([bytes],`photo.${ext}`))
    assert.equal(info.hasExif,true);assert.equal(info.orientation,1)
    assert.equal(info.exif.ifd0.Make,'QA Camera');assert.equal(info.exif.exif.DateTimeOriginal.getDate(),3)
    assert.ok(info.exif.gps.GPSLatitude);assert.ok(info.exif.gps.GPSLongitude)
    const clean=core.stripExifBytes(bytes)
    const after=await core.readImageProperties(new File([clean],`clean.${ext}`))
    assert.equal(after.hasExif,false);assert.deepEqual(after.exif,{})
    assert.ok(clean.length<bytes.length);assert.deepEqual(core.stripExifBytes(clean),clean)
    if(ext==='jpg') { const pos=bytes.indexOf(Buffer.from([255,218]));assert.deepEqual(Buffer.from(clean).subarray(Buffer.from(clean).indexOf(Buffer.from([255,218]))),bytes.subarray(pos)) }
    // Normalization of WEBP's RIFF size and EXIF flag is part of the rewrite.
    if(ext==='webp') {assert.equal(new DataView(clean.buffer).getUint32(4,true),clean.length-8);assert.equal(clean[20]&8,0)}
  })
}
for (const ext of ['png','webp']) {
 await test(`${ext}: animated image frame chunks preserved`, async()=>{
  const bytes=await readFile(`scripts/image-properties-fixtures/animated.${ext}`), clean=core.stripExifBytes(bytes)
  const info=await core.readImageProperties(new File([clean],`animation.${ext}`));assert.equal(info.animated,true);assert.equal(info.hasExif,false)
  const chunk=ext==='png'?'fdAT':'ANMF';assert.ok(Buffer.from(clean).includes(Buffer.from(chunk)))
 })
}
await test('Orientation 6 is retained for the normalization branch',async()=>{
 const bytes=await readFile('scripts/image-properties-fixtures/oriented.jpg')
 assert.equal((await core.readImageProperties(new File([bytes],'oriented.jpg'))).orientation,6)
})
await test('GIF without standard EXIF supports idempotent cleaning without flattening animation',async()=>{
 const bytes=await readFile('scripts/ui-fixture/animated.gif'), info=await core.readImageProperties(new File([bytes],'animated.gif'))
 assert.equal(info.format,'GIF');assert.equal(info.hasExif,false);assert.equal(info.canClean,true)
 assert.deepEqual(Buffer.from(core.stripExifBytes(bytes)),bytes)
})
await test('Malformed containers and empty input fail explicitly',async()=>{
 const bytes=await readFile('scripts/image-properties-fixtures/photo.webp');assert.throws(()=>core.stripExifBytes(bytes.subarray(0,bytes.length-3)),/损坏/)
 await assert.rejects(()=>core.readImageProperties(new File([],'empty.jpg')),/为空/)
 const png=await readFile('scripts/image-properties-fixtures/photo.png');assert.throws(()=>core.stripExifBytes(png.subarray(0,33)),/损坏/)
})
await test('complete metadata retains unknown EXIF, full comments, maker binary data, XMP and ICC; priority rows put model/software/GPS first', async()=>{
 const info=await core.readImageProperties(new File([await readFile('scripts/image-properties-fixtures/extended.jpg')],'extended.jpg'))
 const rows=core.imagePropertyRows(info.metadata)
 assert.equal(info.exif.ifd0.Software,'YH EXIF QA');assert.equal(info.exif.ifd0['60001'],'unknown-but-preserved')
 assert.equal(rows[0].key,'Model');assert.equal(rows[1].key,'Software');assert.ok(rows.findIndex(r=>r.key==='GPSLatitude')<rows.findIndex(r=>r.key==='Make'))
 assert.ok(rows.some(r=>r.group.includes('xmp')&&r.value.includes('Extended metadata software')));assert.ok(Object.keys(info.metadata).some(k=>k==='icc'))
 assert.ok(rows.find(r=>r.key==='UserComment').value.length>3000);const maker=rows.find(r=>r.key==='MakerNote');assert.equal(maker.raw.byteLength,512);assert.ok(core.propertyValue(maker.raw,true).length>1000)
})
await test('GPS directions include hemispheres, unknown or invalid fields display 无',()=>{
 const rows=core.imagePropertyRows({gps:{GPSLatitude:[22,30,0],GPSLatitudeRef:'N',GPSLongitude:[114,10,20],GPSLongitudeRef:'E'},empty:undefined,bad:NaN,date:new Date('invalid')})
 assert.equal(rows.find(r=>r.key==='GPSLatitude').value,'北纬 22° 30′ 0″')
 assert.equal(rows.find(r=>r.key==='GPSLongitude').value,'东经 114° 10′ 20″')
 for(const key of ['empty','bad','date'])assert.equal(rows.find(r=>r.key===key).value,'无')
 const south=core.imagePropertyRows({gps:{GPSLatitude:[12,0,1],GPSLatitudeRef:'S',GPSLongitude:[45,0,1],GPSLongitudeRef:'W'}})
 assert.match(south.find(r=>r.key==='GPSLatitude').value,/南纬/);assert.match(south.find(r=>r.key==='GPSLongitude').value,/西经/)
 assert.equal(core.imagePropertyRows({gps:{GPSLatitude:[0,70,0],GPSLatitudeRef:'N'}})[0].value,'无')
})
await test('broken EXIF values do not prevent removing every EXIF container',async()=>{
 const original=await readFile('scripts/image-properties-fixtures/photo.jpg'),bytes=Buffer.from(original),tiff=bytes.indexOf(Buffer.from('Exif\0\0'))+6
 bytes[tiff]=0;bytes[tiff+1]=0
 const info=await core.readImageProperties(new File([bytes],'broken.jpg'))
 assert.equal(info.hasExif,true);assert.deepEqual(info.exif,{})
 const clean=core.stripExifBytes(bytes),after=await core.readImageProperties(new File([clean],'clean.jpg'))
 assert.equal(after.hasExif,false);assert.equal(after.parseError,'');assert.deepEqual(core.stripExifBytes(clean),clean)
})
await test('WebP EXIF flag clears even when the advertised EXIF block is absent',async()=>{
 const bytes=Buffer.from(core.stripExifBytes(await readFile('scripts/image-properties-fixtures/photo.webp')))
 bytes[20]|=8
 const clean=core.stripExifBytes(bytes);assert.equal(clean[20]&8,0)
 assert.equal(new DataView(clean.buffer).getUint32(4,true),clean.length-8)
})
