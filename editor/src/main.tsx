import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import {getPlatformCapabilities} from './platform/capabilities';
import {initialiseOfflineModels} from './offline-models';

createRoot(document.getElementById('root')!).render(<App/>);
if(import.meta.env.PROD && getPlatformCapabilities().webServiceWorkerUpdates && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{updateViaCache:'none'}).then(()=>initialiseOfflineModels()).catch(console.error);
}
