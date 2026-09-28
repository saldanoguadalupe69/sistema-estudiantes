/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES_C = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
const TIPO = {parcial:"Parcial", recu:"Recuperatorio", final:"Final", entrega:"Entrega", propio:"Personal"};
const ESTADOS = {cursando:"Cursando", regular:"Regular (debo final)", promocion:"Promocionada", aprobada:"Aprobada", libre:"Libre"};
function hoyISO(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function parseISO(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function diasHasta(s){ const a=parseISO(hoyISO()), b=parseISO(s); return Math.round((b-a)/86400000); }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),2200); }

/* ---------- estado ---------- */
const S = {
  materias:{}, eventos:{},
  perfil:{ materias:[], catMaterias:{}, catEventos:{}, carrera:"", universidad:"", estados:{}, notas:{}, notasFinal:{}, resumenes:[], propios:[], leido:{}, recordar:3, planDias:[1,2,3,4,5,6], plan:null },
  isAdmin:false, mode:"local", filtroRes:"todas", calMes:new Date(),
  openRes:new Set(), me:null, userApi:null, dir:{}, fr:{res:{},dudas:{},resp:{}}, names:{}, q:"", hits:[],
  filtroResAmigos:"", filtroDudaMat:"", filtroDudaEstado:"todas", openResp:new Set(), grupos:{}, chatMsgs:{}, chatActivo:null
};
S.calMes.setDate(1);

/* ---------- almacenamiento (db compartida + perfil privado; localStorage si no hay db) ---------- */
const Store = {
  db:null, uid:null, listeners:{},
  lsGet(k){ try{ return JSON.parse(localStorage.getItem("se:"+k)) }catch(e){ return null } },
  lsSet(k,v){ try{ localStorage.setItem("se:"+k, JSON.stringify(v)) }catch(e){} },
  subscribe(col, cb){
    if(this.db){
      this.db.collection(col).onSnapshot(snap=>{
        const o={}; snap.docs.forEach(d=>{ o[d.id]={id:d.id, ...d.data()} }); cb(o);
      }, err=>{ console.warn(col, err); });
    } else {
      this.listeners[col]=cb; cb(this.lsGet(col)||{});
    }
  },
  async save(col,id,data){
    if(this.db){ await this.db.doc(col+"/"+id).set(data); }
    else { const o=this.lsGet(col)||{}; o[id]={id,...data}; this.lsSet(col,o); this.listeners[col]?.(o); }
  },
  async remove(col,id){
    if(this.db){ await this.db.doc(col+"/"+id).delete(); }
    else { const o=this.lsGet(col)||{}; delete o[id]; this.lsSet(col,o); this.listeners[col]?.(o); }
  },
  async loadPerfil(){
    if(this.db && this.uid){
      const s = await this.db.doc("data/users/"+this.uid+"/perfil").get();
      return s.exists ? s.data() : null;
    }
    return this.lsGet("perfil");
  },
  _chain:Promise.resolve(), _dirty:false,
  savePerfil(){
    if(!(this.db && this.uid)){ this.lsSet("perfil", S.perfil); return; }
    if(this._dirty) return; this._dirty=true;
    this._chain = this._chain.then(async ()=>{
      await new Promise(r=>setTimeout(r,400));
      this._dirty=false;
      try{ await this.db.doc("data/users/"+this.uid+"/perfil").set(JSON.parse(JSON.stringify(S.perfil))); }
      catch(e){ console.error("Error al guardar:", e); toast("No se pudo guardar ("+(e?.code||e?.message||"error")+")"); }
    });
  }
};
const norm = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
// Cada estudiante tiene sus propias materias y fechas (guardadas en su perfil privado)
function derivar(){
  S.perfil.catMaterias = S.perfil.catMaterias || {};
  S.perfil.catEventos = S.perfil.catEventos || {};
  S.materias = S.perfil.catMaterias;
  S.eventos = S.perfil.catEventos;
  S.perfil.materias = Object.keys(S.materias);
}
function dirPublico(){ return { materias:[...new Set(Object.values(S.materias).map(m=>norm(m.nombre)))].sort(), carrera:S.perfil.carrera||"", universidad:S.perfil.universidad||"" }; }
function perfilCambio(){
  derivar();
  Store.savePerfil();
  if(S.me){ const d=myDir(), p=dirPublico();
    if(JSON.stringify(d.materias||[])!==JSON.stringify(p.materias) || (d.carrera||"")!==p.carrera || (d.universidad||"")!==p.universidad) saveMyDir(p); }
  renderAll();
}


/* ---------- helpers de datos ---------- */
const materiasOrdenadas = () => Object.values(S.materias).sort((a,b)=>(a.anio-b.anio)||a.nombre.localeCompare(b.nombre));
const misMaterias = () => S.perfil.materias.filter(id=>S.materias[id]).map(id=>S.materias[id]);
const colorDe = id => S.materias[id]?.color || "#7A8599";
const nombreDe = id => S.materias[id]?.nombre || "Sin materia";
const matNombre = x => x.materiaNombre || nombreDe(x.materiaId);
const matColor = x => x.materiaColor || colorDe(x.materiaId);
function todosEventos({soloMias=true}={}){
  const mias = new Set(S.perfil.materias);
  const evs = Object.values(S.eventos).filter(e=>!soloMias || mias.has(e.materiaId));
  const propios = S.perfil.propios.map(p=>({...p, tipo:"propio"}));
  return [...evs, ...propios].sort((a,b)=>(a.fecha+(a.hora||"")).localeCompare(b.fecha+(b.hora||"")));
}
function estadoDe(id){ return S.perfil.estados[id] || "cursando"; }

/* ---------- render ---------- */
function renderHero(){
  const prox = todosEventos().filter(e=>e.tipo!=="propio" && diasHasta(e.fecha)>=0)[0];
  const h=$("#hero");
  if(!prox){
    h.classList.add("empty"); $("#heroDays").textContent="—";
    $("#heroWhat").textContent = S.perfil.materias.length ? "No tenés exámenes cargados por ahora." : "Cargá tus materias y fechas, y acá vas a ver cuánto falta para tu próximo examen.";
    $("#heroMeta").textContent=""; return;
  }
  h.classList.remove("empty");
  const d=diasHasta(prox.fecha);
  $("#heroDays").innerHTML = d===0 ? "<mark>Hoy</mark>" : d===1 ? "<mark>Mañana</mark>" : `<mark>${d}</mark> días`;
  $("#heroWhat").textContent = `${prox.titulo} de ${nombreDe(prox.materiaId)}`;
  const f=parseISO(prox.fecha);
  const res = S.perfil.resumenes.filter(r=>r.materiaId===prox.materiaId);
  const hechos = res.filter(r=>r.hecho).length;
  $("#heroMeta").textContent = `${f.getDate()} de ${MESES[f.getMonth()]}${prox.hora?" · "+prox.hora+" h":""}${prox.aula?" · Aula "+prox.aula:""}${res.length?` · Resúmenes: ${hechos} de ${res.length} hechos`:""}`;
}

function eventoRow(e, {borrar}={}){
  const d=diasHasta(e.fecha), f=parseISO(e.fecha);
  const cls = d<0?"past":(d<=7?"soon":"");
  const nota = e.tipo!=="propio" && e.tipo!=="entrega" && d<0
    ? `<label style="width:84px">Nota<input type="number" min="1" max="10" step="0.5" data-nota="${e.id}" value="${esc(S.perfil.notas[e.id]??"")}"></label>` : "";
  return `<li class="row">
    <div class="date ${cls}"><b>${f.getDate()}</b><small>${MES_C[f.getMonth()]}</small></div>
    <div class="grow">
      <div><span class="dot" style="background:${esc(colorDe(e.materiaId))}"></span><b>${esc(e.titulo)}</b> <span class="tag ${e.tipo}">${TIPO[e.tipo]||e.tipo}</span></div>
      <div class="sub">${esc(nombreDe(e.materiaId))}${e.hora?" · "+esc(e.hora)+" h":""}${e.aula?" · Aula "+esc(e.aula):""}${d>=0?` · ${d===0?"hoy":d===1?"mañana":"en "+d+" días"}`:""}</div>
      ${e.temas?`<div class="sub">Temas: ${esc(e.temas)}</div>`:""}
      ${d>=0?`<a class="cal-link" href="${esc(gcalLink(e))}" target="_blank" rel="noopener">+ Agregar a Google Calendar</a>`:""}
    </div>${nota}
    ${borrar?`<button class="btn danger small" data-del="${borrar}" data-id="${e.id}" aria-label="Borrar">Borrar</button>`:""}
  </li>`;
}

function renderInicio(){
  const mias=misMaterias();
  const res=S.perfil.resumenes.filter(r=>S.materias[r.materiaId]);
  const hechos=res.filter(r=>r.hecho).length;
  const pendFin = mias.filter(m=>estadoDe(m.id)==="regular").length + Object.values(S.materias).filter(m=>!S.perfil.materias.includes(m.id)&&S.perfil.estados[m.id]==="regular").length;
  const notasF = Object.values(S.perfil.notasFinal).map(Number).filter(n=>n>=4);
  const prom = notasF.length ? (notasF.reduce((a,b)=>a+b,0)/notasF.length).toFixed(2) : "—";
  $("#stats").innerHTML = `
    <div><div class="stat">${mias.filter(m=>estadoDe(m.id)==="cursando").length}</div><div class="sub">materias cursando</div></div>
    <div><div class="stat">${hechos}/${res.length}</div><div class="sub">resúmenes hechos</div></div>
    <div><div class="stat">${pendFin}</div><div class="sub">finales pendientes</div></div>
    <div><div class="stat">${prom}</div><div class="sub">promedio</div></div>`;
  const fc=$("#fCarrera"); ["carrera","universidad"].forEach(k=>{ if(document.activeElement!==fc[k]) fc[k].value=S.perfil[k]||""; });
  const prox = todosEventos().filter(e=>diasHasta(e.fecha)>=0).slice(0,8);
  $("#proximas").innerHTML = prox.length ? prox.map(e=>eventoRow(e)).join("") : `<li class="empty-msg">${mias.length?"No hay fechas próximas. Cargalas desde Calendario.":"Empezá cargando tus materias en “Mis materias”."}</li>`;
}

function renderCalendario(){
  const m=S.calMes, y=m.getFullYear(), mo=m.getMonth();
  $("#calTitle").textContent = `${MESES[mo][0].toUpperCase()+MESES[mo].slice(1)} ${y}`;
  const first=new Date(y,mo,1); const start=new Date(first); start.setDate(1-((first.getDay()+6)%7));
  const evs = todosEventos(); const byDay={};
  evs.forEach(e=>{ (byDay[e.fecha]=byDay[e.fecha]||[]).push(e) });
  const hoy=hoyISO();
  let html = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d=>`<div class="dh">${d}</div>`).join("");
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const list=(byDay[iso]||[]).map(e=>`<span class="ev" style="background:${esc(colorDe(e.materiaId))}" title="${esc(e.titulo+" – "+nombreDe(e.materiaId))}">${esc(e.titulo)}</span>`).join("");
    html += `<div class="d ${d.getMonth()!==mo?"out":""} ${iso===hoy?"today":""}"><span class="n">${d.getDate()}</span>${list}</div>`;
  }
  $("#cal").innerHTML=html;

}

function renderMaterias(){
  const mias=misMaterias();
  $("#misMaterias").innerHTML = mias.map(m=>{
    const res=S.perfil.resumenes.filter(r=>r.materiaId===m.id); const h=res.filter(r=>r.hecho).length;
    const pct=res.length?Math.round(h/res.length*100):0;
    const prox=todosEventos().filter(e=>e.materiaId===m.id && e.tipo!=="propio" && diasHasta(e.fecha)>=0)[0];
    const notas=Object.values(S.eventos).filter(e=>e.materiaId===m.id && S.perfil.notas[e.id]!=null && S.perfil.notas[e.id]!=="");
    return `<div class="box mat-card" style="--c:${esc(m.color)}">
      <h3>${esc(m.nombre)}</h3>
      <div class="sub">${m.anio}º año · ${m.cuatri==="A"?"Anual":m.cuatri+"º cuatrimestre"}${m.profesor?" · "+esc(m.profesor):""}</div>
      <label style="margin-top:12px">Estado<select data-estado="${m.id}">${Object.entries(ESTADOS).map(([k,v])=>`<option value="${k}" ${estadoDe(m.id)===k?"selected":""}>${v}</option>`).join("")}</select></label>
      <div style="margin-top:12px" class="sub">Resúmenes ${h}/${res.length}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="sub" style="margin-top:10px">${prox?`Próximo: <b>${esc(prox.titulo)}</b> en ${diasHasta(prox.fecha)} días`:"Sin exámenes próximos"}</div>
      ${notas.length?`<div class="sub">Notas: ${notas.map(e=>esc(e.titulo)+" <b>"+esc(S.perfil.notas[e.id])+"</b>").join(", ")}</div>`:""}
    </div>`;
  }).join("") || `<p class="empty-msg">Todavía no cargaste materias. Usá el formulario de arriba.</p>`;
}

