import { Activity, Target, Settings2 } from 'lucide-react';

const ModelPerformance = () => {
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-on-surface tracking-tight">Model Performance</h2>
        <p className="text-on-surface-variant text-sm mt-1">YOLOv8-seg evaluation metrics — trained on 1,600 images.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-container p-6 rounded-xl">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">mAP@50</span>
            <Activity className="text-primary" size={18} />
          </div>
          <div className="text-4xl font-black text-primary mb-4">0.891</div>
        </div>

        <div className="bg-surface-container p-6 rounded-xl">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">Precision</span>
            <Target className="text-secondary" size={18} />
          </div>
          <div className="text-4xl font-black text-on-surface mb-4">0.908</div>
        </div>
      </div>

      <div className="bg-surface-container rounded-xl p-6 flex flex-col mb-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-on-surface mb-6">Training Configuration</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-y-4 gap-x-8 mb-8 flex-1">
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">Architecture</p>
            <p className="text-xs font-semibold text-on-surface">YOLOv8-Segmentation</p>
          </div>
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">Dataset Size</p>
            <p className="text-xs font-semibold text-on-surface">1,600 Annotations</p>
          </div>
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">Input Size</p>
            <p className="text-xs font-semibold text-on-surface">640 x 640 px</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelPerformance;
