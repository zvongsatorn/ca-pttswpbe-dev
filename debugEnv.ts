import { loadEnv } from './config/loadEnv.js';
loadEnv();

const secret = process.env.AZURE_CLIENT_SECRET;
console.log('Secret Length:', secret?.length);
console.log('Starts with:', secret?.substring(0, 5));
console.log('Ends with:', secret?.substring(secret.length - 5));
console.log('Contains space at end?', secret?.endsWith(' '));
console.log('Contains quotes?', secret?.startsWith('"'));