function fillSelects(){
  const mias=misMaterias();
  $$(".selMisMaterias").forEach(sel=>{
    const v=sel.value;
    sel.innerHTML = mias.length ? mias.map(m=>`<option value="${m.id}">${esc(m.nombre)}</option>`).join("") : `<option value="">Primero cargá tus materias</option>`;
    if(mias.some(m=>m.id===v)) sel.value=v;
  });
  const todas = materiasOrdenadas().map(m=>`<option value="${m.id}">${esc(m.nombre)}</option>`).join("");
  $$(".selTodas").forEach(s=>{ const v=s.value;
    s.innerHTML = todas || `<option value="">Primero cargá tus materias</option>`;
    if(S.materias[v]) s.value=v; });
  // filtros por nombre de materia (sirve entre carreras distintas)
  const nombres=new Map();
  materiasOrdenadas().forEach(m=>nombres.set(norm(m.nombre), m.nombre));
  [S.fr.res, S.fr.dudas].forEach(src=>Object.values(src).forEach(o=>Object.values(o).forEach(r=>{ const n=norm(matNombre(r)); if(!nombres.has(n)) nombres.set(n, matNombre(r)); })));
  const filt = `<option value="">Todas</option>`+[...nombres].map(([k,v])=>`<option value="${esc(k)}">${esc(v)}</option>`).join("");
  [["#filtroResAmigos","filtroResAmigos"],["#filtroDudaMat","filtroDudaMat"]].forEach(([sel,k])=>{ const s=$(sel); s.innerHTML=filt; s.value=nombres.has(S[k])?S[k]:""; });
}

function renderResumenes(){
  const mias=misMaterias();
  const opts=[["todas","Todos"],["pend","No hechos"],["hechos","Hechos"]];
  $("#filtroRes").innerHTML = opts.map(([k,v])=>`<button class="chip" data-fres="${k}" aria-pressed="${S.filtroRes===k}">${v}</button>`).join("");
  const f=S.filtroRes, social=!!S.me;
  const html = mias.map(m=>{
    let res=S.perfil.resumenes.filter(r=>r.materiaId===m.id);
    const total=res.length, h=res.filter(r=>r.hecho).length;
    if(f==="pend") res=res.filter(r=>!r.hecho); if(f==="hechos") res=res.filter(r=>r.hecho);
    if(!total) return "";
    return `<div class="box mat-card" style="--c:${esc(m.color)}">
      <h3>${esc(m.nombre)}</h3>
      <div class="sub">${h} de ${total} hechos</div>
      <div class="bar" style="margin:6px 0 8px"><i style="width:${Math.round(h/total*100)}%"></i></div>
      <ul class="clean">${res.map(r=>`<li class="res-item">
        <div class="row">
          <input type="checkbox" class="check" data-res="${r.id}" ${r.hecho?"checked":""} aria-label="Marcar ${esc(r.titulo)} como hecho">
          <span class="grow ${r.hecho?"done-text":""}">${esc(r.titulo)}</span>
          ${r.compartido?`<span class="shared-pill">Compartido</span>`:""}
          <button class="btn danger small" data-delres="${r.id}">Borrar</button>
        </div>
        <details data-rid="${r.id}" ${S.openRes.has(r.id)?"open":""}>
          <summary>${r.contenido||(r.fotos||[]).length?`Ver contenido${(r.fotos||[]).length?` · ${r.fotos.length} foto${r.fotos.length>1?"s":""}`:""}`:"Agregar contenido, link o fotos"}</summary>
          <textarea data-rescont="${r.id}" placeholder="Pegá tu resumen o un link a Drive/Notion">${esc(r.contenido||"")}</textarea>
          ${S.openRes.has(r.id)?thumbsHTML(S.me||"local", r.fotos||[], r.id, true):""}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            <label class="btn ghost small fotobtn">📷 Agregar foto<input type="file" accept="image/*" data-fotores="${r.id}" hidden></label>
            <button class="btn ghost small ia-only ia-btn" type="button" data-iares="${r.id}">✨ Resumir con IA</button>
            <button class="btn ghost small ia-only ia-btn" type="button" data-iaquiz="${S.me||"local"}|${r.id}">✨ Preguntas de práctica</button>
          </div>
          ${social?`<label class="inline-check"><input type="checkbox" data-resshare="${r.id}" ${r.compartido?"checked":""}> Compartir con mis amigos</label>`:""}
        </details>
      </li>`).join("") || `<li class="empty-msg">Nada en este filtro.</li>`}</ul>
    </div>`;
  }).join("");
  $("#resumenesList").innerHTML = html || `<p class="empty-msg">${mias.length?"Agregá tu primer resumen con el formulario de arriba.":"Primero cargá tus materias en “Mis materias”."}</p>`;
  renderResAmigos();
}

function renderFinales(){
  const reg = materiasOrdenadas().filter(m=>S.perfil.estados[m.id]==="regular");
  $("#finalesList").innerHTML = reg.length ? reg.map(m=>{
    const mesas=Object.values(S.eventos).filter(e=>e.materiaId===m.id && e.tipo==="final" && diasHasta(e.fecha)>=0).sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const prox=mesas[0];
    return `<li class="row"><span class="dot" style="background:${esc(m.color)}"></span>
      <div class="grow"><b>${esc(m.nombre)}</b><div class="sub">${prox?`Próxima mesa: ${parseISO(prox.fecha).getDate()} de ${MESES[parseISO(prox.fecha).getMonth()]} (en ${diasHasta(prox.fecha)} días)`:"Sin mesa de final cargada"}</div></div>
      <label style="width:90px">Nota<input type="number" min="1" max="10" step="1" data-nfinal="${m.id}" placeholder="—"></label>
      <button class="btn small" data-aprobar="${m.id}">Aprobé</button></li>`;
  }).join("") : `<li class="empty-msg">No tenés finales pendientes. Cuando regularices una materia, cambiá su estado a “Regular”.</li>`;
  const apr = materiasOrdenadas().filter(m=>["aprobada","promocion"].includes(S.perfil.estados[m.id]));
  $("#aprobadasList").innerHTML = apr.length ? apr.map(m=>`<li class="row"><span class="dot" style="background:${esc(m.color)}"></span><div class="grow"><b>${esc(m.nombre)}</b><div class="sub">${ESTADOS[S.perfil.estados[m.id]]}</div></div>
    <label style="width:90px">Nota<input type="number" min="4" max="10" step="1" data-notaap="${m.id}" value="${esc(S.perfil.notasFinal[m.id]??"")}"></label></li>`).join("") : `<li class="empty-msg">Todavía no marcaste materias aprobadas.</li>`;
}

function renderCargados(){
  $("#adminMaterias").innerHTML = materiasOrdenadas().map(m=>`<li class="row"><span class="dot" style="background:${esc(m.color)}"></span><div class="grow"><b>${esc(m.nombre)}</b><div class="sub">${m.anio}º año · ${m.cuatri==="A"?"Anual":m.cuatri+"º cuatri"}${m.profesor?" · "+esc(m.profesor):""}</div></div><button class="btn danger small" data-del="materias" data-id="${m.id}">Borrar</button></li>`).join("") || `<li class="empty-msg">Sin materias cargadas.</li>`;
  const evs=[...Object.values(S.eventos), ...S.perfil.propios.map(p=>({...p,tipo:"propio",_viejo:true}))].sort((a,b)=>a.fecha.localeCompare(b.fecha));
  $("#adminEventos").innerHTML = evs.map(e=>eventoRow(e,{borrar:e._viejo?"propio":"eventos"}).replace(/<label style="width:84px">.*?<\/label>/s,"")).join("") || `<li class="empty-msg">Sin fechas cargadas.</li>`;
}

function renderAll(){ derivar(); fillSelects(); renderHero(); renderInicio(); renderCalendario(); renderMaterias(); renderResumenes(); renderFinales(); renderAmigos(); renderDudas(); renderChat(); renderCargados(); renderRecordatorios(); renderPlan(); actualizarTitulo(); }

