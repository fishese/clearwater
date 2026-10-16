import {useSyncExternalStore} from 'react';
import {getOfflineModelState,subscribeOfflineModels,refreshOfflineModels,getOfflineSettings} from './offline-models';
import {getPlatformCapabilities} from './platform/capabilities';
import {t} from './i18n';

export default function OfflineModels(){
 const status=useSyncExternalStore(subscribeOfflineModels,getOfflineModelState),settings=useSyncExternalStore(subscribeOfflineModels,getOfflineSettings);
 if(!import.meta.env.PROD||!getPlatformCapabilities().webServiceWorkerUpdates||!('serviceWorker' in navigator))return null;
 return <div className="offline-models">
  <p role="status" aria-live="polite">{!settings.models.length?t('No models selected.'):status.state==='ready'?t('Models ready offline'):status.state==='downloading'?t('Caching models: {0}/{1}',[status.cached,status.total]):status.state==='checking'?t('Checking offline models…'):t('Offline models: {0}/{1}',[status.cached,status.total])}</p>
  {settings.models.length>0&&status.state!=='ready'&&<button type="button" className="button secondary" disabled={status.state==='downloading'||status.state==='checking'} onClick={()=>refreshOfflineModels(true)}>{t('Download offline models')}</button>}
 </div>;
}
