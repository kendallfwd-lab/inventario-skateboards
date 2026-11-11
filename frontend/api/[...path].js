function backendUrl(){
  const value=process.env.BACKEND_URL?.trim().replace(/\/+$/,'');
  if(!value)throw new Error('BACKEND_URL no está configurada en Vercel');
  return value;
}

function readBody(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];
    req.on('data',chunk=>chunks.push(Buffer.from(chunk)));
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}

export default async function handler(req,res){
  try{
    const path=Array.isArray(req.query?.path)?req.query.path.join('/'):(req.query?.path||'');
    const incomingUrl=new URL(req.url||'/', 'http://vercel.local');
    const target=`${backendUrl()}/api/${path}${incomingUrl.search}`;
    const headers=new Headers();
    for(const [name,value] of Object.entries(req.headers)){
      if(!value||['host','content-length','connection'].includes(name))continue;
      headers.set(name,Array.isArray(value)?value.join(', '):value);
    }
    const method=req.method||'GET';
    const body=['GET','HEAD'].includes(method)?undefined:await readBody(req);
    const upstream=await fetch(target,{method,headers,body});
    res.statusCode=upstream.status;
    const contentType=upstream.headers.get('content-type');
    if(contentType)res.setHeader('content-type',contentType);
    const cookies=typeof upstream.headers.getSetCookie==='function'?upstream.headers.getSetCookie():[];
    const cookieHeader=upstream.headers.get('set-cookie');
    if(cookies.length)res.setHeader('set-cookie',cookies);
    else if(cookieHeader)res.setHeader('set-cookie',cookieHeader);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  }catch(error){
    const message=error instanceof Error?error.message:'Error de conexión con el backend';
    console.error('Vercel API proxy error:',message);
    res.statusCode=503;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.end(JSON.stringify({error:'API no disponible'}));
  }
}