/* ---------- amigos, resúmenes compartidos y dudas ---------- */
const toObj = snap => { const o={}; snap.docs.forEach(d=>{ o[d.id]={id:d.id, ...d.data()} }); return o; };
let wChain=Promise.resolve();
function qWrite(fn){ wChain = wChain.then(fn).catch(e=>{ console.error("Error al guardar:", e); toast("No se pudo guardar ("+(e?.code||e?.message||"error")+")"); }); return wChain; }
function myDir(){ return S.dir[S.me] || {conecto:[], rechazados:[], materias:[]}; }
function amigos(){ return (myDir().conecto||[]).filter(x=>(S.dir[x]?.conecto||[]).includes(S.me)); }
function recibidas(){ const me=myDir(); return Object.keys(S.dir).filter(x=>x!==S.me && (S.dir[x].conecto||[]).includes(S.me) && !(me.conecto||[]).includes(x) && !(me.rechazados||[]).includes(x)); }
function enviadas(){ return (myDir().conecto||[]).filter(x=>!(S.dir[x]?.conecto||[]).includes(S.me)); }
function saveMyDir(patch){
  const cur={conecto:[], rechazados:[], materias:[], ...myDir(), ...patch};
  S.dir[S.me]=cur;
  const body={conecto:cur.conecto, rechazados:cur.rechazados, materias:cur.materias||[], carrera:cur.carrera||"", universidad:cur.universidad||""};
  qWrite(()=>Store.db.doc("dir/"+S.me).set(body)).then(syncFriendSubs);
  renderAll();
}
function nombre(id){ if(id===S.me) return "Vos"; return S.names[id]?.name || "Compañero/a"; }
function avatar(id, sm){ const a=S.names[id]?.avatar; return a?`<img class="avatar ${sm?"sm":""}" src="${esc(a)}" alt="">`:`<span class="avatar ${sm?"sm":""}"></span>`; }
let namesPending=false;
function ensureNames(ids){
  if(!S.userApi) return;
  const missing=[...new Set(ids)].filter(i=>i && !(i in S.names));
  if(!missing.length || namesPending) return;
  namesPending=true;
  S.userApi.profiles(missing).then(ps=>{
    for(const [k,p] of Object.entries(ps)) S.names[k]={name:p.name, avatar:p.avatarUrl};
    missing.forEach(k=>{ if(!(k in S.names)) S.names[k]={name:"",avatar:""}; });
    namesPending=false; renderAll();
  });
}
function linkify(t){ return esc(t).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>'); }
function comunes(x){ const mine=new Set(Object.values(S.materias).map(m=>norm(m.nombre))); return (S.dir[x]?.materias||[]).filter(m=>mine.has(m)); }

const subs={};
function syncFriendSubs(){
  if(!Store.db || !S.me) return;
  const targets=new Set([S.me, ...amigos().slice(0,12)]);
  for(const o of targets){
    if(subs[o]) continue;
    const base="dir/"+o;
    subs[o]=[
      Store.db.collection(base+"/resumenes").onSnapshot(s=>{ S.fr.res[o]=toObj(s); renderAll(); }, e=>console.warn(e)),
      Store.db.collection(base+"/dudas").onSnapshot(s=>{ S.fr.dudas[o]=toObj(s); renderAll();
        if(o!==S.me) nuevos(s).forEach(async d=>notificar(`${await nombreAsync(o)} tiene una duda`, `${matNombre(d)}: ${d.texto}`, "dudas", d.id)); }, e=>console.warn(e)),
      Store.db.collection(base+"/respuestas").onSnapshot(s=>{ S.fr.resp[o]=toObj(s); renderAll();
        if(o!==S.me) nuevos(s).filter(r=>r.dudaOwner===S.me).forEach(async r=>notificar(`${await nombreAsync(o)} respondió tu duda`, r.texto, "dudas", r.id)); }, e=>console.warn(e)),
    ];
  }
  for(const o of Object.keys(subs)){
    if(targets.has(o)) continue;
    subs[o].forEach(u=>u()); delete subs[o];
    delete S.fr.res[o]; delete S.fr.dudas[o]; delete S.fr.resp[o];
  }
}
function syncSharedRes(r, borrar, copiarFotos){
  if(!Store.db || !S.me) return;
  const ref=Store.db.doc(`dir/${S.me}/resumenes/${r.id}`);
  const fotos=r.fotos||[];
  if(r.compartido && !borrar){
    if(copiarFotos) fotos.forEach(fid=>qWrite(async()=>{ const data=await Fotos.leer(S.me,fid); if(data) await Store.db.doc(`dir/${S.me}/fotos/${fid}`).set({data, resumenId:r.id}); }));
    qWrite(()=>ref.set({materiaId:r.materiaId, materiaNombre:nombreDe(r.materiaId), materiaColor:colorDe(r.materiaId), titulo:r.titulo, contenido:r.contenido||"", fotos, hecho:!!r.hecho, actualizado:Date.now()}));
  } else {
    fotos.forEach(fid=>qWrite(()=>Store.db.doc(`dir/${S.me}/fotos/${fid}`).delete()));
    qWrite(()=>ref.delete());
  }
}

function personaRow(x, acciones, extra=""){
  const c=comunes(x);
  const dx=S.dir[x]||{}; const car=[dx.carrera, dx.universidad].filter(Boolean).join(" · ");
  return `<li class="row"><div class="person grow">${avatar(x)}<div><b>${esc(nombre(x))}</b>${car?`<div class="sub">${esc(car)}</div>`:""}<div class="sub">${extra || (c.length?`${c.length} materia${c.length>1?"s":""} en común`:"Sin materias en común")}</div></div></div>${acciones}</li>`;
}
function renderAmigos(){
  const on=!!S.me;
  $("#amigosOff").hidden=on; $("#amigosOn").hidden=!on;
  $("#dudasOff").hidden=on; $("#dudasOn").hidden=!on;
  $("#resAmigosBox").hidden=!on;
  const rec = on?recibidas():[];
  $("#tabAmigos").innerHTML = "Amigos"+(rec.length?`<span class="count">${rec.length}</span>`:"");
  if(!on) return;
  const am=amigos(), env=enviadas();
  ensureNames([...rec, ...am, ...env, ...Object.keys(S.dir)]);
  $("#recibidasBox").hidden = !rec.length;
  $("#recibidasList").innerHTML = rec.map(x=>personaRow(x, `<button class="btn small" data-aceptar="${x}">Aceptar</button><button class="btn ghost small" data-rechazar="${x}">Rechazar</button>`)).join("");
  $("#amigosList").innerHTML = am.length ? am.map(x=>{
    const nres=Object.keys(S.fr.res[x]||{}).length; const c=comunes(x);
    return personaRow(x, `<button class="btn danger small" data-quitar="${x}">Quitar</button>`, `${c.length} en común · ${nres} resumen${nres===1?"":"es"} compartido${nres===1?"":"s"}`);
  }).join("") : `<li class="empty-msg">Todavía no tenés amigos agregados. Buscá compañeros a la derecha.</li>`;
  $("#enviadasWrap").innerHTML = env.length ? `<h3 style="margin-top:16px">Esperando respuesta</h3><ul class="clean">${env.map(x=>personaRow(x, `<button class="btn ghost small" data-cancelar="${x}">Cancelar</button>`)).join("")}</ul>` : "";
  // personas para agregar
  const excl=new Set([S.me, ...am, ...env, ...rec]);
  let pool=[...new Set([...Object.keys(S.dir), ...S.hits.map(h=>h.id)])].filter(x=>!excl.has(x));
  const q=S.q.trim().toLowerCase();
  if(q) pool=pool.filter(x=>norm([S.names[x]?.name, S.dir[x]?.carrera, S.dir[x]?.universidad].join(" ")).includes(norm(q)));
  pool.sort((a,b)=>comunes(b).length-comunes(a).length);
  $("#personasList").innerHTML = pool.slice(0,30).map(x=>personaRow(x, `<button class="btn small" data-agregar="${x}">Agregar</button>`)).join("")
    || `<li class="empty-msg">${q?"No encontramos a nadie con ese nombre que use la app.":"Todavía no hay otras personas usando la app. Compartiles el link."}</li>`;
}

function renderResAmigos(){
  if(!S.me) return;
  const am=new Set(amigos());
  let items=[];
  for(const [o,docs] of Object.entries(S.fr.res)){ if(!am.has(o)) continue; Object.values(docs).forEach(r=>items.push({...r, owner:o})); }
  if(S.filtroResAmigos) items=items.filter(r=>norm(matNombre(r))===S.filtroResAmigos);
  items.sort((a,b)=>(b.actualizado||0)-(a.actualizado||0));
  $("#resAmigosList").innerHTML = items.length ? `<ul class="clean">${items.map(r=>`<li class="res-item">
    <div class="row"><span class="dot" style="background:${esc(matColor(r))}"></span>
      <div class="grow"><b>${esc(r.titulo)}</b><div class="sub">${esc(matNombre(r))} · de ${esc(nombre(r.owner))}</div></div>
      <button class="btn ghost small ia-only ia-btn" type="button" data-iaquiz="${r.owner}|${r.id}">✨ Preguntas</button>
      <button class="btn ghost small" data-copiar="${r.owner}|${r.id}">Guardar en mis resúmenes</button></div>
    ${r.contenido?`<div class="content">${linkify(r.contenido)}</div>`:((r.fotos||[]).length?"":`<div class="sub" style="margin-top:4px">Sin contenido todavía.</div>`)}
    ${(r.fotos||[]).length?thumbsHTML(r.owner, r.fotos, r.id, false):""}
  </li>`).join("")}</ul>` : `<p class="empty-msg">${am.size?"Tus amigos todavía no compartieron resúmenes"+(S.filtroResAmigos?" de esta materia.":"."):"Cuando tengas amigos, acá vas a ver los resúmenes que compartan."}</p>`;
}

function renderDudas(){
  if(!S.me) return;
  const visibles=new Set([S.me, ...amigos()]);
  let dudas=[];
  for(const [o,docs] of Object.entries(S.fr.dudas)){ if(!visibles.has(o)) continue; Object.values(docs).forEach(d=>dudas.push({...d, owner:o})); }
  const resps=[];
  for(const [o,docs] of Object.entries(S.fr.resp)){ if(!visibles.has(o)) continue; Object.values(docs).forEach(r=>resps.push({...r, owner:o})); }
  if(S.filtroDudaMat) dudas=dudas.filter(d=>norm(matNombre(d))===S.filtroDudaMat);
  if(S.filtroDudaEstado==="abiertas") dudas=dudas.filter(d=>!d.resuelta);
  if(S.filtroDudaEstado==="mias") dudas=dudas.filter(d=>d.owner===S.me);
  dudas.sort((a,b)=>(b.creado||0)-(a.creado||0));
  ensureNames(resps.map(r=>r.owner));
  $("#dudasList").innerHTML = dudas.length ? dudas.map(d=>{
    const rs=resps.filter(r=>r.dudaOwner===d.owner && r.dudaId===d.id).sort((a,b)=>a.creado-b.creado);
    const key=d.owner+"|"+d.id, mia=d.owner===S.me;
    return `<div class="duda">
      <div class="person">${avatar(d.owner,true)}<span class="sub"><b style="color:var(--ink)">${esc(nombre(d.owner))}</b> · ${esc(matNombre(d))} · ${new Date(d.creado).toLocaleDateString("es-AR")}</span>
        ${d.resuelta?`<span class="shared-pill">Resuelta</span>`:""}</div>
      <div class="q">${linkify(d.texto)}</div>
      ${rs.map(r=>`<div class="resp ${r.ia?"ia-resp":""}"><div class="who2">${avatar(r.owner,true)}<b>${esc(nombre(r.owner))}</b>${r.ia?` <span class="sub">· compartió una respuesta de la IA ✨</span>`:""}${r.owner===S.me?` <button class="btn danger small" data-delresp="${r.id}">Borrar</button>`:""}</div><div class="${r.ia?"ia-out":""}">${r.ia?md(r.texto):linkify(r.texto)}</div></div>`).join("")}
      <button class="btn ghost small ia-only ia-btn" type="button" data-iaduda="${key}" style="margin-top:8px">✨ Ayuda de la IA</button>
      <details data-respkey="${key}" ${S.openResp.has(key)?"open":""} style="margin-top:8px">
        <summary class="sub" style="font-weight:700">Responder${rs.length?` (${rs.length} respuesta${rs.length>1?"s":""})`:""}</summary>
        <form data-responder="${key}" style="display:grid;gap:8px;margin-top:6px"><textarea name="texto" required placeholder="Escribí tu respuesta"></textarea><button class="btn small" type="submit" style="justify-self:start">Enviar respuesta</button></form>
      </details>
      ${mia?`<div style="margin-top:8px;display:flex;gap:8px">${d.resuelta?"":`<button class="btn ghost small" data-resolver="${d.id}">Marcar resuelta</button>`}<button class="btn danger small" data-delduda="${d.id}">Borrar duda</button></div>`:""}
    </div>`;
  }).join("") : `<p class="empty-msg">${amigos().length?"No hay dudas para mostrar. ¡Publicá la primera!":"Publicá una duda y la van a ver tus amigos. Agregá compañeros desde la pestaña Amigos."}</p>`;
}

/* ---------- chat grupal ---------- */
let chatSubs=[], chatSig="";
function syncChatSubs(){
  if(!Store.db || !S.me) return;
  const gids=Object.keys(S.grupos).sort((a,b)=>(a===S.chatActivo?-1:b===S.chatActivo?1:0)).slice(0,10);
  const act=S.grupos[S.chatActivo];
  const people=[...new Set([...(act?.miembros||[]), ...gids.flatMap(g=>S.grupos[g].miembros||[])])].slice(0,15);
  const sig=gids.join(",")+"#"+people.join(",");
  if(sig===chatSig) return; chatSig=sig;
  chatSubs.forEach(u=>u()); chatSubs=[]; S.chatMsgs={};
  if(!gids.length) return;
  people.forEach(pid=>{
    chatSubs.push(Store.db.collection(`dir/${pid}/mensajes`).where("grupoId","in",gids).onSnapshot(s=>{
      S.chatMsgs[pid]=toObj(s); renderChat();
      if(pid!==S.me) nuevos(s).forEach(async m=>{
        const viendo=document.visibilityState==="visible" && $("#p-chat").classList.contains("on") && S.chatActivo===m.grupoId;
        if(!viendo) notificar(`${await nombreAsync(pid)} en ${S.grupos[m.grupoId]?.nombre||"un grupo"}`, m.imagen&&!m.texto?"📷 Foto":m.texto, "chat", m.id, ()=>abrirGrupo(m.grupoId));
      });
    }, e=>console.warn(e)));
  });
}
function msgsDe(gid){
  const out=[];
  for(const [o,docs] of Object.entries(S.chatMsgs)) Object.values(docs).forEach(m=>{ if(m.grupoId===gid) out.push({...m, owner:o}); });
  return out.sort((a,b)=>a.creado-b.creado);
}
function noLeidos(gid){ const t=S.perfil.leido?.[gid]||0; return msgsDe(gid).filter(m=>m.owner!==S.me && m.creado>t).length; }
let markTimer=null;
function marcarLeido(gid){
  if(markTimer) return;
  markTimer=setTimeout(()=>{ markTimer=null; const ms=msgsDe(gid); const last=ms.length?ms[ms.length-1].creado:Date.now();
    if((S.perfil.leido[gid]||0)>=last) return; S.perfil.leido={...S.perfil.leido,[gid]:last}; Store.savePerfil(); renderChat(); }, 300);
}
function pickHTML(ids, name, checked){
  return ids.map(x=>`<label>${avatar(x,true)}<input type="checkbox" name="${name}" value="${x}" ${checked.has(x)?"checked":""}>${esc(nombre(x))}</label>`).join("");
}
function renderChat(){
  const on=!!S.me;
  $("#chatOff").hidden=on; $("#chatOn").hidden=!on;
  if(!on){ $("#tabChat").textContent="Chat"; return; }
  S.totalUnread=0;
  const gs=Object.values(S.grupos).map(g=>{ const ms=msgsDe(g.id); return {...g, last:ms[ms.length-1], unread:noLeidos(g.id)}; })
    .sort((a,b)=>((b.last?.creado||b.creado||0)-(a.last?.creado||a.creado||0)));
  const totalUnread=gs.reduce((a,g)=>a+g.unread,0); S.totalUnread=totalUnread;
  $("#tabChat").innerHTML="Chat"+(totalUnread?`<span class="count">${totalUnread}</span>`:"");
  ensureNames(gs.flatMap(g=>g.miembros||[]));
  $("#gruposList").innerHTML = gs.length ? gs.map(g=>`<button class="g" data-grupo="${g.id}" aria-current="${g.id===S.chatActivo}">
      <span class="gicon" aria-hidden="true">${esc((g.nombre||"?").trim()[0]?.toUpperCase()||"?")}</span>
      <span class="grow"><b>${esc(g.nombre)}</b><span class="prev" style="display:block">${g.last?esc((g.last.owner===S.me?"Vos":nombre(g.last.owner).split(" ")[0])+": "+(g.last.texto||(g.last.imagen?"📷 Foto":""))):"Sin mensajes todavía"}</span></span>
      ${g.unread?`<span class="count">${g.unread}</span>`:""}</button>`).join("")
    : `<p class="empty-msg">No estás en ningún grupo. Creá uno abajo.</p>`;
  // formulario crear grupo (preserva lo tildado)
  const am=amigos();
  const chk=new Set($$('#grupoMiembros input:checked').map(i=>i.value));
  $("#grupoMiembros").innerHTML = am.length ? pickHTML(am,"m",chk) : `<span class="sub">Primero agregá amigos en la pestaña Amigos.</span>`;
  // conversación
  const g=S.grupos[S.chatActivo];
  $("#chatOn").classList.toggle("has-active", !!g);
  $("#chatEmpty").hidden=!!g; $("#chatBody").hidden=!g;
  if(!g) return;
  $("#chatTitle").textContent=g.nombre;
  $("#chatMembers").textContent=(g.miembros||[]).map(nombre).join(", ");
  const addable=am.filter(x=>!(g.miembros||[]).includes(x));
  $("#chatAddBtn").hidden=!addable.length;
  const chk2=new Set($$('#chatAddPick input:checked').map(i=>i.value));
  $("#chatAddPick").innerHTML=pickHTML(addable,"a",chk2);
  const box=$("#msgs"); const nearBottom = box.scrollHeight-box.scrollTop-box.clientHeight < 80;
  const ms=msgsDe(g.id); let lastDay="";
  box.innerHTML = ms.length ? ms.map(m=>{
    const d=new Date(m.creado); const day=d.toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"});
    const sep = day!==lastDay ? `<div class="dayline">${esc(day)}</div>` : ""; lastDay=day;
    const mine=m.owner===S.me;
    return sep+`<div class="msg ${mine?"mine":""}">${mine?"":`<span class="au">${esc(nombre(m.owner))}</span>`}${m.imagen?`<img class="msg-img" src="${esc(m.imagen)}" data-zoom alt="Foto enviada">`:""}${m.texto?linkify(m.texto):""}<time>${d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</time></div>`;
  }).join("") : `<p class="empty-msg" style="text-align:center">Todavía no hay mensajes. ¡Mandá el primero!</p>`;
  if(nearBottom || renderChat._jump){ box.scrollTop=box.scrollHeight; renderChat._jump=false; }
  if($("#p-chat").classList.contains("on") && noLeidos(g.id)) marcarLeido(g.id);
  actualizarTitulo();
}
function abrirGrupo(gid){ S.chatActivo=gid; $("#chatAdd").hidden=true; renderChat._jump=true; syncChatSubs(); renderChat(); $("#fMsg").texto.focus(); }

/* ---------- fotos (se comprimen y se guardan en Firestore) ---------- */
async function comprimir(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error("No se pudo leer la imagen")); i.src=url; });
    let max=1280, q=0.72, data="";
    for(let k=0;k<7;k++){
      const s=Math.min(1, max/Math.max(img.width,img.height));
      const c=document.createElement("canvas"); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
      const ctx=c.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height);
      data=c.toDataURL("image/jpeg", q);
      if(data.length<650000) return data;
      max*=0.8; q=Math.max(0.45,q-0.08);
    }
    return data.length<900000 ? data : null;
  } finally { URL.revokeObjectURL(url); }
}
const Fotos = {
  cache:{}, pend:new Set(),
  ruta(owner,fid){ return owner===S.me ? `data/users/${S.me}/foto_${fid}` : `dir/${owner}/fotos/${fid}`; },
  async leer(owner,fid){
    const k=owner+"|"+fid; if(this.cache[k]) return this.cache[k];
    let data=null;
    if(Store.db && S.me){ try{ const s=await Store.db.doc(this.ruta(owner,fid)).get(); data=s.exists?s.data().data:null; }catch(e){ console.warn(e); } }
    else data=Store.lsGet("foto:"+fid);
    if(data) this.cache[k]=data; return data;
  },
  async guardar(fid,data,resumenId){
    const owner=S.me||"local"; this.cache[owner+"|"+fid]=data;
    if(Store.db && S.me) await Store.db.doc(this.ruta(S.me,fid)).set({data, resumenId, creado:Date.now()});
    else { try{ localStorage.setItem("se:foto:"+fid, JSON.stringify(data)); }catch(e){ throw new Error("No hay más espacio en este navegador"); } }
  },
  borrar(fid){
    delete this.cache[(S.me||"local")+"|"+fid];
    if(Store.db && S.me) qWrite(()=>Store.db.doc(this.ruta(S.me,fid)).delete());
    else { try{ localStorage.removeItem("se:foto:"+fid); }catch(e){} }
  },
  src(owner,fid){
    const k=owner+"|"+fid; if(this.cache[k]) return this.cache[k];
    if(!this.pend.has(k)){ this.pend.add(k); this.leer(owner==="local"?S.me:owner,fid).then(d=>{ if(d){ this.cache[k]=d; renderResumenes(); } }); }
    return "";
  }
};
function thumbsHTML(owner, fids, rid, puedeBorrar){
  if(!fids.length) return "";
  return `<div class="thumbs">${fids.map(f=>{ const s=Fotos.src(owner,f);
    return `<div class="thumb">${s?`<img src="${esc(s)}" data-zoom alt="Foto del resumen">`:`<span class="ph"></span>`}${puedeBorrar?`<button type="button" data-delfoto="${rid}|${f}" aria-label="Borrar foto">×</button>`:""}</div>`; }).join("")}</div>`;
}
async function agregarFotoResumen(rid, file){
  const r=S.perfil.resumenes.find(x=>x.id===rid); if(!r) return;
  if((r.fotos||[]).length>=6) return toast("Máximo 6 fotos por resumen");
  toast("Subiendo foto…");
  try{
    const data=await comprimir(file); if(!data) return toast("La foto es muy pesada");
    const fid=uid(); await Fotos.guardar(fid,data,rid);
    r.fotos=[...(r.fotos||[]), fid]; S.openRes.add(rid);
    if(r.compartido && Store.db && S.me){ qWrite(()=>Store.db.doc(`dir/${S.me}/fotos/${fid}`).set({data, resumenId:rid})); syncSharedRes(r); }
    perfilCambio(); toast("Foto agregada");
  }catch(e){ console.error(e); toast("No se pudo subir la foto ("+(e.code||e.message)+")"); }
}
function borrarFotoResumen(rid,fid){
  const r=S.perfil.resumenes.find(x=>x.id===rid); if(!r) return;
  r.fotos=(r.fotos||[]).filter(f=>f!==fid); Fotos.borrar(fid);
  if(r.compartido && Store.db && S.me){ qWrite(()=>Store.db.doc(`dir/${S.me}/fotos/${fid}`).delete()); syncSharedRes(r); }
  perfilCambio(); toast("Foto borrada");
}
async function enviarFotoChat(file){
  const gid=S.chatActivo; if(!gid||!Store.db) return;
  toast("Enviando foto…");
  try{
    const data=await comprimir(file); if(!data) return toast("La foto es muy pesada");
    const id=uid(); const m={grupoId:gid, texto:"", imagen:data, creado:Date.now()};
    S.chatMsgs[S.me]={...(S.chatMsgs[S.me]||{}), [id]:{id,...m}}; renderChat._jump=true; renderChat();
    qWrite(()=>Store.db.doc(`dir/${S.me}/mensajes/${id}`).set(m));
  }catch(e){ console.error(e); toast("No se pudo enviar la foto"); }
}
function abrirLightbox(src){ const lb=$("#lightbox"); lb.querySelector("img").src=src; lb.hidden=false; }
$("#lightbox").onclick=()=>{ $("#lightbox").hidden=true; };
document.addEventListener("keydown", e=>{ if(e.key==="Escape") $("#lightbox").hidden=true; });

