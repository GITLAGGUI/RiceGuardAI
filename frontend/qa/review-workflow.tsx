// Dev-only entry; not included in the production build or routing.
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter,RouterProvider,useParams} from 'react-router-dom';
import {OperationsContext,type Store} from '../src/operations/store';
import {ReviewWorkspace} from '../src/operations/Upload';
import type {OperationsData} from '../src/operations/domain';
import '../src/operations/operations.css';
async function operation(action:string,payload:unknown={}) {
 const r=await fetch('/__qa/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;
}
function FixturePost(){const {slug}=useParams();const [post,setPost]=useState<any>();useEffect(()=>{operation('public-fixture',{slug}).then(setPost);},[slug]);return post?<article><h1>{post.title}</h1><p>{post.summary}</p><p>{post.assessment_label}</p><img src={post.cover_url} width="400" alt="Controlled QA overlay"/><p>Map location: {post.approximate_lat ?? 'No pin'}</p><a href="/admin/review?survey=11111111-0000-4000-8000-000000000001">Back to review</a></article>:<p>Loading isolated public projection…</p>;}
function Harness(){
 const [data,setData]=useState<OperationsData>();const [error,setError]=useState('');
 const refresh=async()=>setData(await operation('snapshot'));
 useEffect(()=>{let active=true;operation('snapshot').then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 if(!data)return <p>{error || 'Opening isolated PostgreSQL fixture…'}</p>;
 const value:Store={data,demo:false,loading:false,error:null,operation,refresh,addSurvey:async()=>{throw Error('No uploads in QA');},review:async()=>{throw Error('Use image review');},
  saveDraft:async(id,body,action,title,expectedRevision)=>{await operation('save-draft',{id,body,action,title,advisory_revision:expectedRevision});await refresh();},
  generateAdvisory:async()=>{throw Error('AI requests are disabled in this isolated fixture.');},
  publish:async id=>{const b=data.bulletins.find(b=>b.id===id);const r=await operation('publish',{id,advisory_revision:b?.advisory_revision});await refresh();return r;},
  addContact:async()=>{throw Error('No contacts in QA');},reset:()=>{}};
 return <OperationsContext.Provider value={value}><div className="rg-public"><div style={{background:'#fff2c7',padding:'12px',fontWeight:700}}>ISOLATED QA · Synthetic records · Archived overlay for layout testing · No live Supabase, AI, uploads or SMS</div><main style={{maxWidth:1280,margin:'auto',padding:16}}><RouterProvider router={router}/></main></div></OperationsContext.Provider>;
}
const router=createBrowserRouter([{path:'/admin/review',element:<ReviewWorkspace/>},{path:'/advisories/:slug',element:<FixturePost/>},{path:'*',element:<ReviewWorkspace/>}]);
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);
