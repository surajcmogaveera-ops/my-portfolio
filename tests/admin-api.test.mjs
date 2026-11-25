import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { scryptSync, randomBytes } from 'node:crypto';

const port=43271;
const base=`http://127.0.0.1:${port}/api`;
const password='PortfolioDemo!2030';
const salt=randomBytes(16).toString('hex');
const hash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
let server;
let session='';
async function call(path,{method='GET',body,cookie=session}={}){
  const response=await fetch(`${base}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json(),setCookie:response.headers.get('set-cookie')};
}
before(async()=>{
  server=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','server/index.ts'],{env:{...process.env,PORT:String(port),ADMIN_PASSWORD_HASH:hash,SESSION_SECRET:'automated-test-session-secret-with-enough-entropy',CLIENT_ORIGIN:'http://localhost:5173'},stdio:'ignore'});
  let ready=false;
  for(let i=0;i<80;i++){
    if(server.exitCode!==null)throw new Error(`API exited with ${server.exitCode}`);
    try{const r=await fetch(`${base}/health`);if(r.ok){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  assert.equal(ready,true,'API starts and serves health endpoint');
});
after(()=>server?.kill());

test('protects CRUD, validates data, and updates public content',async()=>{
  assert.equal((await call('/projects',{method:'POST',body:{}})).status,401,'unauthorized writes are rejected');
  const rejected=await call('/auth/login',{method:'POST',cookie:'',body:{password:'wrong'}});
  assert.equal(rejected.status,401,'invalid admin password is rejected');
  const login=await call('/auth/login',{method:'POST',cookie:'',body:{password}});
  assert.equal(login.status,200);assert.match(login.setCookie,/HttpOnly/);session=login.setCookie.split(';')[0];

  const badSkill=await call('/skills',{method:'POST',body:{name:'Invalid',category:'Testing',level:101}});
  assert.equal(badSkill.status,400,'skill proficiency is range validated');
  const skill=await call('/skills',{method:'POST',body:{name:'API test skill',category:'Testing',level:42}});
  assert.equal(skill.status,201);assert.equal(skill.body.data.level,42);
  assert.equal((await call(`/skills/${skill.body.data.id}`,{method:'DELETE'})).status,200);

  const achievement=await call('/achievements',{method:'POST',body:{name:'API test event',award:'Shortlisted',description:'Test entry',year:'2026'}});
  assert.equal(achievement.status,201);assert.equal((await call(`/achievements/${achievement.body.data.id}`,{method:'DELETE'})).status,200);
  const education=await call('/education',{method:'POST',body:{institution:'Test University',degree:'B.Tech',branch:'CSE',year:'2030',location:'Bengaluru'}});
  assert.equal(education.status,201);assert.equal((await call(`/education/${education.body.data.id}`,{method:'DELETE'})).status,200);

  const project=await call('/projects',{method:'POST',body:{title:'API test project',summary:'CRUD check',description:'Ensures data updates publicly.',technologies:['TypeScript'],category:'AI/ML',github:'https://github.com/test/test',image:'',status:'Test',featured:true,visible:true}});
  assert.equal(project.status,201);
  const updated={...project.body.data,summary:'Updated via admin API'};delete updated.id;
  assert.equal((await call(`/projects/${project.body.data.id}`,{method:'PUT',body:updated})).status,200);
  const publicProjects=await call('/projects',{cookie:''});
  assert.equal(publicProjects.body.data.find(p=>p.id===project.body.data.id).summary,'Updated via admin API');
  await call(`/projects/${project.body.data.id}`,{method:'DELETE'});

  const hidden=await call('/projects',{method:'POST',body:{title:'Hidden test project',summary:'Visibility check',description:'Not public.',technologies:['TypeScript'],category:'AI/ML',github:'https://github.com/test/hidden',image:'data:image/png;base64,AAAA',status:'Test',featured:false,visible:false}});
  assert.equal(hidden.status,201);
  assert.equal((await call('/projects',{cookie:''})).body.data.some(p=>p.id===hidden.body.data.id),false,'hidden projects are excluded from public reads');
  assert.equal((await call(`/projects/${hidden.body.data.id}`,{method:'DELETE'})).status,200);

  const editedProfile=await call('/profile');
  assert.equal(editedProfile.status,200);
  assert.equal((await call('/profile',{method:'PUT',body:{...editedProfile.body.data,tagline:'Updated from tests.'}})).status,200);
  assert.equal((await call('/profile',{cookie:''})).body.data.tagline,'Updated from tests.');
});
