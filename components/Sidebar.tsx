'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import {
  LayoutDashboard, Package, Users, Wallet,
  ClipboardList, Settings, LogOut, Truck, Menu, X, ShieldCheck, FileText
} from 'lucide-react'
import { useState } from 'react'

const NAV = [
  { href: '/',              label: 'Dashboard',     icon: LayoutDashboard, roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/pedidos',       label: 'Pedidos',        icon: Package,         roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/repartidores',  label: 'Repartidores',   icon: Users,           roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/asignaciones',  label: 'Asignaciones',   icon: Truck,           roles: ['superadmin','admin','supervisor'] },
  { href: '/asignaciones/facturacion', label: 'Facturación SRI', icon: FileText, roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/liquidaciones', label: 'Liquidaciones',  icon: Wallet,          roles: ['superadmin','admin','supervisor','contador'] },
  { href: '/reportes',      label: 'Reportes',       icon: ClipboardList,   roles: ['superadmin','admin','contador'] },
  { href: '/usuarios',      label: 'Usuarios',       icon: ShieldCheck,     roles: ['superadmin'] },
  { href: '/configuracion', label: 'Configuración',  icon: Settings,        roles: ['superadmin'] },
]

export default function Sidebar() {
  const pathname      = usePathname()
  const { user, rol, logout } = useAuth()
  const [open, setOpen] = useState(false)

  const nombre = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Admin'
  const avatar = user?.user_metadata?.avatar_url

  const links = NAV.filter(n => !rol || n.roles.includes(rol))

  const NavLinks = () => (
    <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link key={href} href={href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
              ${active
                ? 'bg-green-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}>
            <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
            {label}
          </Link>
        )
      })}
    </nav>
  )

  const UserFooter = () => (
    <div className="px-3 py-3 border-t border-slate-200">
      <div className="flex items-center gap-3 px-2 mb-2">
        {avatar
          ? <img src={avatar} className="w-8 h-8 rounded-full" alt="" />
          : <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
              {nombre[0]?.toUpperCase()}
            </div>
        }
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{nombre}</div>
          <div className="text-[10px] text-slate-400 capitalize">{rol ?? 'Sin rol'}</div>
        </div>
      </div>
      <button onClick={logout}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-xl transition">
        <LogOut size={15} /> Cerrar sesión
      </button>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-slate-50 border-r border-slate-200 min-h-screen fixed top-0 left-0 z-30">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">🚚</div>
            <div>
              <div className="text-sm font-extrabold text-slate-800 leading-tight">Reparto</div>
              <div className="text-[10px] text-slate-400">La Crayola</div>
            </div>
          </div>
        </div>
        <NavLinks />
        <UserFooter />
      </aside>

      {/* Mobile header */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-green-600 rounded-lg flex items-center justify-center text-white text-xs">🚚</div>
          <span className="font-bold text-slate-800 text-sm">Reparto · La Crayola</span>
        </div>
        <button onClick={() => setOpen(true)} className="p-1.5 hover:bg-slate-100 rounded-lg">
          <Menu size={20} className="text-slate-600" />
        </button>
      </header>

      {/* Mobile drawer */}
      <>
        <div onClick={() => setOpen(false)}
          className={`md:hidden fixed inset-0 bg-black/40 z-40 transition-opacity ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} />
        <aside className={`md:hidden fixed top-0 left-0 h-full w-64 bg-slate-50 z-50 flex flex-col shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="px-4 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-green-600 rounded-lg flex items-center justify-center text-white text-xs">🚚</div>
              <span className="font-bold text-slate-800 text-sm">Reparto · La Crayola</span>
            </div>
            <button onClick={() => setOpen(false)}><X size={18} className="text-slate-500" /></button>
          </div>
          <NavLinks />
          <UserFooter />
        </aside>
      </>
    </>
  )
}
