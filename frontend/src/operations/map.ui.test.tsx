// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
const map=vi.hoisted(()=>({invalidateSize:vi.fn(),setView:vi.fn(),fitBounds:vi.fn(),getZoom:()=>8,project:([lat,lng]:number[])=>({x:lng*100,y:lat*100}),getSize:()=>({y:590}),getContainer:()=>document.createElement('div')}));
vi.mock('react-leaflet',()=>({
 MapContainer:({children,scrollWheelZoom}:any)=><div data-testid="map" data-scroll-wheel={String(scrollWheelZoom)}>{children}</div>,
 Marker:({children,icon,position,title}:any)=><div data-testid="marker" data-icon={icon.options.html} data-position={JSON.stringify(position)} aria-label={title}>{children}</div>,
 Tooltip:({children}:any)=><span data-testid="tooltip">{children}</span>,
 Popup:({children}:any)=><div>{children}</div>,TileLayer:()=>null,GeoJSON:()=>null,useMap:()=>map,useMapEvents:()=>null
}));
import {FieldMap} from './Map';
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));vi.clearAllMocks();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const points=[{id:'a',lat:17.6,lng:121.7,name:'First post',severity:'moderate' as const,href:'/bulletin/a'},{id:'b',lat:17.6,lng:121.7,name:'Latest post',severity:'unknown' as const,href:'/bulletin/b'}];
describe('individual survey pins',()=>{
 it('renders every post as a pin without a numbered cluster and retains shared bulletin links',()=>{render(<FieldMap points={points} publicView/>);expect(screen.getAllByTestId('marker')).toHaveLength(2);for(const marker of screen.getAllByTestId('marker')){expect(marker.dataset.icon).toContain('<svg');expect(marker.dataset.position).toBe('[17.6,121.7]');}expect(screen.getAllByTestId('tooltip')).toHaveLength(2);expect(screen.getAllByRole('link',{name:'Latest post'})[0].getAttribute('href')).toBe('/bulletin/b');expect(screen.getAllByRole('link',{name:'First post'})).toHaveLength(2);});
 it('never clusters nearby distinct pins',()=>{render(<FieldMap points={[points[0],{...points[1],lat:17.60001}]} publicView/>);expect(screen.getAllByTestId('marker')).toHaveLength(2);expect(screen.getAllByTestId('marker')[1].dataset.position).toBe('[17.60001,121.7]');expect(screen.queryByText(/posts at the same location/)).toBeNull();});
 it('enables wheel zoom inside the map and resets mainland',()=>{render(<FieldMap points={points}/>);expect(screen.getByTestId('map').dataset.scrollWheel).toBe('true');expect(screen.getByRole('region',{name:'Region II operations map'}).hasAttribute('data-lenis-prevent-wheel')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Reset map to Region II'}));expect(map.setView).toHaveBeenCalledWith([17.4,121.72],8,{animate:false});expect(map.invalidateSize).toHaveBeenCalledWith({pan:false});});
 it('enables wheel zoom on the public map without replacing individual pins',()=>{render(<FieldMap points={points} publicView/>);expect(screen.getByTestId('map').dataset.scrollWheel).toBe('true');expect(screen.getAllByTestId('marker')).toHaveLength(2);});
 it('selects the exact private record from a shared location',()=>{const select=vi.fn();render(<FieldMap points={points.map(p=>({...p,href:undefined}))} onSelect={select}/>);fireEvent.click(screen.getAllByRole('button',{name:'Latest post'})[0]);expect(select).toHaveBeenCalledWith('b');});
});
