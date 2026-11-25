import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes, scryptSync } from 'node:crypto';

const rl=createInterface({input:stdin,output:stdout});
const password=await rl.question('New admin password (input will be visible): ');
rl.close();
if(password.length<12) { console.error('Choose a password with at least 12 characters.'); process.exit(1); }
const salt=randomBytes(16).toString('hex');
console.log(`ADMIN_PASSWORD_HASH=${salt}:${scryptSync(password,salt,64).toString('hex')}`);
