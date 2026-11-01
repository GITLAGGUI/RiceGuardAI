// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {OperationsContext,type Store} from './store';
vi.mock('./PipelineMonitor',()=>({PipelineTimeline:()=>null}));
import {VerifyWorkspace} from './VerifyFindings';
const asset='11111111-1111-4111-8111-111111111111';
function mount(){
 const store={data:{surveys:[{id:'s1',name:'Poblacion 1',location:'Santa Maria',captured_at:'2026-10-23T00:00:00Z',camera:'DJI',status:'Needs review',photos:1,severity:'low',lat:null,lng:null}],
  bulletins:[],assets:[{id:asset,survey_id:'s1',name:'a.jpg',mime:'image/jpeg',bytes:1,status:'Verified',preview_url:null,drive_file_id:null,checksum:null,width:10,height:10,duration_seconds:null,
   classification:{model:'cls',probs:{BLB:0.3,'Brown Spot':0.05,'Soil Nitrogen':0.65},top:'Soil Nitrogen',uncertain:false,tiles:9}}],
  jobs:[{id:'j1',survey_id:'s1',status:'Needs review',progress:100,kaggle_kernel_ref:null,run_id:'r',error:null,finding_reviews:[],review_urls:{},
   result_manifest:{schema_version:'riceguard.result.v2',assets:[{source_asset_id:asset,kind:'image',diseases:[{disease:'BLB',status:'detected'}],measurements:{plant_pixels:1000,lesion_pixels:{BLB:62,'Brown Spot':0}}}]}}],
  contacts:[],campaigns:[],models:[],providers:{}},demo:false,loading:false,error:null,operation:vi.fn(async()=>({})),refresh:vi.fn(async()=>{})} as unknown as Store;
 const router=createMemoryRouter([{path:'*',element:<VerifyWorkspace/>}],{initialEntries:['/admin/review?survey=s1']});
 render(<OperationsContext.Provider value={store}><RouterProvider router={router}/></OperationsContext.Provider>);
 return store;
}
afterEach(()=>cleanup());
describe('specialist check: Tama / Hindi sigurado / Mali',()=>{
 it('saves an Uncertain finding with its reason and shows the photo classifier',async()=>{
  const store=mount();const user=userEvent.setup();
  expect(screen.getByText('Mukhang Soil nitrogen')).toBeTruthy();expect(screen.getByText('65%')).toBeTruthy();
  await user.click(screen.getByRole('button',{name:/Hindi sigurado/}));
  const save=screen.getByRole('button',{name:'I-save'}) as HTMLButtonElement;expect(save.disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText('Bakit hindi sigurado?'),'soil_nitrogen');
  expect(save.disabled).toBe(false);await user.click(save);
  await waitFor(()=>expect(store.operation).toHaveBeenCalledWith('verify-findings',{id:'s1',reviews:[{source_asset_id:asset,disease:'BLB',decision:'uncertain',reason:'soil_nitrogen',note:undefined}]}));
 },20000);
 it('offers dry leaf and soil nitrogen as reasons for Mali',async()=>{
  mount();const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:/Mali/}));
  const options=[...(screen.getByLabelText('Bakit mali?') as HTMLSelectElement).options].map((o)=>o.value);
  expect(options).toEqual(expect.arrayContaining(['dry_leaf','soil_nitrogen','healthy']));
 },20000);
});