/* ---------- notificaciones ---------- */
const INICIO=Date.now(); const yaNotificado=new Set();
const notifOK = () => "Notification" in window && Notification.permission==="granted" && Store.lsGet("notif")!==false;
function nuevos(snap){
  return snap.docChanges().filter(ch=>ch.type==="added").map(ch=>({id:ch.doc.id, ...ch.doc.data()}))
    .filter(x=>(x.creado||0)>INICIO && !yaNotificado.has(x.id));
}
async function nombreAsync(id){
  if(!S.names[id]?.name && S.userApi){ try{ const ps=await S.userApi.profiles([id]); if(ps[id]) S.names[id]={name:ps[id].name, avatar:ps[id].avatarUrl}; }catch(e){} }
  return nombre(id);
}
function irA(tab){ $(`#tabs [data-tab="${tab}"]`)?.click(); }
function notificar(titulo, cuerpo, tab, id, alAbrir){
  if(id){ if(yaNotificado.has(id)) return; yaNotificado.add(id); }
  const texto=String(cuerpo||"").slice(0,140);
  if(document.visibilityState==="visible"){ toast(`${titulo}: ${texto}`); return; }
  if(!notifOK()) return;
  try{
    const n=new Notification(titulo, {body:texto, tag:id||undefined});
    n.onclick=()=>{ window.focus(); irA(tab); alAbrir?.(); n.close(); };
  }catch(e){ console.warn(e); }
}
function actualizarTitulo(){
  const n=(S.totalUnread||0)+(S.me?recibidas().length:0);
  document.title=(n?`(${n}) `:"")+"Sistema Estudiantes";
}
function estadoNotif(){
  const el=$("#notifEstado"), b=$("#notifBtn");
  if(!("Notification" in window)){ b.hidden=true; el.textContent="Tu navegador no permite notificaciones. Usá el botón del calendario para que el celu te avise."; return; }
  if(Notification.permission==="granted" && Store.lsGet("notif")!==false){ b.textContent="Desactivar notificaciones";
    el.textContent="Te avisamos de mensajes, dudas, solicitudes y exámenes mientras la app esté abierta (aunque sea en otra pestaña). Para que el celu te avise con la app cerrada, pasá tus fechas al calendario."; }
  else if(Notification.permission==="denied"){ b.hidden=true; el.textContent="Bloqueaste las notificaciones. Podés habilitarlas desde el candadito de la barra de direcciones."; }
  else { b.textContent="Activar notificaciones"; el.textContent="Activalas para enterarte de mensajes, dudas y exámenes. Con el botón del calendario, el celu te avisa aunque la app esté cerrada."; }
}
$("#notifBtn").onclick=async()=>{
  if(Notification.permission==="granted"){ const on=Store.lsGet("notif")!==false; Store.lsSet("notif", !on); estadoNotif(); if(!on) chequearExamenes(true); return; }
  const p=await Notification.requestPermission(); Store.lsSet("notif", true); estadoNotif();
  if(p==="granted"){ new Notification("¡Listo!", {body:"Las notificaciones de Sistema Estudiantes están activadas."}); chequearExamenes(true); }
};

