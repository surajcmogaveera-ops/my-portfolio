import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const origin=process.env.APP_URL||'http://localhost:5173';
const api=`${process.env.VITE_API_URL||'http://localhost:4000/api'}`;
const password=process.env.ADMIN_DEMO_PASSWORD;
const chromePath=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if(!password)throw new Error('Set ADMIN_DEMO_PASSWORD to the local admin password before capturing screenshots.');
const out=resolve('screenshots');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromePath,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
await context.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());
const page=await context.newPage();
let originalProject;
let changed=false;
try{
  const list=await fetch(`${api}/projects`).then(r=>r.json());
  originalProject=list.data.find(project=>project.id==='patchpilot');
  if(!originalProject)throw new Error('Seed project PATCHPILOT was not found.');

  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.screenshot({path:resolve(out,'homepage.png'),timeout:90000,animations:'disabled'});
  await page.locator('#skills').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:resolve(out,'skills.png'),timeout:90000,animations:'disabled'});
  await page.locator('#projects').scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(out,'projects.png'),timeout:90000,animations:'disabled'});

  await page.goto(`${origin}/admin`,{waitUntil:'domcontentloaded'});
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button',{name:'Sign in'}).click();
  await page.getByRole('heading',{name:'Overview'}).waitFor({state:'visible'});
  await page.screenshot({path:resolve(out,'admin-dashboard.png'),timeout:90000,animations:'disabled'});
  await page.locator('aside').getByRole('button',{name:/Projects/}).click();
  await page.getByRole('button',{name:'Add project'}).click();
  await page.screenshot({path:resolve(out,'add-project.png'),timeout:90000,animations:'disabled'});
  await page.getByRole('button',{name:'Cancel'}).click();
  const patchpilot=page.locator('.record-row').filter({hasText:'PATCHPILOT'});
  await patchpilot.locator('button[title="Edit"]').click();
  await page.screenshot({path:resolve(out,'edit-project.png'),timeout:90000,animations:'disabled'});

  const updatedSummary='AST based Python checks and optional AI review show structured findings separately from verified issues.';
  await page.getByLabel('SHORT DESCRIPTION').fill(updatedSummary);
  changed=true;
  await page.getByRole('button',{name:/Save changes/}).click();
  await page.getByText(updatedSummary,{exact:true}).waitFor({state:'visible'});
  await page.goto(`${origin}/#projects`,{waitUntil:'domcontentloaded'});
  await page.getByText(updatedSummary,{exact:true}).waitFor({state:'visible'});
  await page.locator('#projects').scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(out,'public-after-update.png'),timeout:90000,animations:'disabled'});

  await page.setViewportSize({width:390,height:844});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('.hero h1').waitFor({state:'visible'});
  await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';window.scrollTo({top:0,behavior:'instant'})});
  const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:Array.from(document.querySelectorAll('body *')).map(el=>({tag:el.tagName,className:typeof el.className==='string'?el.className:'',right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)})).filter(el=>el.right>innerWidth+1).slice(0,12)}));
  if(layout.documentWidth>layout.width)throw new Error(`Mobile layout overflows horizontally: ${JSON.stringify(layout)}`);
  const menu=page.getByRole('button',{name:'Toggle navigation'});
  if(!await menu.isVisible())throw new Error('Mobile navigation toggle is not visible.');
  await page.screenshot({path:resolve(out,'mobile-homepage.png'),timeout:90000,animations:'disabled'});
  await menu.click();
  if(!await page.locator('.nav-links.open').isVisible())throw new Error('Mobile navigation did not open.');
  await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';window.scrollTo({top:0,behavior:'instant'})});
  await page.waitForTimeout(100);
  await page.screenshot({path:resolve(out,'mobile-navigation.png'),timeout:90000,animations:'disabled'});
  console.log(`Screenshots saved in ${out}`);
}finally{
  if(changed&&originalProject){
    const {id,...body}=originalProject;
    const response=await context.request.put(`${api}/projects/${id}`,{data:body});
    if(!response.ok())console.error('Could not restore the original PATCHPILOT summary; restart the API to restore seed data.');
  }
  await context.close();
  await browser.close();
}
