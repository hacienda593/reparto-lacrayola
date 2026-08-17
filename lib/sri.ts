import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'

const ENDPOINT='https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline'
// SEC-07 de la auditoría: processEntities:true permite expandir entidades
// XML personalizadas -- las facturas SRI nunca las usan (solo las 5
// básicas &amp; &lt; etc., que fast-xml-parser siempre decodifica sin
// este flag). Desactivarlo cierra esa superficie de ataque sin perder
// nada -- se trata la respuesta del SRI como entrada externa, aunque en
// condiciones normales venga de una fuente confiable.
const parser=new XMLParser({ignoreAttributes:false,processEntities:false,trimValues:true})
const arr=<T>(v:T|T[]|undefined):T[]=>v===undefined?[]:Array.isArray(v)?v:[v]
type XmlNode=Record<string,unknown>
const node=(v:unknown):XmlNode=>v!==null&&typeof v==='object'?v as XmlNode:{}
const at=(v:unknown,key:string):unknown=>node(v)[key]

export function validarClaveAcceso(clave:string){
 if(!/^\d{49}$/.test(clave))return false
 let suma=0,factor=2;for(let i=47;i>=0;i--){suma+=Number(clave[i])*factor;factor=factor===7?2:factor+1}
 let d=11-(suma%11);if(d===11)d=0;if(d===10)d=1;return Number(clave[48])===d
}
export type SriFactura={estado:string;claveAcceso:string;numeroAutorizacion:string;fechaAutorizacion:string|null;ambiente:string;rucEmisor:string;razonSocialEmisor:string;identificacionComprador:string;razonSocialComprador:string;establecimiento:string;puntoEmision:string;secuencial:string;fechaEmision:string;subtotal:number;descuento:number;iva:number;total:number;xml:string;sha256:string;detalles:Array<{codigo:string;descripcion:string;cantidad:number;precioUnitario:number;descuento:number;precioTotal:number}>}

export async function consultarFacturaSri(clave:string):Promise<SriFactura>{
 if(!validarClaveAcceso(clave))throw new Error('La clave no supera la validación de 49 dígitos y módulo 11')
 const envelope=`<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion"><soapenv:Header/><soapenv:Body><ec:autorizacionComprobante><claveAccesoComprobante>${clave}</claveAccesoComprobante></ec:autorizacionComprobante></soapenv:Body></soapenv:Envelope>`
 const response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'text/xml;charset=UTF-8','SOAPAction':''},body:envelope,signal:AbortSignal.timeout(20000),cache:'no-store'})
 if(!response.ok)throw new Error(`El SRI respondió HTTP ${response.status}`)
	 const textoRespuesta=await response.text()
	 // Límite de cordura: una respuesta SOAP normal del SRI pesa unos pocos
	 // KB. Un XML de varios MB no es una factura real -- se rechaza antes
	 // de parsear, en vez de dejar que el parser procese algo anómalo.
	 if(textoRespuesta.length>2_000_000)throw new Error('La respuesta del SRI es anormalmente grande')
	 const soap=node(parser.parse(textoRespuesta))
	 const body=at(at(soap,'soap:Envelope'),'soap:Body')??at(at(soap,'soapenv:Envelope'),'soapenv:Body')
	 const responseNode=at(body,'ns2:autorizacionComprobanteResponse')??at(body,'autorizacionComprobanteResponse')
	 const root=at(responseNode,'RespuestaAutorizacionComprobante')
	 const autorizaciones=arr(at(at(root,'autorizaciones'),'autorizacion')).map(node)
	 const aut=autorizaciones.find(x=>String(x.estado).toUpperCase()==='AUTORIZADO')??autorizaciones[0]
 if(!aut)throw new Error('El SRI no devolvió una autorización para esta clave')
 const estado=String(aut.estado??'DESCONOCIDO').toUpperCase()
	 if(estado!=='AUTORIZADO')throw new Error(`Comprobante ${estado}: ${arr(at(at(aut,'mensajes'),'mensaje')).map(m=>String(at(m,'mensaje')??'')).filter(Boolean).join('; ')||'sin detalle'}`)
 const xml=String(aut.comprobante??'').trim();if(!xml.startsWith('<'))throw new Error('El SRI no devolvió el XML del comprobante')
	 const f=node(at(node(parser.parse(xml)),'factura'));if(!Object.keys(f).length)throw new Error('El XML autorizado no corresponde a una factura')
	 const t=node(f.infoTributaria),i=node(f.infoFactura)
	 const impuestos=arr(at(at(i,'totalConImpuestos'),'totalImpuesto')).map(node)
	 const detalles=arr(at(at(f,'detalles'),'detalle')).map(node).map(d=>({codigo:String(d.codigoPrincipal??''),descripcion:String(d.descripcion??''),cantidad:Number(d.cantidad??0),precioUnitario:Number(d.precioUnitario??0),descuento:Number(d.descuento??0),precioTotal:Number(d.precioTotalSinImpuesto??0)}))
 return {estado,claveAcceso:String(t.claveAcceso??clave),numeroAutorizacion:String(aut.numeroAutorizacion??clave),fechaAutorizacion:aut.fechaAutorizacion?String(aut.fechaAutorizacion):null,ambiente:String(aut.ambiente??t.ambiente??''),rucEmisor:String(t.ruc??''),razonSocialEmisor:String(t.razonSocial??''),identificacionComprador:String(i.identificacionComprador??''),razonSocialComprador:String(i.razonSocialComprador??''),establecimiento:String(t.estab??''),puntoEmision:String(t.ptoEmi??''),secuencial:String(t.secuencial??''),fechaEmision:String(i.fechaEmision??''),subtotal:Number(i.totalSinImpuestos??0),descuento:Number(i.totalDescuento??0),iva:impuestos.reduce((s,x)=>s+Number(x.valor??0),0),total:Number(i.importeTotal??0),xml,sha256:createHash('sha256').update(xml).digest('hex'),detalles}
}
