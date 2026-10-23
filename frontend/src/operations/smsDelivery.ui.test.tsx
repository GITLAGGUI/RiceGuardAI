// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SmsDelivery} from './SmsDelivery';
const operation=vi.fn();
vi.mock('./store',()=>({useOperations:()=>({data:{bulletins:[{id:'published-one',title:'Controlled published advisory',status:'published'}],contacts:[{id:'contact-one',name:'Consenting fixture',consent:true,verified:true}],campaigns:[]},demo:false,operation})}));
const preview={id:'published-one',advisory_revision:3,hash:'fixture-preview-hash',count:1,message:'Controlled synthetic preview only',segments:1,encoding:'GSM-7',gateway:'connected',dispatch_enabled:false,receipt_ready:true,device_selected:true,sim_selected:true,quiet_hours:false,resume_at:null,existing_campaign_id:null,recipients:[{id:'contact-one',name:'Consenting fixture'}]};
beforeEach(()=>{cleanup();operation.mockReset();operation.mockResolvedValue(preview);});
function select(){fireEvent.change(screen.getByLabelText('Published advisory'),{target:{value:'published-one'}});fireEvent.change(screen.getByLabelText('Recipients'),{target:{value:'contact-one'}});}
describe('separate SMS preview and explicit campaign UI',()=>{
 it('previews without enqueue and displays disabled sending truthfully',async()=>{
  render(<SmsDelivery/>);select();fireEvent.click(screen.getByRole('button',{name:'Preview only — no SMS'}));
  await screen.findByText('Controlled synthetic preview only');expect(operation.mock.calls).toEqual([['sms-preview',{id:'published-one',contact_id:'contact-one'}]]);
  expect(screen.getByText('Sending is disabled. This preview did not send or queue any messages.')).toBeTruthy();expect((screen.getByRole('button',{name:'Queue SMS to 1 contact'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('requires explicit confirmation and exact preview revision/hash to enqueue',async()=>{
  operation.mockImplementation(async(action:string)=>action==='sms-preview'?{...preview,dispatch_enabled:true}:action==='sms-enqueue'?{recipients:1,duplicate:false}:{campaigns:[]});
  render(<SmsDelivery/>);select();fireEvent.click(screen.getByRole('button',{name:'Preview only — no SMS'}));await screen.findByText(preview.message);
  expect((screen.getByRole('button',{name:'Queue SMS to 1 contact'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Queue SMS to 1 contact'}));
  await waitFor(()=>expect(operation).toHaveBeenCalledWith('sms-enqueue',{id:'published-one',contact_id:'contact-one',advisory_revision:3,hash:'fixture-preview-hash',confirmed:true}));
  await screen.findByText('Queued for 1 contact. Delivery has not been confirmed.');
 });
 it('clears the preview and confirmation when the recipient selection changes',async()=>{
  operation.mockResolvedValue({...preview,dispatch_enabled:true});render(<SmsDelivery/>);select();fireEvent.click(screen.getByRole('button',{name:'Preview only — no SMS'}));await screen.findByText(preview.message);fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Recipients'),{target:{value:''}});expect(screen.queryByText(preview.message)).toBe(null);expect(operation).toHaveBeenCalledTimes(1);
 });
 it('refreshes receipt counts from recipient aggregates',async()=>{
  operation.mockResolvedValue({campaigns:[{id:'campaign-one',bulletin_id:'published-one',created_at:'2026-10-05T00:00:00Z',recipients:2,status:'mixed',counts:{delivered:1,failed:1}}]});
  render(<SmsDelivery/>);fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));await screen.findByText('1 delivered · 1 failed');expect(operation).toHaveBeenCalledWith('sms-status');
 });
});
