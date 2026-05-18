export function AdminSettings() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
          System
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Settings</h1>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <div className="font-semibold">Edge function secrets</div>
        <p className="text-sm text-stone-500 mt-2 leading-relaxed">
          Provider credentials live in Supabase Edge function secrets, not in the database
          or frontend. To rotate keys, run:
        </p>
        <pre className="mt-3 px-4 py-3 rounded-lg bg-stone-900 text-stone-100 text-xs overflow-auto">
          {`supabase secrets set OLLAMA_API_KEY=<new>
supabase secrets set SMS_GATE_USER=<user>
supabase secrets set SMS_GATE_PASS=<pass>
supabase secrets set OPENWEATHER_API_KEY=<key>`}
        </pre>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <div className="font-semibold">Database</div>
        <p className="text-sm text-stone-500 mt-2">
          Schema migrations live in <code>supabase/migrations/</code>. To apply:{" "}
          <code className="px-1 py-0.5 rounded bg-stone-100">supabase db push</code>.
        </p>
      </div>
    </div>
  );
}
