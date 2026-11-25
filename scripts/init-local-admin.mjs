import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';

if(existsSync('.env')) { console.error('.env already exists. Leaving it unchanged.'); process.exit(1); }
const password=randomBytes(24).toString('base64url');
const salt=randomBytes(16).toString('hex');
const hash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
const secret=randomBytes(32).toString('hex');
writeFileSync('.env',`PORT=4000\nCLIENT_ORIGIN=http://localhost:5173\nNODE_ENV=development\nADMIN_PASSWORD_HASH=${hash}\nSESSION_SECRET=${secret}\n`,{flag:'wx'});
console.log(`Local admin password (save it now): ${password}`);
console.log('A random SESSION_SECRET and the scrypt password hash were saved to .env.');
