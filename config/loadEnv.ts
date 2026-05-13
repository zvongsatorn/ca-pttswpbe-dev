import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { existsSync } from 'node:fs';

let isLoaded = false;

export function loadEnv() {
    if (isLoaded) return;

    const rawNodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
    const nodeEnv = /^[a-z0-9_-]+$/.test(rawNodeEnv) ? rawNodeEnv : 'development';
    const envCandidates = Array.from(new Set([
        `.env.${nodeEnv}`,
        ...(nodeEnv === 'development' ? ['.env.dev'] : []),
        ...(nodeEnv === 'dev' ? ['.env.development'] : []),
        '.env.local',
        '.env'
    ]));

    for (const envFile of envCandidates) {
        const filePath = path.resolve(process.cwd(), envFile);
        if (!existsSync(filePath)) continue;

        try {
            loadEnvFile(filePath);
            console.log(`Loaded environment from: ${envFile}`);
            isLoaded = true;
            return;
        } catch (e) {
            console.error(`Failed to load environment from ${envFile}:`, e);
        }
    }

    console.warn(`No environment file found. Tried: ${envCandidates.join(', ')}`);
}
