export interface PhotoOrderItem { id:string; addedAt?:number; file:{name:string} }

/** Sort newest first with stable, deterministic ties without changing the input array. */
export function newestPhotos<T extends PhotoOrderItem>(items:readonly T[]):T[] {
  return [...items].sort((a,b)=>{
    const left=a.addedAt??Number.NEGATIVE_INFINITY,right=b.addedAt??Number.NEGATIVE_INFINITY;
    if(left!==right)return left>right?-1:1;
    if(a.id!==b.id)return a.id<b.id?1:-1;
    return a.file.name<b.file.name?-1:a.file.name>b.file.name?1:0;
  });
}
