import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { existsSync } from 'node:fs';

let isLoaded = false;

export function loadEnv() {
    if (isLoaded) return;

    const nodeEnv = (process.env.NODE_ENV || 'development').trim();

    const envFile = `.env.${nodeEnv}`;
    const filePath = path.resolve(process.cwd(), envFile);

    if (existsSync(filePath)) {
        try {
            loadEnvFile(filePath);
            console.log(`Loaded environment from: ${envFile}`);
            isLoaded = true;
        } catch (e) {
            console.error(`Failed to load environment from ${envFile}:`, e);
        }
    } else {
        console.warn(`Environment file ${envFile} not found.`);
    }
}
