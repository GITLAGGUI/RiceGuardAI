// Layout-only fixture. No gateway, database, auth, queue or send requests exist.
import {createRoot} from 'react-dom/client';
import {SmsDelivery} from '../src/operations/SmsDelivery';
import {MapPage} from '../src/operations/Admin';
import {MemoryRouter} from 'react-router-dom';
import {OperationsContext,type Store} from '../src/operations/store';
import {sampleData} from '../src/operations/data';
import '../src/styles/index.css';
import '../src/operations/operations.css';
const data={...sampleData,bulletins:[{...sampleData.bulletins[0],id:'fixture-advisory',status:'published' as const,title:'Controlled field advisory — layout fixture'}],contacts:[{id:'fixture-contact',name:'Consenting fixture contact',phone:'not-a-real-destination',location:'Synthetic QA',consent:true,verified:true}],campaigns:[]};
const blocked=async()=>{throw Error('No live mutations exist in this layout fixture');};
const value:Store={data,demo:false,loading:false,error:null,refresh:async()=>{},addSurvey:blocked,review:blocked,saveDraft:blocked,generateAdvisory:blocked,publish:blocked,addContact:blocked,reset:()=>{},operation:async(action:string)=>{
 if(action==='sms-preview')return {id:'fixture-advisory',advisory_revision:1,hash:'synthetic-layout-only',count:1,message:'RiceGuardAI\nControlled advisory for layout testing only. No real farmer or SMS destination is used. Review the field bulletin before making farm decisions.',segments:1,encoding:'GSM-7',gateway:'connected',dispatch_enabled:false,receipt_ready:true,device_selected:true,sim_selected:true,quiet_hours:false,resume_at:null,existing_campaign_id:null,recipients:[]};
 if(action==='sms-status')return {campaigns:[]};
 return blocked();
}};
const mapView=new URLSearchParams(location.search).get('view')==='map';
createRoot(document.getElementById('root')!).render(<OperationsContext.Provider value={{...value,data:mapView?sampleData:data}}><MemoryRouter><div className="rg-ops"><div style={{padding:14,background:'#fff2c7',fontWeight:700}}>ISOLATED QA · Synthetic preview · No live database or SMS requests</div><main style={{padding:24,maxWidth:1280,margin:'auto'}}>{mapView?<MapPage/>:<><h1>SMS delivery</h1><SmsDelivery/></>}</main></div></MemoryRouter></OperationsContext.Provider>);
