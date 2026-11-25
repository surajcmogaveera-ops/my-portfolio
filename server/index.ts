import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { store } from './data.js';

const scrypt = promisify(scryptCb);
const app = express();
const port = Number(process.env.PORT || 4000);
const sessionSecret = process.env.SESSION_SECRET || '';
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(x=>x.trim());
app.use(helmet());
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) callback(null, true); else callback(new Error('Origin is not allowed.')); }, credentials:true }));
app.use(express.json({ limit:'6mb' }));

type Entity = 'projects'|'skills'|'achievements'|'education';
const cookieName='portfolio_admin';
const setCookie=(res:Response, value:string, maxAge:number) => res.append('Set-Cookie', `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);
const clearCookie=(res:Response) => res.append('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);
function sign(payload:string) { return createHmac('sha256',sessionSecret).update(payload).digest('hex'); }
function cookie(req:Request) { const raw=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`)); return raw?.slice(cookieName.length+1)||''; }
function authenticated(req:Request) {
  if (!sessionSecret) return false;
  const [payload, signature]=cookie(req).split('.');
  const expectedSignature=payload?sign(payload):'';
  if (!payload || !signature || signature.length!==expectedSignature.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expectedSignature))) return false;
  const [subject,expiry]=Buffer.from(payload,'base64url').toString().split(':');
  return subject==='admin' && Number(expiry)>Date.now();
}
function requireAdmin(req:Request,res:Response,next:NextFunction) {
  if (!authenticated(req)) return res.status(401).json({error:{code:'UNAUTHORIZED',message:'Sign in to manage portfolio content.'}});
  next();
}

const text=z.string().trim().min(1).max(5000);
const imageText=z.string().max(4_000_000);
const safeUrl=z.string().trim().url().max(2000).or(z.literal(''));
const profileSchema=z.object({ name:text, professionalName:text, title:text, tagline:text, introduction:text, about:text, location:text, college:text, degree:text, branch:text, academicYear:text, graduation:text, image:imageText, github:safeUrl, linkedin:safeUrl }).strict();
const projectSchema=z.object({title:text,summary:text,description:text,technologies:z.array(z.string().trim().min(1).max(80)).max(30),category:text,github:safeUrl,image:imageText,status:text,featured:z.boolean(),visible:z.boolean()}).strict();
const skillSchema=z.object({name:text,category:text,level:z.number().int().min(0).max(100)}).strict();
const achievementSchema=z.object({name:text,award:text,description:text,year:z.string().trim().min(1).max(30)}).strict();
const educationSchema=z.object({institution:text,degree:text,branch:text,year:text,location:text}).strict();
const schemas={projects:projectSchema,skills:skillSchema,achievements:achievementSchema,education:educationSchema};
const collections:Record<Entity, any[]>={projects:store.projects,skills:store.skills,achievements:store.achievements,education:store.education};
const wrap=(handler:(req:Request,res:Response)=>unknown)=>(req:Request,res:Response,next:NextFunction)=>Promise.resolve(handler(req,res)).catch(next);
const respond=(res:Response,data:unknown,status=200)=>res.status(status).json({data});

app.get('/api/health',(_req,res)=>respond(res,{status:'ok'}));
app.post('/api/auth/login',wrap(async(req,res)=>{
  const parsed=z.object({password:z.string().min(1).max(300)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Enter your admin password.'}});
  const [salt,expected]=(process.env.ADMIN_PASSWORD_HASH||'').split(':');
  if(!sessionSecret||!salt||!expected)return res.status(503).json({error:{code:'AUTH_NOT_CONFIGURED',message:'Admin authentication is not configured. Add ADMIN_PASSWORD_HASH and SESSION_SECRET to the server environment.'}});
  const actual=await scrypt(parsed.data.password,salt,64) as Buffer;
  const expectedBuf=Buffer.from(expected,'hex');
  if(expectedBuf.length!==actual.length||!timingSafeEqual(actual,expectedBuf))return res.status(401).json({error:{code:'INVALID_CREDENTIALS',message:'Password was not accepted.'}});
  const payload=Buffer.from(`admin:${Date.now()+8*60*60*1000}`).toString('base64url');
  setCookie(res,`${payload}.${sign(payload)}`,8*60*60);
  respond(res,{authenticated:true});
}));
app.get('/api/auth/session',(req,res)=>respond(res,{authenticated:authenticated(req)}));
app.post('/api/auth/logout',(req,res)=>{clearCookie(res);respond(res,{authenticated:false});});

app.get('/api/profile',(_req,res)=>respond(res,store.profile));
app.put('/api/profile',requireAdmin,(req,res)=>{
  const parsed=profileSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Profile fields are invalid.',details:parsed.error.flatten()}});
  Object.assign(store.profile,parsed.data); respond(res,store.profile);
});
for(const entity of Object.keys(collections) as Entity[]) {
  const list=collections[entity]; const schema=schemas[entity];
  app.get(`/api/${entity}`,(req,res)=>respond(res,entity==='projects'&&!authenticated(req)?list.filter(p=>p.visible):list));
  app.get(`/api/${entity}/:id`,(req,res)=>{const row=list.find(item=>item.id===req.params.id);if(!row||entity==='projects'&&!row.visible&&!authenticated(req))return res.status(404).json({error:{code:'NOT_FOUND',message:`${entity} record was not found.`}});respond(res,row);});
  app.post(`/api/${entity}`,requireAdmin,(req,res)=>{const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Submitted fields are invalid.',details:parsed.error.flatten()}});const item={id:randomBytes(9).toString('hex'),...parsed.data};list.unshift(item);respond(res,item,201);});
  app.put(`/api/${entity}/:id`,requireAdmin,(req,res)=>{const i=list.findIndex(item=>item.id===req.params.id);if(i<0)return res.status(404).json({error:{code:'NOT_FOUND',message:`${entity} record was not found.`}});const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Submitted fields are invalid.',details:parsed.error.flatten()}});list[i]={...list[i],...parsed.data};respond(res,list[i]);});
  app.delete(`/api/${entity}/:id`,requireAdmin,(req,res)=>{const i=list.findIndex(item=>item.id===req.params.id);if(i<0)return res.status(404).json({error:{code:'NOT_FOUND',message:`${entity} record was not found.`}});const [deleted]=list.splice(i,1);respond(res,deleted);});
}
app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'API route was not found.'}}));
app.use((err:Error,_req:Request,res:Response,_next:NextFunction)=>{console.error(err.message);res.status(500).json({error:{code:'INTERNAL_ERROR',message:'The server could not complete this request.'}});});
app.listen(port,()=>console.log(`Portfolio API listening on http://localhost:${port}`));