/* ---------- recordatorios y calendario ---------- */
const esExamen = e => ["parcial","recu","final","entrega"].includes(e.tipo);
function proximosAvisos(){ const n=Number(S.perfil.recordar||3); return todosEventos().filter(e=>{ const d=diasHasta(e.fecha); return d>=0 && d<=n && esExamen(e); }); }
function renderRecordatorios(){
  $("#recordarSel").value=String(S.perfil.recordar||3);
  const av=proximosAvisos();
  const hoyT=(S.perfil.plan?.tareas||[]).filter(t=>t.fecha===hoyISO() && !tareaHecha(t));
  $("#alertas").innerHTML = av.map(e=>{ const d=diasHasta(e.fecha);
    return `<div class="alerta"><span aria-hidden="true">⏰</span><div class="grow"><b>${d===0?"¡Hoy!":d===1?"Mañana":`En ${d} días`}</b> · ${esc(e.titulo)} de ${esc(nombreDe(e.materiaId))}${e.hora?` a las ${esc(e.hora)}`:""}</div></div>`; }).join("")
    + (hoyT.length?`<div class="alerta"><span aria-hidden="true">📚</span><div class="grow"><b>Plan de hoy:</b> ${hoyT.length} tarea${hoyT.length>1?"s":""} de estudio</div><button class="btn small" type="button" data-ir="plan">Ver plan</button></div>`:"");
  estadoNotif();
}
function chequearExamenes(forzar){
  if(!notifOK()) return;
  const hoy=hoyISO();
  proximosAvisos().forEach(e=>{
    const k="rec:"+e.id+":"+hoy; if(!forzar && Store.lsGet(k)) return; Store.lsSet(k,true);
    const d=diasHasta(e.fecha);
    try{ new Notification(d===0?"¡Hoy tenés examen!":d===1?"Mañana tenés examen":`Faltan ${d} días`, {body:`${e.titulo} de ${nombreDe(e.materiaId)}${e.hora?" a las "+e.hora:""}`, tag:k}); }catch(err){}
  });
}
setInterval(()=>chequearExamenes(false), 60*60*1000);
const ymd = s => s.replace(/-/g,"");
function sumarDia(iso,n){ const d=parseISO(iso); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function horaMas(h,mins){ const [H,M]=h.split(":").map(Number); const t=H*60+M+mins; return `${String(Math.floor(t/60)%24).padStart(2,"0")}${String(t%60).padStart(2,"0")}00`; }
function gcalLink(e){
  const dates = e.hora ? `${ymd(e.fecha)}T${e.hora.replace(":","")}00/${ymd(e.fecha)}T${horaMas(e.hora,120)}` : `${ymd(e.fecha)}/${ymd(sumarDia(e.fecha,1))}`;
  const p=new URLSearchParams({action:"TEMPLATE", text:`${e.titulo} – ${nombreDe(e.materiaId)}`, dates, details:e.temas?`Temas: ${e.temas}`:"Cargado desde Sistema Estudiantes", location:e.aula?`Aula ${e.aula}`:""});
  return "https://calendar.google.com/calendar/render?"+p.toString();
}
function descargarICS(){
  const evs=todosEventos().filter(e=>diasHasta(e.fecha)>=0);
  if(!evs.length) return toast("No tenés fechas próximas para exportar");
  const escI=s=>String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
  const now=new Date().toISOString().replace(/[-:]/g,"").slice(0,15)+"Z";
  const n=Number(S.perfil.recordar||3);
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Sistema Estudiantes//ES","CALSCALE:GREGORIAN","METHOD:PUBLISH"];
  evs.forEach(e=>{
    L.push("BEGIN:VEVENT", `UID:${e.id}@sistema-estudiantes`, `DTSTAMP:${now}`);
    if(e.hora){ L.push(`DTSTART:${ymd(e.fecha)}T${e.hora.replace(":","")}00`, `DTEND:${ymd(e.fecha)}T${horaMas(e.hora,120)}`); }
    else { L.push(`DTSTART;VALUE=DATE:${ymd(e.fecha)}`, `DTEND;VALUE=DATE:${ymd(sumarDia(e.fecha,1))}`); }
    L.push(`SUMMARY:${escI(`${e.titulo} – ${nombreDe(e.materiaId)}`)}`);
    if(e.aula) L.push(`LOCATION:${escI("Aula "+e.aula)}`);
    if(e.temas) L.push(`DESCRIPTION:${escI("Temas: "+e.temas)}`);
    [...new Set([n,1])].forEach(dd=>L.push("BEGIN:VALARM","ACTION:DISPLAY",`DESCRIPTION:${escI(e.titulo)}`,`TRIGGER:-P${dd}D`,"END:VALARM"));
    L.push("END:VEVENT");
  });
  L.push("END:VCALENDAR");
  const blob=new Blob([L.join("\r\n")],{type:"text/calendar;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="mis-examenes.ics"; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
  toast("Abrí el archivo descargado para sumarlo a tu calendario");
}
$("#icsBtn").onclick=descargarICS;
$("#recordarSel").onchange=e=>{ S.perfil.recordar=Number(e.target.value); perfilCambio(); };

/* ---------- plan de estudio ---------- */
const DIAS=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
function tareaHecha(t){ if(t.resumenId){ const r=S.perfil.resumenes.find(x=>x.id===t.resumenId); if(r?.hecho) return true; } return !!t.hecho; }
function generarPlan(){
  const dias=S.perfil.planDias?.length?S.perfil.planDias:[1,2,3,4,5,6];
  const previo=new Map((S.perfil.plan?.tareas||[]).map(t=>[t.clave,t.hecho]));
  const exams=Object.values(S.eventos).filter(e=>["parcial","recu","final"].includes(e.tipo) && diasHasta(e.fecha)>=1 && diasHasta(e.fecha)<=60).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const hoy=hoyISO(), tareas=[];
  exams.forEach(ex=>{
    let temas=S.perfil.resumenes.filter(r=>r.materiaId===ex.materiaId && !r.hecho).map(r=>({titulo:"Estudiar: "+r.titulo, resumenId:r.id}));
    if(!temas.length && ex.temas) temas=ex.temas.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean).map(t=>({titulo:"Estudiar: "+t}));
    if(!temas.length) temas=[{titulo:"Leer la teoría"},{titulo:"Hacer ejercicios prácticos"},{titulo:"Resolver parciales viejos"}];
    let disp=[]; for(let i=0;i<diasHasta(ex.fecha);i++){ const f=sumarDia(hoy,i); if(dias.includes(parseISO(f).getDay())) disp.push(f); }
    if(!disp.length) disp=[hoy];
    const repaso=disp[disp.length-1], estudio=disp.length>1?disp.slice(0,-1):disp;
    temas.forEach((t,i)=>{ const clave=`${ex.id}:${t.resumenId||t.titulo}`;
      tareas.push({id:uid(), clave, fecha:estudio[Math.floor(i*estudio.length/temas.length)], materiaId:ex.materiaId, eventoId:ex.id, titulo:t.titulo, resumenId:t.resumenId||null, hecho:!!previo.get(clave)}); });
    const clave=`${ex.id}:repaso`;
    tareas.push({id:uid(), clave, fecha:repaso, materiaId:ex.materiaId, eventoId:ex.id, titulo:"Repaso general y simulacro de examen", resumenId:null, hecho:!!previo.get(clave)});
  });
  S.perfil.plan={generado:Date.now(), tareas};
  perfilCambio();
  toast(tareas.length?"¡Plan generado!":"No tenés exámenes en los próximos 60 días");
}
function renderPlan(){
  const dias=S.perfil.planDias||[1,2,3,4,5,6];
  $("#planDias").innerHTML=[1,2,3,4,5,6,0].map(d=>`<label><input type="checkbox" data-plandia="${d}" ${dias.includes(d)?"checked":""}>${DIAS[d]}</label>`).join("");
  const plan=S.perfil.plan;
  $("#planInfo").textContent = plan ? `Generado el ${new Date(plan.generado).toLocaleDateString("es-AR")}. Si cargás fechas o resúmenes nuevos, tocá “Generar plan” otra vez (lo que ya tildaste se mantiene).` : "Cargá tus exámenes en Calendario y tus resúmenes, y después tocá “Generar plan”.";
  const tareas=(plan?.tareas||[]).filter(t=>S.eventos[t.eventoId]);
  if(!tareas.length){ $("#planList").innerHTML = plan?`<p class="empty-msg">No hay tareas. ¿Cargaste parciales o finales en los próximos 60 días?</p>`:""; return; }
  const hoy=hoyISO(), grupos=new Map();
  const atrasadas=tareas.filter(t=>t.fecha<hoy && !tareaHecha(t));
  if(atrasadas.length) grupos.set("atrasadas", atrasadas);
  tareas.filter(t=>t.fecha>=hoy).sort((a,b)=>a.fecha.localeCompare(b.fecha)).forEach(t=>{ if(!grupos.has(t.fecha)) grupos.set(t.fecha,[]); grupos.get(t.fecha).push(t); });
  $("#planList").innerHTML=[...grupos].map(([f,ts])=>{
    const at=f==="atrasadas", pend=ts.filter(t=>!tareaHecha(t)).length;
    let titulo=at?"Atrasadas":f===hoy?"Hoy":f===sumarDia(hoy,1)?"Mañana":parseISO(f).toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"});
    titulo=titulo[0].toUpperCase()+titulo.slice(1);
    return `<div class="box plan-day ${f===hoy?"hoy":""} ${at?"atrasado":""}">
      <h3>${esc(titulo)} <span class="sub" style="font-weight:400">${pend?`${pend} pendiente${pend>1?"s":""}`:"¡completo! ✓"}</span>${ts.length>4&&!at?`<span class="warn-pill">Día cargado</span>`:""}</h3>
      <ul class="clean">${ts.map(t=>{ const ex=S.eventos[t.eventoId], ok=tareaHecha(t);
        return `<li class="row"><input type="checkbox" class="check" data-tarea="${t.id}" ${ok?"checked":""} aria-label="Marcar tarea como hecha">
          <div class="grow"><span class="dot" style="background:${esc(colorDe(t.materiaId))}"></span><span class="${ok?"done-text":""}">${esc(t.titulo)}</span>
          <div class="sub">${esc(nombreDe(t.materiaId))} · para ${esc(ex.titulo)} (${diasHasta(ex.fecha)===1?"mañana":"en "+diasHasta(ex.fecha)+" días"})${at?` · era para el ${parseISO(t.fecha).toLocaleDateString("es-AR")}`:""}</div></div></li>`; }).join("")}</ul>
    </div>`;
  }).join("");
}
$("#planGen").onclick=generarPlan;

/* ---------- IA (Gemini) ---------- */
S.iaHist=[]; S.iaAdj=null; S.iaOcupado=false;
try{ S.iaHist=Store.lsGet("iaHist")||[]; }catch(e){}
function md(t){
  const bloques=[]; let s=String(t||"").replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g,(_,c)=>{ bloques.push(c); return `\u0000${bloques.length-1}\u0000`; });
  s=esc(s);
  const inline=x=>x.replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<i>$2</i>")
    .replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');
  const out=[]; let lista=null;
  const cerrar=()=>{ if(lista){ out.push(`<${lista.t}>${lista.items.map(i=>`<li>${inline(i)}</li>`).join("")}</${lista.t}>`); lista=null; } };
  for(const linea of s.split("\n")){
    const l=linea.trim(); let m;
    if((m=l.match(/^\u0000(\d+)\u0000$/))){ cerrar(); out.push(`<pre>${esc(bloques[+m[1]])}</pre>`); continue; }
    if((m=l.match(/^#{1,4}\s+(.*)/))){ cerrar(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if((m=l.match(/^[-*•]\s+(.*)/))){ if(lista?.t!=="ul"){ cerrar(); lista={t:"ul",items:[]}; } lista.items.push(m[1]); continue; }
    if((m=l.match(/^\d+[.)]\s+(.*)/))){ if(lista?.t!=="ol"){ cerrar(); lista={t:"ol",items:[]}; } lista.items.push(m[1]); continue; }
    if(!l){ cerrar(); continue; }
    cerrar(); out.push(`<p>${inline(l)}</p>`);
  }
  cerrar();
  return out.join("").replace(/\u0000(\d+)\u0000/g,(_,i)=>`<pre>${esc(bloques[+i])}</pre>`);
}
function iaError(e){
  console.error("IA:", e); const m=String(e?.message||e);
  if(/limit:\s*0\b|free.?tier.*(not|isn't) (available|supported)/i.test(m)) return `El modelo “${window.IA?.modelo||window.iaModelo}” no está incluido en el plan gratuito. Cambiá window.iaModelo en firebase-config.js por otro modelo (por ejemplo "gemini-2.5-flash").`;
  if(/app.?check/i.test(m)) return "Firebase bloqueó la IA por App Check. En la consola de Firebase: Seguridad → App Check → pestaña APIs → Firebase AI Logic → “Dejar de aplicar”. (Detalle: "+m.replace(/\s+/g," ").slice(0,160)+")";
  if(/\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(m)) return "La IA llegó al límite gratuito por ahora. Probá de nuevo en un minuto. (Detalle: "+m.replace(/\s+/g," ").slice(0,160)+")";
  if(/not.?found|\b404\b|not supported|deprecated|decommission/i.test(m)) return "Ningún modelo de IA de la lista está disponible para tu proyecto. Mandale esta captura a quien te ayuda con la app. (Detalle: "+m.replace(/\s+/g," ").slice(0,200)+")";
  if(/has not been used|disabled|PERMISSION_DENIED|\b403\b|api-not-enabled/i.test(m)) return "Falta activar Firebase AI Logic en la consola de Firebase (Servicios de IA → AI Logic → Comenzar).";
  if(/SAFETY|blocked/i.test(m)) return "La IA no quiso responder eso. Probá reformulando la pregunta.";
  if(/fetch|network|Failed to/i.test(m)) return "No se pudo conectar con la IA. Revisá tu conexión.";
  return "La IA no pudo responder ("+m.replace(/\s+/g," ").slice(0,200)+")";
}
const b64 = dataUrl => ({inlineData:{mimeType:"image/jpeg", data:String(dataUrl).split(",")[1]}});
function iaListo(){ return !!window.IA; }
function estadoIA(){
  const ok=iaListo(); document.body.classList.toggle("ia-on", ok);
  $("#iaOn").hidden=!ok; $("#iaOff").hidden=ok;
  if(!ok) $("#iaOffMsg").innerHTML = window.IA_ERROR ? `No se pudo iniciar la IA: ${esc(iaError(window.IA_ERROR))}`
    : (S.mode==="local" ? "La IA funciona cuando la app está conectada a Firebase." : "Cargando la IA… Si no aparece, revisá que Firebase AI Logic esté activado en la consola.");
}
window.addEventListener("ia-lista", ()=>{ estadoIA(); renderAll(); renderIAChat(); });

/* Ventana de IA */
function abrirModal(titulo){ $("#iaModalTitle").textContent=titulo; $("#iaModalBody").innerHTML=""; $("#iaModalActions").innerHTML=""; $("#iaModal").hidden=false; return $("#iaModalBody"); }
function cerrarModal(){ $("#iaModal").hidden=true; S.modalId=(S.modalId||0)+1; }
$("#iaModalClose").onclick=cerrarModal;
$("#iaModal").addEventListener("click", e=>{ if(e.target.id==="iaModal") cerrarModal(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("#iaModal").hidden) cerrarModal(); });
function acciones(btns){ $("#iaModalActions").innerHTML=btns.map((b,i)=>`<button class="btn ${b.ghost?"ghost":""}" type="button" data-accion="${i}">${esc(b.t)}</button>`).join("");
  $$("#iaModalActions [data-accion]").forEach(el=>el.onclick=()=>btns[+el.dataset.accion].fn()); }
async function streamEn(el, parts){
  const id=S.modalId=(S.modalId||0)+1; let acc="";
  el.innerHTML=`<p class="pensando">Pensando</p>`;
  for await(const t of window.IA.stream(parts)){ if(id!==S.modalId) return null; acc+=t; el.innerHTML=md(acc); }
  return acc;
}
async function fotosDe(owner, r){ const out=[]; for(const f of (r.fotos||[]).slice(0,6)){ const d=await Fotos.leer(owner,f); if(d) out.push(b64(d)); } return out; }
function resumenDe(owner,id){ return (owner===S.me||owner==="local") ? S.perfil.resumenes.find(x=>x.id===id) : S.fr.res[owner]?.[id]; }

/* Resumir */
async function iaResumir(rid){
  const r=S.perfil.resumenes.find(x=>x.id===rid); if(!r) return;
  const body=abrirModal(`✨ Resumen de “${r.titulo}”`);
  try{
    const fotos=await fotosDe(S.me||"local", r);
    if(!r.contenido && !fotos.length){ body.innerHTML=`<p>Este resumen todavía no tiene contenido ni fotos. Agregá texto o una foto de tus apuntes y volvé a probar.</p>`; return; }
    const prompt=`Materia: ${nombreDe(r.materiaId)}. Tema: ${r.titulo}.
Hacé un resumen de estudio claro y ordenado de estos apuntes${fotos.length?" (las fotos son de mis apuntes: primero entendé lo que dicen, aunque la letra sea a mano)":""}.
Estructura: ## Idea principal (2-3 oraciones), ## Conceptos clave (lista con definiciones cortas), ## Fórmulas o pasos importantes (si hay), ## Para no olvidarse (3 tips o errores comunes).
${r.contenido?`\nApuntes en texto:\n${r.contenido}`:""}`;
    const txt=await streamEn(body,[prompt,...fotos]); if(txt==null) return;
    acciones([
      {t:"Agregar al contenido del resumen", fn:()=>{ r.contenido=(r.contenido?r.contenido.trim()+"\n\n— Resumen hecho con IA —\n":"")+txt.trim(); if(r.compartido) syncSharedRes(r); perfilCambio(); cerrarModal(); toast("Guardado en el resumen"); }},
      {t:"Copiar", ghost:true, fn:()=>{ navigator.clipboard?.writeText(txt).then(()=>toast("Copiado")); }},
      {t:"Preguntas de práctica", ghost:true, fn:()=>iaQuiz(S.me||"local", rid)}
    ]);
  }catch(e){ body.innerHTML=`<p>${esc(iaError(e))}</p>`; }
}

/* Preguntas de práctica */
async function iaQuiz(owner, rid){
  const r=resumenDe(owner,rid); if(!r) return;
  const body=abrirModal(`✨ Preguntas: ${r.titulo}`); const id=S.modalId=(S.modalId||0)+1;
  body.innerHTML=`<p class="pensando">Armando las preguntas</p>`;
  try{
    const fotos=await fotosDe(owner, r);
    const prompt=`Materia: ${matNombre(r)}. Tema: ${r.titulo}.
Generá 5 preguntas de opción múltiple para practicar para un examen universitario${r.contenido||fotos.length?", basadas en estos apuntes":" sobre este tema"}.
Mezclá preguntas de concepto y de aplicación. Cada una con 4 opciones y una sola correcta. Las opciones incorrectas tienen que ser creíbles.
Respondé SOLO con JSON con esta forma exacta:
{"preguntas":[{"pregunta":"...","opciones":["...","...","...","..."],"correcta":0,"explicacion":"por qué es la correcta, en 1-2 oraciones"}]}
${r.contenido?`\nApuntes:\n${r.contenido}`:""}`;
    const data=await window.IA.json([prompt,...fotos]); if(id!==S.modalId) return;
    const qs=(data.preguntas||[]).filter(q=>q.pregunta && Array.isArray(q.opciones) && q.opciones.length>=2);
    if(!qs.length) throw new Error("La IA no devolvió preguntas válidas");
    let puntos=0, respondidas=0;
    body.innerHTML=qs.map((q,i)=>`<div class="quiz-q" data-q="${i}"><div class="num">Pregunta ${i+1} de ${qs.length}</div><div class="enun">${esc(q.pregunta)}</div>
      ${q.opciones.map((o,j)=>`<button type="button" class="quiz-op" data-op="${j}">${esc(String.fromCharCode(65+j))}) ${esc(o)}</button>`).join("")}
      <div class="quiz-exp" hidden></div></div>`).join("")+`<div class="quiz-score" id="quizScore"></div>`;
    body.querySelectorAll(".quiz-q").forEach(box=>{
      const q=qs[+box.dataset.q];
      box.querySelectorAll(".quiz-op").forEach(b=>b.onclick=()=>{
        const j=+b.dataset.op, ok=j===Number(q.correcta);
        box.querySelectorAll(".quiz-op").forEach(x=>{ x.disabled=true; if(+x.dataset.op===Number(q.correcta)) x.classList.add("ok"); });
        if(!ok) b.classList.add("mal"); if(ok) puntos++; respondidas++;
        const ex=box.querySelector(".quiz-exp"); ex.hidden=false; ex.innerHTML=(ok?"✅ ¡Bien! ":"❌ ")+esc(q.explicacion||"");
        if(respondidas===qs.length) $("#quizScore").textContent=`Resultado: ${puntos} de ${qs.length} ${puntos===qs.length?"🎉":puntos>=qs.length*0.6?"👏":"💪 ¡a repasar!"}`;
      });
    });
    acciones([{t:"Otras preguntas", fn:()=>iaQuiz(owner,rid)},{t:"Cerrar", ghost:true, fn:cerrarModal}]);
  }catch(e){ if(id===S.modalId) body.innerHTML=`<p>${esc(iaError(e))}</p>`; }
}

/* Ayuda en dudas */
async function iaDuda(key){
  const [owner,id]=key.split("|"); const d=S.fr.dudas[owner]?.[id]; if(!d) return;
  const body=abrirModal("✨ Ayuda de la IA");
  try{
    const txt=await streamEn(body,[`Un compañero de ${matNombre(d)} tiene esta duda:\n\n"${d.texto}"\n\nExplicale de forma clara y paso a paso para que la entienda. Si falta información, decí qué supuestos hacés.`]);
    if(txt==null) return;
    acciones([
      {t:"Publicar como respuesta", fn:()=>{ const rid=uid(); qWrite(()=>Store.db.doc(`dir/${S.me}/respuestas/${rid}`).set({dudaOwner:owner, dudaId:id, texto:txt.trim(), ia:true, creado:Date.now()})); cerrarModal(); toast("Respuesta publicada"); }},
      {t:"Seguir en el Tutor IA", ghost:true, fn:()=>{ cerrarModal(); irA("ia"); S.iaHist.push({role:"user",text:`Duda de ${matNombre(d)}: ${d.texto}`},{role:"model",text:txt}); guardarHistIA(); renderIAChat(); }}
    ]);
  }catch(e){ body.innerHTML=`<p>${esc(iaError(e))}</p>`; }
}

/* Consejos para el plan */
async function iaPlan(){
  const exams=Object.values(S.eventos).filter(e=>diasHasta(e.fecha)>=0).sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(0,10);
  const body=abrirModal("✨ Consejos para tu plan");
  if(!exams.length){ body.innerHTML="<p>No tenés exámenes próximos cargados. Agregalos en Calendario y volvé a probar.</p>"; return; }
  const dias=(S.perfil.planDias||[]).map(d=>DIAS[d]).join(", ");
  const detalle=exams.map(e=>{ const res=S.perfil.resumenes.filter(r=>r.materiaId===e.materiaId);
    return `- ${TIPO[e.tipo]||e.tipo} de ${nombreDe(e.materiaId)} (“${e.titulo}”) en ${diasHasta(e.fecha)} días. Resúmenes: ${res.filter(r=>r.hecho).length} hechos de ${res.length}. Pendientes: ${res.filter(r=>!r.hecho).map(r=>r.titulo).join(", ")||"ninguno"}.${e.temas?" Temas: "+e.temas:""}`; }).join("\n");
  const tareas=(S.perfil.plan?.tareas||[]); const atr=tareas.filter(t=>t.fecha<hoyISO() && !tareaHecha(t)).length;
  try{
    await streamEn(body,[`Soy estudiante universitario. Puedo estudiar estos días: ${dias||"todos"}. Hoy es ${new Date().toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"})}.
Mis próximos exámenes:\n${detalle}\n${atr?`Tengo ${atr} tareas de estudio atrasadas.`:""}
Dame consejos concretos y realistas: qué priorizar esta semana, cómo repartir el tiempo entre materias, y técnicas de estudio que sirvan para estos exámenes. Sé breve (máximo 250 palabras) y organizado.`]);
    acciones([{t:"Cerrar", ghost:true, fn:cerrarModal}]);
  }catch(e){ body.innerHTML=`<p>${esc(iaError(e))}</p>`; }
}
$("#planIA").onclick=iaPlan;

/* Tutor (chat) */
function guardarHistIA(){ S.iaHist=S.iaHist.slice(-30); Store.lsSet("iaHist", S.iaHist.map(m=>({role:m.role, text:m.text, foto:!!m.foto}))); }
function renderIAChat(){
  const sel=$("#iaMateria"), v=sel.value;
  sel.innerHTML=`<option value="">General</option>`+materiasOrdenadas().map(m=>`<option value="${m.id}">${esc(m.nombre)}</option>`).join("");
  if(S.materias[v]) sel.value=v;
  const box=$("#iaMsgs");
  box.innerHTML = S.iaHist.length ? S.iaHist.map(m=>m.role==="user"
      ? `<div class="msg mine">${m.foto?`<div class="sub" style="color:inherit;opacity:.8">📷 Foto adjunta</div>`:""}${linkify(m.text)}</div>`
      : `<div class="msg ia ia-out"><span class="au">Tutor IA ✨</span>${md(m.text)}</div>`).join("")
    : `<p class="empty-msg" style="text-align:center">Hacele una pregunta o elegí una opción de arriba.</p>`;
  box.scrollTop=box.scrollHeight;
  const adj=$("#iaAdjunto"); adj.hidden=!S.iaAdj;
  adj.innerHTML=S.iaAdj?`<div class="thumb"><img src="${esc(S.iaAdj)}" data-zoom alt="Foto adjunta"><button type="button" id="iaQuitarFoto" aria-label="Quitar foto">×</button></div>`:"";
}
async function enviarIA(){
  const f=$("#fIA"); let texto=f.texto.value.trim(); const foto=S.iaAdj;
  if(!texto && !foto) return; if(S.iaOcupado) return;
  if(!texto) texto="Pasá a texto y resumí esta foto de mis apuntes.";
  const mat=S.materias[$("#iaMateria").value];
  const historial=S.iaHist.slice(-16).map(m=>({role:m.role, parts:[{text:m.text||"(foto)"}]}));
  while(historial.length && historial[0].role!=="user") historial.shift();
  S.iaHist.push({role:"user", text:texto, foto:!!foto}); S.iaAdj=null; f.reset(); f.texto.style.height="";
  renderIAChat();
  const box=$("#iaMsgs"); const burbuja=document.createElement("div"); burbuja.className="msg ia ia-out";
  burbuja.innerHTML=`<span class="au">Tutor IA ✨</span><p class="pensando">Pensando</p>`; box.appendChild(burbuja); box.scrollTop=box.scrollHeight;
  S.iaOcupado=true; $("#iaEnviar").disabled=true;
  let acc="";
  try{
    const parts=[(mat?`[Materia: ${mat.nombre}] `:"")+texto]; if(foto) parts.push(b64(foto));
    for await(const t of window.IA.chat(historial).enviar(parts)){ acc+=t; burbuja.innerHTML=`<span class="au">Tutor IA ✨</span>${md(acc)}`; box.scrollTop=box.scrollHeight; }
    S.iaHist.push({role:"model", text:acc||"(sin respuesta)"});
  }catch(e){ burbuja.innerHTML=`<span class="au">Tutor IA ✨</span><p>${esc(iaError(e))}</p>`; S.iaHist.pop(); }
  S.iaOcupado=false; $("#iaEnviar").disabled=false; guardarHistIA();
  if(acc) renderIAChat();
}
$("#fIA").onsubmit=e=>{ e.preventDefault(); enviarIA(); };
$("#fIA").texto.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); enviarIA(); } });
$("#fIA").texto.addEventListener("input", e=>{ const t=e.target; t.style.height="auto"; t.style.height=Math.min(t.scrollHeight,160)+"px"; });
$("#iaNueva").onclick=()=>{ if(S.iaHist.length && !confirm("¿Empezar una conversación nueva? Se borra la actual.")) return; S.iaHist=[]; S.iaAdj=null; guardarHistIA(); renderIAChat(); };
$("#iaFoto").onchange=async e=>{ const file=e.target.files?.[0]; e.target.value=""; if(!file) return;
  try{ S.iaAdj=await comprimir(file); if(!S.iaAdj) toast("La foto es muy pesada"); renderIAChat(); $("#fIA").texto.focus(); }catch(err){ toast("No se pudo leer la foto"); } };
