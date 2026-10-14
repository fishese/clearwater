import {describe,it,expect} from 'vitest';
import {newestPhotos} from '../src/core/library-order';

describe('photo library order',()=>{
  it('puts newest additions first, treats missing dates as oldest, and leaves input untouched',()=>{
    const items=[
      {id:'old',addedAt:2,file:{name:'old.jpg'}},
      {id:'unknown',file:{name:'unknown.jpg'}},
      {id:'new',addedAt:9,file:{name:'new.jpg'}},
    ];
    expect(newestPhotos(items).map(p=>p.id)).toEqual(['new','old','unknown']);
    expect(items.map(p=>p.id)).toEqual(['old','unknown','new']);
  });
  it('uses descending ids and then ascending names for equal timestamps',()=>{
    const items=[
      {id:'a',addedAt:1,file:{name:'z.jpg'}},
      {id:'b',addedAt:1,file:{name:'b.jpg'}},
      {id:'b',addedAt:1,file:{name:'a.jpg'}},
    ];
    expect(newestPhotos(items).map(p=>p.file.name)).toEqual(['a.jpg','b.jpg','z.jpg']);
  });
  it('keeps timestamp zero newer than pre-epoch dates and missing timestamps',()=>{
    const items=[
      {id:'before-epoch',addedAt:-1,file:{name:'before.jpg'}},
      {id:'unknown',file:{name:'unknown.jpg'}},
      {id:'epoch',addedAt:0,file:{name:'epoch.jpg'}},
    ];
    expect(newestPhotos(items).map(p=>p.id)).toEqual(['epoch','before-epoch','unknown']);
    expect(items.map(p=>p.id)).toEqual(['before-epoch','unknown','epoch']);
  });
});
