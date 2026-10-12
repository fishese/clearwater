import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.fishese.clearwater',
  appName: 'ClearWater',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#10191d' },
};
export default config;
