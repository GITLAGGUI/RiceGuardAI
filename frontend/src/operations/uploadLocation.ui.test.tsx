// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {OperationsContext,type Store} from './store';
const fixture=vi.hoisted(()=>({gps:true,index:0}));
vi.mock('exifr',()=>({parse:vi.fn(async(_file:File,tags:any)=>tags?.xmp ? null : fixture.gps ? {latitude:17.4+(fixture.index++)*0.001,longitude:121.7,Orientation:1} : null)}));
vi.mock('hash-wasm',()=>({createSHA256:async()=>({update(){},digest:()=>`hash-${fixture.index++}`}),createMD5:async()=>({update(){},digest:()=>`md5-${fixture.index}`})}));
vi.mock('./Map',()=>({FieldMap:({onPick,points}:any)=><div><output aria-label="Suggested pin">{JSON.stringify(points)}</output><button type="button" onClick={()=>onPick(17.5,121.8)}>Choose fixture field</button></div>}));
import {UploadWorkspace} from './Upload';
let store:Store;
beforeEach(()=>{
 fixture.gps=true;fixture.index=0;
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1024,height:1024,close(){}})));
 store={data:{surveys:[],bulletins:[],jobs:[],assets:[],contacts:[],campaigns:[],models:[],providers:{drive:'configuration_required',kaggle:'configuration_required',sms:'configuration_required',advisory:'configuration_required'}},demo:true,loading:false,error:null,operation:vi.fn(),refresh:vi.fn(),addSurvey:vi.fn(async()=>{}),review:vi.fn(),saveDraft:vi.fn(),publish:vi.fn(),generateAdvisory:vi.fn(),addContact:vi.fn(),reset:vi.fn()} as any;
 const router=createMemoryRouter([{path:'*',element:<UploadWorkspace/>}],{initialEntries:['/demo/upload']});
 render(<OperationsContext.Provider value={store}><RouterProvider router={router}/></OperationsContext.Provider>);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function photo(i:number){const file=new File([new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0])],`photo-${i}.jpg`,{type:'image/jpeg'});Object.defineProperty(file,'slice',{value:()=>({arrayBuffer:async()=>new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0]).buffer})});return file;}
async function upload(count=5){const user=userEvent.setup();await user.upload(document.querySelector('input[type=file]')!,Array.from({length:count},(_,i)=>photo(i)));await waitFor(()=>expect(screen.getAllByText('Validated locally')).toHaveLength(count));return user;}
describe('automatic GPS location, manual pin only when GPS is missing',()=>{
 it('sets the pin from photo GPS and submits with no extra input',async()=>{
  const user=await upload();expect(screen.getByText('Awtomatiko ang lokasyon')).toBeTruthy();
  const pin=JSON.parse(screen.getByLabelText('Suggested pin').textContent!)[0];expect(pin.lat).toBeCloseTo(17.404);expect(pin.lng).toBeCloseTo(121.7);
  const submit=screen.getByRole('button',{name:'Create demo survey'}) as HTMLButtonElement;expect(submit.disabled).toBe(false);
  await user.click(submit);
  await waitFor(()=>expect(store.addSurvey).toHaveBeenCalledTimes(1));
  expect(vi.mocked(store.addSurvey).mock.calls[0][0]).toMatchObject({lat:17.404,location_status:'verified',location_source:'exif_median'});
  expect(vi.mocked(store.addSurvey).mock.calls[0][0].name).toMatch(/Rice field · /);
 });
 it('asks for a pin when a photo has no GPS, then accepts the manual pin',async()=>{
  fixture.gps=false;const user=await upload(1);expect(screen.getByText('Kailangan ng pin')).toBeTruthy();expect(screen.getByLabelText('Suggested pin').textContent).toBe('[]');
  expect((screen.getByRole('button',{name:'Create demo survey'}) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Choose fixture field'}));await user.click(screen.getByRole('button',{name:'Create demo survey'}));
  await waitFor(()=>expect(store.addSurvey).toHaveBeenCalledTimes(1));
  expect(vi.mocked(store.addSurvey).mock.calls[0][0]).toMatchObject({lat:17.5,lng:121.8,location_source:'manual_pin'});
 });
 it('lets a manual pin replace the GPS pin and switch back',async()=>{
  const user=await upload(2);await user.click(screen.getByRole('button',{name:'Choose fixture field'}));
  expect(JSON.parse(screen.getByLabelText('Suggested pin').textContent!)[0].lat).toBe(17.5);
  await user.click(screen.getByRole('button',{name:'Gamitin ulit ang GPS ng larawan'}));
  expect(JSON.parse(screen.getByLabelText('Suggested pin').textContent!)[0].lat).toBeCloseTo(17.4,1);
 });
});
