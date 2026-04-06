import configService from './services/configService.js';
import { loadEnv } from './config/loadEnv.js';

async function test() {
    loadEnv();
    await configService.loadConfig();
    const keys = [
        'CAA_URL', 'CAA_USER', 'CAA_PASS', 
        'CAA_CLIENT_ID', 'CAA_TENANT_ID',
        'SignupB2C'
    ];
    console.log('--- DB CONFIG ---');
    for (const k of keys) {
        const val = await configService.getConfig(k);
        console.log(`${k}: ${val}`);
    }
    process.exit(0);
}

test();
