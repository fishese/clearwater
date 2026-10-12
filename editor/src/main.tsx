import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import {isAndroid} from './native';

createRoot(document.getElementById('root')!).render(<App/>);
if(import.meta.env.PROD && !isAndroid() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.error);
}
