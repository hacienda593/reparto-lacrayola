import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

const MAX_REDIRECTS = 4

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    cookies:{getAll(){return req.cookies.getAll()},setAll(cs){cs.forEach(({name,value})=>req.cookies.set(name,value));res=NextResponse.next({request:req});cs.forEach(({name,value,options})=>res.cookies.set(name,value,options))}},
  })
  const {data:{user}}=await supabase.auth.getUser()
  const path=req.nextUrl.pathname,redirectCount=Number(req.cookies.get('mw_rc')?.value??'0')
  function irA(destino:string){if(redirectCount>=MAX_REDIRECTS){res.cookies.set('mw_rc','0',{maxAge:5});return res}const r=NextResponse.redirect(new URL(destino,req.url));r.cookies.set('mw_rc',String(redirectCount+1),{maxAge:5});return r}
  if(path==='/login'){if(user)return irA('/');res.cookies.set('mw_rc','0',{maxAge:5});return res}
  if(!user)return irA('/login')
  res.cookies.set('mw_rc','0',{maxAge:5});return res
}

export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png|api/).*)']}
