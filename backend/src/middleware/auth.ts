import {createHash} from 'node:crypto';
import type {Request,Response,NextFunction} from 'express';
import {pool} from '../db/connection.js';
import {env} from '../config/env.js';

export type AuthedRequest=Request<any>&{user?:{id:number,name:string,email:string,roles:string[]}};
export async function requireAuth(req:AuthedRequest,res:Response,next:NextFunction){try{const token=req.cookies?.dv_session;if(!token)return res.status(401).json({error:'Autenticación requerida'});const hash=createHash('sha256').update(token).digest('hex');const [rows]=await pool.execute<any[]>('SELECT u.id,u.nombre,u.email,GROUP_CONCAT(r.codigo) roles FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id JOIN usuario_rol ur ON ur.usuario_id=u.id JOIN roles r ON r.id=ur.rol_id WHERE s.token_hash=? AND s.expira_en>UTC_TIMESTAMP() AND u.activo=1 GROUP BY u.id',[hash]);if(!rows.length)return res.status(401).json({error:'Sesión vencida o inválida'});req.user={id:rows[0].id,name:rows[0].nombre,email:rows[0].email,roles:String(rows[0].roles).split(',')};next();}catch(e){next(e)}}
export function allowRoles(...roles:string[]){return (req:AuthedRequest,res:Response,next:NextFunction)=>{if(!req.user?.roles.some(r=>roles.includes(r)))return res.status(403).json({error:'Permisos insuficientes'});next();};}
export function sameOrigin(req:Request,res:Response,next:NextFunction){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const origin=req.get('origin');if(origin&&!env.allowedOrigins.includes(origin))return res.status(403).json({error:'Origen no permitido'});next();}
