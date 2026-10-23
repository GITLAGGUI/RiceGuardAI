import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {GeminiConnectionPage} from '../src/operations/GeminiConnection';
import '../src/styles/index.css';
import '../src/operations/operations.css';
import '../src/operations/accessibility.css';

if(location.hostname!=='127.0.0.1')throw new Error('Loopback fixture only');
const variant=new URLSearchParams(location.search).get('fixture') || 'consent';
const request='11111111-1111-4111-8111-111111111111';
window.fetch=async(input,init)=>{
  const path=String(input);
  if(!path.startsWith('/api/advisory-oauth/owner/'))throw new Error('External requests forbidden in fixture');
  const action=path.split('/').at(-1);
  const json=(data:unknown,status=200)=>Promise.resolve(Response.json(data,{status}));
  if(action==='preview')return json({app_name:'RiceGuardAI Advisory',scopes:['evidence:read','advisory:submit'],expires_at:new Date(Date.now()+(variant==='expired'?-1000:240000)).toISOString(),eligible_surveys:variant==='empty'?[]:[{id:request,label:'Synthetic survey: sample rice field evidence, not a real farm'}]});
  if(action==='grants')return json({grants:[]});
  // Real Allow/registration writes never happen from this visual fixture.
  if(init?.method==='POST')return json({error:'synthetic_write_blocked',message:'Visual fixture only. No permission or record was created.'},409);
  throw new Error('Unknown fixture action');
};
createRoot(document.getElementById('root')!).render(<><aside style={{padding:12,background:'#fff3cd',color:'#3b3112',fontWeight:700}}>SYNTHETIC LOCAL PREVIEW. No real login, permission grant or Gemini connection.</aside><main style={{maxWidth:960,margin:'0 auto',padding:20}}><MemoryRouter initialEntries={[variant==='owner'?'/admin/connect/gemini':`/admin/connect/gemini?request=${request}`]}><GeminiConnectionPage/></MemoryRouter></main></>);
