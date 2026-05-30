import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ email, password }),
    }
  )

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error_description || data.msg || 'Email o contraseña incorrectos' },
      { status: 401 }
    )
  }

  return NextResponse.json({ session: data })
}
