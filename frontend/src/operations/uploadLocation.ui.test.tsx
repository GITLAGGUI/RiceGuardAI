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
function details(){fireEvent.change(screen.getByLabelText('Survey name'),{target:{value:'Synthetic field'}});fireEvent.change(screen.getByLabelText('Camera / aircraft ID'),{target:{value:'Fixture camera'}});fireEvent.change(screen.getByLabelText('Capture date & time'),{target:{value:'2026-10-05T10:00'}});}
describe('confirmed batch GPS or manual field location',()=>{
 it('shows the five-photo average and requires explicit confirmation before creating a survey',async()=>{
  const user=await upload();expect(screen.getByText(/5 of 5 photos have GPS/)).toBeTruthy();
  const pin=JSON.parse(screen.getByLabelText('Suggested pin').textContent!)[0];expect(pin.lat).toBeCloseTo(17.404);expect(pin.lng).toBeCloseTo(121.7);
  const submit=screen.getByRole('button',{name:'Create demo survey'}) as HTMLButtonElement;expect(submit.disabled).toBe(true);
  details();await user.click(screen.getByRole('checkbox',{name:/I checked that these images/}));await user.click(submit);
  await waitFor(()=>expect(store.addSurvey).toHaveBeenCalledTimes(1));expect(vi.mocked(store.addSurvey).mock.calls[0][0]).toMatchObject({lat:17.404,location_status:'extracted'});
 });
 it('requires a manual pin for screenshots without GPS, then accepts it after confirmation',async()=>{
  fixture.gps=false;const user=await upload(1);expect(screen.getByText(/No photo GPS found/)).toBeTruthy();expect(screen.getByLabelText('Suggested pin').textContent).toBe('[]');
  expect((screen.getByRole('button',{name:'Create demo survey'}) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Choose fixture field'}));details();await user.click(screen.getByRole('checkbox',{name:/I checked that these images/}));await user.click(screen.getByRole('button',{name:'Create demo survey'}));
  await waitFor(()=>expect(store.addSurvey).toHaveBeenCalledTimes(1));expect(vi.mocked(store.addSurvey).mock.calls[0][0]).toMatchObject({lat:17.5,lng:121.8,location_status:'needs_review'});
 });
 it('recomputes when removing a photo and clears confirmation without overwriting a manual pin',async()=>{
  const user=await upload(2);await user.click(screen.getByRole('button',{name:'Choose fixture field'}));await user.click(screen.getByRole('checkbox',{name:/I checked that these images/}));
  await user.click(screen.getByRole('button',{name:'Remove photo-1.jpg'}));await waitFor(()=>expect((screen.getByRole('checkbox',{name:/I checked that these images/}) as HTMLInputElement).checked).toBe(false));
  expect(JSON.parse(screen.getByLabelText('Suggested pin').textContent!)[0].lat).toBe(17.5);expect(screen.getByText(/1 of 1 photos have GPS/)).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Use photo GPS average'}));expect(JSON.parse(screen.getByLabelText('Suggested pin').textContent!)[0].lat).toBe(17.4);
 });
});
