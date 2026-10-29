import { PanelRightOpen, PanelRightClose, Play } from 'lucide-react'
import { CREATE_PRESETS, type CreatePreset } from '../../../lib/render/create-presets'
import { Select } from '../ui/Select'
import { roleForModel } from '../../../lib/render/preset-models'
import { STUDIO_MODELS } from '../../../lib/render/studio-contract'
import { useCreateStore } from '../../../stores/createStore'
import { useCloudCatalogStore } from '../../../stores/cloudCatalogStore'

/** Die Presets.
 *
 *  Eine Schiene am rechten Rand, die von 52 auf 260 Pixel aufgeht. Desktop-
 *  Port (P6): der Web-Quelle Handy-Zweig (`useIsMobile`, das Blatt ueber dem
 *  Inhalt) entfaellt ersatzlos, der Desktop kennt kein Handy-Layout.
 *
 *  Die Schiene erscheint NUR auf der Wolken-Spur (Portplan Abschnitt 1
 *  Punkt 10, Abschnitt 3), UND nur, wenn der lebende Katalog Studio-Modelle
 *  fuehrt: ein aelterer Server, der `quote_required` bei keinem Eintrag
 *  mitschickt, sagt damit selbst, dass er das Studio nicht kennt (Portplan
 *  Abschnitt 4, "nie eine Serverversion fest verdrahten": die Erkennung
 *  laeuft ausschliesslich ueber das Vorhandensein des Feldes). Ohne diese
 *  zweite Bedingung wuerde die Schiene bei so einem Server leer klicken:
 *  jedes Preset stuende da, aber `studioQuote()` liefe sofort in
 *  "This feature needs a newer LU Cloud server."`.
 *
 *  Optik (21.09.2026, Beanstandung des Eigners "komisches grau, komische
 *  edges"): die Schiene stand auf der weichen Akzentflaeche mit einem
 *  Akzentumriss bei 20 Prozent Deckung, also auf einer violett getoenten
 *  Flaeche, die ueber der schwarzen Leinwand als mittleres Grau mit
 *  Farbstich las. Sie steht jetzt auf derselben schwarzen Modalflaeche wie
 *  das Was-ist-neu-Blatt (#202020) mit der Haarlinie des Hauses bei acht
 *  Prozent Weiss. Violett ist nur noch Akzent: die Ueberschrift, der
 *  Continue-Knopf und der Umriss der Karte unter dem Zeiger.
 *
 *  Klassennamen stehen hier bewusst als Prosa: Tailwind liest jede Datei
 *  als Text, also wuerde ein Name im Kommentar eine Regel ins Bundle
 *  schreiben, die niemand aufruft (keine-klasse-aus-prosa.test.ts). */
export function PresetShelf({onSelect,resume,open,onOpenChange}:{onSelect:(p:CreatePreset)=>void;resume?:{title:string;onResume:()=>void}|null;open:boolean;onOpenChange:(o:boolean)=>void}) {
  const backend=useCreateStore(s=>s.backend),generating=useCreateStore(s=>s.isGenerating)
  const catalogHasStudio=useCloudCatalogStore(s=>s.models.some(m=>m.quote_required))
  const setOpen=onOpenChange
  if(backend!=='cloud'||!catalogHasStudio)return null
  return <aside aria-label="Presets" style={{width:open?260:52}} className="my-2 mr-2 flex shrink-0 flex-col overflow-hidden rounded-xl bg-lu-base ring-1 ring-white/[0.08] transition-[width] duration-150">
    <div className={`flex shrink-0 items-center ${open?'gap-2 border-b border-white/[0.08] px-3 py-2':'flex-col gap-1 py-2'}`}>
      <button aria-label={open?'Collapse presets':'Expand presets'} aria-expanded={open} onClick={()=>setOpen(!open)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-white/5 hover:text-gray-200">{open?<PanelRightClose size={16}/>:<PanelRightOpen size={16}/>}</button>
      {open?<><span className="t-control font-medium text-lu-accent">Presets · {CREATE_PRESETS.length}</span>
      {resume&&<button onClick={resume.onResume} title={resume.title} className="ml-auto flex shrink-0 items-center gap-1 rounded-md bg-lu-accent/15 px-2 py-1 t-micro font-medium text-lu-accent hover:bg-lu-accent/25"><Play size={9}/>Continue</button>}</>
      :<><div className="my-1 h-px w-6 bg-white/10"/>{resume&&<button aria-label={`Continue ${resume.title}`} onClick={resume.onResume} className="flex h-7 w-7 items-center justify-center rounded-md bg-lu-accent/15 text-lu-accent hover:bg-lu-accent/25"><Play size={11}/></button>}<button onClick={()=>setOpen(true)} className="py-3 t-micro font-medium tracking-wide text-lu-accent [writing-mode:vertical-rl]">Presets</button></>}
    </div>
    {open&&<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{CREATE_PRESETS.map(p=><button key={p.id} disabled={generating} onClick={()=>onSelect(p)} className="group block w-full overflow-hidden rounded-lg bg-black/25 text-left ring-1 ring-white/[0.08] hover:ring-lu-accent/60 disabled:opacity-40"><img src={`/create-presets/${p.id}.webp?v=2`} alt={p.title} loading="lazy" className="aspect-video w-full object-cover"/><span className="block px-2.5 py-2"><span className="block t-control font-medium text-gray-200">{p.title}</span><span className="mt-1 block t-micro leading-4 text-gray-400">{p.summary}</span></span></button>)}</div>}
    {open&&<div className="shrink-0 border-t border-white/[0.08] p-3"><Select size="sm" ariaLabel="Explore individual cloud models" placeholder="Individual cloud models…" value="" className="w-full" options={Object.entries(STUDIO_MODELS).map(([id,m])=>({value:id,label:m.label}))} onChange={id=>{const m=STUDIO_MODELS[id];if(m)onSelect({id,title:m.label,summary:'Configure your generation below.',category:'Video',adult:m.adult,accent:'',steps:[{model:id,kind:m.kind,op:'studio',title:m.label,role:roleForModel(id)??'image'}]})}}/></div>}
  </aside>
}
