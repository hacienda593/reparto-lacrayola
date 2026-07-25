import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Wallet, Truck, Receipt, ShieldCheck, Info } from 'lucide-react'

export default async function ConfiguracionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rolData } = await supabase.from('rep_roles').select('rol, activo').eq('user_id', user.id).single()
  const rol = rolData?.activo ? rolData.rol : null
  if (rol !== 'superadmin') redirect('/')

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      <main className="flex-1 md:pl-56 pt-14 md:pt-0 p-4 md:p-6 space-y-5">

        <div>
          <h1 className="text-2xl font-extrabold text-white">Configuración</h1>
          <p className="text-sm text-gray-500">Parámetros operativos actuales del sistema</p>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/25 rounded-2xl p-4 flex items-start gap-2.5">
          <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
          <p className="text-blue-300 text-xs leading-relaxed">
            Esta pantalla es informativa: muestra los valores que hoy están definidos directamente en el código
            y en la base de datos. Cambiarlos requiere editar el código fuente o la migración correspondiente —
            todavía no existe una tabla de configuración editable desde aquí.
          </p>
        </div>

        {/* Caja / bloqueo de efectivo */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
          <p className="text-gray-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"><Wallet size={13} /> Control de caja</p>
          <div className="flex justify-between text-sm border-b border-[#2d3748]/50 pb-2">
            <span className="text-gray-400">Límite de efectivo en mano antes de bloqueo</span>
            <span className="text-white font-bold">$40.00</span>
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Definido en el trigger <code className="text-gray-400">trigger_evaluar_bloqueo</code> sobre <code className="text-gray-400">rep_repartidores.efectivo_en_mano</code>
            (migración <code className="text-gray-400">migration_caja_y_bloqueo.sql</code>). Al superarse, el repartidor/comprador queda en estado BLOQUEADO
            hasta que se liquide su caja desde la pantalla de Liquidaciones.
          </p>
        </div>

        {/* Envío consolidado */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
          <p className="text-gray-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"><Truck size={13} /> Envío consolidado (app de cliente)</p>
          <div className="flex justify-between text-sm border-b border-[#2d3748]/50 pb-2">
            <span className="text-gray-400">Tarifa base (1 comercio)</span>
            <span className="text-white font-bold">$1.50</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Recargo por comercio adicional</span>
            <span className="text-white font-bold">+$0.75</span>
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Definido en <code className="text-gray-400">lib/carrito.ts</code> del proyecto tienda-lacrayola (función <code className="text-gray-400">calcularEnvioConsolidado</code>).
          </p>
        </div>

        {/* Facturación */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
          <p className="text-gray-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"><Receipt size={13} /> Datos de facturación de La Crayola</p>
          <div className="flex justify-between text-sm border-b border-[#2d3748]/50 pb-2">
            <span className="text-gray-400">Razón Social</span>
            <span className="text-white font-semibold text-right">Lilliana Maribel Gonzalez Vallejo</span>
          </div>
          <div className="flex justify-between text-sm border-b border-[#2d3748]/50 pb-2">
            <span className="text-gray-400">RUC</span>
            <span className="text-white font-mono font-semibold">1717067647001</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Correo</span>
            <span className="text-white font-mono text-xs">librerialacrayola.ec@gmail.com</span>
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Usados al registrar el comprobante de compra en <code className="text-gray-400">/caja/[id]</code>.
          </p>
        </div>

        {/* Roles */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2">
          <p className="text-gray-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"><ShieldCheck size={13} /> Roles disponibles</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {['superadmin', 'admin', 'supervisor', 'contador', 'repartidor', 'comprador-repartidor'].map(r => (
              <span key={r} className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#0c0f12] border border-[#2d3748] text-gray-300">{r}</span>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed pt-1">
            Se asignan y editan desde <a href="/usuarios" className="text-green-500 hover:underline">Usuarios</a> (tabla <code className="text-gray-500">rep_roles</code>).
          </p>
        </div>

      </main>
    </div>
  )
}
