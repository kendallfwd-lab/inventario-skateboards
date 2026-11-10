import {useState} from 'react';
import type {CSSProperties} from 'react';

export type RailProduct={variantId:number;name:string;size:string;price:number;stock:number;sku:string;slug:string;featured?:boolean};
export function SkateDeckRail({products,onAdd,action}:{products:RailProduct[];onAdd:(p:RailProduct)=>void;action:()=>void}){
  const [grip,setGrip]=useState(false);const [active,setActive]=useState(0);const current=products[active];
  return <section className="deck-rail" aria-label="Exhibidor interactivo de tablas">
    <div className="rail-copy"><span className="eyebrow blue">COLECCIÓN DESTACADA</span><h2>Diseños que piden rodar.</h2><p>Gira la tabla, elige tu medida y llévala a tu carrito.</p><button className="button electric" onClick={action}>Explorar colección <span>↓</span></button></div>
    <div className="rail-stage"><div className="pegboard" aria-hidden="true"/><div className="metal-rail"/><div className="deck-hooks"/>
      {products.map((p,i)=><button key={p.variantId} className={`deck-card ${i===active?'selected':''}`} style={{'--deck-hue':`${i*38+185}deg`} as CSSProperties} onClick={()=>setActive(i)} aria-label={`Ver ${p.name}`}>
        <span className={`deck-art ${grip?'grip':''}`}><i/><b/><em/></span><span className="deck-tag"><strong>{p.name}</strong><small>{p.size}" · {new Intl.NumberFormat('es-CR',{style:'currency',currency:'CRC',maximumFractionDigits:0}).format(p.price)}</small></span>
      </button>)}
      {current&&<div className="rail-controls"><button className="circle-button" onClick={()=>setGrip(!grip)} aria-pressed={grip}>{grip?'Lija':'Diseño'}</button><button className="button small light" onClick={()=>onAdd(current)}>Añadir {current.name}</button></div>}
    </div>
  </section>;
}
