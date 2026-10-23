// @vitest-environment jsdom
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {render,screen,within,waitFor,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {OperationsContext,type Store} from './store';
import {SeverityAssessment} from './SeverityAssessment';
import {ReviewJourney,ReviewLocation,ReviewPublication,reviewHref} from './ReviewJourney';
import {ReviewWorkspace} from './Upload';
import type {Bulletin,Survey} from './domain';
vi.mock('./LazyMap',()=>({FieldMap:()=> <div aria-label="Map fixture">Map fixture</div>}));
vi.mock('./Map',()=>({FieldMap:()=> <div aria-label="Map fixture">Map fixture</div>}));
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(cleanup);
const survey:Survey={id:'survey-one',name:'Duplicate name',location:'Reviewed area',captured_at:'2026-10-04T12:00:00Z',camera:'Fixture',photos:1,status:'Reviewed',severity:'not_calibrated',lat:null,lng:null,active_result_revision:1,approved_result_revision:1};
const bulletin:Bulletin={id:'advisory-one',survey_id:survey.id,slug:'exact-post',title:'Reviewed draft',location:survey.location,disease:'BLB',diseases:['BLB','Brown Spot'],severity:'not_calibrated',body:'Reviewed wording.',action:'Reviewed action.',date:'2026-10-04',status:'draft',image:'/fixture.jpg',reviewer:null,lat:null,lng:null,advisory_revision:1,result_revision:1,advisory_source_ids:['source-one']};
const ready={bulletin_id:bulletin.id,survey_id:survey.id,advisory_revision:1,ready:true,published:false,evidence_key:'fixture-key',public_path:'/advisories/exact-post',map_eligible:false,steps:['images','severity','location','publish'].map(step=>({step,complete:true,reason:step+' reviewed'}))} as any;
let store:Store;
beforeEach(()=>{store={data:{surveys:[survey],bulletins:[bulletin],jobs:[],assets:[],contacts:[],campaigns:[],models:[],providers:{drive:'configuration_required',kaggle:'configuration_required',sms:'configuration_required',advisory:'configuration_required'}},demo:false,loading:false,error:null,operation:vi.fn(async action=> action==='advisory-guidance'?{approved:[{id:'source-one',active:true,title:'Reviewed source',disease:'BLB',source_reference:'https://example.invalid'}]}:ready),refresh:vi.fn(async()=>{}),addSurvey:vi.fn(),review:vi.fn(),saveDraft:vi.fn(async()=>{}),publish:vi.fn(async()=>({public_path:'/advisories/exact-post',map_eligible:false})),generateAdvisory:vi.fn(),addContact:vi.fn(),reset:vi.fn()};});
function mount(component:React.ReactNode,url='/admin/review?survey=survey-one&advisory=advisory-one&step=severity'){
 const router=createMemoryRouter([{path:'*',element:component}],{initialEntries:[url]});const view=render(<OperationsContext.Provider value={store}><RouterProvider router={router}/></OperationsContext.Provider>);return{...view,router};
}
describe('review controls and exact-survey handoff',()=>{
 it('keeps each disease input and sends both confirmed outcomes in one save',async()=>{
  const user=userEvent.setup();mount(<SeverityAssessment survey={survey} bulletin={bulletin}/>);
  for(const disease of ['BLB','Brown Spot']){const card=within(screen.getByRole('group',{name:disease}));
   await user.selectOptions(card.getByLabelText('Assessment method'),'not_assessed');await user.type(card.getByLabelText('Approving reviewer'),'Fixture reviewer');
   await user.type(card.getByLabelText('Why could severity not be assessed?'),'The fixture does not support independent lesion measurements.');await user.click(card.getByRole('checkbox'));}
  expect(screen.getAllByDisplayValue('Fixture reviewer')).toHaveLength(2);const save=screen.getByRole('button',{name:'Save severity review'});expect((save as HTMLButtonElement).disabled).toBe(false);await user.click(save);
  const calls=vi.mocked(store.operation).mock.calls.filter(c=>c[0]==='save-severity-review');expect(calls).toHaveLength(1);expect((calls[0][1] as any).entries).toHaveLength(2);expect((calls[0][1] as any).advisory_revision).toBe(1);
 },30000);
 it('explains disabled severity controls and AI abstention without invented grades',()=>{
  mount(<SeverityAssessment survey={survey} bulletin={bulletin}/>);expect((screen.getByRole('button',{name:'Save severity review'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getAllByText('AI suggestion: Not estimable')).toHaveLength(2);expect(screen.getAllByText('Reviewer name: at least 2 characters.')).toHaveLength(2);
 });
 it('shows protected published severity rather than disabled editable fields',()=>{
  mount(<SeverityAssessment survey={survey} bulletin={{...bulletin,status:'published'}}/>);expect(screen.queryByLabelText('Assessment method')).toBe(null);expect(screen.getByText(/public record is protected/)).toBeTruthy();
 });
 it('permits no-pin without GPS but rejects invalid entered coordinates',async()=>{
  const user=userEvent.setup();mount(<ReviewLocation survey={survey} bulletin={bulletin} onDirtyChange={()=>{}} onSaved={()=>{}}/>);
  await user.selectOptions(screen.getByLabelText('Public location choice'),'no_pin');await user.click(screen.getByRole('checkbox'));expect((screen.getByRole('button',{name:'Save location choice'}) as HTMLButtonElement).disabled).toBe(false);
  await user.type(screen.getByLabelText('Private latitude'),'100');await user.type(screen.getByLabelText('Private longitude'),'121');await user.click(screen.getByRole('checkbox'));expect((screen.getByRole('button',{name:'Save location choice'}) as HTMLButtonElement).disabled).toBe(true);expect(store.operation).not.toHaveBeenCalled();
 });
 it('needs authoritative readiness and explicit confirmation; publishing never invokes SMS',async()=>{
  const user=userEvent.setup();mount(<ReviewPublication survey={survey} bulletin={bulletin} readiness={ready} onDirtyChange={()=>{}} onSaved={()=>{}}/>);
  fireEvent.load(screen.getByRole('img'));const checkbox=screen.getByRole('checkbox');await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));await user.click(checkbox);await user.dblClick(screen.getByRole('button',{name:'Publish advisory'}));
  expect(store.publish).toHaveBeenCalledTimes(1);expect(store.publish).toHaveBeenCalledWith('advisory-one');expect(screen.getByRole('link',{name:'View public post'}).getAttribute('href')).toBe('/advisories/exact-post');expect(screen.getByText('No SMS was sent.')).toBeTruthy();
 });
 it('previews every actual public_media item and blocks confirmation while an image is missing',async()=>{
  const actual={...bulletin,image:'',public_media:[{url:'/one.jpg',alt:'First accepted image',type:'image'},{url:'/two.jpg',alt:'Second accepted image',type:'image'}]} as Bulletin;
  mount(<ReviewPublication survey={survey} bulletin={actual} readiness={ready} onDirtyChange={()=>{}} onSaved={()=>{}}/>);
  expect(screen.getAllByRole('img')).toHaveLength(2);await screen.findByText('Reviewed source');const checkbox=screen.getByRole('checkbox');expect((checkbox as HTMLInputElement).disabled).toBe(true);
  fireEvent.load(screen.getByAltText('First accepted image'));fireEvent.error(screen.getByAltText('Second accepted image'));expect((checkbox as HTMLInputElement).disabled).toBe(true);expect(screen.getByText(/Preview media could not be loaded/)).toBeTruthy();
 });
 it('uses only accepted private variants before public media staging',()=>{
  store.data.jobs=[{id:'job-one',survey_id:survey.id,status:'Reviewed',progress:100,kaggle_kernel_ref:null,run_id:'run',error:null,created_at:'2026-10-04',updated_at:'2026-10-04',provider:'kaggle_yolo26',result_manifest:{schema_version:'riceguard.result.v2',assets:[{source_asset_id:'asset-one',kind:'image',diseases:[{disease:'BLB',status:'detected'},{disease:'Brown Spot',status:'detected'}]}]},finding_reviews:[{source_asset_id:'asset-one',disease:'BLB',decision:'accepted'},{source_asset_id:'asset-one',disease:'Brown Spot',decision:'rejected'}],review_urls:{'asset-one':{BLB:'/blb-only.jpg',combined:'/combined-rejected.jpg'}}}];
  mount(<ReviewPublication survey={survey} bulletin={{...bulletin,image:'',diseases:['BLB']}} readiness={ready} onDirtyChange={()=>{}} onSaved={()=>{}}/>);
  expect(screen.getByRole('img').getAttribute('src')).toBe('/blb-only.jpg');expect(screen.queryByText(/combined-rejected/)).toBe(null);
 });
 it('does not call missing severity or location choices reviewed outcomes',()=>{
  mount(<ReviewPublication survey={survey} bulletin={bulletin} readiness={ready} onDirtyChange={()=>{}} onSaved={()=>{}}/>);
  expect(screen.getAllByText('No recorded severity review')).toHaveLength(2);
  expect(screen.getByText(/Location choice not reviewed/)).toBeTruthy();
 });
 it('keeps legacy published severity and no-pin status without borrowing a newer assessment',()=>{
  const newer={...survey,field_assessment:{result_revision:2,diseases:{BLB:{category:'high'}}}} as Survey;
  mount(<ReviewPublication survey={newer} bulletin={{...bulletin,status:'published',reviewer:'Approved reviewer',severity:'low',diseases:['BLB']}} readiness={{...ready,published:true,map_eligible:false}} onDirtyChange={()=>{}} onSaved={()=>{}}/>);
  expect(screen.getByText('Low · legacy reviewed qualitative grade')).toBeTruthy();
  expect(screen.getByText(/No public map pin/)).toBeTruthy();
 });
 it('keeps an older published advisory viewable without offering an invalid correction on a newer result',()=>{
  store.data.surveys=[{...survey,active_result_revision:2,approved_result_revision:2}];store.data.bulletins=[{...bulletin,status:'published'}];
  mount(<ReviewWorkspace/>,'/admin/review?survey=survey-one&advisory=advisory-one&step=publish');expect(screen.getByText(/current public post remains visible/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Create correction'})).toBe(null);expect(screen.getByRole('link',{name:'Review the current result'})).toBeTruthy();
 });
 it('fails closed when guidance cannot be fetched, and retains wording after a failed save',async()=>{
  const user=userEvent.setup();store.operation=vi.fn(async()=>{throw Error('Network unavailable');});store.saveDraft=vi.fn(async()=>{throw Error('Save failed');});
  mount(<ReviewPublication survey={survey} bulletin={bulletin} readiness={ready} onDirtyChange={()=>{}} onSaved={()=>{}}/>);await screen.findByText(/Guidance could not be loaded/);expect((screen.getByRole('button',{name:'Publish advisory'}) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText('Public advisory'),' Still unsaved.');await user.click(screen.getByRole('button',{name:'Save reviewed wording'}));await screen.findByText('Save failed');expect((screen.getByLabelText('Public advisory') as HTMLTextAreaElement).value).toContain('Still unsaved.');expect(store.publish).not.toHaveBeenCalled();
 });
 it('persists exact survey/advisory in the URL across steps and blocks unsaved navigation',async()=>{
  const user=userEvent.setup();const {router}=mount(<ReviewJourney survey={survey} bulletin={bulletin}><p>Images fixture</p></ReviewJourney>);
  await screen.findAllByText('AI suggestion: Not estimable');await user.type(screen.getAllByLabelText('Approving reviewer')[0],'Unsaved reviewer');await user.click(screen.getByRole('button',{name:/3.*Confirm location/}));
  expect(router.state.location.search).toContain('step=severity');await user.click(screen.getByRole('button',{name:'Discard and leave'}));await waitFor(()=>expect(router.state.location.search).toContain('step=location'));expect(router.state.location.search).toContain('survey=survey-one');expect(router.state.location.search).toContain('advisory=advisory-one');
 });
 it('never silently substitutes another survey for an invalid deep link',()=>{
  mount(<ReviewWorkspace/>,'/admin/review?survey=missing-record');expect(screen.getByText(/Another survey has not been substituted/)).toBeTruthy();expect(screen.queryByText('Duplicate name ·')).toBe(null);
 });
 it('builds deep links with the exact record, not duplicate display names',()=>{
  expect(reviewHref('survey-two','advisory-two','publish')).toBe('/admin/review?survey=survey-two&advisory=advisory-two&step=publish');
 });
});
