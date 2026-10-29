import { NativeModules, Platform } from 'react-native';

// ✅ Guarded import
let SunmiModule: any = null;
if (Platform.OS === 'android') {
  try {
    SunmiModule = require('sunmi-printer-expo');
  } catch (e) {
    console.log('Sunmi module load failed in detector');
  }
}

export class PrinterDetector {
  
  // Check what printer is available
  static async detectPrinter(): Promise<'sunmi' | 'pdf'> {
    if (Platform.OS !== 'android') return 'pdf';
    
    // Quick brand check to avoid blocking native service binding attempts on non-Sunmi hardware
    const brand = (Platform.constants as any).Brand || '';
    const manufacturer = (Platform.constants as any).Manufacturer || '';
    const isSunmiBrand = 
      brand.toLowerCase().includes('sunmi') || 
      manufacturer.toLowerCase().includes('sunmi');
      
    if (!isSunmiBrand) {
      console.log('ℹ️ Non-Sunmi hardware detected, skipping Sunmi printer detection');
      return 'pdf';
    }
    
    try {
      // ✅ Check for Sunmi printer by trying to initialize
      const sunmiReady = await this.checkSunmiPrinter();
      if (sunmiReady) {
        console.log('✅ Sunmi printer detected');
        return 'sunmi';
      }
      
      // Default to PDF
      console.log('⚠️ No Sunmi printer, using PDF fallback');
      return 'pdf';
      
    } catch (error) {
      console.log('Printer detection error:', error);
      return 'pdf';
    }
  }
  
  static async checkSunmiPrinter(): Promise<boolean> {
    try {
      if (!SunmiModule) return false;
      await SunmiModule.initPrinter();
      return true;
    } catch (error) {
      return false;
    }
  }
  
  static async checkPrintService(): Promise<boolean> {
    // Android always has print service
    return Platform.OS === 'android';
  }
}
