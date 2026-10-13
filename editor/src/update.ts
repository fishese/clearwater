/** Activate an available worker only after the user explicitly requests an update. */
export async function activateWebUpdate(base:string):Promise<boolean>{
 if(!navigator.onLine)throw new Error('Connect to the internet to check for updates.');
 if(!('serviceWorker' in navigator))throw new Error('Updates require HTTPS and a browser with service worker support.');
 const registration=await navigator.serviceWorker.register(base+'sw.js',{updateViaCache:'none'});
 await registration.update();
 let next=registration.waiting??registration.installing;
 if(!next)return false;
 if(next.state!=='installed'&&next.state!=='activated'){
  const installing=next;
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>finish(new Error('The update took too long. Check your connection and try again.')),45000);
   function finish(error?:Error){clearTimeout(timer);installing.removeEventListener('statechange',change);error?reject(error):resolve();}
   function change(){if(installing.state==='installed'||installing.state==='activated')finish();else if(installing.state==='redundant')finish(new Error('The update could not be downloaded. Your current version is still available.'));}
   installing.addEventListener('statechange',change);change();
  });
 }
 next=registration.waiting??next;
 if(next.state==='activated')return true;
 const waiting=next;
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>finish(new Error('The update could not be activated. Try again.')),15000);
  function finish(error?:Error){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',change);error?reject(error):resolve();}
  function change(){if(navigator.serviceWorker.controller===waiting)finish();}
  navigator.serviceWorker.addEventListener('controllerchange',change);waiting.postMessage({type:'ACTIVATE_UPDATE'});change();
 });return true;
}