$("#iaSug").addEventListener("click", e=>{ const b=e.target.closest("[data-iasug]"); if(!b) return; const t=$("#fIA").texto; t.value=b.dataset.iasug; t.focus();
  if(b.dataset.iasug.includes("foto")) $("#iaFoto").click(); });

/* ---------- eventos de UI ---------- */
$("#tabs").addEventListener("click", e=>{
  const b=e.target.closest("button[data-tab]"); if(!b) return;
  $$("#tabs button").forEach(x=>x.setAttribute("aria-selected", x===b));
  $$("section.panel").forEach(p=>p.classList.toggle("on", p.id==="p-"+b.dataset.tab));
});
$("#calPrev").onclick=()=>{ S.calMes.setMonth(S.calMes.getMonth()-1); renderCalendario(); };
$("#calNext").onclick=()=>{ S.calMes.setMonth(S.calMes.getMonth()+1); renderCalendario(); };

document.addEventListener("click", e=>{
  const t=e.target;
  if(t.dataset.mat){ const id=t.closest("[data-mat]").dataset.mat; const a=S.perfil.materias;
    S.perfil.materias = a.includes(id)? a.filter(x=>x!==id) : [...a,id]; perfilCambio(); return; }
  const chip=t.closest("[data-mat]"); if(chip && !t.dataset.mat){ chip.click(); return; }
  if(t.dataset.fres){ S.filtroRes=t.dataset.fres; renderResumenes(); return; }
  if(t.dataset.delres){ const r=S.perfil.resumenes.find(x=>x.id===t.dataset.delres); if(!confirm("¿Borrar este resumen?")) return; if(r?.compartido) syncSharedRes(r,true); (r?.fotos||[]).forEach(f=>Fotos.borrar(f));
    S.perfil.resumenes=S.perfil.resumenes.filter(x=>x.id!==t.dataset.delres); perfilCambio(); toast("Resumen borrado"); return; }
  const gb=t.closest("[data-grupo]"); if(gb){ abrirGrupo(gb.dataset.grupo); return; }
  if(t.dataset.zoom!==undefined && t.src){ abrirLightbox(t.src); return; }
  if(t.dataset.delfoto){ const [rid,fid]=t.dataset.delfoto.split("|"); if(confirm("¿Borrar esta foto?")) borrarFotoResumen(rid,fid); return; }
  if(t.dataset.ir){ irA(t.dataset.ir); return; }
  if(t.id==="iaQuitarFoto"){ S.iaAdj=null; renderIAChat(); return; }
  if(t.dataset.iares){ iaResumir(t.dataset.iares); return; }
  if(t.dataset.iaquiz){ const [o,id]=t.dataset.iaquiz.split("|"); iaQuiz(o,id); return; }
  if(t.dataset.iaduda){ iaDuda(t.dataset.iaduda); return; }
  if(t.dataset.aceptar){ saveMyDir({conecto:[...myDir().conecto, t.dataset.aceptar]}); toast("¡Ahora son amigos!"); return; }
  if(t.dataset.rechazar){ saveMyDir({rechazados:[...(myDir().rechazados||[]), t.dataset.rechazar]}); toast("Solicitud rechazada"); return; }
  if(t.dataset.agregar){ const x=t.dataset.agregar; saveMyDir({conecto:[...myDir().conecto, x], rechazados:(myDir().rechazados||[]).filter(y=>y!==x)}); toast("Solicitud enviada"); return; }
  if(t.dataset.cancelar){ saveMyDir({conecto:myDir().conecto.filter(y=>y!==t.dataset.cancelar)}); toast("Solicitud cancelada"); return; }
  if(t.dataset.quitar){ if(!confirm("¿Quitar de tus amigos? Van a dejar de ver lo que comparten.")) return; const x=t.dataset.quitar;
    saveMyDir({conecto:myDir().conecto.filter(y=>y!==x), rechazados:[...(myDir().rechazados||[]), x]}); toast("Amigo quitado"); return; }
  if(t.dataset.copiar){ const [o,id]=t.dataset.copiar.split("|"); const r=S.fr.res[o]?.[id]; if(!r) return;
    const nom=matNombre(r); let mat=Object.values(S.materias).find(m=>norm(m.nombre)===norm(nom));
    if(!mat){ const mid=uid(); mat={id:mid, nombre:nom, anio:1, cuatri:"1", profesor:"", color:matColor(r)}; S.perfil.catMaterias[mid]=mat; }
    const nuevoId=uid(); const fotosAmigo=r.fotos||[];
    if(fotosAmigo.length) Promise.all(fotosAmigo.map(async f=>{ const d=await Fotos.leer(o,f); if(!d) return null; const nf=uid(); await Fotos.guardar(nf,d,nuevoId); return nf; }))
      .then(ids=>{ const mio=S.perfil.resumenes.find(x=>x.id===nuevoId); if(mio){ mio.fotos=ids.filter(Boolean); perfilCambio(); } }).catch(e=>console.warn(e));
    S.perfil.resumenes.push({id:nuevoId, materiaId:mat.id, titulo:`${r.titulo} (de ${nombre(o)})`, contenido:r.contenido||"", hecho:false, compartido:false});
    perfilCambio(); toast("Guardado en tus resúmenes"); return; }
  if(t.dataset.resolver){ qWrite(()=>Store.db.doc(`dir/${S.me}/dudas/${t.dataset.resolver}`).update({resuelta:true})); toast("Duda marcada como resuelta"); return; }
  if(t.dataset.delduda){ if(!confirm("¿Borrar esta duda?")) return; qWrite(()=>Store.db.doc(`dir/${S.me}/dudas/${t.dataset.delduda}`).delete()); return; }
  if(t.dataset.delresp){ qWrite(()=>Store.db.doc(`dir/${S.me}/respuestas/${t.dataset.delresp}`).delete()); return; }
  if(t.dataset.aprobar){ const id=t.dataset.aprobar; const n=$(`[data-nfinal="${id}"]`).value;
    S.perfil.estados[id]="aprobada"; if(n) S.perfil.notasFinal[id]=Number(n); perfilCambio(); toast("¡Felicitaciones! Final aprobado"); return; }
  if(t.dataset.del){ const col=t.dataset.del, id=t.dataset.id;
    if(col==="propio"){ S.perfil.propios=S.perfil.propios.filter(p=>p.id!==id); perfilCambio(); return; }
    if(col==="eventos"){ if(!confirm("¿Borrar esta fecha?")) return; delete S.perfil.catEventos[id]; perfilCambio(); toast("Fecha borrada"); return; }
    if(col==="materias"){ const m=S.materias[id]; if(!confirm(`¿Borrar “${m?.nombre}”? También se borran sus fechas y resúmenes.`)) return;
      delete S.perfil.catMaterias[id];
      for(const [k,e] of Object.entries(S.perfil.catEventos)) if(e.materiaId===id) delete S.perfil.catEventos[k];
      S.perfil.resumenes.filter(r=>r.materiaId===id && r.compartido).forEach(r=>syncSharedRes(r,true));
      S.perfil.resumenes=S.perfil.resumenes.filter(r=>r.materiaId!==id);
      S.perfil.propios=S.perfil.propios.filter(p=>p.materiaId!==id);
      delete S.perfil.estados[id]; delete S.perfil.notasFinal[id];
      perfilCambio(); toast("Materia borrada"); return; } }
});
document.addEventListener("change", e=>{
  const t=e.target;
  if(t.dataset.res){ const r=S.perfil.resumenes.find(x=>x.id===t.dataset.res); if(r){ r.hecho=t.checked; if(r.compartido) syncSharedRes(r); perfilCambio(); } }
  if(t.dataset.rescont){ const r=S.perfil.resumenes.find(x=>x.id===t.dataset.rescont); if(r){ r.contenido=t.value; if(r.compartido) syncSharedRes(r); perfilCambio(); toast("Contenido guardado"); } }
  if(t.dataset.fotores && t.files?.[0]){ agregarFotoResumen(t.dataset.fotores, t.files[0]); t.value=""; return; }
  if(t.id==="fotoChat" && t.files?.[0]){ enviarFotoChat(t.files[0]); t.value=""; return; }
  if(t.dataset.plandia!==undefined){ S.perfil.planDias=$$("[data-plandia]:checked").map(i=>Number(i.dataset.plandia)); perfilCambio(); return; }
  if(t.dataset.tarea){ const tk=S.perfil.plan?.tareas.find(x=>x.id===t.dataset.tarea); if(tk){ tk.hecho=t.checked;
      if(tk.resumenId){ const r=S.perfil.resumenes.find(x=>x.id===tk.resumenId); if(r){ r.hecho=t.checked; if(r.compartido) syncSharedRes(r); } }
      perfilCambio(); } return; }
  if(t.dataset.resshare){ const r=S.perfil.resumenes.find(x=>x.id===t.dataset.resshare); if(r){ r.compartido=t.checked; syncSharedRes(r,false,true); perfilCambio(); toast(r.compartido?"Compartido con tus amigos":"Dejaste de compartirlo"); } }
  if(t.id==="filtroResAmigos"){ S.filtroResAmigos=t.value; renderResAmigos(); }
  if(t.id==="filtroDudaMat"){ S.filtroDudaMat=t.value; renderDudas(); }
  if(t.id==="filtroDudaEstado"){ S.filtroDudaEstado=t.value; renderDudas(); }
  if(t.dataset.estado){ S.perfil.estados[t.dataset.estado]=t.value; perfilCambio(); toast("Estado actualizado"); }
  if(t.dataset.nota){ S.perfil.notas[t.dataset.nota]=t.value; perfilCambio(); }
  if(t.dataset.notaap){ if(t.value) S.perfil.notasFinal[t.dataset.notaap]=Number(t.value); else delete S.perfil.notasFinal[t.dataset.notaap]; perfilCambio(); }
});
document.addEventListener("toggle", e=>{
  const d=e.target; if(!(d instanceof HTMLDetailsElement)) return;
  if(d.dataset.rid){ const antes=S.openRes.has(d.dataset.rid); d.open?S.openRes.add(d.dataset.rid):S.openRes.delete(d.dataset.rid);
    if(d.open && !antes){ const r=S.perfil.resumenes.find(x=>x.id===d.dataset.rid); if((r?.fotos||[]).length) setTimeout(renderResumenes,0); } }
  if(d.dataset.respkey){ d.open?S.openResp.add(d.dataset.respkey):S.openResp.delete(d.dataset.respkey); }
}, true);
document.addEventListener("submit", e=>{
  const f=e.target; if(!f.dataset.responder) return; e.preventDefault();
  const [owner,id]=f.dataset.responder.split("|"); const texto=f.texto.value.trim(); if(!texto) return;
  const rid=uid(); qWrite(()=>Store.db.doc(`dir/${S.me}/respuestas/${rid}`).set({dudaOwner:owner, dudaId:id, texto, creado:Date.now()}));
  f.reset(); toast("Respuesta enviada");
});
$("#tabs").addEventListener("click", e=>{ if(e.target.closest('[data-tab="chat"]')){ renderChat._jump=true; renderChat(); } if(e.target.closest('[data-tab="ia"]')) renderIAChat(); });
$("#fGrupo").onsubmit=e=>{ e.preventDefault(); const f=e.target; const nombreG=f.nombre.value.trim(); if(!nombreG) return;
  const miembros=[S.me, ...$$('#grupoMiembros input:checked').map(i=>i.value)];
  const gid=uid(); const data={nombre:nombreG, creador:S.me, miembros, creado:Date.now()};
  S.grupos[gid]={id:gid,...data};
  qWrite(()=>Store.db.doc("grupos/"+gid).set(data));
  f.reset(); $$('#grupoMiembros input').forEach(i=>i.checked=false); $("#nuevoGrupo").open=false; abrirGrupo(gid); toast("Grupo creado"); };
