import { createRoot } from 'react-dom/client';
import { FieldMap } from '../src/operations/Map';
import { useSmoothScroll } from '../src/components/motion/useSmoothScroll';
import '../src/styles/index.css';
import '../src/operations/operations.css';
import '../src/operations/accessibility.css';
function Fixture() {
  useSmoothScroll();
  return <main style={{padding:24,maxWidth:1100,margin:'auto'}}>
    <h1>Isolated map interaction check</h1>
    <p>No backend writes, uploads, inference, publications or SMS. Wheel over the map to zoom; wheel outside to scroll.</p>
    <FieldMap large points={[{id:'fixture',lat:17.6,lng:121.7,name:'Synthetic QA pin',severity:'unknown'}]} />
    <section aria-label="Page scrolling test" style={{height:1200,padding:30}}>Normal page scrolling outside the map</section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
