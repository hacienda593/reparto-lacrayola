'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { LayoutDashboard, Package, Users, Wallet, ClipboardList, Settings, LogOut, Truck, Menu, X, ShieldCheck, FileText, Scale, Radar, Banknote } from 'lucide-react'

const NAV = [
  { href: '/', label: 'Centro operativo', icon: LayoutDashboard, group: 'Operación', roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/control', label: 'Control 360', icon: Radar, group: 'Operación', roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/asignaciones', label: 'Despacho y control', icon: Truck, group: 'Operación', roles: ['superadmin','admin','supervisor'] },
  { href: '/pedidos', label: 'Pedidos', icon: Package, group: 'Operación', roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/repartidores', label: 'Equipo', icon: Users, group: 'Personal', roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/liquidaciones', label: 'Caja y liquidaciones', icon: Wallet, group: 'Finanzas', roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/conciliacion-bancaria', label: 'Conciliación bancaria', icon: Banknote, group: 'Finanzas', roles: ['superadmin','admin','contador'] },
  { href: '/facturas-compra', label: 'Facturas de compra', icon: FileText, group: 'Finanzas', roles: ['superadmin','admin','contador'] },
  { href: '/estado-cuenta', label: 'Liquidar comisiones', icon: Scale, group: 'Finanzas', roles: ['superadmin','admin','contador'] },
  { href: '/asignaciones/facturacion', label: 'Facturación SRI', icon: FileText, group: 'Finanzas', roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/reportes', label: 'Analítica', icon: ClipboardList, group: 'Análisis', roles: ['superadmin','admin','contador'] },
  { href: '/usuarios', label: 'Usuarios', icon: ShieldCheck, group: 'Administración', roles: ['superadmin'] },
  { href: '/configuracion', label: 'Configuración', icon: Settings, group: 'Administración', roles: ['superadmin'] },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { user, rol, estado, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const nombre = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Admin'
  const avatar = user?.user_metadata?.avatar_url
  // FUN-02 de la auditoría: con "!rol" pasaban TODOS los enlaces (incluidos
  // Usuarios/Configuración, solo superadmin) mientras el rol todavía no se
  // resolvía -- una ventana breve pero real donde se veían opciones
  // sensibles antes de saber si corresponden. Ahora no se muestra nada
  // hasta tener el rol real (la propia página, además, valida su
  // capacidad en servidor -- esto es solo la navegación).
  const links = NAV.filter(n => rol && n.roles.includes(rol))
  const groups = [...new Set(links.map(link => link.group))]
  // Solo una opción puede estar activa. Elegimos la coincidencia más
  // específica para que /asignaciones no se marque también cuando el usuario
  // está en /asignaciones/facturacion.
  const activeHref = links
    .filter(link => link.href === '/' ? pathname === '/' : pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a,b) => b.href.length-a.href.length)[0]?.href

  // Distingue "todavía cargando el rol" de "ya se confirmó que no tiene
  // rol" -- lo primero se ve como progreso normal, no como un menú roto.
  // No cambia qué se muestra: sigue sin haber NINGÚN enlace hasta
  // confirmar el rol real, solo evita que la pantalla se vea vacía/rota.
  const NavLinks = () => <nav className="flex-1 overflow-y-auto px-3 py-4">
    {estado === 'cargando' && (
      <div className="space-y-2 px-3 animate-pulse" aria-label="Cargando menú">
        {[1,2,3,4].map(i => <div key={i} className="h-8 rounded-xl bg-slate-200/70" />)}
      </div>
    )}
    {groups.map(group => <div key={group} className="mb-4">
      <p className="px-3 pb-1.5 text-[9px] font-black uppercase tracking-[.18em] text-slate-400">{group}</p>
      <div className="space-y-1">{links.filter(link => link.group === group).map(({ href, label, icon: Icon }) => {
        const active = href === activeHref
        return <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${active ? 'bg-green-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}><Icon size={18} strokeWidth={active ? 2.5 : 1.8}/>{label}</Link>
      })}</div>
    </div>)}
  </nav>

  const UserFooter = () => <div className="border-t border-slate-200 px-3 py-3">
    <div className="mb-2 flex items-center gap-3 px-2">{avatar ? <img src={avatar} className="h-8 w-8 rounded-full" alt=""/> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">{nombre[0]?.toUpperCase()}</div>}<div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-800">{nombre}</div><div className="text-[10px] capitalize text-slate-400">{rol ?? 'Sin rol'}</div></div></div>
    <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-500 transition hover:bg-red-50"><LogOut size={15}/> Cerrar sesión</button>
  </div>

  const Brand = () => <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-sm font-bold text-white">LC</div><div><div className="text-sm font-extrabold leading-tight text-slate-800">Reparto</div><div className="text-[10px] text-slate-400">La Crayola</div></div></div>

  return <>
    <aside className="fixed left-0 top-0 z-30 hidden min-h-screen w-56 flex-col border-r border-slate-200 bg-slate-50 md:flex"><div className="border-b border-slate-200 px-5 py-4">{Brand()}</div>{NavLinks()}{UserFooter()}</aside>
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">{Brand()}<button onClick={()=>setOpen(true)} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="Abrir menú"><Menu size={20} className="text-slate-600"/></button></header>
    <div onClick={()=>setOpen(false)} className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}/>
    <aside className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-slate-50 shadow-2xl transition-transform duration-300 md:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}><div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">{Brand()}<button onClick={()=>setOpen(false)} aria-label="Cerrar menú"><X size={18} className="text-slate-500"/></button></div>{NavLinks()}{UserFooter()}</aside>
  </>
}