$("#fMsg").onsubmit=e=>{ e.preventDefault(); const f=e.target; const texto=f.texto.value.trim(); const gid=S.chatActivo; if(!texto||!gid) return;
  const id=uid(); const m={grupoId:gid, texto, creado:Date.now()};
  S.chatMsgs[S.me]={...(S.chatMsgs[S.me]||{}), [id]:{id,...m}}; renderChat._jump=true; renderChat();
  qWrite(()=>Store.db.doc(`dir/${S.me}/mensajes/${id}`).set(m));
  f.reset(); f.texto.style.height=""; };
$("#fMsg").texto.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); $("#fMsg").requestSubmit(); } });
$("#fMsg").texto.addEventListener("input", e=>{ const t=e.target; t.style.height="auto"; t.style.height=Math.min(t.scrollHeight,140)+"px"; });
$("#chatBack").onclick=()=>{ S.chatActivo=null; renderChat(); };
$("#chatAddBtn").onclick=()=>{ $("#chatAdd").hidden=!$("#chatAdd").hidden; };
$("#chatAddOk").onclick=()=>{ const g=S.grupos[S.chatActivo]; if(!g) return; const nuevos=$$('#chatAddPick input:checked').map(i=>i.value); if(!nuevos.length) return;
  const miembros=[...new Set([...(g.miembros||[]), ...nuevos])]; g.miembros=miembros;
  qWrite(()=>Store.db.doc("grupos/"+g.id).update({miembros})); $("#chatAdd").hidden=true; syncChatSubs(); renderChat(); toast("Amigos agregados"); };
