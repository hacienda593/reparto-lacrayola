'use client'
import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

interface Props {
  data: string
  size?: number
  className?: string
}

export default function QrCode({ data, size = 192, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    QRCode.toCanvas(canvasRef.current, data, {
      width: size,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    })
  }, [data, size])

  return <canvas ref={canvasRef} className={className} />
}
