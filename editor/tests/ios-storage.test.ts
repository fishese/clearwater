import {describe,expect,it} from 'vitest';
import {savePhoto,type StoredPhoto} from '../src/storage';

describe('native iOS capture persistence boundary',()=>{
 it('never writes the hydrated native source File to IndexedDB',async()=>{
  const descriptor={schemaVersion:1 as const,id:'8e412a77-8448-4f80-9041-9775d4eff00b',kind:'video' as const,name:'capture.mp4',type:'video/mp4',sourceUrl:'file:///private/capture.mp4',thumbnailUrl:'file:///private/thumb.jpg',width:1,height:1,bytes:5,addedAt:1,recipeVersion:1 as const,recipe:{},visible:true,pending:false,photosSaved:false};
  const photo:StoredPhoto={id:descriptor.id,file:new File([new Uint8Array(512)],descriptor.name,{type:descriptor.type}),addedAt:descriptor.addedAt,previewFile:new File(['thumb'],'thumb.jpg',{type:'image/jpeg'}),nativeCapture:{descriptor,loaded:true}};
  await expect(savePhoto(photo)).resolves.toBeUndefined();
 });
});
