declare module 'piexifjs' {
 const piexif:{TAGS:Record<string,Record<number,{name:string;type:string}>>;dump:(data:Record<string,unknown>)=>string;load:(data:string)=>Record<string,Record<number,unknown>>};
 export default piexif;
}
