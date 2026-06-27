import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.foru.pos',
  appName: 'FORU POS',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'http'
  }
};

export default config;