$("#chatLeave").onclick=()=>{ const g=S.grupos[S.chatActivo]; if(!g || !confirm(`¿Salir de “${g.nombre}”?`)) return;
  const miembros=(g.miembros||[]).filter(x=>x!==S.me);
  qWrite(()=> miembros.length ? Store.db.doc("grupos/"+g.id).update({miembros}) : Store.db.doc("grupos/"+g.id).delete());
  delete S.grupos[g.id]; S.chatActivo=null; syncChatSubs(); renderChat(); toast("Saliste del grupo"); };
$("#buscarInput").addEventListener("input", e=>{
  S.q=e.target.value; renderAmigos();
  if(S.userApi && S.q.trim()) S.userApi.search(S.q.trim()).then(hits=>{
    S.hits=hits.filter(h=>h.id && !h.isMe); hits.forEach(h=>{ S.names[h.id]={name:h.name, avatar:h.avatarUrl}; }); renderAmigos(); });
});
$("#fDuda").onsubmit=e=>{ e.preventDefault(); const d=formData(e.target); if(!d.materiaId) return toast("Primero cargá tus materias");
  const id=uid(); qWrite(()=>Store.db.doc(`dir/${S.me}/dudas/${id}`).set({materiaId:d.materiaId, materiaNombre:nombreDe(d.materiaId), materiaColor:colorDe(d.materiaId), texto:d.texto.trim(), creado:Date.now(), resuelta:false}));
  e.target.texto.value=""; toast("Duda publicada"); };
function formData(f){ return Object.fromEntries(new FormData(f).entries()); }
$("#fResumen").onsubmit=e=>{ e.preventDefault(); const d=formData(e.target); if(!d.materiaId) return toast("Primero elegí tus materias");
  S.perfil.resumenes.push({id:uid(), materiaId:d.materiaId, titulo:d.titulo.trim(), hecho:false}); e.target.titulo.value=""; perfilCambio(); toast("Resumen agregado"); };
$("#fMateria").onsubmit=e=>{ e.preventDefault(); const d=formData(e.target);
  const nom=d.nombre.trim(); if(!nom) return;
  if(Object.values(S.materias).some(m=>norm(m.nombre)===norm(nom))) return toast("Ya tenés una materia con ese nombre");
  const id=uid(); S.perfil.catMaterias[id]={id, nombre:nom, anio:Number(d.anio), cuatri:d.cuatri, profesor:d.profesor.trim(), color:d.color};
  e.target.nombre.value=""; e.target.profesor.value=""; perfilCambio(); toast("Materia agregada"); };
$("#fEvento").onsubmit=e=>{ e.preventDefault(); const d=formData(e.target); if(!d.materiaId) return toast("Cargá una materia primero");
  const id=uid(); S.perfil.catEventos[id]={id, materiaId:d.materiaId, tipo:d.tipo, titulo:d.titulo.trim(), fecha:d.fecha, hora:d.hora, aula:d.aula.trim(), temas:d.temas.trim()};
  ["titulo","temas","fecha","hora","aula"].forEach(k=>e.target[k].value=""); perfilCambio(); toast("Fecha agregada"); };
let carreraTimer=null;
$("#fCarrera").addEventListener("input", e=>{ const f=e.currentTarget; clearTimeout(carreraTimer);
  carreraTimer=setTimeout(()=>{ S.perfil.carrera=f.carrera.value.trim(); S.perfil.universidad=f.universidad.value.trim(); perfilCambio(); renderWho(); }, 700); });
$("#fCarrera").addEventListener("submit", e=>e.preventDefault());

/* ---------- arranque ---------- */
let enviadasAntes=new Set();
function renderWho(){
  const car=[S.perfil.carrera, S.perfil.universidad].filter(Boolean).join(" · ");
  $("#who").innerHTML = S.mode==="local" ? `<span class="badge local">Modo local</span>` : `${esc(S.miNombre||"Estudiante")}${car?` <span class="sub">· ${esc(car)}</span>`:""}`;
}
async function init(){
  renderAll();
  const hasClaude = typeof window.claude?.use === "function";
  const [db, user] = hasClaude ? await Promise.all([window.claude.use("db"), window.claude.use("user")]) : [null,null];
  let id=null;
  if(db && user){ try{ id = await user.id(); }catch(e){} }
  if(db && id){
    Store.db=db; Store.uid=id; S.mode="db";
    try{ S.miNombre = await user.name(); }catch(e){}
  } else {
    S.mode="local";
  }
  const p = await Store.loadPerfil().catch(()=>null);
  if(p) S.perfil = {...S.perfil, ...p};
  derivar(); renderWho(); estadoIA();
  if(S.mode==="db"){
    S.userApi=user; S.me=id;
    try{
      const d=await db.doc("dir/"+id).get();
      if(d.exists) S.dir[id]={conecto:[], rechazados:[], materias:[], ...d.data()};
      else { S.dir[id]={conecto:[], rechazados:[], ...dirPublico()}; await db.doc("dir/"+id).set(S.dir[id]); }
      const pub=dirPublico(), cur=S.dir[id];
      if(JSON.stringify(cur.materias||[])!==JSON.stringify(pub.materias) || (cur.carrera||"")!==pub.carrera || (cur.universidad||"")!==pub.universidad) saveMyDir(pub);
    }catch(e){ console.warn(e); }
    db.collection("dir").onSnapshot(s=>{
      const o={}; s.docs.forEach(d=>{ o[d.id]=d.data(); });
      if(!o[id] && S.dir[id]) o[id]=S.dir[id];
      const recAntes=S.dirListo?new Set(recibidas()):null, amAntes=S.dirListo?new Set(amigos()):null;
      S.dir=o; syncFriendSubs(); renderAll();
      if(recAntes){
        recibidas().filter(x=>!recAntes.has(x)).forEach(async x=>notificar("Nueva solicitud de amistad", `${await nombreAsync(x)} quiere ser tu amigo/a`, "amigos", "sol:"+x+":"+Date.now()));
        amigos().filter(x=>!amAntes.has(x) && enviadasAntes.has(x)).forEach(async x=>notificar("¡Solicitud aceptada!", `${await nombreAsync(x)} ahora es tu amigo/a`, "amigos", "acep:"+x));
      }
      enviadasAntes=new Set(enviadas()); S.dirListo=true;
    }, e=>console.warn(e));
    syncFriendSubs();
    db.collection("grupos").where("miembros","array-contains",id).onSnapshot(s=>{
      S.grupos=toObj(s);
      if(S.chatActivo && !S.grupos[S.chatActivo]) S.chatActivo=null;
      syncChatSubs(); renderChat();
    }, e=>console.warn(e));
  }
  renderAll();
  setTimeout(()=>chequearExamenes(false), 2500);
}
init();